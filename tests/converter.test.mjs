import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Session } from '@deepseek-ai/dsh-session';
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import { convertSnapshot, sessionIdFor, validateConversionPlan } from '../lib/converter/index.js';
import { publicSnapshot, options } from './fixtures/p4-data.mjs';

function userOnly() {
  const source = publicSnapshot();
  source.turns[0].items = [{ type: 'userMessage', id: 'user', content: [{ type: 'text', text: '公开用户文字🙂' }] }];
  return source;
}
function failure(code) { return error => { assert.equal(error.code, code); assert.doesNotMatch(String(error), /HIDDEN_CHAIN_SENTINEL/); return true; }; }
test('explicit recall produces a native canonical plan, typed core validation and detached replay', () => {
  const input = publicSnapshot(), before = structuredClone(input);
  const result = convertSnapshot(input, options());
  assert.equal(result.state, 'ready');
  assert.equal(result.plan.header.version, 4);
  assert.equal(result.plan.header.isSeeded, false);
  assert.equal(result.plan.header.cwd, options().target.selectedCwd);
  assert.deepEqual(result.requiredLosses, ['assistant-role-recall', 'non-text-input-omitted', 'reasoning-summary-recall', 'tool-information-recall', 'tool-output-unavailable']);
  assert.equal(result.plan.events[2].type, 'system/message');
  assert.deepEqual(result.plan.events[2].data.message.content, []);
  assert.equal(result.plan.events.at(-1).ignorable, true);
  assert.equal(result.plan.events.at(-1).type, 'codex-bridge/import-receipt');
  assert.equal(result.plan.events.filter(event => event.type === 'user/message').length, 8);
  assert.equal(result.preview.find(message => message.category === 'assistant').content[0].text.includes('公开回复'), true);
  assert.equal(result.preview.find(message => message.category === 'assistant').content[0].text.includes('historical context'), true);
  assert.doesNotMatch(JSON.stringify(result), /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
  assert.equal(result.plan.events.some(event => ['assistant/message', 'tool/call', 'tool/result', 'request/header', 'session/end-seed'].includes(event.type)), false);
  validateConversionPlan(result.plan);
  validateStoredEvents(result.plan.header, structuredClone(result.plan.events));
  const restored = Session.create(result.sessionId, result.plan.events, result.plan.header);
  assert(restored.surface.nodes.length > 1);
  assert.deepEqual(input, before);
  assert(Object.isFrozen(result.plan.events[3].data));
});
test('strict is review-only for missing attribution, tools, summary or attachments; user-only strict can be ready', () => {
  const strict = { ...options(), mode: 'strict', acceptedLosses: [] };
  const result = convertSnapshot(publicSnapshot(), strict);
  assert.equal(result.state, 'needs-review'); assert.equal(result.plan, null);
  assert(result.preview.length > 0);
  assert.equal(convertSnapshot(userOnly(), strict).state, 'ready');
  assert.throws(() => convertSnapshot(userOnly(), { ...strict, acceptedLosses: ['assistant-role-recall'] }), failure('invalid-options'));
  assert.equal(convertSnapshot(publicSnapshot(), { ...options(), acceptedLosses: ['assistant-role-recall'] }).state, 'needs-review');
});
test('determinism, stable identities, raw-independent fingerprints and tool key order', () => {
  const source = publicSnapshot();
  const one = convertSnapshot(source, options()), two = convertSnapshot(structuredClone(source), options());
  assert.deepEqual(one, two);
  assert.equal(sessionIdFor('fixture-thread'), 'codex-' + createHash('sha256').update('dsh-codex-bridge/v1\0fixture-thread').digest('hex'));
  const changed = structuredClone(source);
  changed.thread.cwd = 'Z:\\old-path'; changed.thread.title = 'new title'; changed.thread.updatedAtMs++;
  const changedResult = convertSnapshot(changed, options());
  assert.equal(changedResult.sessionId, one.sessionId);
  assert.deepEqual(changedResult.preview.map(row => row.messageId), one.preview.map(row => row.messageId));
  assert.notEqual(changedResult.sourceFingerprint, one.sourceFingerprint);
  const dirty = structuredClone(source);
  dirty.rawReasoning = 'HIDDEN_CHAIN_SENTINEL'; dirty.thread.path = 'PRIVATE_ROLLOUT_PATH_SENTINEL';
  dirty.counts.raw = 'HIDDEN_CHAIN_SENTINEL';
  dirty.turns[0].items.find(row => row.type === 'reasoning').content = ['HIDDEN_CHAIN_SENTINEL'];
  const tool = dirty.turns[0].items.find(row => row.type === 'toolInformation' && row.toolType === 'mcpToolCall');
  tool.fields.arguments.rawReasoning = 'HIDDEN_CHAIN_SENTINEL';
  assert.deepEqual(convertSnapshot(dirty, options()), one);
  const reversed = structuredClone(source);
  const args = reversed.turns[0].items.find(row => row.type === 'toolInformation' && row.toolType === 'dynamicToolCall').fields.arguments;
  Object.assign(args, { b: 2, a: 1 });
  const reordered = structuredClone(reversed);
  reordered.turns[0].items.find(row => row.type === 'toolInformation' && row.toolType === 'dynamicToolCall').fields.arguments = { a: 1, b: 2, x: 1 };
  assert.equal(convertSnapshot(reversed, options()).sourceFingerprint, convertSnapshot(reordered, options()).sourceFingerprint);
});
test('closed multi-turn statuses, item order and unavailable timing remain explicit', () => {
  const source = userOnly();
  source.turns = [
    source.turns[0],
    { ...structuredClone(source.turns[0]), id: 'turn-b', status: 'interrupted', startedAtMs: null, completedAtMs: null },
    { ...structuredClone(source.turns[0]), id: 'turn-c', status: 'failed', hasError: true },
  ];
  const result = convertSnapshot(source, { ...options(), mode: 'strict', acceptedLosses: [] });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.plan.events.filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2, 3]);
  assert.deepEqual(result.plan.events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind), ['completed', 'interrupted', 'error']);
  assert.equal(result.plan.events.find(event => event.type === 'turn/end' && event.data.turn === 3).data.reason.error.code, 'CODEX_TURN_FAILED');
  assert.equal(result.plan.events.at(-1).data.turns[1].itemTimeBasis, 'thread-created');
  assert.equal(result.plan.events.filter(event => event.type === 'step/start').length, 1);
  assert.equal(new Set(result.preview.map(row => row.messageId)).size, 3);
  const commentary = publicSnapshot();
  commentary.turns[0].items = [
    { type: 'agentMessage', id: 'commentary', text: 'commentary text', phase: 'commentary' },
    { type: 'agentMessage', id: 'final', text: 'final text', phase: 'final_answer' },
  ];
  const texts = convertSnapshot(commentary, options()).preview.map(row => row.content[0].text);
  assert(texts[0].includes('commentary')); assert(texts[1].includes('final_answer'));
});
test('incomplete, active, ephemeral, empty and unmapped histories never offer a write plan', () => {
  for (const mutate of [
    source => { source.history = 'unsupported'; }, source => { source.thread.ephemeral = true; },
    source => { source.turns[0].itemsView = 'summary'; }, source => { source.turns[0].status = 'inProgress'; },
    source => { source.thread.status = 'active'; }, source => { source.thread.status = 'systemError'; },
    source => { source.turns = []; }, source => { source.turns[0].items = [{ type: 'reasoning', id: 'empty', summary: [] }]; },
    source => { source.turns[0].completedAtMs = 1; },
  ]) {
    const source = publicSnapshot(); mutate(source);
    const result = convertSnapshot(source, options());
    assert.equal(result.state, 'unsupported'); assert.equal(result.plan, null);
  }
  for (const path of [null, 'relative', 'C:drive-relative', '\\root-relative', '\\\\?\\C:\\device-path']) {
    const result = convertSnapshot(publicSnapshot(), options(path));
    assert.equal(result.state, 'needs-remap'); assert.equal(result.plan, null);
  }
  assert.equal(convertSnapshot(publicSnapshot(), { ...options(), target: { selectedCwd: '/nonexistent-but-selected', pathStyle: 'posix' } }).state, 'ready',
    'Pure conversion cannot prove directory existence; P5/P7 must verify it');
});
test('unknown items and compaction require separate consent; no unknown payload enters preview', () => {
  const source = userOnly();
  source.turns[0].items.push({ type: 'unsupported', id: 'future', originalType: 'futureItem', raw: 'HIDDEN_CHAIN_SENTINEL' },
    { type: 'toolInformation', id: 'compact', toolType: 'contextCompaction', fields: { rawReasoning: 'HIDDEN_CHAIN_SENTINEL' } });
  const review = convertSnapshot(source, { ...options(), acceptedLosses: [] });
  assert.equal(review.state, 'needs-review');
  assert.deepEqual(review.requiredLosses, ['context-compaction-unrestored', 'unknown-item-omitted']);
  const accepted = convertSnapshot(source, options());
  assert.equal(accepted.state, 'ready');
  assert(accepted.preview.some(row => row.category === 'compaction'));
  assert.doesNotMatch(JSON.stringify(accepted), /HIDDEN_CHAIN_SENTINEL/);
});
test('title controls/UTF-8 bounds, output/input/text/event limits and duplicate identity refusal', () => {
  const source = userOnly(); source.thread.title = '\u001b[31m中文🙂标题'.repeat(5);
  const opts = options(); opts.limits.titleMaxBytes = 10;
  const result = convertSnapshot(source, opts);
  const title = result.plan.events.find(row => row.type === 'session/title').data.title;
  assert(Buffer.byteLength(title) <= 10); assert.doesNotMatch(title, /\u001b|�/);
  const omitted = convertSnapshot(source, { ...opts, titleMode: 'omit' });
  assert.equal(omitted.plan.events.some(row => row.type === 'session/title'), false);
  for (const field of ['maxInputBytes', 'maxResultBytes', 'maxTextBytes', 'maxEvents'])
    assert.throws(() => convertSnapshot(source, { ...opts, limits: { ...opts.limits, [field]: 1 } }), failure('content-limit'));
  const invalid = userOnly(); invalid.turns[0].items.push(invalid.turns[0].items[0]);
  assert.throws(() => convertSnapshot(invalid, options()), failure('invalid-snapshot'));
  const duplicateTurn = userOnly(); duplicateTurn.turns.push(duplicateTurn.turns[0]);
  assert.throws(() => convertSnapshot(duplicateTurn, options()), failure('invalid-snapshot'));
});
test('plan validation detects head changes, seq gaps, fake execution, receipt changes and prefix mutations', () => {
  const ready = convertSnapshot(userOnly(), options()).plan;
  for (const mutate of [
    plan => { plan.events[2].data.message.content = [{ type: 'text', text: 'fake Codex system prompt' }]; },
    plan => { plan.events[3].seq = 999; },
    plan => { plan.events[3].surfaceOp = { op: 'replace', startSeq: 2, endSeq: 2 }; },
    plan => { plan.events.at(-1).ignorable = undefined; },
    plan => { plan.events.at(-1).data.prefixDigest = 'changed'; },
    plan => { plan.events[3].data.content[0].text = 'tampered'; },
    plan => { plan.header.cwd = 'changed-path'; }, plan => { plan.events[0].data.turn = 0; },
    plan => { plan.events[3].type = 'request/header'; },
  ]) {
    const damaged = structuredClone(ready); mutate(damaged);
    assert.throws(() => validateConversionPlan(damaged), failure('invalid-plan'));
  }
});

