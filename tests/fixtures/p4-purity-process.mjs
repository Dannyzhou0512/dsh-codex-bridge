/** Own public Node hooks separate module transport from executed converter code. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { project } from '../helpers.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const source = publicSnapshot(), opts = options(), sources = new Map(), external = new Map();
for (const name of ['zod', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm/brand',
  '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-title', 'node:crypto', 'node:path']) {
  await import(name); external.set(name, import.meta.resolve(name));
}
for (const folder of ['converter', 'codex']) {
  for (const name of await promises.readdir(join(project, 'lib', folder))) {
    if (!name.endsWith('.js')) continue;
    const url = pathToFileURL(join(project, 'lib', folder, name)).href;
    sources.set(url, await promises.readFile(new URL(url), 'utf8'));
  }
}
const moduleUrl = pathToFileURL(join(project, 'lib/converter/index.js')).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (sources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (context.parentURL && sources.has(context.parentURL)) {
      if (specifier.startsWith('.')) {
        const url = new URL(specifier, context.parentURL).href;
        if (sources.has(url)) return { url, shortCircuit: true };
      }
      if (external.has(specifier)) return { url: external.get(specifier), shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    return sources.has(url) ? { format: 'module', source: sources.get(url), shortCircuit: true } : next(url, context);
  },
});
const attempts = [], restore = [];
function forbid(target, key) {
  if (typeof target[key] !== 'function') return;
  const original = target[key];
  target[key] = () => { attempts.push(key); throw new Error('P4 forbidden operation: ' + key); };
  restore.push(() => { target[key] = original; });
}
for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'stat', 'lstat', 'realpath', 'open', 'rename', 'unlink', 'rm', 'copyFile', 'createReadStream', 'createWriteStream']) {
  forbid(fs, name); forbid(fs, name + 'Sync'); forbid(promises, name);
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork']) forbid(childProcess, name);
for (const target of [http, https]) { forbid(target, 'request'); forbid(target, 'get'); }
forbid(net.Socket.prototype, 'connect'); forbid(net.Server.prototype, 'listen'); forbid(globalThis, 'fetch');
for (const name of ['randomUUID', 'randomBytes', 'randomInt']) forbid(crypto, name);
forbid(Date, 'now');
syncBuiltinESMExports();
try {
  assert.throws(() => fs.writeFileSync('unused', ''), /P4 forbidden operation/);
  assert.deepEqual(attempts, ['writeFileSync']); attempts.length = 0;
  const module = await import(moduleUrl);
  const one = module.convertSnapshot(source, opts), two = module.convertSnapshot(structuredClone(source), opts);
  assert.equal(one.state, 'ready'); assert.deepEqual(one, two);
  module.validateConversionPlan(one.plan);
  assert.deepEqual(attempts, []);
} finally {
  hooks.deregister(); for (const undo of restore.reverse()) undo(); syncBuiltinESMExports();
}
console.log('P1_REPORT ' + JSON.stringify({ builtConverterImportAndExecutionPure: true, clockAndRandomDenied: true, ioGuardNegativeControl: true, attempts }));
