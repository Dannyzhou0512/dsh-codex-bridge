import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allocate, cleanup, runFixture, stagePlugin } from './helpers.mjs';

test('built import, registration, health reads and disposal attempt no filesystem/network/subprocess I/O', { timeout: 120_000 }, async t => {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  await stagePlugin(directory);
  const report = await runFixture('side-effects-process.mjs', directory);
  assert.equal(report.guardedBuiltImportAndLifecycle, true);
  assert.equal(report.guardNegativeControl, true);
  assert.deepEqual(report.attempts, []);
});

test('I/O guard rejects an introduced fetch in a copied built artifact before any network access', { timeout: 120_000 }, async t => {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  const packageDirectory = await stagePlugin(directory);
  await appendFile(join(packageDirectory, 'lib/index.js'), "\nglobalThis.fetch('https://p1.invalid');\n");
  await assert.rejects(() => runFixture('side-effects-process.mjs', directory), /P1 forbidden operation: fetch/);
});
