/** Project-owned, isolated process fixtures; no Harness profile is installed. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const artifacts = join(project, '.artifacts');
export async function allocate() {
  await mkdir(artifacts, { recursive: true });
  return mkdtemp(join(artifacts, 'p1-'));
}
export async function cleanup(directory) {
  const parent = await realpath(artifacts);
  const target = await realpath(directory);
  assert(target.startsWith(parent + sep), 'Cleanup must stay under project artifacts');
  assert.equal((await lstat(directory)).isSymbolicLink(), false, 'Do not recurse into a link');
  await rm(directory, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 3 : 0, retryDelay: 100 });
}
export async function stagePlugin(directory, manifestOverride = {}) {
  const packageDirectory = join(directory, 'node_modules', 'dsh-codex-bridge');
  await mkdir(packageDirectory, { recursive: true });
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ ...manifest, ...manifestOverride }));
  await cp(join(project, 'lib'), join(packageDirectory, 'lib'), { recursive: true });
  await cp(join(project, 'cordis.patch.yml'), join(packageDirectory, 'cordis.patch.yml'));
  await cp(join(project, 'tests/fixtures/cordis.yml'), join(directory, 'cordis.yml'));
  return packageDirectory;
}
/** Independent child owns global hooks; wait for close after timeout/kill as well as normal exit. */
export async function runFixture(script, directory, args = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/KEY|SECRET|TOKEN|PASSWORD/i.test(key) && !key.startsWith('DSH_') && key !== 'NODE_OPTIONS'));
  env.DSH_HOME = directory;
  const child = spawn(process.execPath, [join(project, 'tests/fixtures', script), directory, ...args], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false, processError;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45_000);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { processError = String(error); });
  const result = await new Promise(resolveResult => child.once('close', (exitCode, signal) => {
    clearTimeout(timer);
    resolveResult({ exitCode, signal, timedOut, processError, stdout, stderr });
  }));
  assert.equal(result.timedOut, false, 'Child deadline fired: ' + result.stderr);
  assert.equal(result.signal, null, 'Child ended by signal');
  assert.equal(result.processError, undefined);
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('P1_REPORT '));
  assert(line, 'Missing child completion report: ' + result.stdout);
  return JSON.parse(line.slice('P1_REPORT '.length));
}
