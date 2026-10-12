/** P7 single-session writer. No startup wiring, ledger, private file access, resume or model call. */
import { z } from 'zod';
import { SessionAlreadyExistsError, SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence';
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence';
import { canonicalJson, freeze } from '../converter/canonical.js';
import { validateConversionPlan } from '../converter/validate.js';
import type { ConversionPlan } from '../converter/types.js';
import { validateImportPlan } from '../planner/planner.js';
import { PlanningError } from '../planner/errors.js';
import type { ImportPlan } from '../planner/types.js';
import { checkAbort, ImportError, ImportFailure } from './errors.js';
import { assertReadbackCapacity, headersMatch, verifyReadback } from './readback.js';
import type { ImportCapabilities, ImportEffects, ImportLimits, ImportOptions, ImportResult, ImportStage, ImportState } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.object({ maxReadEvents: positive, maxReadBytes: positive, readChunkEvents: positive,
  maxResultBytes: positive.min(8192) }).strict();
const losses = z.enum(['assistant-role-recall', 'tool-information-recall', 'reasoning-summary-recall',
  'non-text-input-omitted', 'unknown-item-omitted', 'context-compaction-unrestored', 'tool-output-unavailable']);
const optionsSchema = z.object({ dryRun: z.boolean(), cache: z.enum(['skip', 'refresh-if-available']),
  approval: z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/), acceptedLosses: z.array(losses) }).optional() });
