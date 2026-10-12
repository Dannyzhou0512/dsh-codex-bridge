/** Inspect the npm archive and exercise its extracted artifact without profile installation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { allocate, cleanup, project, runFixture } from '../tests/helpers.mjs';
const current = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const archive = resolve(project, process.argv[2] ?? '.artifacts/dsh-codex-bridge-' + current.version + '.tgz');
assert(archive.startsWith(join(project, '.artifacts') + sep), 'Inspect only project artifacts');
function tar(args) {
  const result = spawnSync('tar', args, { cwd: project, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const modules = ['errors', 'index', 'parse', 'reader', 'transport', 'types'];
const cliModules = ['config', 'errors', 'index', 'parser', 'runner', 'types'];
const batchModules = ['batch', 'errors', 'index', 'selection', 'types'];
const recoveryModules = ['errors', 'index', 'inspect', 'recovery', 'types'];
const importerModules = ['errors', 'importer', 'index', 'readback', 'types'];
const plannerModules = ['errors', 'index', 'planner', 'target', 'types'];
const workspaceModules = ['errors', 'index', 'mapper', 'paths', 'probe', 'types'];
const converterModules = ['canonical', 'convert', 'errors', 'ids', 'index', 'paths', 'project', 'types', 'validate'];
const expected = ['package/LICENSE', 'package/README.md', 'package/cordis.patch.yml', 'package/docs/P1_RUNTIME_SMOKE.md',
  'package/docs/P2_PROTOCOL.md', 'package/lib/index.js', 'package/lib/types/index.d.ts',
  'package/lib/types/types.d.ts', 'package/package.json',
  ...modules.map(name => 'package/lib/codex/' + name + '.js'),
  ...modules.map(name => 'package/lib/types/codex/' + name + '.d.ts'),
  ...converterModules.map(name => 'package/lib/converter/' + name + '.js'),
  ...converterModules.map(name => 'package/lib/types/converter/' + name + '.d.ts'),
  'package/docs/P4_CONVERTER.md', 'package/docs/P5_WORKSPACE_MAPPER.md', 'package/docs/P6_IMPORT_PLANNER.md', 'package/docs/P7_SESSION_IMPORTER.md', 'package/docs/P8_RECOVERY.md', 'package/docs/P9_BATCH_IMPORTER.md', 'package/docs/P10_CLI.md', 'package/docs/P10_CLI_CONFIG_EXAMPLE.json',
  ...cliModules.map(name => 'package/lib/cli/' + name + '.js'),
  ...cliModules.map(name => 'package/lib/types/cli/' + name + '.d.ts'),
  ...batchModules.map(name => 'package/lib/batch/' + name + '.js'),
  ...batchModules.map(name => 'package/lib/types/batch/' + name + '.d.ts'),
  ...recoveryModules.map(name => 'package/lib/recovery/' + name + '.js'),
  ...recoveryModules.map(name => 'package/lib/types/recovery/' + name + '.d.ts'),
  ...importerModules.map(name => 'package/lib/importer/' + name + '.js'),
  ...importerModules.map(name => 'package/lib/types/importer/' + name + '.d.ts'),
  ...plannerModules.map(name => 'package/lib/planner/' + name + '.js'),
  ...plannerModules.map(name => 'package/lib/types/planner/' + name + '.d.ts'),
  ...workspaceModules.map(name => 'package/lib/workspace/' + name + '.js'),
  ...workspaceModules.map(name => 'package/lib/types/workspace/' + name + '.d.ts')].sort();
const files = tar(['-tf', archive]).trim().split(/\r?\n/).sort();
assert.deepEqual(files, expected, 'Unexpected archive content, sources or embedded runtime');
const manifest = JSON.parse(tar(['-xOf', archive, 'package/package.json']));
assert.equal(manifest.version, current.version);
assert.deepEqual(manifest.dependencies, { zod: '4.6.5', commander: '15.0.0' });
assert.equal(manifest.bundleDependencies, undefined);
assert.equal(manifest.bundledDependencies, undefined);
assert.equal(manifest.dsh.client, undefined); assert.equal(manifest.bin, undefined);
for (const name of ['./planner', './importer', './recovery', './batch', './cli']) assert.equal(Object.keys(manifest.exports[name])[0], 'types');
assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.4');
assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-app-boot'], '0.2.0-rc.2');
for (const name of ['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-title', '@deepseek-ai/dsh-workspace', '@deepseek-ai/dsh-cmdline']) assert.equal(manifest.peerDependencies[name], '0.2.0-rc.2');
const runtimeImports = new Set();
for (const file of files.filter(name => name.endsWith('.js'))) {
  const emitted = tar(['-xOf', archive, file]);
  assert.equal(emitted, await readFile(join(project, file.slice('package/'.length)), 'utf8'));
  const ast = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const name = statement.moduleSpecifier.text;
    if (!name.startsWith('.')) runtimeImports.add(name);
    assert(name.startsWith('.') || ['@deepseek-ai/cordis', 'zod', 'commander', '@deepseek-ai/dsh-cmdline', 'node:child_process', 'node:path', 'node:crypto', 'node:fs/promises', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-title', '@deepseek-ai/dsh-llm/brand'].includes(name), name);
  }
  assert.equal(/node_modules|class Context|class Service|@deepseek-ai\/dsh-(workspace|storage)/.test(emitted), false);
}
const root = tar(['-xOf', archive, 'package/lib/index.js']);
assert.match(root, /from ['"]@deepseek-ai\/cordis['"]/);
assert.doesNotMatch(root, /node:|\.\/(codex|converter|workspace|planner|importer|recovery|batch|cli)\//, 'Host startup must not wire the independent reader');
const directory = await allocate();
let composition, adapter, converter, workspaceMapper, planner, importer, nativeImport, recovery, nativeRecovery, batch, nativeBatch, cli;
try {
  // Only extract after validating all exact traversal-free entry names.
  tar(['-xf', archive, '-C', directory]);
  await mkdir(join(directory, 'node_modules'), { recursive: true });
  await rename(join(directory, 'package'), join(directory, 'node_modules/dsh-codex-bridge'));
  await writeFile(join(directory, 'cordis.yml'), '[]\n');
  composition = await runFixture('loader-process.mjs', directory);
  adapter = await runFixture('codex-artifact-process.mjs', directory);
  converter = await runFixture('converter-artifact-process.mjs', directory);
  workspaceMapper = await runFixture('workspace-artifact-process.mjs', directory);
  planner = await runFixture('planner-artifact-process.mjs', directory);
  importer = await runFixture('importer-artifact-process.mjs', directory);
  recovery = await runFixture('recovery-artifact-process.mjs', directory);
  batch = await runFixture('batch-artifact-process.mjs', directory);
  cli = await runFixture('cli-artifact-process.mjs', directory);
  const mock = join(directory, 'node_modules/p3-mock-model');
  await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
  nativeImport = { write: await runFixture('p7-host-process.mjs', directory, ['write']),
    resume: await runFixture('p7-host-process.mjs', directory, ['resume']),
    verify: await runFixture('p7-host-process.mjs', directory, ['verify']) };
  const recoveryDirectory = join(directory, 'p8-recovery-root');
  await mkdir(join(recoveryDirectory, 'node_modules/p3-mock-model'), { recursive: true });
  await cp(mock, join(recoveryDirectory, 'node_modules/p3-mock-model'), { recursive: true });
  nativeRecovery = { crash: await runFixture('p8-host-process.mjs', recoveryDirectory, ['crash']),
    recover: await runFixture('p8-host-process.mjs', recoveryDirectory, ['recover']),
    verify: await runFixture('p8-host-process.mjs', recoveryDirectory, ['verify']) };
  const batchDirectory = join(directory, 'p9-batch-root');
  await mkdir(join(batchDirectory, 'node_modules/p3-mock-model'), { recursive: true });
  await cp(mock, join(batchDirectory, 'node_modules/p3-mock-model'), { recursive: true });
  nativeBatch = { write: await runFixture('p9-host-process.mjs', batchDirectory, ['write']),
    restart: await runFixture('p9-host-process.mjs', batchDirectory, ['restart']),
    verify: await runFixture('p9-host-process.mjs', batchDirectory, ['verify']) };
} finally { await cleanup(directory); }
const bytes = await readFile(archive);
const report = { archive: basename(archive), bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), files,
  runtimeImports: [...runtimeImports].sort(), dependencies: manifest.dependencies,
  peerDependencies: manifest.peerDependencies, embeddedRuntime: false, tarballComposition: composition, adapter, converter, workspaceMapper, planner, importer, nativeImport, recovery, nativeRecovery, batch, nativeBatch, cli };
await writeFile(join(project, '.artifacts/package-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
