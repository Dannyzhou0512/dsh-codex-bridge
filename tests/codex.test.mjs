import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodexHistoryReader } from '../lib/codex/index.js';
import { ReadOnlyStdioClient } from '../lib/codex/transport.js';
import { parseThreadSnapshot, parseThreadPage } from '../lib/codex/parse.js';
import { allocate, cleanup, project } from './helpers.mjs';

const fixturePath = join(project, 'tests/fixtures/codex/history.json');
const synthetic = JSON.parse(await readFile(fixturePath, 'utf8'));
const limits = { maxItems: 100, maxJsonDepth: 32 };
const scan = { archived: false, sourceKinds: ['vscode', 'appServer', 'cli'] };
async function setup(t, mode = 'normal', changes = {}) {
  const directory = await allocate();
  let client;
  t.after(async () => { try { await client?.close(); } finally { await cleanup(directory); } });
  const options = {
    executable: process.execPath, args: [join(project, 'tests/fixtures/codex/fake-server.mjs'), mode, join(directory, 'requests.jsonl')],
    cwd: project, codexHome: directory, clientInfo: { name: 'fixture', title: 'fixture', version: '0.0.2' },
    limits: { requestTimeoutMs: 2500, shutdownTimeoutMs: 500, maxInFlight: 4, maxFrameBytes: 65536, ...changes.limits },
    readLimits: { pageSize: 1, maxPages: 5, maxThreads: 10, maxItems: 100, maxJsonDepth: 32, ...changes.readLimits },
  };
  client = changes.transport ? new ReadOnlyStdioClient(options) : new CodexHistoryReader(options);
  return { client, options, requests: async () => (await readFile(join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}
function code(expected) { return error => { assert.equal(error.code, expected); assert.doesNotMatch(String(error), /HIDDEN_CHAIN_SENTINEL/); return true; }; }
function assertStopped(client) {
  const observation = client.inspect();
  assert.equal(observation.state, 'closed');
  assert(observation.exit, 'Await process close before returning');
}

test('public projection retains messages, tool information, summary and times but removes raw/unstable fields', () => {
  const snapshot = parseThreadSnapshot(synthetic, 'fixture-thread', limits);
  assert.equal(snapshot.history, 'full');
  assert.deepEqual(snapshot.compatibilityWarnings, ['paginated-full-read-deprecated']);
  assert.equal(snapshot.thread.createdAtMs, 1700000000000);
  assert.equal(snapshot.turns[0].startedAtMs, 1700000001000);
  assert.equal(snapshot.thread.modelAttribution, 'thread-latest-only');
  assert.equal(snapshot.perTurnModelAttribution, false);
  assert.equal(snapshot.counts.messages, 2);
  assert.equal(snapshot.counts.reasoningItems, 1);
  assert.deepEqual(snapshot.nonTextInputTypes, ['localImage']);
  assert.equal(snapshot.turns[0].items.find(item => item.type === 'agentMessage').text, '公开回复');
  assert.deepEqual(snapshot.turns[0].items.find(item => item.type === 'reasoning').summary, ['公开摘要']);
  assert.doesNotMatch(JSON.stringify(snapshot), /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
  const command = snapshot.turns[0].items.find(item => item.type === 'toolInformation' && item.toolType === 'commandExecution');
  assert.equal(command.fields.aggregatedOutput, null, 'Do not invent missing output');
  const page = parseThreadPage({ data: [{ ...synthetic.thread, turns: [] }], nextCursor: null }, false);
  assert.equal(page.data[0].counts, null, 'Unhydrated list is not zero turns');
});
test('partial item views, ephemeral records, unknown types and duplicates are never silently complete', () => {
  const partial = structuredClone(synthetic);
  partial.thread.turns[0].itemsView = 'summary';
  assert.equal(parseThreadSnapshot(partial, 'fixture-thread', limits).history, 'unsupported');
  const ephemeral = structuredClone(synthetic);
  ephemeral.thread.ephemeral = true;
  assert.equal(parseThreadSnapshot(ephemeral, 'fixture-thread', limits).history, 'unsupported');
  const unknown = structuredClone(synthetic);
  unknown.thread.turns[0].items.push({ id: 'unknown', type: 'futureItem', encrypted_content: 'HIDDEN_CHAIN_SENTINEL' });
  const snapshot = parseThreadSnapshot(unknown, 'fixture-thread', limits);
  assert.deepEqual(snapshot.unsupportedTypes, ['futureItem']);
  assert.doesNotMatch(JSON.stringify(snapshot), /HIDDEN_CHAIN_SENTINEL/);
  const duplicate = structuredClone(synthetic);
  duplicate.thread.turns[0].items.push(duplicate.thread.turns[0].items[0]);
  assert.throws(() => parseThreadSnapshot(duplicate, 'fixture-thread', limits), code('invalid-response'));
  assert.throws(() => parseThreadSnapshot(synthetic, 'wrong-thread', limits), code('identity-mismatch'));
  assert.throws(() => parseThreadSnapshot(synthetic, 'fixture-thread', { ...limits, maxItems: 1 }), code('content-limit'));
});
test('lazy stdio handshake, pages, archive filter and UTF-8 fragmentation stay read-only', { timeout: 120000 }, async t => {
  const { client, requests } = await setup(t, 'fragment');
  assert.equal(client.inspect().pid, null);
  const originalSecret = process.env.P2_FAKE_API_KEY;
  const originalInternal = process.env.CODEX_INTERNAL_P2_TEST;
  process.env.P2_FAKE_API_KEY = 'SYNTHETIC_NON_SECRET';
  process.env.CODEX_INTERNAL_P2_TEST = 'SYNTHETIC_NON_SECRET';
  t.after(() => {
    if (originalSecret === undefined) delete process.env.P2_FAKE_API_KEY; else process.env.P2_FAKE_API_KEY = originalSecret;
    if (originalInternal === undefined) delete process.env.CODEX_INTERNAL_P2_TEST; else process.env.CODEX_INTERNAL_P2_TEST = originalInternal;
  });
  const identity = await client.connect();
  assert.equal(identity.userAgent, 'fake🙂/0.162');
  const rows = await client.list(scan);
  assert.deepEqual(rows.map(row => row.id), ['fixture-thread', 'second-fixture']);
  const archived = await client.list({ ...scan, archived: true });
  assert.equal(archived[0].archived, true);
  const snapshot = await client.read('fixture-thread');
  assert.doesNotMatch(JSON.stringify(snapshot), /HIDDEN_CHAIN_SENTINEL/);
  await client.close();
  assertStopped(client);
  assert.equal(client.inspect().exit.forced, false);
  const wire = await requests();
  assert.deepEqual(wire.filter(row => row.method).map(row => row.method),
    ['initialize', 'initialized', 'thread/list', 'thread/list', 'thread/list', 'thread/read']);
  assert.equal(wire[0].envSecretForwarded, false);
  assert.equal(wire[0].internalForwarded, false);
});
test('response IDs correlate out of order; max in-flight rejects excess without breaking admitted reads', { timeout: 120000 }, async t => {
  const { client } = await setup(t, 'reorder', { limits: { maxInFlight: 2 } });
  await client.connect();
  const one = client.read('one'), two = client.read('two');
  await assert.rejects(client.read('three'), code('concurrency-limit'));
  const results = await Promise.all([one, two]);
  assert.deepEqual(results.map(value => value.thread.id), ['one', 'two']);
  await client.close(); assertStopped(client);
});
for (const [mode, expected, changes] of [
  ['cycle', 'cursor-cycle', {}], ['endless', 'scan-limit', { readLimits: { maxPages: 2 } }],
  ['many', 'scan-limit', { readLimits: { maxThreads: 1 } }],
  ['invalid-utf8', 'invalid-frame', {}], ['invalid', 'invalid-frame', {}], ['oversize', 'frame-too-large', { limits: { maxFrameBytes: 1024 } }],
  ['unknown-id', 'unexpected-response', {}], ['partial', 'truncated-frame', {}],
  ['exit', 'process-exited', {}], ['rpc-error', 'rpc-failed', {}], ['timeout', 'request-timeout', {}],
]) {
  test('read-only process handles ' + mode + ' and waits for cleanup', { timeout: 120000 }, async t => {
    const { client } = await setup(t, mode, changes);
    await assert.rejects(client.list(scan), code(expected));
    await client.close(); assertStopped(client);
  });
}
test('unsolicited raw reasoning is ignored and server approval requests are declined', { timeout: 120000 }, async t => {
  const { client, requests } = await setup(t, 'server-request');
  await client.list(scan);
  await client.close(); assertStopped(client);
  const wire = await requests();
  const response = wire.find(row => row.id === 'server-approval');
  assert.equal(response.error.code, -32601);
  assert.equal(client.inspect().sent.rejectedServerRequests, 1);
  assert.doesNotMatch(JSON.stringify(client.inspect()), /HIDDEN_CHAIN_SENTINEL/);
});
test('write methods are blocked before spawn; invalid inputs do not start Codex', { timeout: 120000 }, async t => {
  const { client, options } = await setup(t, 'normal', { transport: true });
  await assert.rejects(client.request('turn/start', {}), code('write-method-denied'));
  assert.equal(client.inspect().pid, null);
  assert.throws(() => new CodexHistoryReader({ ...options, executable: 'relative-command' }), code('invalid-config'));
  const reader = new CodexHistoryReader(options);
  try {
    await assert.rejects(reader.list({ ...scan, sourceKinds: [] }), code('invalid-config'));
    await assert.rejects(reader.read(null), code('invalid-config'));
    assert.equal(reader.inspect().pid, null);
  } finally { await reader.close(); }
});
test('abort closes an in-flight request and EOF-resistant processes are bounded', { timeout: 120000 }, async t => {
  const { client } = await setup(t, 'timeout');
  await client.connect();
  const abort = new AbortController();
  const pending = client.read('fixture-thread', abort.signal);
  // Wait until the request is actually admitted; no clock sleep is used as readiness.
  while (client.inspect().sent.read === 0) await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, code('cancelled'));
  await client.close(); assertStopped(client);
});
test('shutdown waits for forced close only when EOF is ignored', { timeout: 120000 }, async t => {
  const { client } = await setup(t, 'ignore-eof', { limits: { shutdownTimeoutMs: 100 } });
  await client.connect();
  await client.close(); assertStopped(client);
  assert.equal(client.inspect().exit.forced, true);
});
test('missing executable is a sanitized failure with quiescent close', { timeout: 120000 }, async t => {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  const client = new CodexHistoryReader({
    executable: join(directory, 'absent.exe'), args: [], cwd: project, codexHome: directory,
    clientInfo: { name: 'fixture', title: 'fixture', version: '0.0.2' },
    limits: { requestTimeoutMs: 2500, shutdownTimeoutMs: 500, maxInFlight: 1, maxFrameBytes: 65536 },
    readLimits: { pageSize: 1, maxPages: 1, maxThreads: 1, maxItems: 1, maxJsonDepth: 32 },
  });
  t.after(() => client.close());
  await assert.rejects(client.connect(), code('spawn-failed'));
  await client.close(); assertStopped(client);
});
