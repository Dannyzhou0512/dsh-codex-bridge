/** Preloaded built modules isolate module loading from guarded operation I/O. */
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
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2], cwd = join(directory, 'p7-readonly');
await promises.mkdir(cwd);
const source = publicSnapshot(); source.thread.cwd = cwd;
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const url = name => pathToFileURL(require.resolve('dsh-codex-bridge/' + name)).href;
const importerUrl = url('importer');
const plannerUrl = url('planner'), mapperUrl = url('workspace'), sources = new Map();
for (const folder of ['importer', 'planner', 'workspace', 'converter', 'codex']) {
  const root = join(directory, 'node_modules/dsh-codex-bridge/lib', folder);
  for (const name of await promises.readdir(root)) if (name.endsWith('.js')) {
    const location = pathToFileURL(join(root, name)).href;
    sources.set(location, await promises.readFile(new URL(location), 'utf8'));
  }
}
const external = new Map();
for (const name of ['zod', 'node:crypto', 'node:path', 'node:fs/promises', '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-title', '@deepseek-ai/dsh-llm/brand']) {
  await import(name); external.set(name, import.meta.resolve(name));
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (sources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (sources.has(context.parentURL)) {
      if (specifier.startsWith('.')) {
        const location = new URL(specifier, context.parentURL).href;
        if (sources.has(location)) return { url: location, shortCircuit: true };
      }
      if (external.has(specifier)) return { url: external.get(specifier), shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(location, context, next) { return sources.has(location)
    ? { format: 'module', source: sources.get(location), shortCircuit: true } : next(location, context); },
});
const restore = [], attempts = [], reads = [];
function deny(object, key) {
  if (typeof object[key] !== 'function') return;
  const original = object[key];
  object[key] = () => { attempts.push(key); throw new Error('P6 forbidden I/O'); };
  restore.push(() => { object[key] = original; });
}
for (const key of ['writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'rm', 'rmdir', 'copyFile', 'cp',
  'open', 'readFile', 'readdir', 'createWriteStream', 'createReadStream']) {
  deny(fs, key); deny(fs, key + 'Sync'); deny(promises, key);
}
for (const key of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) deny(childProcess, key);
for (const object of [http, https]) for (const key of ['request', 'get']) deny(object, key);
deny(net.Socket.prototype, 'connect'); deny(net.Server.prototype, 'listen'); deny(globalThis, 'fetch');
for (const key of ['stat', 'lstat', 'realpath']) {
  const original = promises[key];
  promises[key] = async (...args) => { reads.push(key); return original(...args); };
  restore.push(() => { promises[key] = original; });
}
syncBuiltinESMExports();
try {
  assert.throws(() => promises.mkdir('unused'), /forbidden/);
  assert.deepEqual(attempts, ['mkdir']); attempts.length = 0;
  const { SessionImporter } = await import(importerUrl);
  const { ImportPlanner } = await import(plannerUrl), { WorkspaceMapper } = await import(mapperUrl);
  const forbidMutator = () => { attempts.push('mutator'); throw new Error('P6 mutator denied'); };
  const mapper = new WorkspaceMapper({ registry: { list: () => [], create: forbidMutator } },
    { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const guardPersistence = { identity: Symbol(), stat: async () => undefined, open: forbidMutator, create: forbidMutator, flush: forbidMutator };
  const planner = new ImportPlanner({ source: { read: async () => source }, mapper, liveSession: () => false,
    persistence: guardPersistence },
    { maxTargetEvents: 2000, maxTargetBytes: 2000000, readChunkEvents: 3, maxPlanBytes: 4000000 });
  assert.deepEqual(reads, [], 'Built import and construction must be lazy');
  const { target, ...conversion } = options(cwd);
  const plan = await planner.plan({ threadId: source.thread.id, conversion }, { dryRun: true });
  assert.equal(plan.state, 'ready'); assert.equal((await planner.checkFresh(plan, { dryRun: true })).state, 'fresh');
  const importer = new SessionImporter({ planner, persistence: guardPersistence },
    { maxReadEvents: 2000, maxReadBytes: 2000000, readChunkEvents: 3, maxResultBytes: 8192 });
  assert.equal((await importer.apply(plan, { dryRun: true, cache: 'refresh-if-available' })).state, 'dry-run');
  assert.deepEqual(attempts, []);
} finally { hooks.deregister(); for (const undo of restore.reverse()) undo(); syncBuiltinESMExports(); }
console.log('P1_REPORT ' + JSON.stringify({ lazyImport: true, strictDryRun: true, attempts,
  reads: [...new Set(reads)], negativeControl: true }));
