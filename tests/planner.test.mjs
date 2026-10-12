import assert from 'node:assert/strict';
import { mkdir, realpath, access, rename, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ImportPlanner, PlanningError, validateImportPlan } from '../lib/planner/index.js';
import { WorkspaceMapper } from '../lib/workspace/index.js';
import { publicSnapshot, options } from './fixtures/p4-data.mjs';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';
const limits = { maxTargetEvents: 2000, maxTargetBytes: 2000000, readChunkEvents: 3, maxPlanBytes: 4000000 };
async function setup(t, override = {}) {
  const root = await allocate(); t.after(() => cleanup(root));
  const cwd = join(root, 'Workspace 中文 spaces'); await mkdir(cwd);
  const source = publicSnapshot(); source.thread.cwd = cwd; source.thread.counts = null;
  const calls = { source: 0, stat: 0, open: 0, read: 0, close: 0, writes: 0 };
  let stored, readFailure = false, closeFailure = false;
  const forbidden = () => { calls.writes++; throw new Error('Forbidden mutator'); };
  const persistence = { identity: Symbol('test-provider'),
    async stat() { calls.stat++; return stored ? { header: stored.header, revision: stored.revision, eventCount: stored.events.length } : undefined; },
    async open(id, accessMode) {
      calls.open++; assert.equal(accessMode, 'read');
      const row = structuredClone(stored);
      return { id, header: row.header, access: 'read', inheritedEventCount: 0,
        async read(offset, length) { calls.read++; if (readFailure) throw new Error('SECRET raw storage failure');
          return { eventState: 'detached', events: row.events.slice(offset, offset + length) }; },
        async close() { calls.close++; if (closeFailure) throw new Error('SECRET close failure'); },
        append: forbidden, flush: forbidden };
    }, create: forbidden, flush: forbidden };
  const registry = { list: () => [], create: forbidden };
  const mapper = new WorkspaceMapper({ registry }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  let live = false;
  const caps = { source: { async read() { calls.source++; return source; } }, mapper, persistence, liveSession: () => live };
  const planner = new ImportPlanner(caps, { ...limits, ...override });
  const { target, ...conversion } = options(cwd);
  const request = { threadId: source.thread.id, conversion };
  return { root, cwd, source, caps, planner, request, calls,
    store(plan) { stored = { header: structuredClone(plan.header), events: structuredClone(plan.events), revision: 'r1' }; return stored; },
    live(value) { live = value; }, failRead() { readFailure = true; }, failClose() { closeFailure = true; } };
}
test('P6 constructor is lazy and strict dry-run refuses missing/false before reads', async t => {
  const f = await setup(t);
  assert.equal(f.calls.source, 0);
  for (const operation of [{}, { dryRun: false }])
    await assert.rejects(f.planner.plan(f.request, operation), error => error.code === 'invalid-options');
  const plan = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(plan.state, 'ready'); assert.equal(plan.target.state, 'absent');
  assert.equal(plan.workspace.canonicalCwd, await realpath(f.cwd));
  assert.equal(plan.conversion.statistics.turns, f.source.turns.length);
  assert.equal(plan.conversion.sourceFingerprint, plan.sourceFingerprint);
  assert(Object.isFrozen(plan.conversion.plan.events)); validateImportPlan(plan);
  assert.equal(f.calls.writes, 0); assert.equal(f.calls.open, 0);
  assert.equal((await f.planner.checkFresh(plan, { dryRun: true })).state, 'fresh');
  assert.equal(f.calls.writes, 0);
});
test('P6 missing capabilities fail closed and never invent an empty target registry', async t => {
  const f = await setup(t);
  for (const missing of ['source', 'mapper', 'persistence', 'liveSession']) {
    const caps = { ...f.caps }; delete caps[missing];
    await assert.rejects(new ImportPlanner(caps, limits).plan(f.request, { dryRun: true }),
      error => error instanceof PlanningError && error.code === 'capability-unavailable');
  }
  assert.equal(f.calls.source, 0);
});
test('P6 public preview stays available while recall consent and missing cwd block readiness', async t => {
  const f = await setup(t);
  const blocked = await f.planner.plan({ ...f.request, conversion: { ...f.request.conversion, acceptedLosses: [] } }, { dryRun: true });
  assert.equal(blocked.state, 'needs-review'); assert(blocked.conversion.preview.length > 0);
  assert.equal(blocked.conversion.plan, null);
  f.source.thread.cwd = join(f.root, 'missing');
  const unmapped = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(unmapped.state, 'needs-remap');
  await assert.rejects(access(f.source.thread.cwd), error => error.code === 'ENOENT');
  assert.equal((await f.planner.plan({ ...f.request, remapCwd: f.cwd }, { dryRun: true })).state, 'ready');
  assert.equal(f.calls.writes, 0);
});
test('P6 active, partial, failed hydration and foreign thread id cannot become ready', async t => {
  const f = await setup(t);
  f.source.thread.status = 'active';
  assert.equal((await f.planner.plan(f.request, { dryRun: true })).state, 'unsupported');
  f.source.thread.status = 'idle'; f.source.history = 'unsupported';
  assert.equal((await f.planner.plan(f.request, { dryRun: true })).state, 'unsupported');
  f.source.thread.id = 'foreign';
  await assert.rejects(f.planner.plan(f.request, { dryRun: true }), error => error.code === 'invalid-request');
});
test('P6 validates complete receipt and skips original prefix with preserved DSH continuation', async t => {
  const f = await setup(t), initial = await f.planner.plan(f.request, { dryRun: true });
  const row = f.store(initial.conversion.plan);
  const start = structuredClone(row.events.find(event => event.type === 'turn/start'));
  const end = structuredClone(row.events.find(event => event.type === 'turn/end'));
  start.data.turn = 2; end.data.turn = 2;
  start.seq = row.events.length; end.seq = start.seq + 1; row.events.push(start, end);
  const before = structuredClone(row);
  const repeated = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(repeated.state, 'already-imported'); assert.equal(repeated.target.continuationEvents, 2);
  const stricter = await f.planner.plan({ ...f.request, conversion: { ...f.request.conversion, mode: 'strict', acceptedLosses: [] } }, { dryRun: true });
  assert.equal(stricter.state, 'already-imported', 'Original import policy is retained; a new conversion is not applied');
  assert.deepEqual(row, before); assert.equal(f.calls.close, 2); assert.equal(f.calls.writes, 0);
  f.source.thread.updatedAtMs++;
  const changed = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(changed.state, 'conflict'); assert.equal(changed.target.reason, 'previous-import-source-changed');
});
test('P6 refuses unknown sessions, invalid receipts, duplicate receipts and unverified partial prefixes', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  let row = f.store(plan.conversion.plan); row.events.splice(-1);
  let result = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(result.state, 'incomplete'); assert.match(result.target.reason, /unverified/);
  row = f.store(plan.conversion.plan); row.header.cwd = join(f.root, 'another');
  result = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(result.state, 'conflict');
  row = f.store(plan.conversion.plan); row.events.at(-1).data.prefixDigest = '0'.repeat(64);
  result = await f.planner.plan(f.request, { dryRun: true }); assert.equal(result.state, 'conflict');
  row = f.store(plan.conversion.plan); const duplicate = structuredClone(row.events.at(-1));
  duplicate.seq = row.events.length; row.events.push(duplicate);
  result = await f.planner.plan(f.request, { dryRun: true }); assert.equal(result.target.reason, 'multiple-import-receipts');
  assert.equal(f.calls.writes, 0); assert.equal(f.calls.open, f.calls.close);
});
test('P6 source content, target appearance, live collision and provider replacement invalidate previous plans', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  f.source.thread.title = 'Changed title';
  assert((await f.planner.checkFresh(plan, { dryRun: true })).reasons.includes('source-changed'));
  f.store(plan.conversion.plan);
  assert((await f.planner.checkFresh(plan, { dryRun: true })).reasons.includes('target-changed'));
  f.caps.persistence.identity = Symbol('replacement');
  assert((await f.planner.checkFresh(plan, { dryRun: true })).reasons.includes('persistence-provider-changed'));
  const g = await setup(t); g.live(true);
  assert.equal((await g.planner.plan(g.request, { dryRun: true })).target.reason, 'live-session-collision');
});
test('P6 directory replacement invalidates even the same canonical cwd', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  await rename(f.cwd, join(f.root, 'moved')); await mkdir(f.cwd);
  const check = await f.planner.checkFresh(plan, { dryRun: true });
  assert.equal(check.state, 'stale-plan'); assert(check.reasons.includes('workspace-or-directory-changed'));
});
test('P6 bounded reads, resource failures, cancellation and teardown never produce a usable plan', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true }); f.store(plan.conversion.plan);
  const tiny = new ImportPlanner(f.caps, { ...limits, maxTargetEvents: 2 });
  await assert.rejects(tiny.plan(f.request, { dryRun: true }), error => error.code === 'content-limit');
  const tinyBytes = new ImportPlanner(f.caps, { ...limits, maxTargetBytes: 1000 });
  await assert.rejects(tinyBytes.plan(f.request, { dryRun: true }), error => error.code === 'content-limit');
  assert.equal(f.calls.open, f.calls.close);
  f.failRead();
  await assert.rejects(f.planner.plan(f.request, { dryRun: true }), error => error.message === 'capability-failed' && !String(error).includes('SECRET'));
  assert.equal(f.calls.open, f.calls.close);
  const controller = new AbortController(); controller.abort('SECRET cancellation reason');
  const calls = f.calls.source;
  await assert.rejects(f.planner.plan(f.request, { dryRun: true, signal: controller.signal }), error => error.code === 'cancelled');
  assert.equal(f.calls.source, calls);
  const g = await setup(t), p = await g.planner.plan(g.request, { dryRun: true }); g.store(p.conversion.plan); g.failClose();
  await assert.rejects(g.planner.plan(g.request, { dryRun: true }), error => error.message === 'capability-failed');
});
test('P6 plans reject tampering, transfer and complete output byte overflow', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  const changed = structuredClone(plan); changed.request.threadId = 'tampered';
  assert.throws(() => validateImportPlan(changed), error => error.code === 'invalid-plan');
  await assert.rejects(f.planner.checkFresh(structuredClone(plan), { dryRun: true }), error => error.code === 'invalid-plan');
  await assert.rejects(new ImportPlanner(f.caps, { ...limits, maxPlanBytes: 64 }).plan(f.request, { dryRun: true }),
    error => error.code === 'content-limit');
  assert.equal(f.calls.writes, 0);
});
test('P6 target revision changes during read are refused and the handle closes', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true }); const row = f.store(plan.conversion.plan);
  const open = f.caps.persistence.open;
  f.caps.persistence.open = async (...args) => { const handle = await open(...args); row.revision = 'r2'; return handle; };
  await assert.rejects(f.planner.plan(f.request, { dryRun: true }), error => error.code === 'target-changed');
  assert.equal(f.calls.open, f.calls.close);
});
test('P6 real published Loader Host planning blocks all migration mutators and preserves public state', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
  const report = await runFixture('p6-host-process.mjs', root);
  assert.equal(report.strictDryRun, true); assert.equal(report.publicStateUnchanged, true);
  assert.equal(report.modelCalls, 0); assert.deepEqual(report.mutatorAttempts, []);
});

