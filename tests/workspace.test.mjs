import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath, access, rename, symlink, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { WorkspaceMapper, classifyWorkspacePath } from '../lib/workspace/index.js';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';
const limits = { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 };
async function setup(t) {
  const root = await allocate(); t.after(() => cleanup(root));
  const path = join(root, '中文 Project spaces');
  await mkdir(path);
  const canonical = await realpath(path);
  const calls = { create: 0, attach: 0, stat: 0 };
  const rows = [];
  const registry = {
    list: () => rows,
    async create(path) {
      calls.create++;
      const reused = rows.find(row => row.path === path);
      if (reused) return reused;
      const workspace = { id: 'fixture-workspace', path, title: 'existing title', sessionIds: [],
        async attachSession(id) { calls.attach++; if (!this.sessionIds.includes(id)) this.sessionIds.push(id); } };
      rows.push(workspace); return workspace;
    },
  };
  const persistence = { async stat(id) { calls.stat++; return { header: { id, cwd: canonical, version: 4, createdAt: 0, isSeeded: false }, revision: 'fixture' }; } };
  return { root, path, canonical, calls, rows, registry, persistence, mapper: new WorkspaceMapper({ registry, persistence }, limits) };
}
test('path classification distinguishes platform, URI, roots, devices, UNC and byte caps without I/O', () => {
  for (const value of ['C:\\x', 'c:/中文 folder', '\\\\server.example.test\\share\\folder', '//server/share/folder'])
    assert.equal(classifyWorkspacePath(value, 'windows', 8192), 'qualified', value);
  for (const value of ['relative', 'C:drive-relative', '\\root-relative'])
    assert.equal(classifyWorkspacePath(value, 'windows', 8192), 'unqualified', value);
  assert.equal(classifyWorkspacePath('/Users/project', 'windows', 8192), 'foreign-platform');
  assert.equal(classifyWorkspacePath('C:\\old', 'posix', 8192), 'foreign-platform');
  assert.equal(classifyWorkspacePath('\\\\server\\share', 'posix', 8192), 'foreign-platform');
  assert.equal(classifyWorkspacePath('/tmp/中文 spaces', 'posix', 8192), 'qualified');
  for (const value of ['file:///C:/project', 'ssh://host/project', 'vscode-remote://host/project'])
    assert.equal(classifyWorkspacePath(value, 'windows', 8192), 'uri');
  for (const value of ['\\\\?\\C:\\x', '\\\\.\\device'])
    assert.equal(classifyWorkspacePath(value, 'windows', 8192), 'device-path');
  assert.equal(classifyWorkspacePath('C:\\x\0', 'windows', 8192), 'invalid');
  assert.equal(classifyWorkspacePath('C:/🙂', 'windows', 6), 'over-limit');
});
test('constructor is lazy; directory plans use actual realpath and public Workspace reuse', async t => {
  const fixture = await setup(t);
  assert.deepEqual(fixture.calls, { create: 0, attach: 0, stat: 0 });
  const first = await fixture.mapper.plan({ originalCwd: fixture.path + sep });
  assert.equal(first.status, 'ready'); assert.equal(first.action, 'create');
  assert.equal(first.canonicalCwd, fixture.canonical);
  assert(Object.isFrozen(first.target.identity));
  fixture.rows.push({ id: 'existing', path: fixture.canonical, title: 'Keep this title', sessionIds: [], attachSession: async () => {} });
  const reuse = await fixture.mapper.plan({ originalCwd: fixture.path });
  assert.equal(reuse.action, 'reuse'); assert.equal(reuse.workspace.title, 'Keep this title');
  assert.equal((await fixture.mapper.resolve(reuse, { dryRun: false })).workspace.id, 'existing');
  assert.equal(fixture.calls.create, 0);
});
test('missing and non-directory paths require remap and never create directories; explicit target is preserved', async t => {
  const fixture = await setup(t), missing = join(fixture.root, 'does-not-exist');
  const plan = await fixture.mapper.plan({ originalCwd: missing });
  assert.equal(plan.status, 'needs-remap'); assert.equal(plan.target.state, 'missing');
  assert.equal((await fixture.mapper.resolve(plan, { dryRun: false })).status, 'blocked');
  await assert.rejects(access(missing), error => error.code === 'ENOENT');
  const file = join(fixture.root, 'file.txt'); await writeFile(file, 'synthetic');
  const nonDirectory = await fixture.mapper.plan({ originalCwd: file });
  assert.equal(nonDirectory.target.state, 'not-directory');
  const remap = await fixture.mapper.plan({ originalCwd: missing, remapCwd: fixture.path });
  assert.equal(remap.status, 'ready'); assert.equal(remap.original.state, 'uninspected');
  assert.equal(remap.request.originalCwd, missing);
  assert.equal(remap.canonicalCwd, fixture.canonical);
  assert.equal(fixture.calls.create, 0);
});
test('all write entry points require dryRun; dry-run resolve/attach never invoke mutators', async t => {
  const fixture = await setup(t), plan = await fixture.mapper.plan({ originalCwd: fixture.path });
  await assert.rejects(fixture.mapper.resolve(plan, {}), error => error.code === 'invalid-options');
  const dry = await fixture.mapper.resolve(plan, { dryRun: true });
  assert.equal(dry.status, 'dry-run'); assert.equal(dry.effects.createInvoked, false);
  const resolved = await fixture.mapper.resolve(plan, { dryRun: false });
  assert.equal(resolved.status, 'resolved'); assert.equal(fixture.calls.create, 1);
  const attachment = await fixture.mapper.attach(plan, 'synthetic-session', { dryRun: true });
  assert.equal(attachment.status, 'dry-run'); assert.equal(fixture.calls.attach, 0);
  assert.equal((await fixture.mapper.attach(plan, 'synthetic-session', { dryRun: false })).status, 'attached');
  assert.equal((await fixture.mapper.attach(plan, 'synthetic-session', { dryRun: false })).status, 'already-attached');
  assert.equal(fixture.calls.attach, 1);
  assert.equal(resolved.workspace.path, fixture.canonical);
});
test('missing registry is capability unavailable; bounded lists/plans and service errors do not look like empty history', async t => {
  const fixture = await setup(t);
  const absent = await new WorkspaceMapper({}, limits).plan({ originalCwd: fixture.path });
  assert.equal(absent.status, 'capability-unavailable');
  const broken = new WorkspaceMapper({ registry: { list() { throw new Error('PRIVATE_SENTINEL'); }, create() { throw new Error('unused'); } } }, limits);
  await assert.rejects(broken.plan({ originalCwd: fixture.path }), error => error.code === 'capability-failed' && !String(error).includes('PRIVATE_SENTINEL'));
  fixture.rows.push(...Array.from({ length: 2 }, (_, index) => ({ id: 'row-' + index, path: 'unused', title: 'unused' })));
  await assert.rejects(new WorkspaceMapper({ registry: fixture.registry }, { ...limits, maxWorkspaces: 1 }).plan({ originalCwd: fixture.path }), error => error.code === 'workspace-limit');
  await assert.rejects(new WorkspaceMapper({ registry: fixture.registry }, { ...limits, maxPlanBytes: 1 }).plan({ originalCwd: fixture.path }), error => error.code === 'content-limit');
});
test('directory disappearance/replacement and mutated plans fail before Workspace mutation', async t => {
  const fixture = await setup(t), plan = await fixture.mapper.plan({ originalCwd: fixture.path });
  const replacement = join(fixture.root, 'replacement'), preserved = join(fixture.root, 'preserved');
  await mkdir(replacement);
  for (const path of [fixture.path, replacement, preserved]) assert(path.startsWith(fixture.root + sep));
  await rename(fixture.path, preserved);
  assert.equal((await fixture.mapper.resolve(plan, { dryRun: false })).status, 'stale-plan');
  await rename(replacement, fixture.path);
  assert.equal((await fixture.mapper.resolve(plan, { dryRun: false })).status, 'stale-plan');
  assert.equal(fixture.calls.create, 0);
  const damaged = structuredClone(plan); damaged.canonicalCwd = preserved;
  await assert.rejects(fixture.mapper.resolve(damaged, { dryRun: false }), error => error.code === 'invalid-plan');
});
test('junction/symlink aliases resolve and link retargeting invalidates a prior plan', async t => {
  const fixture = await setup(t), second = join(fixture.root, 'second'), alias = join(fixture.root, 'alias');
  await mkdir(second);
  await symlink(fixture.path, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const plan = await fixture.mapper.plan({ originalCwd: alias });
  assert.equal(plan.target.isLink, true); assert.equal(plan.canonicalCwd, fixture.canonical);
  const renamed = join(fixture.root, 'old-alias');
  for (const path of [alias, renamed]) assert(path.startsWith(fixture.root + sep));
  await rename(alias, renamed);
  await symlink(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fixture.mapper.resolve(plan, { dryRun: false })).status, 'stale-plan');
  assert.equal(fixture.calls.create, 0);
});
test('attach validates public header even for accounted ids and reports missing/mismatched cwd without writes', async t => {
  const fixture = await setup(t), plan = await fixture.mapper.plan({ originalCwd: fixture.path });
  await fixture.mapper.resolve(plan, { dryRun: false });
  fixture.rows[0].sessionIds.push('already');
  for (const [header, reason] of [
    [undefined, 'session-not-found'], [{ id: 'already' }, 'session-cwd-missing'],
    [{ id: 'already', cwd: join(fixture.root, 'missing') }, 'session-cwd-mismatch'],
  ]) {
    fixture.persistence.stat = async () => header ? { header, revision: 'fixture' } : undefined;
    const result = await fixture.mapper.attach(plan, 'already', { dryRun: false });
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, reason);
  }
  assert.equal(fixture.calls.attach, 0);
});
test('pre-cancel blocks writes; post-commit cancellation and failure report attempted mutations without rollback promises', async t => {
  const fixture = await setup(t), plan = await fixture.mapper.plan({ originalCwd: fixture.path });
  const cancelled = new AbortController(); cancelled.abort();
  const result = await fixture.mapper.resolve(plan, { dryRun: false, signal: cancelled.signal });
  assert.equal(result.status, 'cancelled'); assert.equal(fixture.calls.create, 0);
  const controller = new AbortController(), original = fixture.registry.create;
  fixture.registry.create = async path => { const value = await original(path); controller.abort(); return value; };
  const committed = await fixture.mapper.resolve(plan, { dryRun: false, signal: controller.signal });
  assert.equal(committed.status, 'resolved'); assert(committed.warnings.includes('cancelled-after-workspace-resolution'));
  fixture.rows[0].attachSession = async () => { throw new Error('PRIVATE_SENTINEL'); };
  const failed = await fixture.mapper.attach(plan, 'session', { dryRun: false });
  assert.equal(failed.status, 'failed'); assert.equal(failed.effects.attachInvoked, true);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_SENTINEL/);
});

