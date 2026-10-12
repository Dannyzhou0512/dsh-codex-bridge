import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { cp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { BatchImporter, validateBatchPlan } from '../lib/batch/index.js';
import { sessionIdFor } from '../lib/converter/index.js';
import { setupBatch, approved, planOptions, batchLimits } from './fixtures/p9-data.mjs';
import { approval } from './fixtures/p7-data.mjs';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';
test('P9 lazy explicit selection deduplicates exact ids and never writes unselected entries', async t => {
  const f = await setupBatch(t); assert.deepEqual(f.reads, []);
  const plan = await f.batch.plan([f.requests[0], f.requests[0], f.requests[1]], planOptions);
  assert.deepEqual(f.reads, ['a', 'b']); assert.equal(plan.inputCount, 3); assert.equal(plan.duplicateCount, 1);
  assert.equal(plan.entries[0].occurrences, 2); validateBatchPlan(plan); assert(Object.isFrozen(plan.entries[0].plan.conversion));
  const result = await f.batch.apply(plan, approved(plan, ['a', 'a']));
  assert.equal(result.summary.selected, 1); assert.equal(result.summary.completed, 1);
  assert.equal(result.entries[1].state, 'not-selected'); assert.equal(f.rows.has(sessionIdFor('b')), false);
  assert.equal(f.rows.has(sessionIdFor('c')), false); assert.equal(f.calls.create, 1);
});
test('P9 conflicting duplicate policies and malformed selection fail before source reads', async t => {
  const f = await setupBatch(t);
  await assert.rejects(f.batch.plan([f.requests[0], { ...f.requests[0], remapCwd: 'C:\\different' }], planOptions), e => e.code === 'conflicting-selection');
  await assert.rejects(f.batch.plan([f.requests[0], { ...f.requests[0], conversion: { ...f.requests[0].conversion, acceptedLosses: [] } }], planOptions), e => e.code === 'conflicting-selection');
  await assert.rejects(f.batch.plan([{}], planOptions), e => e.code === 'invalid-selection');
  await assert.rejects(f.batch.plan(f.requests, { dryRun: false, cache: 'skip' }), e => e.code === 'invalid-options');
  assert.deepEqual(f.reads, []); assert.equal(f.calls.create, 0);
});
test('P9 semantic loss-set duplicates match but ids remain case-sensitive and input-only', async t => {
  const f = await setupBatch(t, ['a', 'A']);
  const duplicate = { ...f.requests[0], conversion: { ...f.requests[0].conversion, acceptedLosses: [...f.requests[0].conversion.acceptedLosses].reverse() } };
  const plan = await f.batch.plan([f.requests[0], duplicate, f.requests[1]], planOptions);
  assert.equal(plan.entries.length, 2); assert.deepEqual(f.reads, ['a', 'A']); assert.notEqual(plan.entries[0].sessionId, plan.entries[1].sessionId);
});
test('P9 empty selection is a zero-I/O no-op; dry-run does not create Workspace or Session', async t => {
  const f = await setupBatch(t), empty = await f.batch.plan([], planOptions);
  assert.equal(empty.state, 'empty'); assert.equal((await f.batch.apply(empty, approved(empty))).state, 'empty'); assert.deepEqual(f.reads, []);
  const plan = await f.batch.plan(f.requests, planOptions), before = structuredClone(f.calls);
  const result = await f.batch.apply(plan, { dryRun: true, selectedThreadIds: ['a', 'b'] });
  assert.equal(result.summary.dryRun, 2); assert.equal(result.entries[2].state, 'not-selected');
  assert.equal(f.calls.create + f.calls.workspaceCreate + f.calls.attach + f.calls.cache, 0);
  assert.equal(before.create, 0);
});
test('P9 all selected approvals are checked before the first importer invocation', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), opts = approved(plan);
  opts.approval.items[2].acceptedLosses = [];
  await assert.rejects(f.batch.apply(plan, opts), e => e.code === 'invalid-approval'); assert.equal(f.calls.create, 0);
  await assert.rejects(f.batch.apply(plan, { ...approved(plan), selectedThreadIds: ['not-planned'] }), e => e.code === 'invalid-selection');
  await assert.rejects(f.batch.apply(structuredClone(plan), approved(plan)), e => e.code === 'invalid-plan');
  const tampered = structuredClone(plan); tampered.entries[0].threadId = 'tampered';
  assert.throws(() => validateBatchPlan(tampered), e => e.code === 'invalid-plan');
});
test('P9 shared cwd creates one Workspace and rebases only proven own registration effects', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions);
  assert(plan.entries.every(entry => entry.plan.workspace.action === 'create'));
  const result = await f.batch.apply(plan, approved(plan));
  assert.equal(result.summary.completed, 3); assert.equal(f.calls.workspaceCreate, 1); assert.equal(f.calls.create, 3);
  assert.equal(result.entries[0].rebasedWorkspace, false);
  assert(result.entries.slice(1).every(entry => entry.rebasedWorkspace && entry.effectivePlanDigest !== entry.originalPlanDigest));
  assert.deepEqual(new Set(f.workspaces[0].sessionIds), new Set(plan.entries.map(entry => entry.sessionId)));
});
test('P9 mixed outcomes preserve independent completed/duplicate/blocked/planning-failed results', async t => {
  const f = await setupBatch(t, ['a', 'missing', 'review', 'error', 'b', 'duplicate', 'active']);
  f.sources.get('missing').thread.cwd = join(f.root, 'absent');
  f.requests.find(r => r.threadId === 'review').conversion.acceptedLosses = [];
  f.failReads.add('error'); f.sources.get('active').thread.status = 'active';
  const duplicateRequest = f.requests.find(r => r.threadId === 'duplicate');
  const seed = await f.planner.plan(duplicateRequest, { dryRun: true });
  await f.importer.apply(seed, approval(seed));
  const before = structuredClone(f.rows.get(seed.sessionId));
  const plan = await f.batch.plan(f.requests, planOptions); assert.equal(plan.state, 'partial');
  const result = await f.batch.apply(plan, approved(plan));
  assert.deepEqual(result.entries.map(e => e.state), ['completed', 'blocked', 'blocked', 'planning-failed', 'completed', 'already-imported', 'blocked']);
  assert.equal(result.summary.completed, 2); assert.equal(result.summary.alreadyImported, 1);
  assert.deepEqual(f.rows.get(seed.sessionId), before); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BATCH_SENTINEL/);
});
test('P9 a partial write is cleaned by the leaf importer and does not stop a safe next item', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), apply = f.importer.apply.bind(f.importer);
  f.importer.apply = async (leaf, opts) => { if (leaf.request.threadId === 'a') f.fault('append-partial');
    try { return await apply(leaf, opts); } finally { f.fault(null); } };
  const result = await f.batch.apply(plan, approved(plan));
  assert.equal(result.entries[0].state, 'incomplete'); assert.equal(result.summary.completed, 2);
  assert.equal(f.rows.get(sessionIdFor('a')).owner, false); assert.equal(f.calls.writeOpen, 0);
  assert.equal(f.rows.get(sessionIdFor('a')).events.length, 4);
});
test('P9 unknown importer exception after a commit is reported without rollback or raw errors', async t => {
  const f = await setupBatch(t); await f.registry.create(await realpath(f.cwd));
  const plan = await f.batch.plan(f.requests, planOptions), apply = f.importer.apply.bind(f.importer);
  f.importer.apply = async (leaf, opts) => { const result = await apply(leaf, opts);
    if (leaf.request.threadId === 'a') throw new Error('PRIVATE_BATCH_SENTINEL'); return result; };
  const result = await f.batch.apply(plan, approved(plan));
  assert.equal(result.entries[0].state, 'failed'); assert.equal(result.entries[0].outcomeMayHaveCommitted, true);
  assert.equal(result.summary.completed, 2); assert.equal(f.rows.size, 3);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BATCH_SENTINEL/);
});
test('P9 external Workspace substitution or source drift cannot use own-registration rebasing', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), apply = f.importer.apply.bind(f.importer);
  f.importer.apply = async (leaf, opts) => { const result = await apply(leaf, opts);
    if (leaf.request.threadId === 'a') f.sources.get('b').thread.title = 'changed source'; return result; };
  const result = await f.batch.apply(plan, approved(plan));
  assert.deepEqual(result.entries.map(e => e.state), ['completed', 'stale-plan', 'completed']);
  const g = await setupBatch(t), p = await g.batch.plan(g.requests, planOptions), other = g.importer.apply.bind(g.importer);
  g.importer.apply = async (leaf, opts) => { const result = await other(leaf, opts);
    if (leaf.request.threadId === 'a') g.workspaces[0].id = 'externally-replaced'; return result; };
  const replaced = await g.batch.apply(p, approved(p));
  assert.equal(replaced.summary.completed, 1); assert.equal(replaced.entries[1].state, 'stale-plan');
});
test('P9 cancellation during planning stops later reads; cancelled planning entries never auto-hydrate on apply', async t => {
  const f = await setupBatch(t), stop = new AbortController(), read = f.source.read;
  f.source.read = async (...args) => { const result = await read(...args); stop.abort(); return result; };
  const plan = await f.batch.plan(f.requests, { ...planOptions, signal: stop.signal });
  assert.equal(plan.state, 'cancelled'); assert.deepEqual(f.reads, ['a']);
  assert(plan.entries.every(e => e.state === 'not-planned'));
  const result = await f.batch.apply(plan, approved(plan));
  assert.equal(result.summary.invoked, 0); assert.equal(result.summary.notStarted, 3); assert.deepEqual(f.reads, ['a']);
});
test('P9 cancellation after append awaits current writer close and never starts the next item', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), stop = new AbortController(), create = f.persistence.create;
  f.persistence.create = async (...args) => { const writer = await create(...args), append = writer.append;
    writer.append = async (...batch) => { await append(...batch); stop.abort(); }; return writer; };
  const result = await f.batch.apply(plan, { ...approved(plan), signal: stop.signal });
  assert.equal(result.state, 'cancelled'); assert.equal(result.summary.invoked, 1);
  assert.equal(result.entries[0].result.effects.writerCloseSucceeded, true); assert.equal(f.rows.get(plan.entries[0].sessionId).owner, false);
  assert(result.entries.slice(1).every(e => e.state === 'not-started')); assert.equal(f.calls.create, 1);
});
test('P9 cancellation after completed leaf retains commit and reports remaining items not-started', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), stop = new AbortController(), apply = f.importer.apply.bind(f.importer);
  f.importer.apply = async (...args) => { const result = await apply(...args); stop.abort(); return result; };
  const result = await f.batch.apply(plan, { ...approved(plan), signal: stop.signal });
  assert.equal(result.state, 'cancelled'); assert.equal(result.summary.completed, 1); assert.equal(result.summary.notStarted, 2);
  assert.equal(f.calls.create, 1);
});
test('P9 input/aggregate plan/result budgets reject before migration writes', async t => {
  const f = await setupBatch(t);
  const input = new BatchImporter(f.caps, { ...batchLimits, maxSelectionBytes: 5 });
  await assert.rejects(input.plan(f.requests, planOptions), e => e.code === 'content-limit'); assert.deepEqual(f.reads, []);
  const plan = await f.batch.plan(f.requests, planOptions);
  const small = new BatchImporter(f.caps, { ...batchLimits, maxResultBytes: 8192 });
  const tiny = await small.plan(f.requests, planOptions);
  await assert.rejects(small.apply(tiny, approved(tiny)), e => e.code === 'content-limit');
  assert.equal(f.calls.create + f.calls.workspaceCreate, 0);
  const cloned = structuredClone(plan); cloned.entries[0].plan.request.conversion.secret = 'PRIVATE_BATCH_SENTINEL';
  assert.throws(() => validateBatchPlan(cloned), e => e.code === 'invalid-plan');
});

