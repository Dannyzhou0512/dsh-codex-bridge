/** Explicit selected batch; serial orchestration over the same P6 planner and P7 importer. */
import { z } from 'zod';
import { canonicalJson, digest, freeze } from '../converter/canonical.js';
import { sessionIdFor } from '../converter/ids.js';
import { validateImportPlan } from '../planner/planner.js';
import { PlanningError } from '../planner/errors.js';
import { ImportError } from '../importer/errors.js';
import type { ImportPlan, ImportRequest } from '../planner/types.js';
import type { ImportResult } from '../importer/types.js';
import { BatchError } from './errors.js';
import { equalLosses, loss, normalizeSelection } from './selection.js';
import type { BatchCapabilities, BatchLimits, BatchPlanOptions, BatchPlan, BatchEntryPlan,
  BatchApplyOptions, BatchEntryResult, BatchResult } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.object({ maxEntries: positive, maxSelectionBytes: positive, maxPlanBytes: positive,
  maxResultBytes: positive.min(8192), maxItemResultBytes: positive.min(8192) }).strict();
const applySchema = z.object({ dryRun: z.boolean(), selectedThreadIds: z.array(z.string().min(1)),
  approval: z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/), items: z.array(z.object({
    threadId: z.string().min(1), planDigest: z.string().regex(/^[a-f0-9]{64}$/), acceptedLosses: z.array(loss).max(7) })) }).optional() });
const planningCodes = new Set(['invalid-options', 'invalid-request', 'invalid-plan', 'capability-unavailable',
  'capability-failed', 'cancelled', 'content-limit', 'target-changed']);
