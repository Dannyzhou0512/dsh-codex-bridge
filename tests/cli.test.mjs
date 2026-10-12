import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup, run, rpcLog, selectedArgs, cliConfig, createProfile } from './fixtures/p10-launch.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
test('P10 actual dsh launcher passes app help/version and rejects grammar before Codex startup', { timeout: 120000 }, async t => {
  const { root } = await setup(t);
  const help = await run(root, ['--help']); assert.equal(help.code, 0, help.stderr); assert.match(help.stdout, /list[\s\S]*preview[\s\S]*plan[\s\S]*apply/);
  const version = await run(root, ['--bridge-version']); assert.equal(version.code, 0, version.stderr); assert.match(version.stdout, /0\.0\.9/);
  const missing = await run(root, ['apply', '--execute']); assert.equal(missing.code, 1); assert.match(missing.stderr, /thread/);
  assert.deepEqual(await rpcLog(root), []);
});
test('P10 actual dsh profile scans stable public history and previews hydrated content', { timeout: 120000 }, async t => {
  const { root } = await setup(t);
  const list = await run(root, ['list']); assert.equal(list.code, 0, list.stderr); assert.equal(list.json.threads.length, 2);
  assert.equal(list.json.threads[0].counts, null); assert.equal(list.json.countSemantics, 'unknown-until-hydrated');
  const preview = await run(root, ['preview', ...selectedArgs(root)]); assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.json.entries.length, 2); assert(preview.json.entries[0].preview.length > 0);
  assert.doesNotMatch(preview.stdout, /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
  const log = await rpcLog(root); assert(log.filter(m => m.method).every(m => ['initialize', 'initialized', 'thread/list', 'thread/read'].includes(m.method)));
  assert(log.some(m => m.method === 'thread/list' && m.params.useStateDbOnly));
});