test('built converter import, conversion and validation use no I/O, clock or randomness', { timeout: 120000 }, async t => {
  const { allocate, cleanup, runFixture } = await import('./helpers.mjs');
  const directory = await allocate(); t.after(() => cleanup(directory));
  const report = await runFixture('p4-purity-process.mjs', directory);
  assert.equal(report.builtConverterImportAndExecutionPure, true);
  assert.equal(report.clockAndRandomDenied, true);
  assert.equal(report.ioGuardNegativeControl, true);
  assert.deepEqual(report.attempts, []);
});
test('generated multi-turn plans cold-read and continue through actual rc.2 Host after bridge removal', { timeout: 180000 }, async t => {
  const { mkdir, cp, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { allocate, cleanup, stagePlugin, runFixture, project } = await import('./helpers.mjs');
  const directory = await allocate(); t.after(() => cleanup(directory));
  await stagePlugin(directory);
  const mockRoot = join(directory, 'node_modules/p3-mock-model');
  await mkdir(mockRoot, { recursive: true });
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mockRoot, 'index.mjs'));
  await writeFile(join(mockRoot, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0',
    type: 'module', main: 'index.mjs', peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  for (const mode of ['write', 'resume', 'verify-after-resume']) {
    const report = await runFixture('p4-host-process.mjs', directory, [mode]);
    assert.equal(report.converterSubpath, true);
    assert.equal(report.nativeReadback, true);
    assert.equal(report.bridgeAbsent, true);
    assert.equal(report.networkAttempts, 0);
  }
});
test('complete result byte cap is exact; omission-only, empty and nested malformed data remain safe', () => {
  const source = userOnly(), opts = options();
  const baseline = convertSnapshot(source, opts);
  const bytes = Buffer.byteLength(JSON.stringify(baseline));
  assert.equal(convertSnapshot(source, { ...opts, limits: { ...opts.limits, maxResultBytes: bytes } }).state, 'ready');
  assert.throws(() => convertSnapshot(source, { ...opts, limits: { ...opts.limits, maxResultBytes: bytes - 1 } }), failure('content-limit'));
  const attachmentOnly = userOnly();
  attachmentOnly.turns[0].items[0].content = [{ type: 'localImage', path: 'C:\\never-open.png' }];
  assert.equal(convertSnapshot(attachmentOnly, options()).state, 'unsupported');
  const blank = userOnly();
  blank.turns[0].items.push({ type: 'agentMessage', id: 'empty-answer', text: ' ', phase: null },
    { type: 'reasoning', id: 'empty-summary', summary: [] });
  assert.equal(convertSnapshot(blank, { ...options(), mode: 'strict', acceptedLosses: [] }).state, 'ready');
  const unsafe = publicSnapshot();
  const arg = unsafe.turns[0].items.find(row => row.type === 'toolInformation' && row.toolType === 'dynamicToolCall').fields.arguments;
  arg.loop = arg;
  assert.throws(() => convertSnapshot(unsafe, options()), failure('content-limit'));
  const invalid = userOnly(); invalid.thread.createdAtMs = NaN;
  assert.throws(() => convertSnapshot(invalid, options()), failure('invalid-snapshot'));
  const changedReceipt = structuredClone(baseline.plan);
  changedReceipt.events.at(-1).data.originalTitle = 'changed receipt';
  assert.throws(() => validateConversionPlan(changedReceipt), failure('invalid-plan'));
  const mapped = convertSnapshot(source, options('D:\\second-selected'));
  assert.equal(mapped.sourceFingerprint, baseline.sourceFingerprint);
  assert.equal(mapped.sessionId, baseline.sessionId);
  assert.notEqual(mapped.plan.planDigest, baseline.plan.planDigest);
});

test('model-visible formatter preview matches the fixed synthetic snapshot', async () => {
  const { readFile } = await import('node:fs/promises');
  const expected = JSON.parse(await readFile(new URL('./fixtures/p4-expected-preview.json', import.meta.url), 'utf8'));
  const actual = convertSnapshot(publicSnapshot(), options()).preview.map(({ category, content }) => ({ category, content }));
  assert.deepEqual(actual, expected);
});