test('P6 built module import/constructor are lazy and plan/checkFresh deny writes, network and subprocess', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const report = await runFixture('planner-artifact-process.mjs', root);
  assert.equal(report.lazyImport, true); assert.equal(report.strictDryRun, true);
  assert.equal(report.negativeControl, true); assert.deepEqual(report.attempts, []);
});
test('P6 only the documented default header depth is normalized; nonzero depth conflicts', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  const row = f.store(plan.conversion.plan); row.header.delegationDepth = 0;
  assert.equal((await f.planner.plan(f.request, { dryRun: true })).state, 'already-imported');
  row.header.delegationDepth = 1;
  assert.equal((await f.planner.plan(f.request, { dryRun: true })).state, 'conflict');
});
test('P6 target gaps and post-read cancellation close handles without a ready result', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  const row = f.store(plan.conversion.plan); row.events[2].seq++;
  await assert.rejects(f.planner.plan(f.request, { dryRun: true }), error => error.code === 'capability-failed');
  assert.equal(f.calls.open, f.calls.close);
  const g = await setup(t), p = await g.planner.plan(g.request, { dryRun: true }); g.store(p.conversion.plan);
  const abort = new AbortController(), open = g.caps.persistence.open;
  g.caps.persistence.open = async (...args) => {
    const reader = await open(...args), read = reader.read;
    reader.read = async (...input) => { const result = await read(...input); abort.abort(); return result; };
    return reader;
  };
  await assert.rejects(g.planner.plan(g.request, { dryRun: true, signal: abort.signal }), error => error.code === 'cancelled');
  assert.equal(g.calls.open, g.calls.close);
});

