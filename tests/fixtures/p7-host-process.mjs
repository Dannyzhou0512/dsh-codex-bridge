/** Actual rc.2 Loader Host; only source/model inputs are synthetic. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence';
import { hostEntries } from './p3/host-config.mjs';
import { history } from './p3/events.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2], mode = process.argv[3] ?? 'write';
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const face = async name => import(pathToFileURL(require.resolve('dsh-codex-bridge/' + name)).href);
const { SessionImporter } = await face('importer'), { ImportPlanner } = await face('planner');
const { WorkspaceMapper } = await face('workspace'), { convertSnapshot } = await face('converter');
const cwd = join(directory, 'workspace'); await mkdir(cwd, { recursive: true });
const source = publicSnapshot(); source.thread.cwd = cwd;
source.turns.push({ ...structuredClone(source.turns[0]), id: 'p7-second', status: 'interrupted' },
  { ...structuredClone(source.turns[0]), id: 'p7-third', status: 'failed', hasError: true });
const converted = convertSnapshot(source, options(cwd)), expected = converted.plan;
const config = join(directory, 'p7-cordis.yml'), entries = hostEntries(directory, mode !== 'resume' && mode !== 'verify', 'zstd');
entries.push({ id: 'p7-real-cache', name: '@deepseek-ai/dsh-session-projection-cache',
  config: { writeEveryEvents: 1000, writeIntervalMs: 60000 } });
await writeFile(config, JSON.stringify(entries));
let ctx, racer, report, networkAttempts = 0;
const restore = [], mutations = [];
globalThis.fetch = () => { networkAttempts++; throw new Error('P7 no network'); };
net.Socket.prototype.connect = () => { networkAttempts++; throw new Error('P7 no sockets'); };
function deny(object, key, label = key) {
  const original = object[key];
  if (typeof original !== 'function') return;
  object[key] = () => { mutations.push(label); throw new Error('P7 denied mutator'); };
  restore.push(() => { object[key] = original; });
}
try {
  ctx = await boot('p7-single-importer-integration', config);
  const persistence = ctx.get('sessionPersistence'), registry = ctx.get('workspaceRegistry');
  const query = ctx.get('sessionQuery'), controller = ctx.get('sessionController'), cache = ctx.get('sessionProjectionCache');
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const planner = new ImportPlanner({ source: { read: async () => source }, mapper, persistence,
    liveSession: id => ctx.get('sessions').get(id) !== undefined },
    { maxTargetEvents: 4000, maxTargetBytes: 4000000, readChunkEvents: 5, maxPlanBytes: 5000000 });
  const importer = new SessionImporter({ planner, mapper, persistence, cache,
    liveSession: id => ctx.get('sessions').get(id) !== undefined },
    { maxReadEvents: 4000, maxReadBytes: 4000000, readChunkEvents: 5, maxResultBytes: 8192 });
  const { target, ...conversion } = options(cwd);
  const plan = await planner.plan({ threadId: source.thread.id, conversion }, { dryRun: true });
  const selected = value => ({ dryRun: false, cache: 'refresh-if-available',
    approval: { planDigest: value.planDigest, acceptedLosses: value.request.conversion.acceptedLosses } });
  if (mode === 'write') {
    const before = { sessions: await persistence.list(), workspaces: registry.list().map(row => ({ id: row.id, sessionIds: row.sessionIds })) };
    for (const [service, methods] of [[persistence, ['create', 'flush']], [registry, ['create', 'initializeDefault']],
      [cache, ['coldSnapshot', 'write', 'hydratePrepared']], [ctx.get('storageDomain'), ['open']]])
      for (const method of methods) deny(service, method);
    const dry = await importer.apply(plan, { dryRun: true, cache: 'refresh-if-available' });
    assert.equal(dry.state, 'dry-run'); assert.deepEqual(mutations, []);
    for (const undo of restore.splice(0).reverse()) undo();
    assert.deepEqual({ sessions: await persistence.list(), workspaces: registry.list().map(row => ({ id: row.id, sessionIds: row.sessionIds })) }, before);
    let resolveCheckpoint;
    const checkpoint = new Promise(resolve => { resolveCheckpoint = resolve; });
    const off = ctx.on('domain/changed', change => {
      if (change.domain === 'session_projcache' && change.table === 'sessions' && change.key === plan.sessionId && change.operation === 'put')
        resolveCheckpoint();
    });
    try {
      const result = await importer.apply(plan, selected(plan));
      assert.equal(result.state, 'completed', JSON.stringify(result));
      assert.equal(result.cacheStatus, 'requested'); assert.equal(result.effects.writerCloseSucceeded, true);
      await checkpoint; // Public durable domain event, not a guessed timing delay.
      const stored = await query.readSession(plan.sessionId); assert.deepEqual(stored.events, expected.events);
      assert(registry.list().find(row => row.id === result.workspaceId).sessionIds.includes(plan.sessionId));
      assert.equal((await controller.projections({ sessionId: plan.sessionId }, new AbortController().signal)).values.title, 'Synthetic fixture');
      assert.equal(ctx.get('p3Probe').requests.length, 0);
      const entry = [...ctx.loader.entries()].find(row => row.options.id === 'dsh-codex-bridge-host');
      await entry.fiber.dispose(); await ctx.loader.await(); assert.equal(ctx.get('codexHistory'), undefined);
      const repeat = await planner.plan(plan.request, { dryRun: true });
      assert.equal((await importer.apply(repeat, selected(repeat))).state, 'already-imported');
      assert.deepEqual((await query.readSession(plan.sessionId)).events, expected.events);
      report = { phase: 'P7', mode, importerFromArtifact: true, strictDryRun: true, nativeReadback: true,
        membership: true, actualCacheDurableEvent: true, bridgeUnloaded: true, modelCalls: 0 };
    } finally { off(); }
  } else if (mode === 'resume' || mode === 'verify') {
    assert.equal(ctx.get('codexHistory'), undefined);
    assert.equal(plan.state, 'already-imported');
    assert(registry.list().some(row => row.sessionIds.includes(plan.sessionId)));
    const signal = new AbortController().signal;
    assert((await controller.list({}, signal)).items.some(row => row.sessionId === plan.sessionId));
    assert.equal((await controller.projections({ sessionId: plan.sessionId }, signal)).values.title, 'Synthetic fixture');
    const stored = await query.readSession(plan.sessionId);
    assert.deepEqual(stored.events.slice(0, expected.events.length), expected.events);
    if (mode === 'resume') {
      const resolved = await controller.resolveAgent(plan.sessionId); if ('error' in resolved) throw resolved.error;
      await controller.prompt({ sessionId: plan.sessionId, requestId: 'p7-native-followup', mode: 'queue',
        content: [{ type: 'text', text: 'P7 continue imported public history' }] }, signal);
      await resolved.agent.whenIdle(); await persistence.flush();
      assert.deepEqual(ctx.get('p3Probe').errors, []);
      assert.deepEqual(ctx.get('p3Probe').requests[0], [...converted.preview.map(row => ({ role: 'user', content: row.content })),
        { role: 'user', content: [{ type: 'text', text: 'P7 continue imported public history' }] }]);
      assert(ctx.get('p3Probe').systemPrompts[0].includes('P3 current host system prompt'));
    }
    const before = await query.readSession(plan.sessionId), repeat = await planner.plan(plan.request, { dryRun: true });
    assert.equal((await importer.apply(repeat, selected(repeat))).state, 'already-imported');
    assert.deepEqual((await query.readSession(plan.sessionId)).events, before.events);
    assert.deepEqual(before.events.filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2, 3, 4]);
    assert.doesNotMatch(JSON.stringify(ctx.get('p3Probe').requests), /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
    report = { phase: 'P7', mode, restartNativeContinuation: true, originalPrefixRetained: true,
      membershipSurvivedRestart: true, duplicateRetainedNativeTail: true, bridgeAbsent: true, realModelCalls: 0 };
  } else {
    let expectedState = 'incomplete';
    const originalCreate = persistence.create, originalOpen = persistence.open;
    if (['fault-append', 'fault-flush', 'fault-close'].includes(mode)) {
      persistence.create = async (...args) => {
        const writer = await originalCreate.apply(persistence, args);
        const append = writer.append, flush = writer.flush, close = writer.close;
        if (mode === 'fault-append') writer.append = async events => { await append.call(writer, events.slice(0, 4)); throw new Error('PRIVATE_FAILURE_SENTINEL'); };
        if (mode === 'fault-flush') writer.flush = async () => { throw new Error('PRIVATE_FAILURE_SENTINEL'); };
        if (mode === 'fault-close') writer.close = async () => { await close.call(writer); throw new Error('PRIVATE_FAILURE_SENTINEL'); };
        return writer;
      };
      restore.push(() => { persistence.create = originalCreate; });
    } else if (mode === 'fault-readback') {
      persistence.open = async (...args) => {
        const reader = await originalOpen.apply(persistence, args), read = reader.read;
        if (args[1] === 'read') reader.read = async (...input) => {
          const batch = await read.apply(reader, input), copy = structuredClone(batch.events);
          const user = copy.find(row => row.type === 'user/message'); if (user) user.data.content[0].text += ' corrupted observation';
          return { ...batch, events: copy };
        };
        return reader;
      };
      restore.push(() => { persistence.open = originalOpen; });
    } else if (mode === 'fault-attach') {
      const create = registry.create;
      registry.create = async (...args) => {
        const workspace = await create.apply(registry, args);
        const attach = workspace.attachSession;
        workspace.attachSession = async () => { throw new Error('PRIVATE_FAILURE_SENTINEL'); };
        restore.push(() => { workspace.attachSession = attach; });
        return workspace;
      };
      restore.push(() => { registry.create = create; }); expectedState = 'workspace-pending';
    } else if (mode === 'fault-cache') {
      const cold = cache.coldSnapshot;
      cache.coldSnapshot = () => { throw new Error('PRIVATE_FAILURE_SENTINEL'); };
      restore.push(() => { cache.coldSnapshot = cold; }); expectedState = 'completed';
    } else if (mode === 'race') {
      persistence.create = async header => {
        racer = await originalCreate.call(persistence, header);
        const foreign = history(cwd, 'recall', header.id);
        await racer.append(foreign.events); await racer.flush();
        return originalCreate.call(persistence, header);
      };
      restore.push(() => { persistence.create = originalCreate; }); expectedState = 'conflict';
    } else throw new Error('Unknown P7 mode');
    const result = await importer.apply(plan, selected(plan));
    assert.equal(result.state, expectedState, JSON.stringify(result)); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FAILURE_SENTINEL/);
    for (const undo of restore.splice(0).reverse()) undo();
    if (mode === 'race') {
      assert.equal(result.effects.writerAcquired, false);
      await assert.rejects(persistence.open(plan.sessionId, 'write'), error => error instanceof SessionAlreadyOwnedError);
      assert.deepEqual((await query.readSession(plan.sessionId)).events, history(cwd, 'recall', plan.sessionId).events);
    } else {
      if (mode === 'fault-append') {
        const prefixReader = await persistence.open(plan.sessionId, 'read');
        try { assert.deepEqual((await prefixReader.read()).events, expected.events.slice(0, 4)); }
        finally { await prefixReader.close(); }
      }
      const reopened = await persistence.open(plan.sessionId, 'write'); await reopened.close();
      const stored = await query.readSession(plan.sessionId);
      if (mode === 'fault-append') {
        assert.deepEqual(stored.events.slice(0, 4), expected.events.slice(0, 4));
        assert.equal(stored.events.some(event => event.type === 'codex-bridge/import-receipt'), false);
        assert.deepEqual(stored.events.slice(4).map(event => event.type), ['step/end', 'turn/end']);
        assert.equal(stored.events.at(-1).data.reason.kind, 'interrupted');
      } else assert.deepEqual(stored.events, expected.events);
      if (mode === 'fault-attach') assert.equal(registry.list().some(row => row.sessionIds.includes(plan.sessionId)), false);
      if (mode === 'fault-cache') assert.equal(result.cacheStatus, 'pending');
    }
    assert.equal(ctx.get('p3Probe').requests.length, 0);
    report = { phase: 'P7', mode, realServices: true, state: result.state,
      ownershipReleased: mode !== 'race', racerOwnershipPreserved: mode === 'race', noPrivateRollback: true, modelCalls: 0 };
  }
  assert.deepEqual(await readdir(cwd), [], 'History information never executes commands or diffs');
  assert.equal(networkAttempts, 0);
} finally {
  for (const undo of restore.reverse()) undo();
  await racer?.close(); await ctx?.fiber.dispose();
}
console.log('P1_REPORT ' + JSON.stringify(report));
