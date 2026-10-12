import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { cp, mkdir, writeFile, rename } from 'node:fs/promises';
import { SessionImporter, ImportError } from '../lib/importer/index.js';
import { SessionAlreadyExistsError } from '@deepseek-ai/dsh-session-persistence';
import { setupImport, approval, importLimits } from './fixtures/p7-data.mjs';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';

test('P7 constructor is lazy and execution requires explicit dryRun/cache/reviewed policy', async t => {
  const f = await setupImport(t), before = structuredClone(f.calls), plan = await f.plan();
  assert.equal(before.source, 0); assert.equal(before.create, 0);
  for (const opts of [{}, { dryRun: false, cache: 'skip' }, { ...approval(plan), approval: { planDigest: '0'.repeat(64), acceptedLosses: [] } },
    { ...approval(plan), approval: { planDigest: plan.planDigest, acceptedLosses: [] } }])
    await assert.rejects(f.importer.apply(plan, opts), error => error instanceof ImportError);
  assert.equal(f.calls.create, 0); assert.equal(f.calls.workspaceCreate, 0);
  const dry = await f.importer.apply(plan, { dryRun: true, cache: 'refresh-if-available' });
  assert.equal(dry.state, 'dry-run'); assert(Object.isFrozen(dry.effects));
  assert.equal(Object.values(dry.effects).some(Boolean), false);
  assert.equal(f.calls.workspaceCreate + f.calls.create + f.calls.cache, 0);
});
test('P7 successful public writer is closed and exact receipt readback precedes association/cache', async t => {
  const f = await setupImport(t), plan = await f.plan();
  const result = await f.importer.apply(plan, approval(plan, 'refresh-if-available'));
  assert.equal(result.state, 'completed'); assert.equal(result.sessionVerified, true);
  assert.equal(result.workspaceStatus, 'attached'); assert.equal(result.cacheStatus, 'requested');
  assert.equal(result.effects.writerCloseSucceeded, true); assert.equal(f.calls.writeOpen, 0);
  assert.deepEqual(f.rows.get(plan.sessionId).events, plan.conversion.plan.events);
  assert.equal(f.rows.get(plan.sessionId).owner, false);
  assert.deepEqual(f.workspaces[0].sessionIds, [plan.sessionId]);
  assert.deepEqual(f.cacheSeen[0].events, plan.conversion.plan.events);
  assert.equal(f.cacheSeen[0].header.delegationDepth, 0);
});
test('P7 duplicate import skips, preserves native continuation and does not repair pending Workspace', async t => {
  const f = await setupImport(t), plan = await f.plan();
  f.fault('attach-before');
  assert.equal((await f.importer.apply(plan, approval(plan))).state, 'workspace-pending');
  f.fault(null);
  const row = f.rows.get(plan.sessionId), count = row.events.length;
  const start = structuredClone(row.events.find(event => event.type === 'turn/start'));
  const end = structuredClone(row.events.find(event => event.type === 'turn/end'));
  start.seq = count; start.data.turn = 2; end.seq = count + 1; end.data.turn = 2; row.events.push(start, end); row.revision = 'native-tail';
  const before = structuredClone(row), creates = f.calls.create, attaches = f.calls.attach;
  const repeated = await f.plan();
  assert.equal((await f.importer.apply(repeated, approval(repeated))).state, 'already-imported');
  assert.deepEqual(row, before); assert.equal(f.calls.create, creates); assert.equal(f.calls.attach, attaches);
  assert.equal((await f.importer.apply(plan, approval(plan))).state, 'stale-plan', 'Old reviewed ready plan is not silently reused');
});
test('P7 source edits, same-name directory replacement and blocked recall refuse writes', async t => {
  const f = await setupImport(t), plan = await f.plan();
  f.source.thread.title = 'changed';
  assert.equal((await f.importer.apply(plan, approval(plan))).state, 'stale-plan');
  const g = await setupImport(t), p = await g.plan();
  await rename(g.cwd, join(g.root, 'old')); await mkdir(g.cwd);
  assert.equal((await g.importer.apply(p, approval(p))).state, 'stale-plan');
  g.request.conversion.acceptedLosses = [];
  const blocked = await g.plan(); assert.equal(blocked.state, 'needs-review');
  assert.equal((await g.importer.apply(blocked, approval(blocked))).state, 'blocked');
  assert.equal(f.calls.create + g.calls.create + f.calls.workspaceCreate + g.calls.workspaceCreate, 0);
});
test('P7 provider mismatch and serialized plan cannot route a reviewed import elsewhere', async t => {
  const f = await setupImport(t), plan = await f.plan();
  const wrong = new SessionImporter({ ...f.caps, persistence: { ...f.persistence, identity: Symbol('other') } }, importLimits);
  assert.equal((await wrong.apply(plan, approval(plan))).state, 'stale-plan');
  assert.equal((await f.importer.apply(structuredClone(plan), approval(plan))).state, 'stale-plan');
  assert.equal(f.calls.create + f.calls.workspaceCreate, 0);
});
test('P7 stat/create race refuses the occupied ID and never opens a writer to adopt it', async t => {
  const f = await setupImport(t), plan = await f.plan();
  f.persistence.create = async header => {
    f.calls.create++; f.rows.set(header.id, { header, events: [], revision: 'racer', owner: true });
    throw new SessionAlreadyExistsError(header.id);
  };
  const result = await f.importer.apply(plan, approval(plan));
  assert.equal(result.state, 'conflict'); assert.equal(result.reason, 'session-already-exists');
  assert.equal(result.effects.writerAcquired, false); assert.equal(f.calls.append + f.calls.writeOpen, 0);
  assert.equal(f.rows.get(plan.sessionId).owner, true, 'Another owner is never closed by the importer');
});
test('P7 writer-held errors and live collision fail without acquiring or replacing ownership', async t => {
  const f = await setupImport(t), plan = await f.plan(); f.fault('already-owned');
  const result = await f.importer.apply(plan, approval(plan)); assert.equal(result.state, 'conflict');
  assert.equal(result.reason, 'session-already-owned'); assert.equal(f.calls.writerClose, 0);
  const g = await setupImport(t), p = await g.plan();
  g.caps.liveSession = () => true;
  const importer = new SessionImporter(g.caps, importLimits);
  assert.equal((await importer.apply(p, approval(p))).state, 'conflict');
  assert.equal(g.calls.create, 0);
});
for (const fault of ['create-before', 'create-after', 'append-before', 'append-partial', 'append-after', 'flush', 'close']) {
  test('P7 write failure: ' + fault + ' reports uncertain completion without private rollback', async t => {
    const f = await setupImport(t), plan = await f.plan(); f.fault(fault);
    const result = await f.importer.apply(plan, approval(plan, 'refresh-if-available'));
    assert.equal(result.state, 'incomplete'); assert.equal(result.sessionVerified, false);
    assert.equal(f.calls.attach + f.calls.cache + f.calls.writeOpen, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FAILURE_SENTINEL/);
    if (result.effects.writerAcquired) { assert.equal(f.calls.writerClose, 1); assert.equal(f.rows.get(plan.sessionId).owner, false); }
    if (fault === 'close') assert.equal(result.effects.writerCloseSucceeded, false);
  });
}
for (const fault of ['readback-open', 'readback-read', 'readback-prefix', 'readback-gap', 'readback-header', 'readback-revision', 'readback-close']) {
  test('P7 durable readback failure: ' + fault + ' never attaches or warms cache', async t => {
    const f = await setupImport(t), plan = await f.plan(); f.fault(fault);
    const result = await f.importer.apply(plan, approval(plan, 'refresh-if-available'));
    assert.equal(result.state, 'incomplete'); assert.equal(result.sessionVerified, false);
    assert.equal(result.effects.writerCloseSucceeded, true); assert.equal(f.calls.attach + f.calls.cache, 0);
    assert.equal(f.rows.get(plan.sessionId).owner, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FAILURE_SENTINEL/);
  });
}
test('P7 Workspace failures retain explicit partial effects and never claim rollback', async t => {
  for (const fault of ['workspace-before', 'workspace-after']) {
    const f = await setupImport(t), plan = await f.plan(); f.fault(fault);
    const result = await f.importer.apply(plan, approval(plan));
    assert.equal(result.state, 'failed'); assert.equal(result.effects.workspaceCreateInvoked, true);
    assert.equal(f.calls.create, 0); assert(result.warnings.includes('workspace-registration-may-remain'));
  }
  for (const fault of ['attach-before', 'attach-after']) {
    const f = await setupImport(t), plan = await f.plan(); f.fault(fault);
    const result = await f.importer.apply(plan, approval(plan, 'refresh-if-available'));
    assert.equal(result.state, 'workspace-pending'); assert.equal(result.sessionVerified, true);
    assert.equal(result.effects.attachInvoked, true); assert.equal(f.calls.cache, 0);
    assert.deepEqual(f.rows.get(plan.sessionId).events, plan.conversion.plan.events);
  }
});
test('P7 cache refresh is optional, fail-soft and never an acknowledgement of durable caching', async t => {
  const f = await setupImport(t), plan = await f.plan(); f.fault('cache');
  const result = await f.importer.apply(plan, approval(plan, 'refresh-if-available'));
  assert.equal(result.state, 'completed'); assert.equal(result.cacheStatus, 'pending'); assert.equal(result.sessionVerified, true);
  const g = await setupImport(t), p = await g.plan();
  const caps = { ...g.caps }; delete caps.cache;
  assert.equal((await new SessionImporter(caps, importLimits).apply(p, approval(p, 'refresh-if-available'))).cacheStatus, 'unavailable');
});
test('P7 source change during Workspace registration is detected before Session creation', async t => {
  const f = await setupImport(t), plan = await f.plan(), create = f.registry.create;
  f.registry.create = async (...args) => { const workspace = await create(...args); f.source.thread.updatedAtMs++; return workspace; };
  const result = await f.importer.apply(plan, approval(plan));
  assert.equal(result.state, 'stale-plan'); assert.equal(f.calls.create, 0);
  assert.equal(result.effects.workspaceCreateInvoked, true);
});
test('P7 cancellation before create, after append and after verified commit preserves honest outcomes', async t => {
  const f = await setupImport(t), plan = await f.plan(), first = new AbortController(); first.abort('PRIVATE_FAILURE_SENTINEL');
  const cancelled = await f.importer.apply(plan, { ...approval(plan), signal: first.signal });
  assert.equal(cancelled.state, 'cancelled'); assert.equal(f.calls.create, 0);
  const g = await setupImport(t), p = await g.plan(), abort = new AbortController(), create = g.persistence.create;
  g.persistence.create = async (...args) => {
    const writer = await create(...args), append = writer.append;
    writer.append = async (...events) => { await append(...events); abort.abort(); };
    return writer;
  };
  const partial = await g.importer.apply(p, { ...approval(p), signal: abort.signal });
  assert.equal(partial.state, 'incomplete'); assert.equal(partial.effects.writerCloseSucceeded, true);
  assert.equal(g.calls.attach, 0);
  const h = await setupImport(t), q = await h.plan(), stop = new AbortController(), attach = h.mapper.attach.bind(h.mapper);
  h.mapper.attach = async (...args) => { const result = await attach(...args); stop.abort(); return result; };
  const complete = await h.importer.apply(q, { ...approval(q, 'refresh-if-available'), signal: stop.signal });
  assert.equal(complete.state, 'completed'); assert.equal(complete.cacheStatus, 'pending'); assert.equal(h.calls.cache, 0);
});
test('P7 result structural minimum is enforced before mutations', async () => {
  assert.throws(() => new SessionImporter({}, { ...importLimits, maxResultBytes: 100 }), error => error.code === 'invalid-options');
});