test('P6 content edits without a timestamp change stale the plan; hidden fields and reported counts are excluded', async t => {
  const f = await setup(t), plan = await f.planner.plan(f.request, { dryRun: true });
  f.source.thread.counts = { turns: 999, items: 999, messages: 999, toolItems: 999, reasoningItems: 999 };
  f.source.privatePath = 'PRIVATE_SENTINEL'; f.source.rawReasoning = 'PRIVATE_SENTINEL';
  const unchanged = await f.planner.checkFresh(plan, { dryRun: true });
  assert.equal(unchanged.state, 'fresh'); assert.doesNotMatch(JSON.stringify(unchanged), /PRIVATE_SENTINEL/);
  assert.deepEqual(unchanged.currentPlan.conversion.statistics, plan.conversion.statistics);
  f.source.turns[0].items.find(item => item.type === 'userMessage').content.find(input => input.type === 'text').text += ' amended';
  assert((await f.planner.checkFresh(plan, { dryRun: true })).reasons.includes('source-changed'));
});
test('P6 exact complete-result byte bound and unknown policy fields are handled without retention', async t => {
  const f = await setup(t);
  f.request.conversion.secret = 'PRIVATE_SENTINEL'; f.request.conversion.limits.secret = 'PRIVATE_SENTINEL';
  const plan = await f.planner.plan(f.request, { dryRun: true });
  assert.doesNotMatch(JSON.stringify(plan), /PRIVATE_SENTINEL/);
  const bytes = Buffer.byteLength(JSON.stringify(plan));
  // Both serialized forms have identical byte lengths: canonicalization changes key order only.
  assert.equal((await new ImportPlanner(f.caps, { ...limits, maxPlanBytes: bytes }).plan(f.request, { dryRun: true })).state, 'ready');
  await assert.rejects(new ImportPlanner(f.caps, { ...limits, maxPlanBytes: bytes - 1 }).plan(f.request, { dryRun: true }),
    error => error.code === 'content-limit');
});
test('P6 owns projected source across awaited mapping and closes on invalid handle metadata', async t => {
  const f = await setup(t), title = f.source.thread.title, mapping = f.caps.mapper.plan.bind(f.caps.mapper);
  f.caps.mapper.plan = async (...args) => { f.source.thread.title = 'changed during mapping'; return mapping(...args); };
  const plan = await f.planner.plan(f.request, { dryRun: true });
  assert.equal(plan.conversion.source.title, title);
  const g = await setup(t), p = await g.planner.plan(g.request, { dryRun: true }); g.store(p.conversion.plan);
  const open = g.caps.persistence.open;
  g.caps.persistence.open = async (...args) => { const handle = await open(...args); handle.header = { bad: undefined }; return handle; };
  await assert.rejects(g.planner.plan(g.request, { dryRun: true }), error => error.code === 'capability-failed');
  assert.equal(g.calls.open, g.calls.close);
});
