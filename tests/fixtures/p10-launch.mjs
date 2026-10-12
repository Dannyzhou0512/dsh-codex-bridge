/** Actual published dsh bin launcher helper: every profile/file/child stays in a unique plugin artifact root. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { allocate, cleanup, stagePlugin, project } from '../helpers.mjs';
import { options, LOSSES } from './p4-data.mjs';
const require = createRequire(import.meta.url);
export const launcher = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
export function cliConfig(root, executable = process.execPath) {
  const { target, acceptedLosses, ...conversion } = options(join(root, '目标 中文 spaces'));
  return { enabled: true, reader: { executable, args: [join(root, 'fake-server.mjs'), 'normal', join(root, 'rpc.jsonl')],
    cwd: root, codexHome: join(root, 'codex-home'), clientInfo: { name: 'p10-synthetic', title: 'Synthetic history', version: '0.0.9' },
    limits: { requestTimeoutMs: 2000, shutdownTimeoutMs: 1000, maxInFlight: 2, maxFrameBytes: 1000000 },
    readLimits: { pageSize: 30, maxPages: 5, maxThreads: 50, maxItems: 1000, maxJsonDepth: 32 } },
    scan: { sourceKinds: ['vscode'], archived: false }, conversion,
    mapping: { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 },
    planning: { maxTargetEvents: 4000, maxTargetBytes: 4000000, readChunkEvents: 4, maxPlanBytes: 5000000 },
    importing: { maxReadEvents: 4000, maxReadBytes: 4000000, readChunkEvents: 4, maxResultBytes: 8192 },
    batch: { maxEntries: 30, maxSelectionBytes: 1000000, maxPlanBytes: 10000000, maxResultBytes: 1000000, maxItemResultBytes: 8192 },
    cache: 'skip', io: { maxArgBytes: 100000, maxOutputBytes: 15000000 } };
}
export async function createProfile(root, config = cliConfig(root), profileName = 'bridge') {
  const directory = join(root, 'profiles', profileName), bundle = join(directory, 'node_modules/p10-synthetic-profile');
  await mkdir(bundle, { recursive: true }); await mkdir(join(root, '目标 中文 spaces'), { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'p10-test-profile', private: true,
    dependencies: { 'dsh-codex-bridge': '0.0.9' }, dsh: { profile: { bundles: ['p10-synthetic-profile', 'dsh-codex-bridge'] } } }));
  await writeFile(join(directory, 'cordis.patch.yml'), '[]\n');
  const rows = [
    { id: 'session', name: '@deepseek-ai/dsh-session' },
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    { id: 'storage-json', name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'zstd' } },
    { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
    { id: 'bridge-cli', name: 'dsh-codex-bridge/cli', config },
  ];
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]));
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'p10-synthetic-profile', version: '0.0.0', type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  // Actual public protocol fixture, no Desktop/private Codex files.
  await cp(join(project, 'tests/fixtures/codex/fake-server.mjs'), join(root, 'fake-server.mjs'));
  await cp(join(project, 'tests/fixtures/codex/history.json'), join(root, 'history.json'));
  return directory;
}
export async function setup(t, configFactory = cliConfig) {
  const root = await allocate(); t.after(() => cleanup(root)); await stagePlugin(root);
  const config = configFactory(root); await createProfile(root, config); return { root, config };
}
export async function run(root, args, before = ['--profile', 'bridge']) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)
    && !key.startsWith('DSH_') && key !== 'NODE_OPTIONS'));
  env.DSH_HOME = root; env.DSH_TELEMETRY_DISABLED = '1';
  const child = spawn(process.execPath, [launcher, ...before, ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timeout = false, failed;
  const timer = setTimeout(() => { timeout = true; child.kill(); }, 45000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => { stdout += text; }); child.stderr.on('data', text => { stderr += text; });
  child.on('error', error => { failed = error.code; });
  const code = await new Promise(resolve => child.once('close', (code, signal) => {
    clearTimeout(timer); assert.equal(signal, null, stderr); resolve(code);
  }));
  assert.equal(timeout, false, stderr); assert.equal(failed, undefined, stderr);
  const line = stdout.split(/\r?\n/).find(line => line.startsWith('{"action":') || line.startsWith('{"schemaVersion":'));
  return { code, stdout, stderr, json: line ? JSON.parse(line) : null };
}
export const recallFlags = ['--mode', 'recall', ...LOSSES.flatMap(loss => ['--accept-loss', loss])];
export const selectedArgs = root => ['--thread', 'fixture-thread', '--thread', 'second-fixture', '--remap', join(root, '目标 中文 spaces'), ...recallFlags];
export async function rpcLog(root) {
  try { return (await readFile(join(root, 'rpc.jsonl'), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
