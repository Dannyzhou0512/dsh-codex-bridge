/** Opt-in public schema generation, restricted to the tested executable version. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.argv[2];
assert(executable && isAbsolute(executable), 'Provide an absolute Codex executable');
const options = { cwd: project, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 };
const version = execFileSync(executable, ['--version'], options).trim();
assert.equal(version, 'codex-cli 0.162.0-alpha.2', 'Different binary: review its public protocol before changing the baseline');
const root = join(project, '.artifacts/codex-schema/0.162.0-alpha.2');
for (const [command, folder] of [['generate-json-schema', 'json'], ['generate-ts', 'ts']]) {
  await mkdir(join(root, folder), { recursive: true });
  execFileSync(executable, ['app-server', command, '--out', join(root, folder)], options);
}
console.log(JSON.stringify({ version, output: root, experimentalApi: false, note: 'Generators themselves are experimental tooling; emitted methods still need documentation review.' }));
