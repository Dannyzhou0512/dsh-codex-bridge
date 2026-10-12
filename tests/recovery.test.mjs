import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, rename, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionRecovery, validateRecoveryPlan } from '../lib/recovery/index.js';
import { setupImport, approval } from './fixtures/p7-data.mjs';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';
const limits = { maxReadEvents: 2000, maxReadBytes: 2000000, readChunkEvents: 3,
  maxWorkspaces: 100, maxPlanBytes: 1000000, maxResultBytes: 8192 };
const actions = { workspace: 'retry', cache: 'refresh-if-available', dryRun: true };
const selected = plan => ({ dryRun: false, approval: { planDigest: plan.planDigest } });
function recovery(f, overrides = {}) {
  return new SessionRecovery({ planner: f.planner, persistence: f.persistence, mapper: f.mapper,
    registry: f.registry, liveSession: () => false, cache: f.caps.cache, ...overrides }, limits);
}
async function pending(t) {
  const f = await setupImport(t), initial = await f.plan(); f.fault('attach-before');
  assert.equal((await f.importer.apply(initial, approval(initial))).state, 'workspace-pending');
  f.fault(null); f.recovery = recovery(f); f.importPlan = await f.plan(); return f;
}
function immutableWrites(f) { return { create: f.calls.create, append: f.calls.append, flush: f.calls.flush,
  close: f.calls.writerClose, open: f.calls.writeOpen, rows: structuredClone([...f.rows]) }; }
