/** Native continuation proof of Sessions actually produced by the published dsh CLI. */
import assert from 'node:assert/strict';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionIdFor } from '../../lib/converter/index.js';
import { hostEntries } from './p3/host-config.mjs';
const root = process.argv[2];
await mkdir(join(root, 'workspace'), { recursive: true });
const config = join(root, 'p10-native.yml'); await writeFile(config, JSON.stringify(hostEntries(root, false, 'zstd')));
let ctx;
try {
  ctx = await boot('p10-native-continuation', config);
  const controller = ctx.get('sessionController'), query = ctx.get('sessionQuery'), persistence = ctx.get('sessionPersistence');
  const id = sessionIdFor('fixture-thread'), before = await query.readSession(id), signal = new AbortController().signal;
  assert(before.events.some(e => e.type === 'codex-bridge/import-receipt'));
  assert(ctx.get('workspaceRegistry').list().some(w => w.sessionIds.includes(id)));
  const agent = await controller.resolveAgent(id); if ('error' in agent) throw agent.error;
  await controller.prompt({ sessionId: id, requestId: 'p10-cli-native', mode: 'queue',
    content: [{ type: 'text', text: 'P10 continue CLI import' }] }, signal);
  await agent.agent.whenIdle(); await persistence.flush();
  const after = await query.readSession(id), probe = ctx.get('p3Probe');
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.deepEqual(after.events.filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2]);
  assert(probe.requests[0].some(message => message.content.some(block => block.type === 'text' && block.text.includes('公开输入'))));
  assert(probe.requests[0].some(message => message.content.some(block => block.type === 'text' && block.text === 'P10 continue CLI import')));
  assert.deepEqual(probe.errors, []); assert.equal(ctx.get('codexHistory'), undefined);
} finally { await ctx?.fiber.dispose(); }
console.log('P1_REPORT ' + JSON.stringify({ cliProducedNativeSession: true, bridgeAbsent: true, originalPrefixRetained: true,
  nativeTurn2: true, modelVisibleImportedHistory: true, realModelCalls: 0 }));
