/** P6 real rc.2 Host: setup writes are synthetic; the measured planner phase denies all mutators. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { hostEntries } from './p3/host-config.mjs';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const { ImportPlanner } = await import(pathToFileURL(require.resolve('dsh-codex-bridge/planner')).href);
const { WorkspaceMapper } = await import(pathToFileURL(require.resolve('dsh-codex-bridge/workspace')).href);
const { convertSnapshot } = await import(pathToFileURL(require.resolve('dsh-codex-bridge/converter')).href);
const cwd = join(directory, 'workspace');
await mkdir(cwd, { recursive: true });
const config = join(directory, 'p6-cordis.yml'); await writeFile(config, JSON.stringify(hostEntries(directory, true, 'zstd')));
let ctx, handle, audit, report;
const restore = [], attempts = [];
function deny(object, keys, prefix) {
  if (!object) return;
  for (const key of keys) {
    if (typeof object[key] !== 'function') continue;
    const original = object[key];
    object[key] = () => { attempts.push(prefix + '.' + key); throw new Error('P6 forbidden mutator'); };
    restore.push(() => { object[key] = original; });
  }
}
try {
  ctx = await boot('p6-planning-integration', config);
  const persistence = ctx.get('sessionPersistence'), registry = ctx.get('workspaceRegistry');
  const sessions = ctx.get('sessions'), query = ctx.get('sessionQuery');
  const source = publicSnapshot(); source.thread.cwd = cwd;
  const existing = convertSnapshot(source, options(cwd)).plan;
  handle = await persistence.create(existing.header);
  await handle.append(existing.events); await handle.flush(); await handle.close(); handle = undefined;
  const workspace = await registry.create(cwd); await workspace.attachSession(existing.header.id);
  audit = await ctx.get('storageDomain').open(defineDomain({ name: 'p6_test_audit', version: 1,
    global: { schema: z.object({ marker: z.string() }), initial: { marker: 'synthetic' } },
    tables: { rows: domainTable(z.object({ value: z.string() })) } }));
  const table = audit.table('rows'); await table.put('sentinel', { value: 'unchanged' });
  const observed = async () => ({
    sessions: await persistence.list(),
    liveSessions: sessions.list().map(session => session.id),
    workspaces: registry.list().map(item => ({ id: item.id, path: item.path, title: item.title, sessionIds: [...item.sessionIds] })),
    domain: { global: audit.global.get(), rows: [...table.entries()] },
    events: (await query.readSession(existing.header.id)).events,
    modelCalls: ctx.get('p3Probe').requests.length,
  });
  const before = await observed();
  assert.deepEqual(before.sessions[0].header, { ...existing.header, delegationDepth: 0 });
  assert.deepEqual(before.events, existing.events);
  deny(persistence, ['create', 'flush'], 'persistence');
  const open = persistence.open;
  persistence.open = async (id, access, opts) => {
    if (access !== 'read') { attempts.push('persistence.open.write'); throw new Error('Writer denied'); }
    const reader = await open.call(persistence, id, access, opts);
    deny(reader, ['append', 'flush'], 'readHandle');
    return reader;
  };
  restore.push(() => { persistence.open = open; });
  deny(registry, ['create', 'initializeDefault', 'delete', 'insertBefore', 'archiveSession', 'unarchiveSession',
    'pinSession', 'unpinSession', 'resolveByPath'], 'registry');
  for (const item of registry.list()) deny(item, ['attachSession', 'detachSession', 'setTitle', 'insertSessionBefore'], 'workspace');
  deny(sessions, ['create', 'prepare', 'enter', 'announce', 'flush', 'fork'], 'sessions');
  deny(ctx.get('sessionController'), ['resolveAgent', 'inspect', 'create', 'selectModel', 'initializeDefaultModel',
    'rename', 'fork', 'prompt', 'attachment', 'updateQueue', 'cancel', 'page', 'follow', 'projections', 'openWorkspacePath'], 'controller');
  deny(ctx.get('sessionProjectionCache'), ['coldSnapshot', 'write', 'hydratePrepared'], 'cache');
  deny(query, ['observeSession', 'readSession', 'readSurface', 'listSessions', 'searchSessions', 'searchEvents'], 'query');
  deny(ctx.get('storageDomain'), ['open'], 'domain');
  deny(audit.global, ['set'], 'domainGlobal'); deny(table, ['put', 'update', 'delete'], 'domainTable');
  const mapper = new WorkspaceMapper({ registry }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const newer = structuredClone(source); newer.thread.id = 'p6-new-synthetic';
  const planner = new ImportPlanner({ source: { async read(id) { return id === source.thread.id ? source : newer; } },
    mapper, persistence, liveSession: id => sessions.get(id) !== undefined },
    { maxTargetEvents: 2000, maxTargetBytes: 2000000, readChunkEvents: 3, maxPlanBytes: 4000000 });
  const { target, ...conversion } = options(cwd);
  const request = { threadId: source.thread.id, conversion };
  const duplicate = await planner.plan(request, { dryRun: true });
  assert.equal(duplicate.state, 'already-imported', JSON.stringify(duplicate.target));
  const fresh = await planner.plan({ ...request, threadId: newer.thread.id }, { dryRun: true });
  assert.equal(fresh.state, 'ready'); assert.equal(fresh.workspace.action, 'reuse');
  assert.equal((await planner.checkFresh(fresh, { dryRun: true })).state, 'fresh');
  // Negative control proves the guards execute at the actual public boundary.
  assert.throws(() => persistence.create(existing.header), /forbidden/);
  assert.deepEqual(attempts, ['persistence.create']); attempts.length = 0;
  for (const undo of restore.splice(0).reverse()) undo();
  const after = await observed(); assert.deepEqual(after, before);
  assert.equal(ctx.get('p3Probe').requests.length, 0);
  assert.equal(ctx.get('codexHistory').status().importEnabled, false);
  report = { phase: 'P6', strictDryRun: true, publicStateUnchanged: true,
    modelCalls: 0, mutatorAttempts: attempts, syntheticOnly: true,
    projectionCachePresent: ctx.get('sessionProjectionCache') !== undefined };
} finally {
  for (const undo of restore.reverse()) undo();
  await handle?.close(); await audit?.close(); await ctx?.fiber.dispose();
}
console.log('P1_REPORT ' + JSON.stringify(report));
