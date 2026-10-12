/** P3 keyless native Session evidence; every case owns its temporary Host and child exits. */
import assert from 'node:assert/strict';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { allocate, cleanup, stagePlugin, runFixture, project } from './helpers.mjs';

async function environment(t) {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  await stagePlugin(directory);
  const mockRoot = join(directory, 'node_modules/p3-mock-model');
  await mkdir(mockRoot, { recursive: true });
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mockRoot, 'index.mjs'));
  await writeFile(join(mockRoot, 'package.json'), JSON.stringify({
    name: 'p3-mock-model', version: '0.0.0', type: 'module', main: 'index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' },
  }));
  return directory;
}
for (const [variant, compression] of [['recall', 'none'], ['assistant', 'none'], ['unknown', 'none'], ['recall', 'zstd']]) {
  test('native Session survives bridge unload and two restarts: ' + variant + '/' + compression, { timeout: 180000 }, async t => {
    const directory = await environment(t);
    for (const mode of ['write', 'resume', 'resume-again']) {
      const report = await runFixture('p3-process.mjs', directory, [mode, variant, compression]);
      assert.equal(report.networkAttempts, 0);
      assert.equal(report.bridgeMounted, false);
      assert.equal(report.sharedSessionClass, true);
      assert.equal(report.titlePinnedAfterContinuation, true);
      if (mode === 'write') {
        assert.equal(report.requiredEventNegativeControl, true);
        assert.equal(report.turnZeroInvariantNegativeControl, true);
      }
    }
    const request = JSON.parse(await readFile(join(directory, 'request-resume.json'), 'utf8'));
    const repeated = JSON.parse(await readFile(join(directory, 'request-resume-again.json'), 'utf8'));
    assert.equal(repeated.length, request.length + 2, 'Later request contains the preceding continuation prompt and assistant');
    assert.deepEqual(request, JSON.parse(await readFile(join(project, 'tests/fixtures/p3/expected-' + variant + '.json'), 'utf8')));
  });
}
test('missing protected system head becomes unreadable after a native continuation and restart', { timeout: 180000 }, async t => {
  const directory = await environment(t);
  const write = await runFixture('p3-process.mjs', directory, ['missing-head-write', 'no-head']);
  assert.equal(write.networkAttempts, 0);
  const restart = await runFixture('p3-process.mjs', directory, ['missing-head-check', 'no-head']);
  assert.equal(restart.missingHeadRejectedAfterRestart, true);
});
test('append can accept unknown required vocabulary; fresh public read refuses it', { timeout: 180000 }, async t => {
  const directory = await environment(t);
  const write = await runFixture('p3-process.mjs', directory, ['unknown-required-write']);
  assert.equal(write.appendAcceptedUnknownRequired, true);
  const restart = await runFixture('p3-process.mjs', directory, ['unknown-required-check']);
  assert.equal(restart.coldReadRejectedUnknownRequired, true);
});
test('synthetic plan mutator guards leave public Session and Workspace state unchanged', { timeout: 180000 }, async t => {
  const directory = await environment(t);
  const report = await runFixture('p3-process.mjs', directory, ['plan']);
  assert.equal(report.dryRun, true);
  const result = JSON.parse(await readFile(join(directory, 'plan-result.json'), 'utf8'));
  assert.deepEqual(result, { dryRun: true, sessionWrites: 0, workspaceWrites: 0, guardNegativeControl: true });
});
test('public Chat bundles project recall/unknown context and empty assistant stream; renderer unit forwards the body', { timeout: 180000 }, async t => {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  const report = await runFixture('p3-client-process.mjs', directory);
  assert.equal(report.publicModuleSystem, true);
  assert.equal(report.rendererRegistered, true);
  assert.equal(report.sharedPrimitivesMocked, true);
  assert.equal(report.desktopVisualTest, false);
  assert.equal(report.outcomes.length, 3);
});