type MutableResult = { -readonly [Key in keyof ImportResult]: ImportResult[Key] };
type Outcome = Omit<MutableResult, 'effects' | 'warnings'> & { effects: ImportEffects; warnings: string[] };
function equalLosses(a: readonly string[], b: readonly string[]): boolean {
  return canonicalJson([...new Set(a)].sort()) === canonicalJson([...new Set(b)].sort());
}
export class SessionImporter {
  readonly #caps: ImportCapabilities;
  readonly #limits: ImportLimits;
  /** Only capture services and explicit limits; never launch a transport or touch storage here. */
  constructor(capabilities: ImportCapabilities, limits: ImportLimits) {
    const checked = limitsSchema.safeParse(limits);
    if (!checked.success) throw new ImportError('invalid-options');
    this.#limits = checked.data; this.#caps = { ...capabilities };
  }
  #finish(outcome: Outcome): ImportResult {
    if (outcome.effects.workspaceCreateInvoked !== false && !['completed', 'already-imported', 'dry-run'].includes(outcome.state))
      outcome.warnings.push('workspace-registration-may-remain');
    outcome.warnings = [...new Set(outcome.warnings)];
    // Fixed finite codes, bounded ids and no raw error/history keep every outcome below the structural minimum.
    if (Buffer.byteLength(canonicalJson(outcome), 'utf8') > this.#limits.maxResultBytes)
      throw new ImportError('invalid-options');
    return freeze(structuredClone(outcome));
  }
  async #write(payload: ConversionPlan, outcome: Outcome, signal?: AbortSignal): Promise<boolean> {
    let writer: SessionHandle | undefined, failure: { stage: ImportStage; reason: string; state: ImportState } | undefined;
    try {
      checkAbort(signal); outcome.stage = 'create'; outcome.effects.sessionCreateInvoked = true;
      writer = await this.#caps.persistence!.create(payload.header, signal ? { signal } : {});
      outcome.effects.writerAcquired = true;
      checkAbort(signal);
      if (writer.access !== 'write' || writer.id !== payload.header.id || !headersMatch(payload.header, writer.header))
        throw new ImportFailure('writer-header-mismatch');
      outcome.stage = 'append'; outcome.effects.appendInvoked = true;
      await writer.append(payload.events, signal ? { signal } : {});
      outcome.effects.appendSucceeded = true; checkAbort(signal);
      outcome.stage = 'flush'; outcome.effects.flushInvoked = true;
      await writer.flush(signal ? { signal } : {});
      outcome.effects.flushSucceeded = true; checkAbort(signal);
    } catch (error) {
      const collision = error instanceof SessionAlreadyExistsError || error instanceof SessionAlreadyOwnedError;
      const reason = error instanceof SessionAlreadyExistsError ? 'session-already-exists'
        : error instanceof SessionAlreadyOwnedError ? 'session-already-owned'
        : error instanceof ImportFailure ? error.code : outcome.stage + '-failed';
      failure = { stage: outcome.stage, reason,
        state: collision ? 'conflict' : outcome.effects.sessionCreateInvoked ? 'incomplete' : reason === 'cancelled' ? 'cancelled' : 'failed' };
    } finally {
      if (writer) {
        outcome.effects.writerCloseInvoked = true;
        try { await writer.close(); outcome.effects.writerCloseSucceeded = true; }
        catch {
          outcome.warnings.push('writer-close-failed-release-unconfirmed');
          failure ??= { stage: 'close', reason: 'close-failed', state: 'incomplete' };
        }
      }
    }
    if (failure) {
      outcome.state = failure.state; outcome.stage = failure.stage; outcome.reason = failure.reason;
      if (outcome.effects.sessionCreateInvoked && failure.state !== 'conflict')
        outcome.warnings.push('session-may-be-partially-or-fully-written-no-rollback');
      return false;
    }
    outcome.stage = 'close';
    return true;
  }
  /** Explicit plan approval is required for every non-dry-run invocation, including a no-op duplicate. */
  async apply(plan: ImportPlan, options: ImportOptions): Promise<ImportResult> {
    const checked = optionsSchema.safeParse(options);
    if (!checked.success) throw new ImportError('invalid-options');
    try { validateImportPlan(plan); } catch { throw new ImportError('invalid-plan'); }
    if (!options.dryRun && (!checked.data.approval || checked.data.approval.planDigest !== plan.planDigest
      || !equalLosses(checked.data.approval.acceptedLosses, plan.request.conversion.acceptedLosses)))
      throw new ImportError('invalid-approval');
    const outcome: Outcome = { schemaVersion: 1, dryRun: checked.data.dryRun, sessionId: plan.sessionId,
      planDigest: plan.planDigest, decision: plan.state, state: 'failed', stage: 'approval', reason: null,
      sessionVerified: false, workspaceId: null, workspaceStatus: 'not-attempted', cacheStatus: 'not-attempted',
      effects: { workspaceResolveInvoked: false, workspaceCreateInvoked: false, sessionCreateInvoked: false, writerAcquired: false,
        appendInvoked: false, appendSucceeded: false, flushInvoked: false, flushSucceeded: false,
        writerCloseInvoked: false, writerCloseSucceeded: false, workspaceAttachInvoked: false, attachInvoked: false, cacheInvoked: false }, warnings: [] };
    try {
      checkAbort(options.signal);
      const { planner, persistence, mapper, liveSession } = this.#caps;
      if (!persistence) throw new ImportError('capability-unavailable');
      planner.assertPersistenceProvider(plan, persistence.identity);
      outcome.stage = 'freshness';
      const freshness = await planner.checkFresh(plan, { dryRun: true, ...options.signal ? { signal: options.signal } : {} });
      checkAbort(options.signal);
      const current = freshness.currentPlan; outcome.decision = current.state;
      if (freshness.state !== 'fresh') {
        outcome.state = 'stale-plan'; outcome.reason = 'reviewed-plan-changed';
        return this.#finish(outcome);
      }
      if (current.state === 'already-imported') {
        outcome.state = options.dryRun ? 'dry-run' : 'already-imported'; outcome.sessionVerified = true;
        outcome.workspaceStatus = 'retained'; outcome.warnings.push('existing-history-and-continuation-retained');
        return this.#finish(outcome);
      }
      if (current.state !== 'ready' || !current.conversion.plan || !current.workspace) {
        outcome.state = 'blocked'; outcome.reason = 'plan-not-ready'; return this.#finish(outcome);
      }
      assertReadbackCapacity(current.conversion.plan, this.#limits);
      if (options.dryRun) { outcome.state = 'dry-run'; return this.#finish(outcome); }
      if (!mapper || !liveSession || typeof persistence.create !== 'function') throw new ImportError('capability-unavailable');
      outcome.stage = 'workspace';
      outcome.effects.workspaceResolveInvoked = true; outcome.effects.workspaceCreateInvoked = null;
      const resolution = await mapper.resolve(current.workspace, { dryRun: false, ...options.signal ? { signal: options.signal } : {} });
      outcome.effects.workspaceCreateInvoked = resolution.effects.createInvoked;
      if (resolution.status !== 'resolved' || !resolution.workspace || resolution.canonicalCwd !== current.conversion.plan.header.cwd) {
        outcome.state = resolution.status === 'stale-plan' ? 'stale-plan' : resolution.status === 'cancelled' ? 'cancelled' : 'failed';
        outcome.reason = 'workspace-resolution-not-completed'; return this.#finish(outcome);
      }
      if (Buffer.byteLength(String(resolution.workspace.id), 'utf8') > 512) throw new ImportFailure('workspace-identity-invalid');
      outcome.workspaceId = resolution.workspace.id; outcome.workspaceStatus = 'resolved'; checkAbort(options.signal);
      // Our Workspace registration can legitimately change create -> reuse. Re-read and allow only that expected transition.
      outcome.stage = 'recheck';
      const effective = await planner.plan(current.request, { dryRun: true, ...options.signal ? { signal: options.signal } : {} });
      checkAbort(options.signal); planner.assertPersistenceProvider(effective, persistence.identity);
      if (effective.state !== 'ready' || !effective.conversion.plan || !effective.workspace
        || effective.sourceFingerprint !== current.sourceFingerprint
        || effective.conversion.plan.planDigest !== current.conversion.plan.planDigest
        || canonicalJson(effective.workspace.target.identity) !== canonicalJson(current.workspace.target.identity)
        || effective.workspace.workspace?.id !== outcome.workspaceId || effective.workspace.canonicalCwd !== resolution.canonicalCwd) {
        outcome.state = 'stale-plan'; outcome.reason = 'source-path-or-target-changed-before-create';
        return this.#finish(outcome);
      }
      validateConversionPlan(effective.conversion.plan);
      if (liveSession(plan.sessionId)) { outcome.state = 'conflict'; outcome.reason = 'live-session-collision'; return this.#finish(outcome); }
      if (!await this.#write(effective.conversion.plan, outcome, options.signal)) return this.#finish(outcome);
      outcome.stage = 'readback';
      const verified = await verifyReadback(persistence, effective.conversion.plan, this.#limits, options.signal);
      outcome.sessionVerified = true; checkAbort(options.signal);
      outcome.stage = 'attach';
      outcome.effects.workspaceAttachInvoked = true; outcome.effects.attachInvoked = null;
      const attachment = await mapper.attach(effective.workspace, plan.sessionId, { dryRun: false, ...options.signal ? { signal: options.signal } : {} });
      outcome.effects.attachInvoked = attachment.effects.attachInvoked;
      if (attachment.status !== 'attached' && attachment.status !== 'already-attached') {
        outcome.state = 'workspace-pending'; outcome.workspaceStatus = 'pending'; outcome.reason = 'workspace-attach-not-completed';
        return this.#finish(outcome);
      }
      outcome.workspaceStatus = 'attached'; outcome.state = 'completed';
      if (options.signal?.aborted) {
        outcome.reason = 'cancelled-after-attach-commit'; outcome.warnings.push('session-and-workspace-commit-retained');
        outcome.cacheStatus = checked.data.cache === 'skip' ? 'skipped' : 'pending';
        return this.#finish(outcome);
      }
      outcome.stage = 'cache';
      if (checked.data.cache === 'skip') outcome.cacheStatus = 'skipped';
      else if (!this.#caps.cache) outcome.cacheStatus = 'unavailable';
      else {
        outcome.effects.cacheInvoked = true;
        try {
          await this.#caps.cache.coldSnapshot(verified.header, verified.inherited, verified.events);
          outcome.cacheStatus = 'requested'; outcome.warnings.push('cache-writeback-not-acknowledged');
          if (options.signal?.aborted) { outcome.reason = 'cancelled-after-cache-request'; outcome.warnings.push('session-and-workspace-commit-retained'); }
        } catch { outcome.cacheStatus = 'pending'; outcome.warnings.push('cache-refresh-failed-session-retained'); }
      }
      outcome.stage = 'done'; return this.#finish(outcome);
    } catch (error) {
      const cancelled = options.signal?.aborted || (error instanceof ImportFailure && error.code === 'cancelled')
        || (error instanceof PlanningError && error.code === 'cancelled');
      const reason = cancelled ? 'cancelled'
        : error instanceof ImportError || error instanceof ImportFailure || error instanceof PlanningError ? error.code : outcome.stage + '-failed';
      outcome.reason = reason;
      if (outcome.effects.workspaceCreateInvoked === null || outcome.effects.attachInvoked === null)
        outcome.warnings.push('workspace-mutation-effects-unknown');
      if (outcome.sessionVerified) { outcome.state = 'workspace-pending'; outcome.workspaceStatus = 'pending'; }
      else if (outcome.effects.sessionCreateInvoked) { outcome.state = 'incomplete'; outcome.warnings.push('session-may-be-partially-or-fully-written-no-rollback'); }
      else outcome.state = cancelled ? 'cancelled' : reason === 'invalid-plan' ? 'stale-plan' : 'failed';
      return this.#finish(outcome);
    }
  }
}
