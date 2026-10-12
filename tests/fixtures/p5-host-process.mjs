/** P5 real published Host fixture; every persisted Session/Workspace is synthetic and project-owned. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { hostEntries } from './p3/host-config.mjs';
import { history } from './p3/events.mjs';
const directory = process.argv[2], mode = process.argv[3];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const { WorkspaceMapper } = await import(pathToFileURL(require.resolve('dsh-codex-bridge/workspace')).href);
const target = join(directory, 'workspace 中文 spaces'), other = join(directory, 'other');
await mkdir(target, { recursive: true }); await mkdir(other, { recursive: true });
const config = join(directory, 'p5-cordis.yml');
await writeFile(config, JSON.stringify(hostEntries(directory, false, 'zstd')));
let ctx, handle, report;
try {
  ctx = await boot('p5-workspace-integration', config);
  const registry = ctx.get('workspaceRegistry'), persistence = ctx.get('sessionPersistence'), query = ctx.get('sessionQuery');
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const plan = await mapper.plan({ originalCwd: target });
  assert.equal(plan.status, 'ready');
  if (mode === 'write') {
    const before = registry.list().map(workspace => ({ id: workspace.id, path: workspace.path, sessionIds: [...workspace.sessionIds] }));
    const create = registry.create; registry.create = () => { throw new Error('P5 dry-run must not create Workspace'); };
    try { assert.equal((await mapper.resolve(plan, { dryRun: true })).status, 'dry-run'); }
    finally { registry.create = create; }
    assert.deepEqual(registry.list().map(workspace => ({ id: workspace.id, path: workspace.path, sessionIds: [...workspace.sessionIds] })), before);
    const resolved = await mapper.resolve(plan, { dryRun: false });
    assert.equal(resolved.status, 'resolved');
    const workspace = registry.list().find(workspace => workspace.id === resolved.workspace.id);
    assert(workspace);
    assert.equal((await registry.create(target)).id, workspace.id);
    if (process.platform === 'win32') {
      const variants = [target[0].toLowerCase() + target.slice(1), target.toUpperCase()];
      for (const path of variants) {
        const aliasPlan = await mapper.plan({ originalCwd: path });
        assert.equal(aliasPlan.action, 'reuse', 'Case alias must reuse real public Workspace');
        assert.equal((await mapper.resolve(aliasPlan, { dryRun: false })).workspace.id, workspace.id);
      }
    }
    const imported = history(workspace.path, 'recall', 'p5-mapped-session');
    handle = await persistence.create(imported.header);
    await handle.append(imported.events); await handle.flush(); await handle.close(); handle = undefined;
    const storedBefore = await query.readSession(imported.header.id);
    const attach = workspace.attachSession; workspace.attachSession = () => { throw new Error('P5 dry-run must not attach Session'); };
    const sessionCreate = persistence.create, sessionOpen = persistence.open;
    persistence.create = () => { throw new Error('Mapper must not create Session'); };
    persistence.open = () => { throw new Error('Mapper header check must use public stat only'); };
    try {
      const dry = await mapper.attach(plan, imported.header.id, { dryRun: true });
      assert.equal(dry.status, 'dry-run'); assert.equal(dry.effects.attachInvoked, false);
      assert.equal(workspace.sessionIds.includes(imported.header.id), false);
    } finally { workspace.attachSession = attach; persistence.create = sessionCreate; persistence.open = sessionOpen; }
    assert.equal((await mapper.attach(plan, imported.header.id, { dryRun: false })).status, 'attached');
    assert.equal((await mapper.attach(plan, imported.header.id, { dryRun: false })).status, 'already-attached');
    assert.deepEqual((await query.readSession(imported.header.id)).events, storedBefore.events);
    assert.equal(workspace.sessionIds.filter(id => id === imported.header.id).length, 1);
    const mismatch = { id: SessionId('p5-mismatch'), version: SESSION_FORMAT_VERSION, createdAt: 0, cwd: other, isSeeded: false };
    handle = await persistence.create(mismatch); await handle.flush(); await handle.close(); handle = undefined;
    assert.equal((await mapper.attach(plan, mismatch.id, { dryRun: false })).reason, 'session-cwd-mismatch');
    const noCwd = { id: SessionId('p5-no-cwd'), version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false };
    handle = await persistence.create(noCwd); await handle.flush(); await handle.close(); handle = undefined;
    assert.equal((await mapper.attach(plan, noCwd.id, { dryRun: false })).reason, 'session-cwd-missing');
    assert.equal((await mapper.attach(plan, SessionId('p5-unknown'), { dryRun: false })).reason, 'session-not-found');
    assert.equal(workspace.sessionIds.includes(mismatch.id), false);
    assert.equal(workspace.sessionIds.includes(noCwd.id), false);
    report = { phase: 'P5', mode, realPublicWorkspace: true, canonicalFromRegistry: true, dryRunNoMutators: true,
      attachValidated: true, sessionLogUnchanged: true, caseAliasesReused: process.platform === 'win32' };
  } else {
    const workspace = registry.list().find(workspace => workspace.path === plan.canonicalCwd);
    assert(workspace);
    assert(workspace.sessionIds.includes(SessionId('p5-mapped-session')));
    assert.equal((await mapper.attach(plan, SessionId('p5-mapped-session'), { dryRun: false })).status, 'already-attached');
    report = { phase: 'P5', mode, membershipSurvivedRestart: true };
  }
} finally { await handle?.close(); await ctx?.fiber.dispose(); }
console.log('P1_REPORT ' + JSON.stringify(report));
