/** Read-only mapper IO guard with genuine public capabilities; only OS failure modes are simulated. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = process.argv[2];
const target = join(directory, 'readonly directory');
await promises.mkdir(target);
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const moduleUrl = pathToFileURL(require.resolve('dsh-codex-bridge/workspace')).href;
const sources = new Map();
for (const folder of ['workspace', 'converter']) {
  const root = join(directory, 'node_modules/dsh-codex-bridge/lib', folder);
  for (const name of await promises.readdir(root)) {
    if (!name.endsWith('.js')) continue;
    const url = pathToFileURL(join(root, name)).href;
    sources.set(url, await promises.readFile(new URL(url), 'utf8'));
  }
}
const external = new Map();
for (const name of ['zod', 'node:crypto', 'node:path', 'node:fs/promises']) {
  await import(name); external.set(name, import.meta.resolve(name));
}
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
  load(url, context, next) { return sources.has(url) ? { format: 'module', source: sources.get(url), shortCircuit: true } : next(url, context); },
});
const attempts = [], restore = [], readCalls = [];
function forbid(target, key) {
  if (typeof target[key] !== 'function') return;
  const original = target[key];
  target[key] = () => { attempts.push(key); throw new Error('P5 forbidden operation: ' + key); };
  restore.push(() => { target[key] = original; });
}
for (const key of ['writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'rm', 'rmdir', 'copyFile', 'cp', 'open', 'readFile', 'readdir', 'createWriteStream', 'createReadStream']) {
  forbid(fs, key); forbid(fs, key + 'Sync'); forbid(promises, key);
}
for (const key of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) forbid(childProcess, key);
for (const service of [http, https]) { forbid(service, 'request'); forbid(service, 'get'); }
forbid(net.Socket.prototype, 'connect'); forbid(net.Server.prototype, 'listen'); forbid(globalThis, 'fetch');
let deny = null;
for (const key of ['lstat', 'realpath', 'stat']) {
  const original = promises[key];
  promises[key] = async (...args) => {
    readCalls.push(key);
    if (deny && key === 'lstat') { const error = new Error('PRIVATE_OS_SENTINEL'); error.code = deny; throw error; }
    return original(...args);
  };
  restore.push(() => { promises[key] = original; });
}
syncBuiltinESMExports();
try {
  assert.throws(() => promises.mkdir('unused'), /P5 forbidden operation/);
  assert.deepEqual(attempts, ['mkdir']); attempts.length = 0;
  const { WorkspaceMapper } = await import(moduleUrl);
  const rows = [];
  const registry = { list: () => rows, create() { throw new Error('P5 mutator denied'); } };
  const persistence = { stat: async id => ({ header: { id, cwd: target }, revision: 'fixture' }) };
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  assert.deepEqual(readCalls, [], 'Import and constructor are lazy');
  const plan = await mapper.plan({ originalCwd: target });
  assert.equal(plan.status, 'ready');
  assert.equal((await mapper.resolve(plan, { dryRun: true })).status, 'dry-run');
  rows.push({ id: 'guard-workspace', path: plan.canonicalCwd, title: 'guard', sessionIds: [],
    attachSession() { throw new Error('P5 attach denied'); } });
  assert.equal((await mapper.attach(plan, 'guard-session', { dryRun: true })).status, 'dry-run');
  for (const [code, state] of [['EACCES', 'inaccessible'], ['EPERM', 'inaccessible'], ['EIO', 'io-error']]) {
    deny = code;
    const blocked = await mapper.plan({ originalCwd: target });
    assert.equal(blocked.target.state, state);
    assert.equal(blocked.status, 'needs-remap');
    assert.doesNotMatch(JSON.stringify(blocked), /PRIVATE_OS_SENTINEL/);
  }
  deny = null;
  const abort = new AbortController(); abort.abort();
  await assert.rejects(mapper.plan({ originalCwd: target }, abort.signal), error => error.code === 'cancelled');
  assert.deepEqual(attempts, []);
} finally { hooks.deregister(); for (const undo of restore.reverse()) undo(); syncBuiltinESMExports(); }
console.log('P1_REPORT ' + JSON.stringify({ lazyBuiltModule: true, dryRunReadOnly: true, osPermissionErrorsDistinct: true,
  reads: [...new Set(readCalls)].sort(), attempts, negativeControl: true }));
