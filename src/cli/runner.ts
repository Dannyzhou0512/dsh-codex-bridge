/** Owned one-shot CLI operation. Source closes before AppExit; native writes remain in the P7/P9 APIs. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-app-boot';
import { CodexHistoryReader } from '../codex/reader.js';
import { CodexReadError } from '../codex/errors.js';
import { WorkspaceMapper } from '../workspace/mapper.js';
import { ImportPlanner } from '../planner/planner.js';
import { SessionImporter } from '../importer/importer.js';
import type { ImportCapabilities } from '../importer/types.js';
import { BatchImporter } from '../batch/batch.js';
import { canonicalJson, digest } from '../converter/canonical.js';
import { CliError } from './errors.js';
import { parseCliConfig } from './config.js';
import type { CliInvocation, CliOutcome } from './types.js';
function encode(value: unknown, limit: number): string {
  const text = canonicalJson(value);
  if (Buffer.byteLength(text, 'utf8') > limit) throw new CliError('output-limit');
  return text;
}
export async function runCliOperation(ctx: Context, rawConfig: unknown, invocation: CliInvocation, signal?: AbortSignal): Promise<CliOutcome> {
  let reader: CodexHistoryReader | undefined;
  let code = 1, output = '', limit = 8192, writeAttempted = false;
  try {
    const config = parseCliConfig(rawConfig); limit = config.io.maxOutputBytes;
    const profile = ctx.get('profileContext');
    if (!profile) throw new CliError('capability-unavailable');
    const args = ctx.get('cmdlineArgs')?.get() ?? [];
    if (Buffer.byteLength(canonicalJson(args), 'utf8') > config.io.maxArgBytes) throw new CliError('invalid-config');
    if (signal?.aborted) throw new CliError('cancelled');
    reader = new CodexHistoryReader(config.reader);
    const identity = { name: profile.name, home: profile.home, dir: profile.dir,
      bundles: [...profile.startedBundles], configDigest: digest('dsh-codex-bridge/cli-config/v1', config) };
    if (invocation.action === 'list') {
      const threads = await reader.list({ sourceKinds: invocation.sourceKinds ?? config.scan.sourceKinds,
        archived: invocation.archived ?? config.scan.archived }, signal);
      output = encode({ schemaVersion: 1, action: 'list', dryRun: true, profile: profile.name,
        threads, countSemantics: 'unknown-until-hydrated' }, limit); code = 0;
    } else {
      const persistence = ctx.get('sessionPersistence'), registry = ctx.get('workspaceRegistry'), sessions = ctx.get('sessions');
      if (!persistence || !registry || !sessions) throw new CliError('capability-unavailable');
      const mapper = new WorkspaceMapper({ persistence, registry }, config.mapping);
      const planner = new ImportPlanner({ source: reader, persistence, mapper, liveSession: id => sessions.get(id) !== undefined }, config.planning);
      const cache = ctx.get('sessionProjectionCache') as ImportCapabilities['cache'];
      const importer = new SessionImporter({ planner, persistence, mapper, liveSession: id => sessions.get(id) !== undefined,
        ...cache ? { cache } : {} }, config.importing);
      const batch = new BatchImporter({ planner, importer }, config.batch);
      const requests = invocation.threads.map(threadId => ({ threadId,
        conversion: { ...config.conversion, mode: invocation.mode ?? config.conversion.mode, acceptedLosses: [...invocation.losses] },
        ...invocation.remap === undefined ? {} : { remapCwd: invocation.remap } }));
      const plan = await batch.plan(requests, { dryRun: true, cache: config.cache, ...signal ? { signal } : {} });
      const reviewDigest = digest('dsh-codex-bridge/cli-review/v1', { identity, planDigest: plan.planDigest });
      if (invocation.action === 'preview') {
        output = encode({ schemaVersion: 1, action: 'preview', dryRun: true, profile: profile.name, reviewDigest,
          entries: plan.entries.map(entry => ({ threadId: entry.threadId, sessionId: entry.sessionId,
            state: entry.plan?.state ?? entry.state, error: entry.error,
            source: entry.plan?.conversion.source ?? null, statistics: entry.plan?.conversion.statistics ?? null,
            preview: entry.plan?.conversion.preview ?? [], requiredLosses: entry.plan?.conversion.requiredLosses ?? [],
            warnings: entry.plan?.warnings ?? [], blockers: entry.plan?.blockers ?? [] })) }, limit);
        code = plan.state === 'cancelled' ? 130 : plan.entries.some(e => !e.plan) ? 3 : 0;
      } else if (invocation.action === 'plan') {
        output = encode({ schemaVersion: 1, action: 'plan', dryRun: true, profile: profile.name, reviewDigest, plan }, limit);
        code = plan.state === 'cancelled' ? 130 : plan.entries.some(e => !e.plan || !['ready', 'already-imported'].includes(e.plan.state)) ? 3 : 0;
      } else {
        if (invocation.execute && !invocation.reviewedDigest) throw new CliError('review-required');
        if (invocation.execute && invocation.reviewedDigest !== reviewDigest) throw new CliError('review-stale');
        const envelope = { schemaVersion: 1, action: 'apply', dryRun: !invocation.execute, profile: profile.name, reviewDigest, result: null };
        if (Buffer.byteLength(canonicalJson(envelope), 'utf8') + config.batch.maxResultBytes + 1024 > limit) throw new CliError('output-limit');
        writeAttempted = invocation.execute;
        const result = await batch.apply(plan, { dryRun: !invocation.execute, selectedThreadIds: [...invocation.threads],
          ...invocation.execute ? { approval: { planDigest: plan.planDigest, items: plan.entries.filter(e => e.plan).map(e => ({
            threadId: e.threadId, planDigest: e.plan!.planDigest, acceptedLosses: e.plan!.request.conversion.acceptedLosses })) } } : {},
          ...signal ? { signal } : {} });
        output = encode({ ...envelope, result }, limit);
        code = result.state === 'cancelled' ? 130 : result.state === 'partial' ? 3 : 0;
      }
    }
  } catch (error) {
    const safe = signal?.aborted ? 'cancelled' : error instanceof CliError ? error.code
      : error instanceof CodexReadError ? 'codex-' + error.code : 'operation-failed';
    code = safe === 'cancelled' ? 130 : 1;
    output = encode({ schemaVersion: 1, action: invocation.action, error: safe,
      outcomeMayHaveCommitted: writeAttempted, dryRun: !writeAttempted }, limit);
  } finally {
    try { await reader?.close(); }
    catch { code = 1; output = canonicalJson({ schemaVersion: 1, action: invocation.action,
      error: 'reader-close-failed', outcomeMayHaveCommitted: writeAttempted, dryRun: !writeAttempted }); }
  }
  return { code, output };
}
