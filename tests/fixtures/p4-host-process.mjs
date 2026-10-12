/** Integration evidence only: generated synthetic plans run through real rc.2 Host APIs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { hostEntries } from './p3/host-config.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2], mode = process.argv[3];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const { convertSnapshot } = await import(pathToFileURL(require.resolve('dsh-codex-bridge/converter')).href);
const cwd = join(directory, 'workspace');
await mkdir(cwd, { recursive: true });
const source = publicSnapshot();
source.turns.push({ ...structuredClone(source.turns[0]), id: 'second-turn', status: 'interrupted' },
  { ...structuredClone(source.turns[0]), id: 'third-turn', status: 'failed', hasError: true });
const generated = convertSnapshot(source, options(cwd));
assert.equal(generated.state, 'ready');
const { plan } = generated;
const configPath = join(directory, 'p4-cordis.yml');
await writeFile(configPath, JSON.stringify(hostEntries(directory, mode === 'write', 'zstd')));
let ctx, handle, networkAttempts = 0;
globalThis.fetch = () => { networkAttempts++; throw new Error('P4 integration disallows real network'); };
net.Socket.prototype.connect = () => { networkAttempts++; throw new Error('P4 integration disallows sockets'); };
let report;
try {
  ctx = await boot('p4-converter-integration', configPath);
  const persistence = ctx.get('sessionPersistence'), query = ctx.get('sessionQuery'), controller = ctx.get('sessionController');
  const signal = new AbortController().signal;
  if (mode === 'write') {
    handle = await persistence.create(plan.header);
    await handle.append(plan.events); await handle.flush(); await handle.close(); handle = undefined;
    assert.deepEqual((await query.readSession(plan.header.id)).events, plan.events);
    const entry = [...ctx.loader.entries()].find(row => row.options.id === 'dsh-codex-bridge-host');
    await entry.fiber.dispose(); await ctx.loader.await();
  }
  assert.equal(ctx.get('codexHistory'), undefined);
  const before = await query.readSession(plan.header.id);
  assert.deepEqual(before.events.slice(0, plan.events.length), plan.events);
  const row = (await controller.list({}, signal)).items.find(row => row.sessionId === plan.header.id);
  assert(row);
  const projection = await controller.projections({ sessionId: plan.header.id }, signal);
  assert.equal(projection.values.title, 'Synthetic fixture');
  if (mode === 'resume') {
    const resolution = await controller.resolveAgent(plan.header.id);
    if ('error' in resolution) throw resolution.error;
    await controller.prompt({ sessionId: plan.header.id, requestId: 'p4-synthetic-followup', mode: 'queue',
      content: [{ type: 'text', text: 'P4 continue generated history' }] }, signal);
    await resolution.agent.whenIdle(); await persistence.flush();
    const probe = ctx.get('p3Probe');
    assert.deepEqual(probe.errors, []);
    assert.equal(probe.requests.length, 1);
    const expected = [...generated.preview.map(message => ({ role: 'user', content: message.content })),
      { role: 'user', content: [{ type: 'text', text: 'P4 continue generated history' }] }];
    assert.deepEqual(probe.requests[0], expected);
    assert(probe.systemPrompts[0].includes('P3 current host system prompt'));
    assert.doesNotMatch(JSON.stringify(probe.requests), /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
    const after = await query.readSession(plan.header.id);
    assert.deepEqual(after.events.slice(0, plan.events.length), plan.events);
    assert.deepEqual(after.events.filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2, 3, 4]);
    assert.equal(after.events.at(-1).data.reason.kind, 'completed');
  }
  assert.deepEqual(await readdir(cwd), [], 'Historical commands/diffs/images do not perform filesystem actions');
  assert.equal(networkAttempts, 0);
  report = { converterSubpath: true, mode, nativeReadback: true, bridgeAbsent: true, sourceTurns: 3,
    importedEvents: plan.events.length, generatedModelMessages: generated.preview.length, networkAttempts };
} finally { await handle?.close(); await ctx?.fiber.dispose(); }
console.log('P1_REPORT ' + JSON.stringify(report));