function safeError(error: unknown, phase: 'planning' | 'importer'): string {
  if (error instanceof PlanningError && planningCodes.has(error.code)) return 'planning-' + error.code;
  if (error instanceof ImportError && ['invalid-options', 'invalid-plan', 'invalid-approval', 'capability-unavailable'].includes(error.code))
    return 'importer-' + error.code;
  return phase + '-failed';
}
/** Pure consistency validator; authorization additionally binds issued in-process originals and explicit selection. */
export function validateBatchPlan(plan: BatchPlan): void {
  try {
    const { planDigest, ...data } = plan;
    if (plan.schemaVersion !== 1 || plan.dryRun !== true || !['skip', 'refresh-if-available'].includes(plan.cache)
      || digest('dsh-codex-bridge/batch-plan/v1', data) !== planDigest) throw new Error();
    const ids = new Set<string>(); let count = 0;
    for (const [index, entry] of plan.entries.entries()) {
      if (entry.index !== index || ids.has(entry.threadId) || entry.sessionId !== sessionIdFor(entry.threadId)
        || !Number.isSafeInteger(entry.occurrences) || entry.occurrences < 1) throw new Error();
      ids.add(entry.threadId); count += entry.occurrences;
      if (entry.plan) {
        validateImportPlan(entry.plan);
        if (entry.state !== 'planned' || entry.plan.conversion.source.id !== entry.threadId || entry.plan.sessionId !== entry.sessionId) throw new Error();
      } else if (entry.state === 'planned') throw new Error();
    }
    if (count !== plan.inputCount || plan.duplicateCount !== count - plan.entries.length) throw new Error();
  } catch { throw new BatchError('invalid-plan'); }
}
export class BatchImporter {
  readonly #caps: BatchCapabilities;
  readonly #limits: BatchLimits;
  readonly #issued = new WeakMap<BatchPlan, Map<string, ImportPlan>>();
  /** Capture only; no scan, source connection, filesystem, Context or model initialization. */
  constructor(capabilities: BatchCapabilities, limits: BatchLimits) {
    const checked = limitsSchema.safeParse(limits);
    if (!checked.success) throw new BatchError('invalid-options');
    this.#caps = { ...capabilities }; this.#limits = checked.data;
  }
  /** Deduplicate explicit requests before reads. Conflicting duplicates fail before any external work. */
  async plan(requests: readonly ImportRequest[], options: BatchPlanOptions): Promise<BatchPlan> {
    if (options?.dryRun !== true || !['skip', 'refresh-if-available'].includes(options.cache)) throw new BatchError('invalid-options');
    const selected = normalizeSelection(requests, this.#limits), entries: BatchEntryPlan[] = [], originals = new Map<string, ImportPlan>();
    let stopped = Boolean(options.signal?.aborted), failed = false;
    for (const selection of selected) {
      const base = { index: entries.length, threadId: selection.request.threadId,
        sessionId: sessionIdFor(selection.request.threadId), occurrences: selection.occurrences };
      if (stopped || options.signal?.aborted) {
        stopped = true; entries.push({ ...base, state: 'not-planned', error: 'cancelled-before-planning', plan: null });
      } else {
        try {
          const plan = await this.#caps.planner.plan(selection.request, { dryRun: true, ...options.signal ? { signal: options.signal } : {} });
          originals.set(base.threadId, plan); entries.push({ ...base, state: 'planned', error: null, plan });
        } catch (error) {
          const cancelled = options.signal?.aborted || (error instanceof PlanningError && error.code === 'cancelled');
          stopped ||= Boolean(cancelled); failed = true;
          entries.push({ ...base, state: cancelled ? 'not-planned' : 'failed', error: cancelled ? 'planning-cancelled' : safeError(error, 'planning'), plan: null });
        }
      }
      if (Buffer.byteLength(canonicalJson(entries), 'utf8') > this.#limits.maxPlanBytes) throw new BatchError('content-limit');
    }
    const data = { schemaVersion: 1 as const, dryRun: true as const, cache: options.cache,
      state: stopped || options.signal?.aborted ? 'cancelled' as const : !entries.length ? 'empty' as const : failed ? 'partial' as const : 'planned' as const,
      inputCount: requests.length, duplicateCount: requests.length - selected.length, entries };
    const value = { ...data, planDigest: digest('dsh-codex-bridge/batch-plan/v1', data) };
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > this.#limits.maxPlanBytes) throw new BatchError('content-limit');
    validateBatchPlan(value);
    const plan = freeze(structuredClone(value)); this.#issued.set(plan, originals); return plan;
  }
  async #effective(original: ImportPlan, owned: Map<string, string>, signal?: AbortSignal): Promise<ImportPlan> {
    const mapping = original.workspace, key = mapping?.canonicalCwd;
    if (original.state !== 'ready' || mapping?.action !== 'create' || !key || !owned.has(key)) return original;
    const freshness = await this.#caps.planner.checkFresh(original, { dryRun: true, ...signal ? { signal } : {} });
    if (freshness.reasons.some(reason => reason !== 'workspace-or-directory-changed')) return original;
    const current = freshness.currentPlan;
    if (current.state === 'ready' && current.workspace?.action === 'reuse' && current.workspace.workspace?.id === owned.get(key)
      && current.workspace.canonicalCwd === key && canonicalJson(current.workspace.target.identity) === canonicalJson(mapping.target.identity)
      && current.sourceFingerprint === original.sourceFingerprint && canonicalJson(current.target) === canonicalJson(original.target)
      && current.conversion.plan?.planDigest === original.conversion.plan?.planDigest)
      return current;
    // Delegate any unrelated drift to P7's usual stale-plan rejection.
    return original;
  }
  /** Serial apply. Selection and every leaf approval are checked before invoking the first importer. */
  async apply(plan: BatchPlan, options: BatchApplyOptions): Promise<BatchResult> {
    if (!Array.isArray(options?.selectedThreadIds) || options.selectedThreadIds.length > this.#limits.maxEntries
      || (options.approval && (!Array.isArray(options.approval.items) || options.approval.items.length > this.#limits.maxEntries))) throw new BatchError('invalid-options');
    const checked = applySchema.safeParse(options);
    if (!checked.success) throw new BatchError('invalid-options');
    validateBatchPlan(plan);
    const originals = this.#issued.get(plan); if (!originals) throw new BatchError('invalid-plan');
    const selected = new Set(checked.data.selectedThreadIds), ids = new Set(plan.entries.map(entry => entry.threadId));
    if ([...selected].some(id => !ids.has(id))) throw new BatchError('invalid-selection');
    const approvals = new Map(checked.data.approval?.items.map(item => [item.threadId, item]) ?? []);
    if (!checked.data.dryRun) {
      if (checked.data.approval?.planDigest !== plan.planDigest || approvals.size !== checked.data.approval.items.length)
        throw new BatchError('invalid-approval');
      for (const entry of plan.entries) {
        if (!selected.has(entry.threadId) || !entry.plan) continue;
        const approval = approvals.get(entry.threadId);
        if (!approval || approval.planDigest !== entry.plan.planDigest
          || !equalLosses(approval.acceptedLosses, entry.plan.request.conversion.acceptedLosses)) throw new BatchError('invalid-approval');
      }
      if ([...approvals.keys()].some(id => !selected.has(id) || !originals.has(id))) throw new BatchError('invalid-approval');
    }
    const entries: { -readonly [Key in keyof BatchEntryResult]: BatchEntryResult[Key] }[] = plan.entries.map(entry => ({
      threadId: entry.threadId, sessionId: entry.sessionId, selected: selected.has(entry.threadId),
      sourceFingerprint: entry.plan?.sourceFingerprint ?? null, sourceCwd: entry.plan?.conversion.source.cwd ?? null,
      targetCwd: entry.plan?.workspace?.canonicalCwd ?? null, plannedState: entry.plan?.state ?? null,
      state: selected.has(entry.threadId) ? 'not-started' : 'not-selected', error: null,
      invocationStarted: false, outcomeMayHaveCommitted: false, rebasedWorkspace: false,
      originalPlanDigest: entry.plan?.planDigest ?? null, effectivePlanDigest: null, result: null,
    }));
    const reserved = Buffer.byteLength(canonicalJson(entries), 'utf8') + 2048
      + entries.filter(entry => entry.selected).length * (this.#limits.maxItemResultBytes + 1024);
    if (reserved > this.#limits.maxResultBytes) throw new BatchError('content-limit');
    const ownedWorkspaces = new Map<string, string>();
    let cancelled = Boolean(options.signal?.aborted);
    for (const entry of entries) {
      if (!entry.selected) continue;
      if (cancelled || options.signal?.aborted) { cancelled = true; entry.error = 'cancelled-before-import'; continue; }
      const original = originals.get(entry.threadId);
      if (!original) {
        const failedPlan = plan.entries.find(item => item.threadId === entry.threadId)!;
        entry.state = failedPlan.state === 'failed' ? 'planning-failed' : 'not-started'; entry.error = failedPlan.error; continue;
      }
      try {
        const effective = checked.data.dryRun ? original : await this.#effective(original, ownedWorkspaces, options.signal);
        if (options.signal?.aborted) { cancelled = true; entry.error = 'cancelled-before-import'; continue; }
        entry.rebasedWorkspace = effective !== original; entry.effectivePlanDigest = effective.planDigest; entry.invocationStarted = true;
        const result = await this.#caps.importer.apply(effective, { dryRun: checked.data.dryRun, cache: plan.cache,
          ...checked.data.dryRun ? {} : { approval: { planDigest: effective.planDigest, acceptedLosses: original.request.conversion.acceptedLosses } },
          ...options.signal ? { signal: options.signal } : {} });
        if (result.sessionId !== entry.sessionId || result.planDigest !== effective.planDigest
          || Buffer.byteLength(canonicalJson(result), 'utf8') > this.#limits.maxItemResultBytes) throw new Error();
        entry.result = structuredClone(result); entry.state = result.state;
        if (!checked.data.dryRun && result.effects.workspaceCreateInvoked === true && result.workspaceId
          && effective.workspace?.canonicalCwd && ['resolved', 'attached', 'pending'].includes(result.workspaceStatus))
          ownedWorkspaces.set(effective.workspace.canonicalCwd, result.workspaceId);
      } catch (error) {
        entry.state = options.signal?.aborted ? 'cancelled' : 'failed';
        entry.error = safeError(error, entry.invocationStarted ? 'importer' : 'planning');
        entry.outcomeMayHaveCommitted = entry.invocationStarted && !checked.data.dryRun;
      }
      cancelled ||= Boolean(options.signal?.aborted) || entry.state === 'cancelled';
    }
    const summary = { selected: selected.size, invoked: entries.filter(entry => entry.invocationStarted).length,
      completed: entries.filter(entry => entry.state === 'completed').length,
      alreadyImported: entries.filter(entry => entry.state === 'already-imported').length,
      dryRun: entries.filter(entry => entry.state === 'dry-run').length,
      blocked: entries.filter(entry => ['blocked', 'stale-plan', 'conflict'].includes(entry.state)).length,
      failed: entries.filter(entry => ['failed', 'planning-failed', 'incomplete', 'workspace-pending'].includes(entry.state)).length,
      notStarted: entries.filter(entry => entry.selected && entry.state === 'not-started').length,
      notSelected: entries.filter(entry => !entry.selected).length };
    const value: BatchResult = { schemaVersion: 1, dryRun: checked.data.dryRun, planDigest: plan.planDigest,
      state: cancelled ? 'cancelled' : !selected.size ? 'empty' : summary.blocked || summary.failed || summary.notStarted ? 'partial' : 'completed',
      entries, summary, warnings: ['batch-is-not-atomic-no-global-rollback',
        ...entries.some(entry => entry.outcomeMayHaveCommitted) ? ['importer-outcome-unavailable-commit-uncertain'] : [],
        ...cancelled ? ['cancellation-retains-prior-commits'] : []] };
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > this.#limits.maxResultBytes) throw new BatchError('content-limit');
    return freeze(value);
  }
}
