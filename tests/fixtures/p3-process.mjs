/** Actual published rc.2 Host process; no private persistence file access or real model calls. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { Session, SessionId, deriveEventMessage } from '@deepseek-ai/dsh-session';
import { InvariantError } from '@deepseek-ai/dsh-invariants';
import { SessionQueryError } from '@deepseek-ai/dsh-session-query';
import { SessionAlreadyExistsError, SessionAlreadyOwnedError, SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import { hostEntries } from './p3/host-config.mjs';
import { history } from './p3/events.mjs';
const directory = process.argv[2];
const mode = process.argv[3] ?? 'write';
const variant = process.argv[4] ?? 'recall';
const compression = process.argv[5] ?? 'none';
const creates = mode === 'write' || mode === 'missing-head-write';
const imported = history(join(directory, 'workspace'), variant);
let networkAttempts = 0;
globalThis.fetch = () => { networkAttempts++; throw new Error('P3 disallows network'); };
net.Socket.prototype.connect = function () { networkAttempts++; throw new Error('P3 disallows sockets'); };
net.Server.prototype.listen = function () { throw new Error('P3 does not launch a server listener'); };
await mkdir(join(directory, 'workspace'), { recursive: true });
const configPath = join(directory, 'cordis-p3.yml');
await writeFile(configPath, JSON.stringify(hostEntries(directory, mode === 'write', compression)));
let ctx, writer;
try {
  ctx = await boot('p3-synthetic-host', configPath);
  const services = ['sessionPersistence', 'sessionQuery', 'sessionController', 'sessions', 'agents', 'workspaceRegistry', 'p3Probe'];
  for (const key of services) assert(ctx.get(key), 'Missing real Host service: ' + key);
  const persistence = ctx.get('sessionPersistence');
  const query = ctx.get('sessionQuery');
  const controller = ctx.get('sessionController');
  const signal = new AbortController().signal;
  if (mode === 'unknown-required-write') {
    writer = await persistence.create(imported.header);
    await writer.append([{ type: 'future-required-event', seq: 0, time: 1700000000000, data: {} }]);
    await writer.flush(); await writer.close(); writer = undefined;
    await ctx.fiber.dispose(); ctx = undefined;
    console.log('P1_REPORT ' + JSON.stringify({ phase: 'P3', mode, appendAcceptedUnknownRequired: true, networkAttempts }));
  } else if (mode === 'unknown-required-check') {
    await assert.rejects(persistence.open(imported.header.id, 'read'), SessionFormatUnsupportedError);
    await ctx.fiber.dispose(); ctx = undefined;
    console.log('P1_REPORT ' + JSON.stringify({ phase: 'P3', mode, coldReadRejectedUnknownRequired: true, networkAttempts }));
  } else if (mode === 'missing-head-check') {
    await assert.rejects(query.readSession(imported.header.id), error =>
      error instanceof SessionQueryError && error.code === 'SESSION_QUERY_CORRUPT_SESSION');
    await ctx.fiber.dispose(); ctx = undefined;
    console.log('P1_REPORT ' + JSON.stringify({ phase: 'P3', mode, missingHeadRejectedAfterRestart: true, networkAttempts }));
    process.exitCode = 0;
  } else if (mode === 'plan') {
    const before = await controller.list({}, signal);
    const workspaces = ctx.get('workspaceRegistry').list().map(workspace => workspace.id);
    let attempts = 0;
    const guards = [];
    for (const [service, method] of [[persistence, 'create'], [persistence, 'open'], [ctx.get('sessions'), 'create'], [ctx.get('workspaceRegistry'), 'create']]) {
      const original = service[method];
      service[method] = () => { attempts++; throw new Error('P3 plan cannot mutate'); };
      guards.push(() => { service[method] = original; });
    }
    try {
      assert.throws(() => persistence.create(imported.header), /P3 plan cannot mutate/);
      const guardControl = attempts;
      const planned = history(join(directory, 'workspace'), variant);
      assert.equal(planned.header.id, imported.header.id);
      const after = await controller.list({}, signal);
      assert.deepEqual(after, before);
      assert.deepEqual(ctx.get('workspaceRegistry').list().map(workspace => workspace.id), workspaces);
      assert.equal(attempts, guardControl);
      assert.equal(ctx.get('p3Probe').requests.length, 0);
      await writeFile(join(directory, 'plan-result.json'), JSON.stringify({ dryRun: true, sessionWrites: 0, workspaceWrites: 0, guardNegativeControl: true }));
    } finally { for (const restore of guards.reverse()) restore(); }
    await ctx.fiber.dispose(); ctx = undefined;
    console.log('P1_REPORT ' + JSON.stringify({ phase: 'P3', mode, dryRun: true, networkAttempts }));
  } else {
  if (creates) {
    if (mode === 'write') assert.equal(ctx.get('codexHistory').status().importEnabled, false);
    const invalidTurn = structuredClone(imported.events);
    invalidTurn[0].data.turn = 0;
    const invalidId = SessionId('p3-invalid-turn');
    assert.throws(() => ctx.get('sessions').create(invalidId, { seed: invalidTurn,
      meta: { cwd: imported.header.cwd, createdAt: imported.header.createdAt, isSeeded: false } }), InvariantError);
    assert.equal(ctx.get('sessions').get(invalidId), undefined);
    assert.equal(await persistence.stat(invalidId), undefined);
    writer = await persistence.create(imported.header);
    assert.throws(() => validateStoredEvents(imported.header,
      [{ type: 'future-required-event', seq: 0, time: 1700000000000, data: {} }]), SessionFormatUnsupportedError);
    assert.deepEqual((await writer.read()).events, [], 'Rejected unknown required event must not mutate the writer');
    await assert.rejects(persistence.create(imported.header), SessionAlreadyExistsError);
    await assert.rejects(persistence.open(imported.header.id, 'write'), SessionAlreadyOwnedError);
    await writer.append(imported.events);
    await writer.flush();
    await writer.close(); writer = undefined;
    const stored = await query.readSession(imported.header.id);
    assert.deepEqual(stored.events, imported.events);
    assert.equal(ctx.get('sessions').get(imported.header.id), undefined, 'Direct handle does not publish a live Session');
    const coldList = await controller.list({}, signal);
    assert(coldList.items.some(row => row.sessionId === imported.header.id), 'Native cold list must discover the imported Session');
    if (mode === 'write') {
    const entry = [...ctx.loader.entries()].find(value => value.options.id === 'dsh-codex-bridge-host');
    await entry.fiber.dispose(); await ctx.loader.await();
    assert.equal(ctx.get('codexHistory'), undefined);
    }
  } else {
    assert.equal(ctx.get('codexHistory'), undefined, 'Restart omits the bridge entirely');
  }
  const before = await query.readSession(imported.header.id);
  assert.deepEqual(before.events.slice(0, imported.events.length), imported.events, 'Prefix survives process restart and bridge removal');
  const nativeRow = (await controller.list({}, signal)).items.find(row => row.sessionId === imported.header.id);
  assert(nativeRow, 'Each new Host process discovers the cold native Session');
  assert.equal(nativeRow.agentAvailable, false);
  const projections = await controller.projections({ sessionId: imported.header.id }, signal);
  assert.equal(projections.values.title, 'P3 synthetic imported title');
  const surface = await query.readSurface(imported.header.id);
  const messages = surface.events.map(event => deriveEventMessage(event)).filter(Boolean);
  assert(messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('P3 original public'))));
  const page = await controller.page({ address: { kind: 'session', sessionId: imported.header.id }, throughSeq: before.events.at(-1).seq, maxMessages: 100 }, signal);
  assert.equal(page.hasMore, false);
  assert(JSON.stringify(page.records).includes('P3 original public user message'));
  const resolved = await controller.resolveAgent(imported.header.id);
  if ('error' in resolved) throw resolved.error;
  const agent = resolved.agent;
  assert(agent.session instanceof Session, 'Use the same public Session class as the Host');
  if (mode !== 'write') {
    const probe = ctx.get('p3Probe');
    assert.equal(probe.requests.length, 0, 'Resolving a cold Agent does not call the model');
    await controller.prompt({ sessionId: imported.header.id, requestId: 'p3-request-' + mode, mode: 'queue',
      content: [{ type: 'text', text: 'P3 continue this native session' }] }, signal);
    await agent.whenIdle();
    assert.deepEqual(probe.errors, []);
    assert.equal(probe.requests.length, 1);
    assert(probe.systemPrompts[0].includes('P3 current host system prompt'));
    assert.equal(probe.systemPrompts[0].includes('P3 recalled public assistant text'), false);
    // Live event durability belongs to the public backend; explicitly flush before inspecting its stored log.
    await persistence.flush();
    const durable = await query.readSession(imported.header.id);
    assert.deepEqual(durable.events.slice(0, imported.events.length), imported.events);
    assert(durable.events.length > before.events.length);
    const turns = durable.events.filter(event => event.type === 'turn/start').map(event => event.data.turn);
    assert.deepEqual(turns, mode === 'resume-again' ? [1, 2, 3] : [1, 2]);
    assert.equal(durable.events.at(-1).type, 'turn/end');
    assert.equal(durable.events.at(-1).data.reason.kind, 'completed');
    for (const [index, event] of durable.events.entries()) assert.equal(event.seq, index);
    const text = JSON.stringify(probe.requests[0]);
    assert(text.includes('P3 original public user message'));
    assert(text.includes(variant === 'assistant' ? 'P3 known-model historical assistant' : 'P3 recalled public assistant text'));
    if (variant !== 'assistant') assert(text.includes('command=never-execute'));
    assert(text.includes('P3 continue this native session'));
    await writeFile(join(directory, 'request-' + mode + '.json'), JSON.stringify(probe.requests[0], null, 2) + '\n');
  }
  const finalProjections = await controller.projections({ sessionId: imported.header.id }, signal);
  assert.equal(finalProjections.values.title, 'P3 synthetic imported title');
  const report = { titlePinnedAfterContinuation: true, coldSummaryHasTitle: Boolean(nativeRow.projections?.values?.title), phase: 'P3', mode, variant, compression, sharedSessionClass: true, coldList: true,
    importedEvents: imported.events.length, requiredEventNegativeControl: creates, turnZeroInvariantNegativeControl: creates, publicSurfaceMessages: messages.length,
    nativePageRead: page !== undefined, bridgeMounted: Boolean(ctx.get('codexHistory')), networkAttempts };
  assert.equal(networkAttempts, 0);
  await ctx.fiber.dispose(); ctx = undefined;
  console.log('P1_REPORT ' + JSON.stringify(report));
  }
} finally {
  await writer?.close();
  await ctx?.fiber.dispose();
}
