/** Genuine published rc.2 Hosts: interrupted response, post-import repair, native tail and fresh-process retry. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { hostEntries } from './p3/host-config.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2], mode = process.argv[3] ?? 'recover';
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const face = async name => import(pathToFileURL(require.resolve('dsh-codex-bridge/' + name)).href);
const { SessionRecovery } = await face('recovery'), { ImportPlanner } = await face('planner');
const { SessionImporter } = await face('importer'), { WorkspaceMapper } = await face('workspace');
const { convertSnapshot } = await face('converter');
const cwd = join(directory, 'workspace'); await mkdir(cwd, { recursive: true });
const source = publicSnapshot(); source.thread.cwd = cwd;
const expected = convertSnapshot(source, options(cwd));
const config = join(directory, 'p8-cordis.yml'), entries = hostEntries(directory, mode === 'crash', 'zstd');
entries.push({ id: 'p8-real-cache', name: '@deepseek-ai/dsh-session-projection-cache', config: { writeEveryEvents: 1000, writeIntervalMs: 60000 } });
await writeFile(config, JSON.stringify(entries));
let ctx, report;
const restore = [], postRestore = [], attempts = [];
function deny(object, key, bucket = restore) {
  if (typeof object?.[key] !== 'function') return;
  const original = object[key]; object[key] = () => { attempts.push(key); throw new Error('P8 forbidden operation'); };
  bucket.push(() => { object[key] = original; });
}
async function stored(persistence, id) {
  const reader = await persistence.open(id, 'read');
  try { return { header: reader.header, events: (await reader.read()).events }; }
  finally { await reader.close(); }
}
try {
  ctx = await boot('p8-recovery-integration', config);
  const persistence = ctx.get('sessionPersistence'), registry = ctx.get('workspaceRegistry'), cache = ctx.get('sessionProjectionCache');
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const planner = new ImportPlanner({ source: { read: async () => source }, mapper, persistence,
    liveSession: id => ctx.get('sessions').get(id) !== undefined },
    { maxTargetEvents: 4000, maxTargetBytes: 4000000, readChunkEvents: 4, maxPlanBytes: 5000000 });
  const { target, ...conversion } = options(cwd);
  const input = await planner.plan({ threadId: source.thread.id, conversion }, { dryRun: true });
  if (mode === 'crash') {
    const importer = new SessionImporter({ planner, mapper, persistence, liveSession: () => false },
      { maxReadEvents: 4000, maxReadBytes: 4000000, readChunkEvents: 4, maxResultBytes: 8192 });
    mapper.attach = async () => {
      assert.equal(ctx.get('p3Probe').requests.length, 0);
      // Called only after importer flush/close/exact readback. Deliberately exit before its response or attach.
      process.stdout.write('P1_REPORT ' + JSON.stringify({ phase: 'P8', mode, responseLostAfterVerifiedWrite: true }) + '\n',
        () => process.exit(0));
      return new Promise(() => {});
    };
    await importer.apply(input, { dryRun: false, cache: 'skip',
      approval: { planDigest: input.planDigest, acceptedLosses: input.request.conversion.acceptedLosses } });
    throw new Error('Crash fixture unexpectedly returned');
  }
  assert.equal(ctx.get('codexHistory'), undefined); assert.equal(input.state, 'already-imported');
  const recovery = new SessionRecovery({ planner, persistence, mapper, registry, cache,
    liveSession: id => ctx.get('sessions').get(id) !== undefined },
    { maxReadEvents: 4000, maxReadBytes: 4000000, readChunkEvents: 4, maxWorkspaces: 100, maxPlanBytes: 1000000, maxResultBytes: 8192 });
  const plan = await recovery.diagnose(input, { dryRun: true, workspace: 'retry', cache: 'refresh-if-available' });
  const before = await stored(persistence, input.sessionId);
  assert.deepEqual(before.events.slice(0, expected.plan.events.length), expected.plan.events);
  if (mode === 'recover') assert.equal(plan.membership, 'unattached');
  if (mode === 'verify') {
    assert.equal(plan.membership, 'attached'); assert(plan.session.continuationEvents > 0);
    assert.deepEqual(before.events.filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2]);
  }
  // Every Recovery call forbids Session mutations, writer opens, controller activation and opening a ledger.
  const open = persistence.open;
  persistence.open = async (id, access, opts) => {
    assert.equal(access, 'read'); const reader = await open.call(persistence, id, access, opts);
    deny(reader, 'append'); deny(reader, 'flush'); return reader;
  };
  restore.push(() => { persistence.open = open; });
  for (const key of ['create', 'flush']) deny(persistence, key);
  for (const key of ['create', 'prepare', 'enter', 'announce', 'flush', 'fork']) deny(ctx.get('sessions'), key);
  for (const key of ['resolveAgent', 'prompt', 'create', 'rename', 'fork']) deny(ctx.get('sessionController'), key);
  deny(ctx.get('storageDomain'), 'open');
  const beforeMembers = registry.list().map(row => ({ id: row.id, sessionIds: [...row.sessionIds] }));
  deny(registry, 'create', postRestore); for (const row of registry.list()) deny(row, 'attachSession', postRestore); deny(cache, 'coldSnapshot', postRestore);
  const dry = await recovery.retry(plan, { dryRun: true }); assert.equal(dry.state, 'dry-run');
  assert.deepEqual(registry.list().map(row => ({ id: row.id, sessionIds: [...row.sessionIds] })), beforeMembers);
  // Post-effect guards have their own owner; read-handle guards may be installed during diagnosis.
  for (const undo of postRestore.splice(0).reverse()) undo();
  let acknowledge;
  const durable = new Promise(resolve => { acknowledge = resolve; });
  const off = ctx.on('domain/changed', change => {
    if (change.domain === 'session_projcache' && change.table === 'sessions' && change.key === input.sessionId && change.operation === 'put') acknowledge();
  });
  try {
    const result = await recovery.retry(plan, { dryRun: false, approval: { planDigest: plan.planDigest } });
    assert.equal(result.state, 'completed', JSON.stringify({ result, attempts })); assert.equal(result.cacheStatus, 'requested');
    await durable;
    assert.deepEqual(await stored(persistence, input.sessionId), before);
    assert(registry.list().some(row => row.sessionIds.includes(input.sessionId)));
    assert.deepEqual(attempts, []); assert.equal(ctx.get('p3Probe').requests.length, 0);
  } finally { off(); }
  for (const undo of restore.splice(0).reverse()) undo();
  if (mode === 'recover') {
    const controller = ctx.get('sessionController'), signal = new AbortController().signal;
    const agent = await controller.resolveAgent(input.sessionId); if ('error' in agent) throw agent.error;
    await controller.prompt({ sessionId: input.sessionId, requestId: 'p8-native-continue', mode: 'queue',
      content: [{ type: 'text', text: 'P8 continue repaired import' }] }, signal);
    await agent.agent.whenIdle(); await persistence.flush();
    assert.deepEqual(ctx.get('p3Probe').errors, []);
    assert.deepEqual(ctx.get('p3Probe').requests[0], [...expected.preview.map(row => ({ role: 'user', content: row.content })),
      { role: 'user', content: [{ type: 'text', text: 'P8 continue repaired import' }] }]);
    const livePlan = await planner.plan(input.request, { dryRun: true });
    assert.equal((await recovery.diagnose(livePlan, { dryRun: true, workspace: 'retry', cache: 'skip' })).state, 'busy');
  } else if (mode === 'verify') {
    const current = await planner.plan(input.request, { dryRun: true });
    const noop = await recovery.diagnose(current, { dryRun: true, workspace: 'retry', cache: 'skip' });
    assert.equal(noop.state, 'noop');
    assert.equal((await recovery.retry(noop, { dryRun: false, approval: { planDigest: noop.planDigest } })).state, 'noop');
  } else throw new Error('Unknown P8 mode');
  report = { phase: 'P8', mode, trueLoaderHost: true, receiptSurvivedResponseLoss: true,
    strictDryRun: true, sessionHeaderAndLogUnchangedByRecovery: true, membership: true,
    cacheDurablePublicEvent: true, nativeTailRetained: mode === 'verify', nativeContinuation: mode === 'recover',
    noLedgerOpen: true, sessionMutatorAttempts: attempts, realModelCalls: 0 };
} finally { for (const undo of postRestore.reverse()) undo(); for (const undo of restore.reverse()) undo(); await ctx?.fiber.dispose(); }
console.log('P1_REPORT ' + JSON.stringify(report));