test('P8 lazy construction, approval and dry-run never perform post-import effects', async t => {
  const f = await pending(t), before = structuredClone(f.calls), writes = immutableWrites(f);
  const another = recovery(f); assert.deepEqual(f.calls, before);
  const plan = await another.diagnose(f.importPlan, actions);
  assert.equal(plan.state, 'recoverable'); assert.equal(plan.membership, 'unattached'); validateRecoveryPlan(plan);
  assert(Object.isFrozen(plan.session)); assert(Object.isFrozen(plan.workspace.target.identity));
  await assert.rejects(another.retry(plan, {}), error => error.code === 'invalid-options');
  await assert.rejects(another.retry(plan, { dryRun: false }), error => error.code === 'invalid-approval');
  const dry = await another.retry(plan, { dryRun: true });
  assert.equal(dry.state, 'dry-run'); assert.equal(Object.values(dry.effects).some(Boolean), false);
  assert.deepEqual(immutableWrites(f), writes); assert.equal(f.calls.attach, before.attach); assert.equal(f.calls.cache, before.cache);
});
test('P8 retries association/cache using stored full log; native tail and header remain unchanged', async t => {
  const f = await pending(t), row = f.rows.get(f.importPlan.sessionId), count = row.events.length;
  const start = structuredClone(row.events.find(event => event.type === 'turn/start')), end = structuredClone(row.events.find(event => event.type === 'turn/end'));
  start.seq = count; start.data.turn = 2; end.seq = count + 1; end.data.turn = 2; row.events.push(start, end); row.revision = 'native-tail';
  f.importPlan = await f.plan();
  const plan = await f.recovery.diagnose(f.importPlan, actions), writes = immutableWrites(f);
  assert.equal(plan.session.continuationEvents, 2);
  const result = await f.recovery.retry(plan, selected(plan));
  assert.equal(result.state, 'completed'); assert.equal(result.sessionVerified, true);
  assert.equal(result.effects.attachInvoked, true); assert.equal(result.cacheStatus, 'requested');
  assert.deepEqual(f.cacheSeen.at(-1).events, row.events); assert.deepEqual(immutableWrites(f), writes);
  const repeated = await f.recovery.diagnose(await f.plan(), { ...actions, cache: 'skip' });
  assert.equal(repeated.state, 'noop');
  assert.equal((await f.recovery.retry(repeated, selected(repeated))).state, 'noop');
});
test('P8 unknown/partial/changed source/absent targets are diagnostic only, never adopted or repaired', async t => {
  const absent = await setupImport(t), empty = recovery(absent), p = await absent.plan();
  const d = await empty.diagnose(p, actions); assert.equal(d.state, 'absent');
  assert.equal((await empty.retry(d, selected(d))).state, 'blocked');
  const f = await setupImport(t), initial = await f.plan(); f.fault('append-partial');
  await f.importer.apply(initial, approval(initial)); f.fault(null);
  const partial = recovery(f), plan = await partial.diagnose(await f.plan(), actions);
  assert.equal(plan.state, 'incomplete'); const writes = immutableWrites(f);
  assert.equal((await partial.retry(plan, selected(plan))).state, 'blocked'); assert.deepEqual(immutableWrites(f), writes);
  f.rows.get(initial.sessionId).header.cwd = join(f.root, 'unknown');
  assert.equal((await partial.diagnose(await f.plan(), actions)).state, 'conflict');
  const g = await pending(t); g.source.thread.updatedAtMs++;
  const changed = await g.recovery.diagnose(await g.plan(), actions);
  assert.equal(changed.state, 'conflict'); assert.equal((await g.recovery.retry(changed, selected(changed))).state, 'blocked');
});
test('P8 changed target/source/membership/provider and transferred plans invalidate approval before effects', async t => {
  const f = await pending(t), plan = await f.recovery.diagnose(f.importPlan, actions), calls = f.calls.attach;
  f.rows.get(plan.sessionId).revision = 'changed-observation';
  assert.equal((await f.recovery.retry(plan, selected(plan))).state, 'stale-plan'); assert.equal(f.calls.attach, calls);
  const g = await pending(t), p = await g.recovery.diagnose(g.importPlan, actions);
  g.source.thread.title = 'source changed';
  assert.equal((await g.recovery.retry(p, selected(p))).state, 'stale-plan');
  const h = await pending(t), q = await h.recovery.diagnose(h.importPlan, actions);
  await assert.rejects(h.recovery.retry(structuredClone(q), selected(q)), error => error.code === 'invalid-plan');
  const clone = structuredClone(q); clone.actions.cache = 'skip';
  assert.throws(() => validateRecoveryPlan(clone), error => error.code === 'invalid-plan');
  h.persistence.identity = Symbol('other');
  await assert.rejects(h.recovery.retry(q, selected(q)), error => error.code === 'invalid-plan');
});
test('P8 uses immutable stored cwd rather than a newly proposed remap or strict conversion policy', async t => {
  const f = await pending(t), original = f.rows.get(f.importPlan.sessionId).header.cwd;
  const other = join(f.root, 'new proposed mapping'); await mkdir(other);
  f.request.remapCwd = other; f.request.conversion.mode = 'strict'; f.request.conversion.acceptedLosses = [];
  const input = await f.plan(); assert.equal(input.state, 'already-imported'); assert.equal(input.conversion.plan, null);
  const plan = await f.recovery.diagnose(input, actions);
  assert.equal(plan.workspace.canonicalCwd, original);
  const writes = immutableWrites(f);
  assert.equal((await f.recovery.retry(plan, selected(plan))).state, 'completed');
  assert.deepEqual(immutableWrites(f), writes); assert.equal(f.workspaces.length, 1);
});
test('P8 missing native cwd requires remap diagnosis; cache-only recovery does not recreate directory', async t => {
  const f = await pending(t); await rename(f.cwd, join(f.root, 'moved-away'));
  const input = await f.plan(), plan = await f.recovery.diagnose(input, actions);
  assert.equal(plan.state, 'needs-remap');
  assert.equal((await f.recovery.retry(plan, selected(plan))).state, 'blocked');
  const cacheOnly = await f.recovery.diagnose(input, { ...actions, workspace: 'skip' });
  assert.equal((await f.recovery.retry(cacheOnly, selected(cacheOnly))).state, 'completed');
  assert.equal(f.calls.workspaceCreate, 1);
});
test('P8 live Session and conflicting Workspace memberships are deferred without moving Sessions', async t => {
  const f = await pending(t), busy = recovery(f, { liveSession: () => true });
  const plan = await busy.diagnose(f.importPlan, actions); assert.equal(plan.state, 'busy');
  assert.equal((await busy.retry(plan, selected(plan))).state, 'blocked');
  const g = await pending(t);
  g.workspaces.push({ id: 'other-workspace', path: join(g.root, 'wrong'), title: 'other', sessionIds: [g.importPlan.sessionId] });
  const conflict = await g.recovery.diagnose(g.importPlan, actions);
  assert.equal(conflict.state, 'conflict'); assert.equal((await g.recovery.retry(conflict, selected(conflict))).state, 'blocked');
});
test('P8 attach/cache faults retain complete log and support later explicit retries', async t => {
  const f = await pending(t), plan = await f.recovery.diagnose(f.importPlan, actions), writes = immutableWrites(f);
  f.fault('attach-before');
  const failed = await f.recovery.retry(plan, selected(plan)); assert.equal(failed.state, 'workspace-pending');
  assert.equal(failed.effects.attachInvoked, true); assert.deepEqual(immutableWrites(f), writes);
  f.fault(null);
  const again = await f.recovery.diagnose(await f.plan(), actions);
  assert.equal((await f.recovery.retry(again, selected(again))).state, 'completed');
  const g = await pending(t), p = await g.recovery.diagnose(g.importPlan, actions); g.fault('cache');
  const cache = await g.recovery.retry(p, selected(p)); assert.equal(cache.state, 'completed'); assert.equal(cache.cacheStatus, 'pending');
  assert.doesNotMatch(JSON.stringify(cache), /PRIVATE_FAILURE_SENTINEL/);
});
test('P8 re-creates only a Workspace registration for an existing directory, never a Session', async t => {
  const f = await pending(t); f.workspaces.splice(0);
  const plan = await f.recovery.diagnose(await f.plan(), actions), writes = immutableWrites(f);
  assert.equal(plan.workspace.action, 'create');
  const result = await f.recovery.retry(plan, selected(plan));
  assert.equal(result.state, 'completed'); assert.equal(result.effects.workspaceCreateInvoked, true);
  assert.deepEqual(immutableWrites(f), writes);
});
test('P8 source change after own registration prevents attach/cache and retains explicit effects', async t => {
  const f = await pending(t); f.workspaces.splice(0);
  const plan = await f.recovery.diagnose(await f.plan(), actions), create = f.registry.create;
  f.registry.create = async (...args) => { const w = await create(...args); f.source.thread.updatedAtMs++; return w; };
  const result = await f.recovery.retry(plan, selected(plan));
  assert.equal(result.state, 'stale-plan'); assert.equal(result.effects.workspaceCreateInvoked, true);
  assert.equal(result.effects.workspaceAttachInvoked, false); assert.equal(result.effects.cacheInvoked, false);
});
test('P8 limits, read faults, cancellation and missing capabilities fail closed with owned read cleanup', async t => {
  const f = await pending(t);
  const tiny = new SessionRecovery({ planner: f.planner, persistence: f.persistence, liveSession: () => false },
    { ...limits, maxReadEvents: 2 });
  await assert.rejects(tiny.diagnose(f.importPlan, { ...actions, workspace: 'skip' }), error => error.code === 'content-limit');
  const missing = recovery(f, { registry: undefined });
  await assert.rejects(missing.diagnose(f.importPlan, actions), error => error.code === 'capability-unavailable');
  const noCache = recovery(f, { cache: undefined });
  const noAction = await noCache.diagnose(f.importPlan, { ...actions, workspace: 'skip' });
  assert.equal(noAction.state, 'noop');
  const plan = await f.recovery.diagnose(f.importPlan, actions), stop = new AbortController(); stop.abort('PRIVATE_FAILURE_SENTINEL');
  assert.equal((await f.recovery.retry(plan, { ...selected(plan), signal: stop.signal })).state, 'cancelled');
  f.fault('readback-read');
  await assert.rejects(f.recovery.diagnose(f.importPlan, actions), error => error.message === 'capability-failed');
  assert.equal(f.calls.writeOpen, 0);
});
test('P8 directory replacement after diagnosis and target change after attach prevent stale cache requests', async t => {
  const f = await pending(t), plan = await f.recovery.diagnose(f.importPlan, actions);
  await rename(f.cwd, join(f.root, 'previous')); await mkdir(f.cwd);
  assert.equal((await f.recovery.retry(plan, selected(plan))).state, 'stale-plan');
  const g = await pending(t), p = await g.recovery.diagnose(g.importPlan, actions), attach = g.mapper.attach.bind(g.mapper);
  g.mapper.attach = async (...args) => { const result = await attach(...args); g.rows.get(p.sessionId).revision = 'changed'; return result; };
  const result = await g.recovery.retry(p, selected(p));
  assert.equal(result.state, 'stale-plan'); assert.equal(result.effects.attachInvoked, true); assert.equal(result.effects.cacheInvoked, false);
});