test('real rc.2 Workspace create/reuse, header attachment and membership survive restart without touching Session logs', { timeout: 180000 }, async t => {
  const { cp } = await import('node:fs/promises');
  const root = await allocate(); t.after(() => cleanup(root));
  await stagePlugin(root);
  const mockRoot = join(root, 'node_modules/p3-mock-model');
  await mkdir(mockRoot, { recursive: true });
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mockRoot, 'index.mjs'));
  await writeFile(join(mockRoot, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0',
    type: 'module', main: 'index.mjs', peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  const write = await runFixture('p5-host-process.mjs', root, ['write']);
  assert.equal(write.realPublicWorkspace, true);
  assert.equal(write.dryRunNoMutators, true);
  assert.equal(write.sessionLogUnchanged, true);
  const restarted = await runFixture('p5-host-process.mjs', root, ['restart']);
  assert.equal(restarted.membershipSurvivedRestart, true);
});

test('built mapper import is lazy; plan/dry-run deny file writes, subprocess/network and distinguish OS permission failures', { timeout: 120000 }, async t => {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const report = await runFixture('p5-readonly-process.mjs', root);
  assert.equal(report.lazyBuiltModule, true);
  assert.equal(report.dryRunReadOnly, true);
  assert.equal(report.osPermissionErrorsDistinct, true);
  assert.deepEqual(report.attempts, []);
});

test('path change after a public attach is reported with committed-attempt facts', async t => {
  const fixture = await setup(t), plan = await fixture.mapper.plan({ originalCwd: fixture.path });
  await fixture.mapper.resolve(plan, { dryRun: false });
  const moved = join(fixture.root, 'moved-after-attach');
  assert(moved.startsWith(fixture.root + sep));
  fixture.rows[0].attachSession = async id => {
    fixture.rows[0].sessionIds.push(id);
    await rename(fixture.path, moved);
  };
  const result = await fixture.mapper.attach(plan, 'session', { dryRun: false });
  assert.equal(result.status, 'stale-plan');
  assert.equal(result.effects.attachInvoked, true);
  assert(result.warnings.includes('mutation-not-rolled-back'));
});
