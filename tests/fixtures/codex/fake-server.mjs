/** Synthetic external process only: never opens real Codex state or a network listener. */
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.argv[2];
const log = process.argv[3];
const fixture = JSON.parse(readFileSync(new URL('./history.json', import.meta.url), 'utf8'));
const reads = [];
const line = createInterface({ input: process.stdin });
let initialized = false, page = 0, approvalSent = false;
const record = value => appendFileSync(log, JSON.stringify(value) + '\n');
record({ envSecretForwarded: Boolean(process.env.P2_FAKE_API_KEY), internalForwarded: Object.keys(process.env).some(key => key.startsWith('CODEX_INTERNAL_')) });
function send(value) {
  const frame = Buffer.from(JSON.stringify(value) + '\n');
  if (mode !== 'fragment') { process.stdout.write(frame); return; }
  const emoji = frame.indexOf(Buffer.from('🙂'));
  const middle = emoji >= 0 ? emoji + 1 : Math.floor(frame.length / 2);
  const chunks = [frame.subarray(0, 1), frame.subarray(1, middle), frame.subarray(middle, middle + 1), frame.subarray(middle + 1)];
  const emit = () => { const chunk = chunks.shift(); if (chunk) process.stdout.write(chunk, () => setImmediate(emit)); };
  emit();
}
function snapshot(id) { return { thread: { ...fixture.thread, id, sessionId: id } }; }
line.on('line', raw => {
  const message = JSON.parse(raw);
  record(message);
  if (message.method === 'initialize') {
    assert.equal(message.params.capabilities.experimentalApi, false);
    assert.equal(message.params.capabilities.requestAttestation, false);
    assert.equal(message.params.capabilities.explicitGatewayOauth, true);
    send({ id: message.id, result: { codexHome: process.env.CODEX_HOME, userAgent: 'fake🙂/0.162', platformFamily: 'test', platformOs: process.platform } });
    return;
  }
  if (message.method === 'initialized') { initialized = true; return; }
  if (!message.method) return;
  assert(initialized, 'History request before initialized');
  assert(['thread/list', 'thread/read'].includes(message.method), 'Write method reached fake server');
  if (mode === 'timeout' || mode === 'ignore-eof') return;
  if (mode === 'exit') { process.exit(7); return; }
  if (mode === 'partial') { process.stdout.write('{"id":', () => process.exit(0)); return; }
  if (mode === 'invalid-utf8') { process.stdout.write(Buffer.from([0x7b, 0xff, 0x7d, 0x0a])); return; }
  if (mode === 'invalid') { process.stdout.write('HIDDEN_CHAIN_SENTINEL not JSON\n'); return; }
  if (mode === 'oversize') { process.stdout.write('x'.repeat(100000)); return; }
  if (mode === 'unknown-id') { send({ id: 'unknown-response', result: {} }); return; }
  if (mode === 'rpc-error') { send({ id: message.id, error: { code: -32600, message: 'HIDDEN_CHAIN_SENTINEL', data: { content: 'HIDDEN_CHAIN_SENTINEL' } } }); return; }
  if (mode === 'server-request' && !approvalSent) {
    approvalSent = true;
    send({ method: 'item/reasoning/textDelta', params: { text: 'HIDDEN_CHAIN_SENTINEL' } });
    send({ id: 'server-approval', method: 'item/commandExecution/requestApproval', params: { text: 'HIDDEN_CHAIN_SENTINEL' } });
  }
  if (message.method === 'thread/read') {
    if (mode === 'reorder') {
      reads.push(message);
      if (reads.length === 2) {
        const last = reads[1], first = reads[0];
        process.stdout.write(JSON.stringify({ id: last.id, result: snapshot(last.params.threadId) }) + '\n' +
          JSON.stringify({ id: first.id, result: snapshot(first.params.threadId) }) + '\n');
      }
    } else send({ id: message.id, result: snapshot(message.params.threadId) });
    return;
  }
  assert.equal(message.params.useStateDbOnly, true);
  assert(message.params.sourceKinds.includes('vscode'));
  page++;
  let data, nextCursor;
  if (mode === 'cycle') { data = []; nextCursor = 'cycle'; }
  else if (mode === 'endless') { data = []; nextCursor = 'page-' + page; }
  else if (mode === 'many') { data = [0, 1, 2].map(i => ({ ...fixture.thread, id: 'many-' + i, turns: [] })); nextCursor = null; }
  else if (message.params.archived) { data = [{ ...fixture.thread, id: 'archived-fixture', turns: [] }]; nextCursor = null; }
  else if (!message.params.cursor) { data = [{ ...fixture.thread, turns: [] }]; nextCursor = 'second'; }
  else { data = [{ ...fixture.thread, turns: [] }, { ...fixture.thread, id: 'second-fixture', turns: [] }]; nextCursor = null; }
  send({ id: message.id, result: { data, nextCursor, backwardsCursor: null } });
});
process.stdin.on('end', () => {
  if (mode === 'ignore-eof') setInterval(() => {}, 1000);
});