test('P9 persistence provider replacement after an own Workspace creation blocks remaining writes', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan(f.requests, planOptions), apply = f.importer.apply.bind(f.importer);
  f.importer.apply = async (leaf, opts) => { const result = await apply(leaf, opts);
    if (leaf.request.threadId === 'a') f.persistence.identity = Symbol('replacement'); return result; };
  const result = await f.batch.apply(plan, approved(plan));
  assert.equal(result.summary.completed, 1); assert.equal(result.entries[1].state, 'stale-plan'); assert.equal(f.calls.create, 1);
});
test('P9 serial apply never overlaps leaf calls and keeps results in first-selection order', async t => {
  const f = await setupBatch(t), plan = await f.batch.plan([f.requests[2], f.requests[0], f.requests[1]], planOptions);
  const apply = f.importer.apply.bind(f.importer); let active = 0, maximum = 0; const order = [];
  f.importer.apply = async (...args) => { active++; maximum = Math.max(maximum, active); order.push(args[0].request.threadId);
    try { return await apply(...args); } finally { active--; } };
  const result = await f.batch.apply(plan, approved(plan, ['a', 'b', 'c']));
  assert.deepEqual(order, ['c', 'a', 'b']); assert.equal(maximum, 1); assert.equal(result.summary.completed, 3);
});

