import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { allocate, cleanup, project, runFixture, stagePlugin } from './helpers.mjs';

test('published Loader composition loads, observes capabilities, unloads and reloads the built package', { timeout: 120_000 }, async t => {
  const directory = await allocate();
  t.after(() => cleanup(directory));
  await stagePlugin(directory);
  const report = await runFixture('loader-process.mjs', directory);
  assert.equal(report.sharedCordis, true);
  assert.equal(report.unloaded, true);
  assert.equal(report.reloaded, true);
  assert.equal(report.capabilityCalls, 0);
});

test('exact rc.2 peer admits only the declared DSH runtime', async () => {
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.2'), undefined);
  for (const runtime of ['0.1.9', '0.2.0-rc.1', '0.2.0-rc.3', '0.2.0']) {
    const issue = evaluatePluginCompatibility(manifest, {}, runtime);
    assert(issue, 'Wrong runtime was admitted: ' + runtime);
    assert.equal(issue.exempted, false);
    assert.deepEqual(issue.peers, {
      '@deepseek-ai/dsh-app-boot': '0.2.0-rc.2', '@deepseek-ai/dsh-session': '0.2.0-rc.2',
      '@deepseek-ai/dsh-llm': '0.2.0-rc.2', '@deepseek-ai/dsh-session-persistence': '0.2.0-rc.2',
      '@deepseek-ai/dsh-session-title': '0.2.0-rc.2', '@deepseek-ai/dsh-workspace': '0.2.0-rc.2', '@deepseek-ai/dsh-cmdline': '0.2.0-rc.2',
    });
  }
});

for (const peer of ['0.1.9', '0.2.0-rc.1', '0.2.0']) {
  test('real profile preflight refuses incompatible peer ' + peer + ' before module execution', { timeout: 120_000 }, async t => {
    const directory = await allocate();
    t.after(() => cleanup(directory));
    await stagePlugin(directory, { peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-app-boot': peer } });
    const report = await runFixture('preflight-process.mjs', directory);
    assert.equal(report.deniedBeforeImport, true);
    assert.equal(report.peer, peer);
  });
}