async function stageP7(t) {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs')); return root;
}
test('P7 real Host importer persists/attaches/cache-checkpoints then survives unload and two process restarts', { timeout: 180000 }, async t => {
  const root = await stageP7(t);
  const write = await runFixture('p7-host-process.mjs', root, ['write']);
  assert.equal(write.strictDryRun, true); assert.equal(write.actualCacheDurableEvent, true);
  const resumed = await runFixture('p7-host-process.mjs', root, ['resume']);
  assert.equal(resumed.restartNativeContinuation, true); assert.equal(resumed.bridgeAbsent, true);
  const verified = await runFixture('p7-host-process.mjs', root, ['verify']);
  assert.equal(verified.duplicateRetainedNativeTail, true); assert.equal(verified.membershipSurvivedRestart, true);
});
for (const mode of ['fault-append', 'fault-flush', 'fault-close', 'fault-readback', 'fault-attach', 'fault-cache', 'race']) {
  test('P7 real published Host fault boundary: ' + mode, { timeout: 120000 }, async t => {
    const root = await stageP7(t), report = await runFixture('p7-host-process.mjs', root, [mode]);
    assert.equal(report.realServices, true); assert.equal(report.noPrivateRollback, true);
    assert.equal(report.modelCalls, 0);
    if (mode === 'race') assert.equal(report.racerOwnershipPreserved, true);
    else assert.equal(report.ownershipReleased, true);
  });
}