test('P8 real published Host recovers lost response then preserves native tail after another restart', { timeout: 180000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
  const crash = await runFixture('p8-host-process.mjs', root, ['crash']); assert.equal(crash.responseLostAfterVerifiedWrite, true);
  const fixed = await runFixture('p8-host-process.mjs', root, ['recover']);
  assert.equal(fixed.sessionHeaderAndLogUnchangedByRecovery, true); assert.equal(fixed.nativeContinuation, true);
  const restarted = await runFixture('p8-host-process.mjs', root, ['verify']);
  assert.equal(restarted.nativeTailRetained, true); assert.equal(restarted.cacheDurablePublicEvent, true);
  assert.deepEqual(restarted.sessionMutatorAttempts, []);
});

test('P8 built recovery import, complete receipt diagnosis and dry-run forbid files/network/processes', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const report = await runFixture('recovery-artifact-process.mjs', root);
  assert.equal(report.lazyImport, true); assert.equal(report.strictDryRun, true); assert.deepEqual(report.attempts, []);
});
test('P8 post-commit cancellation and unknown facade effects retain honest outcomes', async t => {
  const f = await pending(t), plan = await f.recovery.diagnose(f.importPlan, { ...actions, cache: 'skip' });
  const stop = new AbortController(), attach = f.mapper.attach.bind(f.mapper);
  f.mapper.attach = async (...args) => { const result = await attach(...args); stop.abort(); return result; };
  const done = await f.recovery.retry(plan, { ...selected(plan), signal: stop.signal });
  assert.equal(done.state, 'completed'); assert.equal(done.cacheStatus, 'skipped'); assert.equal(done.effects.attachInvoked, true);
  const g = await pending(t), p = await g.recovery.diagnose(g.importPlan, actions), callback = g.mapper.attach.bind(g.mapper);
  g.mapper.attach = async (...args) => { await callback(...args); throw new Error('PRIVATE_FAILURE_SENTINEL'); };
  const unknown = await g.recovery.retry(p, selected(p));
  assert.equal(unknown.state, 'workspace-pending'); assert.equal(unknown.effects.attachInvoked, null);
  assert(unknown.warnings.includes('workspace-mutation-effects-unknown'));
});
test('P8 diagnosis full-byte bounds, read cleanup failures and independent cache-only capability remain safe', async t => {
  const f = await pending(t);
  const capped = new SessionRecovery({ planner: f.planner, persistence: f.persistence, liveSession: () => false },
    { ...limits, maxPlanBytes: 100 });
  await assert.rejects(capped.diagnose(f.importPlan, { ...actions, workspace: 'skip' }), error => error.code === 'content-limit');
  const bytes = new SessionRecovery({ planner: f.planner, persistence: f.persistence, liveSession: () => false },
    { ...limits, maxReadBytes: 100 });
  await assert.rejects(bytes.diagnose(f.importPlan, { ...actions, workspace: 'skip' }), error => error.code === 'content-limit');
  const cacheOnly = recovery(f, { mapper: undefined, registry: undefined });
  const p = await cacheOnly.diagnose(f.importPlan, { ...actions, workspace: 'skip' });
  assert.equal((await cacheOnly.retry(p, selected(p))).cacheStatus, 'requested');
  f.fault('readback-close');
  await assert.rejects(f.recovery.diagnose(f.importPlan, actions), error => error.message === 'capability-failed');
  assert.equal(f.calls.writeOpen, 0);
});
