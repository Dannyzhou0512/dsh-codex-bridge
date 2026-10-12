/** Hooks live only in this isolated child and are restored after quiescent disposal. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';

const directory = process.argv[2];
// Node's own module transport needs filesystem reads; feed the exact artifact before guarding plugin execution.
const moduleUrl = pathToFileURL(join(directory, 'node_modules/dsh-codex-bridge/lib/index.js')).href;
const moduleSource = await promises.readFile(new URL(moduleUrl), 'utf8');
const cordisUrl = import.meta.resolve('@deepseek-ai/cordis');
const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === moduleUrl) return { url: moduleUrl, shortCircuit: true };
    if (context.parentURL === moduleUrl && specifier === '@deepseek-ai/cordis') return { url: cordisUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === moduleUrl) return { format: 'module', source: moduleSource, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const restorers = [];
const attempts = [];
function forbid(target, key, label) {
  if (typeof target[key] !== 'function') return;
  const original = target[key];
  target[key] = function () { attempts.push(label); throw new Error('P1 forbidden operation: ' + label); };
  restorers.push(() => { target[key] = original; });
}
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) forbid(childProcess, key, 'process.' + key);
for (const key of ['request', 'get']) { forbid(http, key, 'http.' + key); forbid(https, key, 'https.' + key); }
forbid(net.Socket.prototype, 'connect', 'socket.connect');
forbid(net.Server.prototype, 'listen', 'server.listen');
forbid(tls, 'connect', 'tls.connect');
forbid(dns, 'lookup', 'dns.lookup');
forbid(globalThis, 'fetch', 'fetch');
for (const key of ['readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'stat', 'lstat', 'realpath', 'open', 'rename', 'unlink', 'rm', 'rmdir', 'copyFile', 'cp', 'createWriteStream', 'createReadStream']) {
  forbid(fs, key, 'fs.' + key);
  forbid(fs, key + 'Sync', 'fs.' + key + 'Sync');
  forbid(promises, key, 'fs.promises.' + key);
}
syncBuiltinESMExports();
let ctx;
let report;
try {
  // Guard negative control: the intercepted call throws before any network request exists.
  assert.throws(() => globalThis.fetch('https://p1.invalid'), /P1 forbidden operation/);
  assert.deepEqual(attempts, ['fetch']);
  attempts.length = 0;
  const module = await import(moduleUrl);
  assert.deepEqual(Object.keys(module), ['default']);
  ctx = new Context();
  await ctx.plugin(module.default);
  assert(ctx.get('codexHistory') instanceof Service);
  assert.equal(ctx.get('codexHistory').status().state, 'capabilityUnavailable');
  assert.equal(ctx.get('codexHistory').capabilities().length, 4);
  await ctx.fiber.dispose();
  assert.equal(ctx.get('codexHistory'), undefined);
  assert.deepEqual(attempts, []);
  report = { guardedBuiltImportAndLifecycle: true, guardNegativeControl: true, moduleTransport: 'pre-read built artifact via public Node hooks', attempts };
} finally {
  await ctx?.fiber.dispose();
  moduleHooks.deregister();
  for (const restore of restorers.reverse()) restore();
  syncBuiltinESMExports();
}
console.log('P1_REPORT ' + JSON.stringify(report));