test('P7 predictable readback limits fail before writing and abrupt mapper failures preserve unknown effect facts', async t => {
  const f = await setupImport(t), plan = await f.plan();
  const importer = new SessionImporter(f.caps, { ...importLimits, maxReadEvents: 2 });
  const result = await importer.apply(plan, approval(plan)); assert.equal(result.reason, 'readback-content-limit');
  assert.equal(f.calls.create + f.calls.workspaceCreate, 0);
  const tiny = new SessionImporter(f.caps, { ...importLimits, maxReadBytes: 1 });
  assert.equal((await tiny.apply(plan, { dryRun: true, cache: 'skip' })).reason, 'readback-content-limit');
  const g = await setupImport(t), p = await g.plan(), resolve = g.mapper.resolve.bind(g.mapper);
  g.mapper.resolve = async (...args) => { await resolve(...args); throw new Error('PRIVATE_FAILURE_SENTINEL'); };
  const uncertain = await g.importer.apply(p, approval(p));
  assert.equal(uncertain.effects.workspaceResolveInvoked, true); assert.equal(uncertain.effects.workspaceCreateInvoked, null);
  assert(uncertain.warnings.includes('workspace-mutation-effects-unknown')); assert.equal(g.calls.create, 0);
  const h = await setupImport(t), q = await h.plan(), attach = h.mapper.attach.bind(h.mapper);
  h.mapper.attach = async (...args) => { await attach(...args); throw new Error('PRIVATE_FAILURE_SENTINEL'); };
  const pending = await h.importer.apply(q, approval(q));
  assert.equal(pending.state, 'workspace-pending'); assert.equal(pending.sessionVerified, true);
  assert.equal(pending.effects.workspaceAttachInvoked, true); assert.equal(pending.effects.attachInvoked, null);
  assert.doesNotMatch(JSON.stringify(pending), /PRIVATE_FAILURE_SENTINEL/);
});
test('P7 strict user-only import and missing write capabilities share the executor safety gates', async t => {
  const f = await setupImport(t);
  f.source.turns = [f.source.turns[0]]; f.source.turns[0].items = [{ type: 'userMessage', id: 'strict-user',
    content: [{ type: 'text', text: 'strict public input' }] }];
  f.request.conversion.mode = 'strict'; f.request.conversion.acceptedLosses = [];
  const plan = await f.plan(); assert.equal(plan.state, 'ready');
  assert.equal((await f.importer.apply(plan, approval(plan))).state, 'completed');
  const g = await setupImport(t), p = await g.plan(), caps = { planner: g.planner, persistence: g.persistence };
  const importer = new SessionImporter(caps, importLimits);
  assert.equal((await importer.apply(p, { dryRun: true, cache: 'skip' })).state, 'dry-run');
  assert.equal((await importer.apply(p, approval(p))).reason, 'capability-unavailable');
  assert.equal(g.calls.create + g.calls.workspaceCreate, 0);
});
test('P7 artifact import/constructor and strict dry-run deny private reads, writes, network and processes', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const report = await runFixture('importer-artifact-process.mjs', root);
  assert.equal(report.lazyImport, true); assert.equal(report.strictDryRun, true); assert.deepEqual(report.attempts, []);
});