test('P9 real published Host batch imports three native Sessions, shares Workspace and preserves tails across restarts', { timeout: 180000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
  const written = await runFixture('p9-host-process.mjs', root, ['write']); assert.equal(written.serialMaximum, 1);
  assert.equal(written.sharedWorkspace, true); assert.equal(written.unselectedNotWritten, true);
  const restarted = await runFixture('p9-host-process.mjs', root, ['restart']); assert.equal(restarted.duplicateWithoutNewId, true);
  const verified = await runFixture('p9-host-process.mjs', root, ['verify']); assert.equal(verified.nativeTailRetained, true);
});

for (const mode of ['failure', 'cancel']) {
  test('P9 real Host ' + mode + ' closes the current writer and isolates later items', { timeout: 120000 }, async t => {
    const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
    const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
    await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
      peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
    await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
    const report = await runFixture('p9-host-process.mjs', root, [mode]);
    assert.equal(report.currentWriterClosed, true);
    if (mode === 'cancel') assert.equal(report.cancelledBeforeNext, true);
    else assert.equal(report.safeNextItemsCompleted, true);
  });
}

test('P9 built batch import, deduplicated plan and dry-run have no filesystem/network/subprocess effects', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const report = await runFixture('batch-artifact-process.mjs', root);
  assert.equal(report.lazyImport, true); assert.equal(report.strictDryRun, true); assert.deepEqual(report.attempts, []);
});
