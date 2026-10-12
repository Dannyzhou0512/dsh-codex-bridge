/** P8 diagnoses and retries only post-import Workspace/cache effects; never opens a writer or repairs a log. */
import { z } from 'zod';
import { SessionLogOffset } from '@deepseek-ai/dsh-session';
import { canonicalJson, digest, freeze } from '../converter/canonical.js';
import { validateImportPlan } from '../planner/planner.js';
import { PlanningError } from '../planner/errors.js';
import type { ImportPlan } from '../planner/types.js';
import type { WorkspaceMappingPlan } from '../workspace/types.js';
import { readStoredImport } from './inspect.js';
import { abort, RecoveryError } from './errors.js';
import type { RecoveryCapabilities, RecoveryLimits, DiagnosisOptions, RecoveryPlan, RetryOptions,
  RecoveryResult, RecoveryEffects } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.object({ maxReadEvents: positive, maxReadBytes: positive, readChunkEvents: positive,
  maxWorkspaces: positive, maxPlanBytes: positive, maxResultBytes: positive.min(8192) }).strict();
const actionsSchema = z.object({ workspace: z.enum(['skip', 'retry']), cache: z.enum(['skip', 'refresh-if-available']) });
const retrySchema = z.object({ dryRun: z.boolean(), approval: z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/) }).optional() });
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type Outcome = Omit<Mutable<RecoveryResult>, 'effects' | 'warnings'> & { effects: RecoveryEffects; warnings: string[] };
/** A digest is consistency only. Retry also requires this instance's issued plan and explicit approval. */
export function validateRecoveryPlan(plan: RecoveryPlan): void {
  try {
    const { planDigest, ...data } = plan;
    if (plan.schemaVersion !== 1 || plan.dryRun !== true || !actionsSchema.safeParse(plan.actions).success
      || digest('dsh-codex-bridge/recovery-plan/v1', data) !== planDigest) throw new Error();
    if (['recoverable', 'noop'].includes(plan.state) && !plan.session) throw new Error();
  } catch { throw new RecoveryError('invalid-plan'); }
}
export class SessionRecovery {
  readonly #caps: RecoveryCapabilities;
  readonly #limits: RecoveryLimits;
  readonly #issued = new WeakMap<RecoveryPlan, { importPlan: ImportPlan; identity: symbol }>();
  /** No filesystem, transport, registry, model or storage calls here. */
  constructor(capabilities: RecoveryCapabilities, limits: RecoveryLimits) {
    const checked = limitsSchema.safeParse(limits);
    if (!checked.success) throw new RecoveryError('invalid-options');
    this.#caps = { ...capabilities }; this.#limits = checked.data;
  }
  #membership(mapping: WorkspaceMappingPlan, id: ImportPlan['sessionId']): { attached: boolean; id: string | null } {
    const registry = this.#caps.registry;
    if (!registry) throw new RecoveryError('capability-unavailable');
    const rows = registry.list();
    if (rows.length > this.#limits.maxWorkspaces) throw new RecoveryError('content-limit');
    const found = rows.filter(row => row.sessionIds.includes(id));
    if (found.length > 1 || found.some(row => row.path !== mapping.canonicalCwd || row.id !== mapping.workspace?.id))
      throw new RecoveryError('target-changed');
    const workspaceId = mapping.workspace?.id ?? null;
    if (workspaceId !== null && Buffer.byteLength(workspaceId, 'utf8') > 512) throw new RecoveryError('content-limit');
    return { attached: found.length === 1, id: workspaceId };
  }
  #publish(data: Omit<RecoveryPlan, 'planDigest'>, input: ImportPlan): RecoveryPlan {
    const value = { ...data, planDigest: digest('dsh-codex-bridge/recovery-plan/v1', data) };
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > this.#limits.maxPlanBytes) throw new RecoveryError('content-limit');
    validateRecoveryPlan(value);
    const plan = freeze(structuredClone(value));
    this.#issued.set(plan, { importPlan: input, identity: this.#caps.persistence!.identity });
    return plan;
  }
  /** Read-only diagnosis. Uses stored cwd, never a new converter/remap proposal to rewrite immutable metadata. */
  async diagnose(input: ImportPlan, options: DiagnosisOptions): Promise<RecoveryPlan> {
    const actions = actionsSchema.safeParse(options);
    if (options?.dryRun !== true || !actions.success) throw new RecoveryError('invalid-options');
    try {
      abort(options.signal); validateImportPlan(input);
      const { planner, persistence, liveSession } = this.#caps;
      if (!persistence || !liveSession) throw new RecoveryError('capability-unavailable');
      planner.assertPersistenceProvider(input, persistence.identity);
      const fresh = await planner.checkFresh(input, { dryRun: true, ...options.signal ? { signal: options.signal } : {} });
      abort(options.signal);
      const current = fresh.currentPlan;
      const data: Mutable<Omit<RecoveryPlan, 'planDigest'>> = { schemaVersion: 1, dryRun: true, sessionId: current.sessionId,
        importPlanDigest: current.planDigest, sourceFingerprint: current.sourceFingerprint, actions: actions.data,
        state: 'blocked', reason: 'target-not-complete', session: null, workspace: null, membership: 'uninspected',
        workspaceId: null, cacheAvailable: typeof this.#caps.cache?.coldSnapshot === 'function' };
      if (fresh.state !== 'fresh') { data.state = 'stale-plan'; data.reason = 'reviewed-import-plan-changed'; }
      else if (current.state !== 'already-imported') {
        data.state = current.state === 'ready' ? 'absent' : current.state === 'incomplete' ? 'incomplete'
          : current.state === 'conflict' ? 'conflict' : 'blocked';
        data.reason = data.state === 'incomplete' ? 'incomplete-history-no-automatic-repair'
          : data.state === 'conflict' ? 'source-or-target-conflict-no-adoption' : 'target-not-complete';
      } else if (liveSession(current.sessionId) || current.target?.live) { data.state = 'busy'; data.reason = 'live-session-recovery-deferred'; }
      else {
        const stored = await readStoredImport(persistence, current, this.#limits, options.signal); data.session = stored.summary;
        if (liveSession(current.sessionId)) { data.state = 'busy'; data.reason = 'live-session-recovery-deferred'; }
        else {
          data.state = actions.data.cache !== 'skip' && data.cacheAvailable ? 'recoverable' : 'noop'; data.reason = null;
          if (actions.data.workspace === 'retry') {
            if (!this.#caps.mapper || !this.#caps.registry) throw new RecoveryError('capability-unavailable');
            const mapping = await this.#caps.mapper.plan({ originalCwd: stored.header.cwd! }, options.signal);
            data.workspace = mapping;
            if (mapping.status !== 'ready') {
              data.state = mapping.status === 'needs-remap' ? 'needs-remap' : 'blocked';
              data.reason = 'stored-cwd-unavailable-no-header-rewrite';
            } else {
              try {
                const membership = this.#membership(mapping, current.sessionId);
                data.membership = membership.attached ? 'attached' : 'unattached'; data.workspaceId = membership.id;
                if (!membership.attached) data.state = 'recoverable';
              } catch (error) {
                if (!(error instanceof RecoveryError) || error.code !== 'target-changed') throw error;
                data.state = 'conflict'; data.reason = 'workspace-membership-conflict-no-move';
              }
            }
          }
        }
      }
      abort(options.signal);
      return this.#publish(data, current);
    } catch (error) {
      abort(options.signal);
      if (error instanceof RecoveryError) throw error;
      if (error instanceof PlanningError && ['invalid-plan', 'content-limit', 'target-changed', 'capability-unavailable'].includes(error.code))
        throw new RecoveryError(error.code as 'invalid-plan' | 'content-limit' | 'target-changed' | 'capability-unavailable');
      throw new RecoveryError('capability-failed');
    }
  }
  #finish(outcome: Outcome): RecoveryResult {
    if (outcome.effects.workspaceCreateInvoked !== false && outcome.state !== 'completed')
      outcome.warnings.push('workspace-registration-may-remain');
    if (outcome.effects.workspaceCreateInvoked === null || outcome.effects.attachInvoked === null)
      outcome.warnings.push('workspace-mutation-effects-unknown');
    outcome.warnings = [...new Set(outcome.warnings)];
    if (Buffer.byteLength(canonicalJson(outcome), 'utf8') > this.#limits.maxResultBytes) throw new RecoveryError('content-limit');
    return freeze(structuredClone(outcome));
  }
  async #guard(base: RecoveryPlan, input: ImportPlan, signal?: AbortSignal) {
    const persistence = this.#caps.persistence!;
    const current = await this.#caps.planner.plan(input.request, { dryRun: true, ...signal ? { signal } : {} });
    this.#caps.planner.assertPersistenceProvider(current, persistence.identity); abort(signal);
    if (!base.session || !current.target || current.state !== 'already-imported' || current.sourceFingerprint !== base.sourceFingerprint
      || current.target?.contentDigest !== base.session?.contentDigest || current.target.revision !== base.session.revision)
      throw new RecoveryError('target-changed');
    if (current.target.live || this.#caps.liveSession!(base.sessionId)) throw new RecoveryError('target-changed');
    const stored = await readStoredImport(persistence, current, this.#limits, signal);
    let mapping: WorkspaceMappingPlan | null = null;
    if (base.actions.workspace === 'retry') {
      mapping = await this.#caps.mapper!.plan({ originalCwd: stored.header.cwd! }, signal);
      if (mapping.status !== 'ready' || mapping.canonicalCwd !== base.workspace?.canonicalCwd
        || canonicalJson(mapping.target.identity) !== canonicalJson(base.workspace.target.identity)) throw new RecoveryError('target-changed');
      this.#membership(mapping, base.sessionId);
    }
    if (this.#caps.liveSession!(base.sessionId)) throw new RecoveryError('target-changed');
    abort(signal); return { stored, mapping };
  }
  /** Explicit post-import effects only; no Session creation, append, flush or write-open capability exists. */
  async retry(plan: RecoveryPlan, options: RetryOptions): Promise<RecoveryResult> {
    const checked = retrySchema.safeParse(options);
    if (!checked.success) throw new RecoveryError('invalid-options');
    validateRecoveryPlan(plan);
    const binding = this.#issued.get(plan);
    if (!binding || binding.identity !== this.#caps.persistence?.identity) throw new RecoveryError('invalid-plan');
    if (!checked.data.dryRun && checked.data.approval?.planDigest !== plan.planDigest) throw new RecoveryError('invalid-approval');
    const outcome: Outcome = { schemaVersion: 1, dryRun: checked.data.dryRun, sessionId: plan.sessionId,
      planDigest: plan.planDigest, state: 'failed', stage: 'validation', reason: null, sessionVerified: false,
      workspaceId: plan.workspaceId, cacheStatus: 'not-attempted',
      effects: { workspaceResolveInvoked: false, workspaceCreateInvoked: false, workspaceAttachInvoked: false,
        attachInvoked: false, cacheInvoked: false }, warnings: [] };
    try {
      abort(options.signal); outcome.stage = 'recheck';
      const current = await this.diagnose(binding.importPlan, { ...plan.actions, dryRun: true, ...options.signal ? { signal: options.signal } : {} });
      if (current.planDigest !== plan.planDigest) { outcome.state = 'stale-plan'; outcome.reason = 'reviewed-recovery-plan-changed'; return this.#finish(outcome); }
      outcome.sessionVerified = current.session !== null;
      if (current.state !== 'recoverable' && current.state !== 'noop') {
        outcome.state = 'blocked'; outcome.reason = current.reason ?? 'diagnosis-not-recoverable'; return this.#finish(outcome);
      }
      if (checked.data.dryRun) { outcome.state = 'dry-run'; return this.#finish(outcome); }
      if (current.state === 'noop') {
        outcome.state = 'noop'; outcome.cacheStatus = plan.actions.cache === 'skip' ? 'skipped' : 'unavailable';
        return this.#finish(outcome);
      }
      if (plan.actions.workspace === 'retry' && current.membership !== 'attached') {
        outcome.stage = 'resolve'; outcome.effects.workspaceResolveInvoked = true; outcome.effects.workspaceCreateInvoked = null;
        const resolved = await this.#caps.mapper!.resolve(current.workspace!, { dryRun: false, ...options.signal ? { signal: options.signal } : {} });
        outcome.effects.workspaceCreateInvoked = resolved.effects.createInvoked;
        if (resolved.status !== 'resolved' || !resolved.workspace) {
          outcome.state = 'workspace-pending'; outcome.reason = 'workspace-resolution-not-completed'; return this.#finish(outcome);
        }
        if (Buffer.byteLength(resolved.workspace.id, 'utf8') > 512) throw new RecoveryError('content-limit');
        outcome.workspaceId = resolved.workspace.id; abort(options.signal);
        outcome.stage = 'recheck';
        const guarded = await this.#guard(plan, binding.importPlan, options.signal);
        if (guarded.mapping?.workspace?.id !== outcome.workspaceId) throw new RecoveryError('target-changed');
        outcome.stage = 'attach'; outcome.effects.workspaceAttachInvoked = true; outcome.effects.attachInvoked = null;
        const attached = await this.#caps.mapper!.attach(guarded.mapping, plan.sessionId, { dryRun: false, ...options.signal ? { signal: options.signal } : {} });
        outcome.effects.attachInvoked = attached.effects.attachInvoked;
        if (attached.status !== 'attached' && attached.status !== 'already-attached') {
          outcome.state = 'workspace-pending'; outcome.reason = 'workspace-attach-not-completed'; return this.#finish(outcome);
        }
      }
      if (options.signal?.aborted) {
        outcome.state = 'completed'; outcome.reason = 'cancelled-after-workspace-commit'; outcome.cacheStatus = plan.actions.cache === 'skip' ? 'skipped' : 'pending';
        outcome.warnings.push('workspace-commit-retained'); return this.#finish(outcome);
      }
      outcome.stage = 'recheck';
      const latest = await this.#guard(plan, binding.importPlan, options.signal);
      outcome.stage = 'cache';
      if (plan.actions.cache === 'skip') outcome.cacheStatus = 'skipped';
      else if (!this.#caps.cache) outcome.cacheStatus = 'unavailable';
      else {
        outcome.effects.cacheInvoked = true;
        try {
          await this.#caps.cache.coldSnapshot(latest.stored.header, SessionLogOffset(0), latest.stored.events);
          outcome.cacheStatus = 'requested'; outcome.warnings.push('cache-writeback-not-acknowledged');
          if (options.signal?.aborted) { outcome.reason = 'cancelled-after-cache-request'; outcome.warnings.push('post-import-effects-retained'); }
        } catch { outcome.cacheStatus = 'pending'; outcome.warnings.push('cache-refresh-failed-session-retained'); }
      }
      outcome.state = 'completed'; outcome.stage = 'done'; return this.#finish(outcome);
    } catch (error) {
      const cancelled = options.signal?.aborted || (error instanceof RecoveryError && error.code === 'cancelled');
      outcome.state = cancelled ? 'cancelled' : error instanceof RecoveryError && error.code === 'target-changed' ? 'stale-plan'
        : outcome.stage === 'resolve' || outcome.stage === 'attach' ? 'workspace-pending' : 'failed';
      outcome.reason = cancelled ? 'cancelled' : error instanceof RecoveryError ? error.code : outcome.stage + '-failed';
      if (outcome.effects.workspaceAttachInvoked) outcome.warnings.push('workspace-commit-may-have-completed');
      return this.#finish(outcome);
    }
  }
}
