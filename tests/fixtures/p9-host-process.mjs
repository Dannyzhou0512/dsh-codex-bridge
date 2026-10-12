/** Real published rc.2 Loader batch, never real Codex history or formal profiles. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { hostEntries } from './p3/host-config.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2], mode = process.argv[3] ?? 'write';
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const face = async name => import(pathToFileURL(require.resolve('dsh-codex-bridge/' + name)).href);
const { BatchImporter } = await face('batch'), { ImportPlanner } = await face('planner');
const { SessionImporter } = await face('importer'), { WorkspaceMapper } = await face('workspace'), { convertSnapshot } = await face('converter');
const cwd = join(directory, 'workspace'); await mkdir(cwd, { recursive: true });
const sources = new Map();
for (const id of ['batch-a', 'batch-b', 'batch-c', 'batch-unselected']) {
  const source = publicSnapshot(); source.thread.id = id; source.thread.title = 'P9 ' + id; source.thread.cwd = cwd; sources.set(id, source);
}
const config = join(directory, 'p9-cordis.yml'); await writeFile(config, JSON.stringify(hostEntries(directory, ['write', 'failure', 'cancel'].includes(mode), 'zstd')));
let ctx, report; const restore = [], postRestore = [], attempts = [];
function deny(object, key, bucket = restore) {
  if (typeof object?.[key] !== 'function') return;
  const original = object[key]; object[key] = () => { attempts.push(key); throw new Error('P9 forbidden boundary'); };
  bucket.push(() => { object[key] = original; });
}
async function read(persistence, id) { const handle = await persistence.open(id, 'read');
  try { return { header: handle.header, events: (await handle.read()).events }; } finally { await handle.close(); } }
const selectedIds = ['batch-a', 'batch-b', 'batch-c'];
try {
  ctx = await boot('p9-batch-integration', config);
  const persistence = ctx.get('sessionPersistence'), registry = ctx.get('workspaceRegistry'), sessions = ctx.get('sessions');
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const planner = new ImportPlanner({ source: { read: async id => sources.get(id) }, mapper, persistence, liveSession: id => sessions.get(id) !== undefined },
    { maxTargetEvents: 4000, maxTargetBytes: 4000000, readChunkEvents: 4, maxPlanBytes: 5000000 });
  const importer = new SessionImporter({ planner, mapper, persistence, liveSession: id => sessions.get(id) !== undefined },
    { maxReadEvents: 4000, maxReadBytes: 4000000, readChunkEvents: 4, maxResultBytes: 8192 });
  const batch = new BatchImporter({ planner, importer }, { maxEntries: 30, maxSelectionBytes: 1000000,
    maxPlanBytes: 10000000, maxResultBytes: 1000000, maxItemResultBytes: 8192 });
  const { target, ...conversion } = options(cwd);
  const requests = [...sources.keys()].map(threadId => ({ threadId, conversion }));
  requests.splice(1, 0, requests[0]);
  const plan = await batch.plan(requests, { dryRun: true, cache: 'skip' });
  assert.equal(plan.duplicateCount, 1); assert.equal(plan.entries.length, 4);
  const approve = value => ({ dryRun: false, selectedThreadIds: selectedIds, approval: { planDigest: value.planDigest,
    items: value.entries.filter(e => selectedIds.includes(e.threadId) && e.plan).map(e => ({
      threadId: e.threadId, planDigest: e.plan.planDigest, acceptedLosses: e.plan.request.conversion.acceptedLosses })) } });
  if (mode === 'write') {
    const before = { sessions: await persistence.list(), workspaces: registry.list().map(row => ({ id: row.id, sessionIds: [...row.sessionIds] })) };
    deny(persistence, 'create', postRestore); deny(registry, 'create', postRestore); deny(registry, 'initializeDefault', postRestore);
    for (const key of ['create', 'prepare', 'enter', 'announce', 'flush', 'fork']) deny(sessions, key);
    for (const key of ['create', 'resolveAgent', 'prompt']) deny(ctx.get('sessionController'), key);
    deny(ctx.get('storageDomain'), 'open');
    const dry = await batch.apply(plan, { dryRun: true, selectedThreadIds: selectedIds });
    assert.equal(dry.summary.dryRun, 3); assert.deepEqual(attempts, []);
    assert.deepEqual({ sessions: await persistence.list(), workspaces: registry.list().map(row => ({ id: row.id, sessionIds: [...row.sessionIds] })) }, before);
    for (const undo of postRestore.splice(0).reverse()) undo();
    let active = 0, maximum = 0; const order = [], apply = importer.apply.bind(importer);
    importer.apply = async (...args) => { active++; maximum = Math.max(maximum, active); order.push(args[0].request.threadId);
      try { return await apply(...args); } finally { active--; } };
    const result = await batch.apply(plan, approve(plan));
    assert.equal(result.summary.completed, 3, JSON.stringify(result)); assert.equal(result.summary.notSelected, 1);
    assert.equal(maximum, 1); assert.deepEqual(order, selectedIds);
    assert.equal(registry.list().length, 1); assert.equal((await persistence.list()).length, 3);
    assert.deepEqual(result.entries.filter(e => e.selected).map(e => e.rebasedWorkspace), [false, true, true]);
    for (const entry of result.entries.filter(e => e.selected)) {
      const expected = convertSnapshot(sources.get(entry.threadId), options(cwd)).plan;
      assert.deepEqual((await read(persistence, entry.sessionId)).events, expected.events);
      assert(registry.list()[0].sessionIds.includes(entry.sessionId));
      assert.equal(entry.result.effects.writerCloseSucceeded, true);
    }
    assert.deepEqual(attempts, []); assert.equal(ctx.get('p3Probe').requests.length, 0);
    for (const undo of restore.splice(0).reverse()) undo();
    const root = [...ctx.loader.entries()].find(row => row.options.id === 'dsh-codex-bridge-host');
    await root.fiber.dispose(); await ctx.loader.await();
    report = { phase: 'P9', mode, nativeSessions: 3, sharedWorkspace: true, ownRebase: true, strictDryRun: true,
      serialMaximum: maximum, unselectedNotWritten: true, bridgeUnloaded: true, modelCalls: 0 };
  } else if (mode === 'failure' || mode === 'cancel') {
    const first = plan.entries[0], create = persistence.create, stop = new AbortController();
    persistence.create = async (...args) => {
      const writer = await create.apply(persistence, args), append = writer.append;
      if (writer.id === first.sessionId) writer.append = async (events, opts) => {
        await append.call(writer, mode === 'failure' ? events.slice(0, 4) : events, opts);
        if (mode === 'failure') throw new Error('PRIVATE_P9_FAILURE');
        stop.abort();
      };
      return writer;
    };
    restore.push(() => { persistence.create = create; });
    const result = await batch.apply(plan, { ...approve(plan), ...mode === 'cancel' ? { signal: stop.signal } : {} });
    assert.equal(result.entries[0].state, 'incomplete');
    assert.equal(result.entries[0].result.effects.writerCloseSucceeded, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_P9_FAILURE/);
    const expected = convertSnapshot(sources.get('batch-a'), options(cwd)).plan;
    assert.deepEqual((await read(persistence, first.sessionId)).events, mode === 'failure' ? expected.events.slice(0, 4) : expected.events);
    if (mode === 'failure') {
      assert.equal(result.summary.completed, 2); assert.equal((await persistence.list()).length, 3);
      for (const entry of result.entries.filter(e => e.state === 'completed')) {
        assert.equal(entry.rebasedWorkspace, true);
        assert.deepEqual((await read(persistence, entry.sessionId)).events, convertSnapshot(sources.get(entry.threadId), options(cwd)).plan.events);
      }
    } else {
      assert.equal(result.state, 'cancelled'); assert.equal(result.summary.invoked, 1); assert.equal(result.summary.notStarted, 2);
      assert.equal((await persistence.list()).length, 1);
    }
    assert.equal(ctx.get('p3Probe').requests.length, 0);
    report = { phase: 'P9', mode, trueHost: true, currentWriterClosed: true,
      safeNextItemsCompleted: mode === 'failure', cancelledBeforeNext: mode === 'cancel', modelCalls: 0 };
  } else if (mode === 'restart' || mode === 'verify') {
    assert.equal(ctx.get('codexHistory'), undefined);
    assert.equal((await persistence.list()).length, 3);
    const before = await Promise.all(plan.entries.filter(e => selectedIds.includes(e.threadId)).map(e => read(persistence, e.sessionId)));
    const result = await batch.apply(plan, approve(plan));
    assert.equal(result.summary.alreadyImported, 3); assert.equal(result.summary.notSelected, 1);
    assert.deepEqual(await Promise.all(plan.entries.filter(e => selectedIds.includes(e.threadId)).map(e => read(persistence, e.sessionId))), before);
    if (mode === 'restart') {
      const entry = plan.entries.find(e => e.threadId === 'batch-b'), controller = ctx.get('sessionController'), signal = new AbortController().signal;
      const resolved = await controller.resolveAgent(entry.sessionId); if ('error' in resolved) throw resolved.error;
      await controller.prompt({ sessionId: entry.sessionId, requestId: 'p9-native-batch-followup', mode: 'queue',
        content: [{ type: 'text', text: 'P9 continue selected Session' }] }, signal);
      await resolved.agent.whenIdle(); await persistence.flush();
      const expected = convertSnapshot(sources.get('batch-b'), options(cwd));
      assert.deepEqual(ctx.get('p3Probe').requests[0], [...expected.preview.map(e => ({ role: 'user', content: e.content })),
        { role: 'user', content: [{ type: 'text', text: 'P9 continue selected Session' }] }]);
      assert.deepEqual(ctx.get('p3Probe').errors, []);
    } else {
      const entry = plan.entries.find(e => e.threadId === 'batch-b');
      assert.deepEqual((await read(persistence, entry.sessionId)).events.filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2]);
      assert(registry.list()[0].sessionIds.includes(entry.sessionId));
    }
    report = { phase: 'P9', mode, nativeSessions: 3, duplicateWithoutNewId: true,
      nativeContinuation: mode === 'restart', nativeTailRetained: mode === 'verify', rootAbsent: true, realModelCalls: 0 };
  } else throw new Error('Unknown P9 mode');
} finally { for (const undo of postRestore.reverse()) undo(); for (const undo of restore.reverse()) undo(); await ctx?.fiber.dispose(); }
console.log('P1_REPORT ' + JSON.stringify(report));
