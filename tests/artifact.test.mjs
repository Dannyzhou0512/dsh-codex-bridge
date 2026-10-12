import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';
import { project } from './helpers.mjs';

test('manifest, patch and built ESM keep only the P1 service form and external host import', async () => {
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client, undefined);
  assert.deepEqual(manifest.dependencies, { zod: '4.6.5', commander: '15.0.0' });
  assert.equal(manifest.bin, undefined);
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-title', '@deepseek-ai/dsh-workspace', '@deepseek-ai/dsh-cmdline']) {
    assert.equal(manifest.devDependencies[name], manifest.peerDependencies[name]);
  }
  assert.deepEqual(composeEntries([loadOverlayPatches('p1', join(project, 'cordis.patch.yml'))]),
    [{ id: 'dsh-codex-bridge-host', name: 'dsh-codex-bridge' }]);
  const built = await readFile(join(project, 'lib/index.js'), 'utf8');
  const parsed = ts.createSourceFile('index.js', built, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = parsed.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.deepEqual(imports, ['@deepseek-ai/cordis']);
  const forbiddenImports = /\b(import\s*\(|require\s*\(|fetch\s*\(|spawn\s*\(|exec\s*\(|mkdir\s*\(|storageDomain\b|node:)/;
  assert.equal(forbiddenImports.test(built), false, 'Unexpected P2 or I/O code in runtime');
  assert.equal(built.includes('class Context'), false);
  assert.equal(built.includes('class Service'), false);
  const module = await import('../lib/index.js');
  assert.deepEqual(Object.keys(module), ['default'], 'Do not mix function-plugin named exports with a service default');
});

test('development lock has one Cordis and only rc.2 DSH packages confined to development', async () => {
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
  const packages = Object.entries(lock.packages);
  const cordis = packages.filter(([path]) => /node_modules\/@deepseek-ai\/cordis$/.test(path));
  assert.equal(cordis.length, 1);
  assert.equal(cordis[0][1].version, '4.0.4');
  for (const [path, data] of packages) {
    if (/node_modules\/@deepseek-ai\/dsh(?:-[^\/]+)?$/.test(path)) assert.equal(data.version, '0.2.0-rc.2', path);
    if (/node_modules\/@deepseek-ai\/dsh(?:-[^\/]+)?$/.test(path)) assert.equal(data.dev === true || data.devOptional === true, true, 'DSH must remain development-only: ' + path);
  }
});
