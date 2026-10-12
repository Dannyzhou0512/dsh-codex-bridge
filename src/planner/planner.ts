/** Read-only P6 orchestration. There is deliberately no apply/import/write method. */
import { z } from 'zod';
import { convertSnapshot } from '../converter/convert.js';
import { projectSnapshot } from '../converter/project.js';
import { validateConversionPlan } from '../converter/validate.js';
import { canonicalJson, digest, freeze } from '../converter/canonical.js';
import { cancelled, PlanningError } from './errors.js';
import { inspectTarget } from './target.js';
import type { ImportPlan, ImportRequest, PlanningCapabilities, PlanningLimits, PlanningOperation, FreshnessResult } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limitsSchema = z.object({ maxTargetEvents: positive, maxTargetBytes: positive,
  readChunkEvents: positive, maxPlanBytes: positive }).strict();

/** Checks consistency only; a digest is not proof of ownership, consent or trust. */
export function validateImportPlan(plan: ImportPlan): void {
  try {
    const { planDigest, ...data } = plan;
    if (plan.schemaVersion !== 1 || plan.dryRun !== true || plan.sessionId !== plan.conversion.sessionId
      || plan.sourceFingerprint !== plan.conversion.sourceFingerprint || plan.request.threadId !== plan.conversion.source.id
      || digest('dsh-codex-bridge/import-plan/v1', data) !== planDigest) throw new Error();
    if (plan.workspace) {
      const { fingerprint, ...mapping } = plan.workspace;
      if (digest('dsh-codex-bridge/workspace-plan/v1', mapping) !== fingerprint) throw new Error();
    }
    if (plan.conversion.plan) validateConversionPlan(plan.conversion.plan);
    if (plan.state === 'ready' && (plan.conversion.state !== 'ready' || !plan.conversion.plan
      || plan.workspace?.status !== 'ready' || plan.target?.state !== 'absent' || plan.target.live
      || plan.blockers.length > 0 || plan.conversion.plan.header.cwd !== plan.workspace.canonicalCwd)) throw new Error();
  } catch { throw new PlanningError('invalid-plan'); }
}
export class ImportPlanner {
  readonly #caps: PlanningCapabilities;
  readonly #limits: PlanningLimits;
  readonly #providers = new WeakMap<ImportPlan, symbol>();
  /** No capability, filesystem, transport or clock calls during construction. */
  constructor(capabilities: PlanningCapabilities, limits: PlanningLimits) {
    const checked = limitsSchema.safeParse(limits);
    if (!checked.success) throw new PlanningError('invalid-options');
    this.#limits = checked.data; this.#caps = { ...capabilities };
  }
  #operation(operation: PlanningOperation): void {
    if (operation?.dryRun !== true) throw new PlanningError('invalid-options');
    cancelled(operation.signal);
  }
  /** Hydrate one source and build a frozen, bounded, strictly read-only plan. */
  async plan(request: ImportRequest, operation: PlanningOperation): Promise<ImportPlan> {
    this.#operation(operation);
    try {
      if (typeof request?.threadId !== 'string' || request.threadId.length === 0
        || (request.remapCwd !== undefined && (typeof request.remapCwd !== 'string' || request.remapCwd.length === 0)))
        throw new PlanningError('invalid-request');
      const { source, mapper, persistence, liveSession } = this.#caps;
      if (!source || !mapper || !persistence || !liveSession) throw new PlanningError('capability-unavailable');
      const signal = operation.signal;
      const snapshot = projectSnapshot(await source.read(request.threadId, signal), request.conversion.limits.maxToolDepth);
      cancelled(signal);
      if (snapshot.thread.id !== request.threadId) throw new PlanningError('invalid-request');
      // Validate policy and project public content before invoking path/target reads.
      convertSnapshot(snapshot, { ...request.conversion,
        target: { selectedCwd: null, pathStyle: process.platform === 'win32' ? 'windows' : 'posix' } });
      const policy = { mode: request.conversion.mode, acceptedLosses: [...request.conversion.acceptedLosses],
        titleMode: request.conversion.titleMode, limits: {
          maxInputBytes: request.conversion.limits.maxInputBytes, maxResultBytes: request.conversion.limits.maxResultBytes,
          maxEvents: request.conversion.limits.maxEvents, maxTextBytes: request.conversion.limits.maxTextBytes,
          maxToolDepth: request.conversion.limits.maxToolDepth, titleMaxBytes: request.conversion.limits.titleMaxBytes } };
      const owned: ImportRequest = { threadId: request.threadId, conversion: policy,
        ...request.remapCwd === undefined ? {} : { remapCwd: request.remapCwd } };
      const workspace = await mapper.plan({ originalCwd: snapshot.thread.cwd,
        ...owned.remapCwd === undefined ? {} : { remapCwd: owned.remapCwd } }, signal);
      cancelled(signal);
      const conversion = convertSnapshot(snapshot, { ...policy,
        target: { selectedCwd: workspace.canonicalCwd, pathStyle: workspace.pathStyle } });
      const target = await inspectTarget(this.#caps, this.#limits, conversion, signal);
      cancelled(signal);
      let state: ImportPlan['state'];
      const blockers: string[] = [];
      if (target.state === 'imported') state = 'already-imported';
      else if (target.state === 'conflict' || target.state === 'source-changed') state = 'conflict';
      else if (target.state === 'incomplete') state = 'incomplete';
      else if (conversion.state === 'unsupported') state = 'unsupported';
      else if (workspace.status === 'capability-unavailable') state = 'capability-unavailable';
      else if (workspace.status === 'needs-remap') state = 'needs-remap';
      else state = conversion.state;
      if (state !== 'ready' && state !== 'already-imported') {
        if (target.reason) blockers.push(target.reason);
        if (workspace.status !== 'ready') blockers.push('workspace-' + workspace.status);
        blockers.push(...conversion.blockers);
      }
      const warnings = [...new Set([...workspace.warnings, ...conversion.warnings.map(warning => warning.code),
        'snapshot-liveness-not-global', 'freshness-check-is-not-write-reservation',
        ...state === 'already-imported' ? ['existing-import-retained-no-overwrite'] : []])];
      const data = { schemaVersion: 1 as const, dryRun: true as const, state,
        request: owned, sessionId: conversion.sessionId, sourceFingerprint: conversion.sourceFingerprint,
        conversion, workspace, target, blockers, warnings };
      const result = { ...data, planDigest: digest('dsh-codex-bridge/import-plan/v1', data) };
      if (Buffer.byteLength(canonicalJson(result), 'utf8') > this.#limits.maxPlanBytes)
        throw new PlanningError('content-limit');
      validateImportPlan(result);
      // Own the complete graph without freezing caller-owned snapshots/capability values.
      const plan = freeze(structuredClone(result));
      this.#providers.set(plan, persistence.identity);
      return plan;
    } catch (error) {
      cancelled(operation.signal);
      if (error instanceof PlanningError) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'content-limit')
        throw new PlanningError('content-limit');
      throw new PlanningError('capability-failed');
    }
  }
  /** Bind an issued plan to the same public persistence provider used by an importer. No I/O. */
  assertPersistenceProvider(plan: ImportPlan, identity: symbol): void {
    validateImportPlan(plan);
    if (!this.#providers.has(plan) || this.#providers.get(plan) !== identity
      || this.#caps.persistence?.identity !== identity) throw new PlanningError('invalid-plan');
  }
  /** Re-read everything before later P7 use. Only plans issued by this instance may be checked. */
  async checkFresh(plan: ImportPlan, operation: PlanningOperation): Promise<FreshnessResult> {
    this.#operation(operation);
    validateImportPlan(plan);
    if (!this.#providers.has(plan)) throw new PlanningError('invalid-plan');
    const currentPlan = await this.plan(plan.request, operation);
    const reasons: string[] = [];
    if (this.#providers.get(plan) !== this.#caps.persistence?.identity) reasons.push('persistence-provider-changed');
    if (plan.sourceFingerprint !== currentPlan.sourceFingerprint) reasons.push('source-changed');
    if (plan.workspace?.fingerprint !== currentPlan.workspace?.fingerprint) reasons.push('workspace-or-directory-changed');
    if (canonicalJson(plan.target) !== canonicalJson(currentPlan.target)) reasons.push('target-changed');
    if (plan.state !== currentPlan.state || plan.conversion.plan?.planDigest !== currentPlan.conversion.plan?.planDigest)
      reasons.push('decision-changed');
    return freeze({ state: reasons.length ? 'stale-plan' : 'fresh', reasons, currentPlan });
  }
}