test('P10 actual launcher plan, dry-run, reviewed serial apply and restart dedup use public seams', { timeout: 180000 }, async t => {
  const { root } = await setup(t), args = selectedArgs(root);
  const planned = await run(root, ['plan', ...args]); assert.equal(planned.code, 0, planned.stderr); assert(planned.json.reviewDigest);
  const dry = await run(root, ['apply', ...args, '--dry-run']); assert.equal(dry.code, 0, dry.stderr); assert.equal(dry.json.result.summary.dryRun, 2);
  const stale = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', '0'.repeat(64)]);
  assert.equal(stale.code, 1, stale.stderr); assert.equal(stale.json.error, 'review-stale');
  const written = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', planned.json.reviewDigest]);
  assert.equal(written.code, 0, written.stderr + written.stdout); assert.equal(written.json.result.summary.completed, 2);
  assert.equal(written.json.result.entries[1].rebasedWorkspace, true);
  const current = await run(root, ['plan', ...args]); assert.equal(current.code, 0, current.stderr);
  const repeat = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', current.json.reviewDigest]);
  assert.equal(repeat.code, 0, repeat.stderr); assert.equal(repeat.json.result.summary.alreadyImported, 2);
  assert.doesNotMatch(written.stdout, /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
});
test('P10 missing executable fails locally and source/private payload errors remain sanitized', { timeout: 120000 }, async t => {
  const { root } = await setup(t, root => cliConfig(root, join(root, 'missing-codex.exe')));
  const result = await run(root, ['list']); assert.equal(result.code, 1, result.stderr);
  assert.equal(result.json.error, 'codex-spawn-failed'); assert.deepEqual(await rpcLog(root), []);
});
test('P10 explicit loss refusal, malformed execute and launcher flag coexistence never migrate implicitly', { timeout: 120000 }, async t => {
  const { root } = await setup(t), remap = join(root, '目标 中文 spaces');
  const blocked = await run(root, ['plan', '--thread', 'fixture-thread', '--remap', remap]);
  assert.equal(blocked.code, 3, blocked.stderr); assert.equal(blocked.json.plan.entries[0].plan.state, 'needs-review');
  const conflict = await run(root, ['apply', '--thread', 'fixture-thread', '--execute', '--dry-run', '--reviewed-digest', '0'.repeat(64)]);
  assert.equal(conflict.code, 1); assert.match(conflict.stderr, /conflicts/);
  const dump = await run(root, [], ['--profile', 'bridge', '--dump-config']);
  assert.equal(dump.code, 0, dump.stderr); assert.match(dump.stdout, /codex-bridge|bridge-cli/);
  const launcherVersion = await run(root, [], ['--version']); assert.equal(launcherVersion.code, 0);
  assert.match(launcherVersion.stdout, /0\.2\.0-rc\.2/);
});
test('P10 disabled app face and startup failure do not parse/migrate or spawn the source', { timeout: 120000 }, async t => {
  const { root } = await setup(t, root => ({ ...cliConfig(root), enabled: false }));
  const disabled = await run(root, ['--unknown-desktop-option']); assert.equal(disabled.code, 0, disabled.stderr);
  assert.deepEqual(await rpcLog(root), []);
  const config = cliConfig(root); await createProfile(root, config);
  const badPatch = join(root, 'bad.patch.yml');
  await (await import('node:fs/promises')).writeFile(badPatch, '- insert: not-an-entry-list\n');
  const failed = await run(root, ['list'], ['--profile', 'bridge', '--patch', badPatch]); assert.equal(failed.code, 1, failed.stdout + failed.stderr); assert.deepEqual(await rpcLog(root), []);
});

test('P10 stale source/profile configuration review and output budget reject before any Session writes', { timeout: 180000 }, async t => {
  const { root } = await setup(t), args = selectedArgs(root);
  const plan = await run(root, ['plan', ...args]); assert.equal(plan.code, 0);
  const wire = JSON.parse(await readFile(join(root, 'history.json'), 'utf8')); wire.thread.updatedAt++;
  await (await import('node:fs/promises')).writeFile(join(root, 'history.json'), JSON.stringify(wire));
  const stale = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', plan.json.reviewDigest]);
  assert.equal(stale.code, 1); assert.equal(stale.json.error, 'review-stale');
  const small = cliConfig(root); small.io.maxOutputBytes = 8192; await createProfile(root, small);
  const budget = await run(root, ['apply', ...args]); assert.equal(budget.code, 1); assert.equal(budget.json.error, 'output-limit');
});
test('P10 transport timeout and forced owned child close finish through public appExit', { timeout: 120000 }, async t => {
  const { root } = await setup(t, root => {
    const config = cliConfig(root); config.reader.args[1] = 'ignore-eof'; config.reader.limits.requestTimeoutMs = 150;
    config.reader.limits.shutdownTimeoutMs = 300; return config;
  });
  const result = await run(root, ['list']); assert.equal(result.code, 1, result.stderr);
  assert.equal(result.json.error, 'codex-request-timeout');
});

test('P10 CLI-created native Session continues under a fresh Host without bridge', { timeout: 180000 }, async t => {
  const { root } = await setup(t), args = selectedArgs(root), plan = await run(root, ['plan', ...args]);
  const imported = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', plan.json.reviewDigest]);
  assert.equal(imported.code, 0, imported.stderr);
  const { cp, mkdir, writeFile } = await import('node:fs/promises');
  const { project, runFixture } = await import('./helpers.mjs');
  const mock = join(root, 'node_modules/p3-mock-model'); await mkdir(mock, { recursive: true });
  await writeFile(join(mock, 'package.json'), JSON.stringify({ name: 'p3-mock-model', version: '0.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-llm': '0.2.0-rc.2' } }));
  await cp(join(project, 'tests/fixtures/p3/mock-llm.mjs'), join(mock, 'index.mjs'));
  const report = await runFixture('p10-native-process.mjs', root);
  assert.equal(report.cliProducedNativeSession, true); assert.equal(report.nativeTurn2, true);
});
test('P10 archived/source filters, invalid config, and bounded argv are explicit', { timeout: 120000 }, async t => {
  const { root } = await setup(t);
  const archived = await run(root, ['list', '--archived', '--source-kind', 'vscode']);
  assert.equal(archived.code, 0); assert.equal(archived.json.threads[0].archived, true);
  const bad = cliConfig(root); bad.reader.limits.shutdownTimeoutMs = 6000; await createProfile(root, bad);
  const invalid = await run(root, ['list']); assert.equal(invalid.json.error, 'invalid-config');
  const tiny = cliConfig(root); tiny.io.maxArgBytes = 1; await createProfile(root, tiny);
  assert.equal((await run(root, ['list'])).json.error, 'invalid-config');
});
