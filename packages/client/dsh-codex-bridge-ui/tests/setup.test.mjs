import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { allocate, cleanup } from '../../../../tests/helpers.mjs';
import { SourceSetup } from '../lib/setup.js';

async function fixture(t) {
  const root = await allocate();
  t.after(() => cleanup(root));
  const executable = join(root, 'codex.exe');
  await writeFile(executable, 'synthetic executable marker');
  const codexHome = join(root, 'synthetic history');
  await mkdir(codexHome);
  const draft = { executable, codexHome, cwd: '' };
  const record = { native: [], probes: [], writes: 0, allow: false };
  const entry = { options: { id: 'dsh-codex-bridge-ui', name: '@dannyzhou/dsh-codex-bridge-ui', config: {} } };
  const editor = {
    entries: () => [entry],
    async edit(target, change) {
      assert.equal(target, entry);
      entry.options.config = change(structuredClone(entry.options.config));
      record.writes++;
    },
  };
  const createContext = (id, kind = 'owner') => ({
    invocation: { peer: { id, principal: { kind } }, signal: new AbortController().signal },
    get: key => key === 'configEditor' ? editor : undefined,
  });
  const service = new SourceSetup(async (action, paths) => {
    assert.equal(paths.codexHome, paths.cwd);
    record.native.push(action);
    return record.allow;
  }, async config => {
    record.probes.push(config);
    assert.deepEqual(config.reader.args, ['app-server']);
    return 'setup-empty';
  }, () => true);
  t.after(() => service.close());
  return { service, createContext, draft, record, entry };
}

test('source setup refuses ordinary browser requests, invalid paths and declined native confirmation before starting Codex', async t => {
  const { service, createContext, draft, record } = await fixture(t);
  const owner = createContext('a');
  const viewer = createContext('b', 'viewer');
  assert.equal(service.available(viewer), false);
  assert.deepEqual(await service.suggestions(viewer, null), { executable: '', codexHome: '', cwd: '' });
  assert.deepEqual(await service.test(viewer, draft), { state: 'setup-unavailable', ticket: null });
  assert.equal((await service.test(owner, { ...draft, executable: 'relative.exe' })).state, 'setup-executable');
  assert.equal((await service.test(owner, draft)).state, 'setup-cancelled');
  assert.equal(await service.enableWrites(viewer), 'setup-unavailable');
  assert.deepEqual(record.native, ['test']);
  assert.equal(record.probes.length, 0);
  assert.equal(record.writes, 0);
});

test('saving the tested source requires the same peer, another native confirmation and a fresh profile', async t => {
  const { service, createContext, draft, record, entry } = await fixture(t);
  const owner = createContext('a');
  const otherOwner = createContext('b');
  record.allow = true;
  const first = await service.test(owner, draft);
  assert.equal(first.state, 'setup-empty');
  assert.equal(await service.save(otherOwner, first.ticket), 'setup-stale');
  record.allow = false;
  assert.equal(await service.save(owner, first.ticket), 'setup-cancelled');
  assert.equal(record.writes, 0);
  record.allow = true;
  entry.options.config = { writeEnabled: true };
  assert.equal(await service.save(owner, first.ticket), 'setup-stale');
  assert.equal(record.writes, 0);

  const next = await service.test(owner, draft);
  assert.equal(await service.save(owner, next.ticket), 'setup-saved');
  assert.equal(await service.save(owner, next.ticket), 'setup-stale');
  assert.equal(entry.options.config.writeEnabled, false);
  assert.equal(record.writes, 1);
  assert.deepEqual(record.native, ['test', 'save', 'save', 'test', 'save']);
});

test('enabling imports honors a separate native decision while preserving the source', async t => {
  const { service, createContext, draft, record, entry } = await fixture(t);
  const owner = createContext('a');
  record.allow = true;
  const testResult = await service.test(owner, draft);
  assert.equal(await service.save(owner, testResult.ticket), 'setup-saved');
  const reader = structuredClone(entry.options.config.reader);
  record.allow = false;
  assert.equal(await service.enableWrites(owner), 'setup-cancelled');
  assert.equal(entry.options.config.writeEnabled, false);
  record.allow = true;
  assert.equal(await service.enableWrites(owner), 'setup-saved');
  assert.equal(entry.options.config.writeEnabled, true);
  assert.deepEqual(entry.options.config.reader, reader);

  entry.options.config.reader.readLimits.pageSize = 25;
  const changedHome = join(draft.codexHome, 'other history');
  await mkdir(changedHome);
  const changed = await service.test(owner, { ...draft, codexHome: changedHome });
  assert.equal(await service.save(owner, changed.ticket), 'setup-saved');
  assert.equal(entry.options.config.reader.codexHome, changedHome);
  assert.equal(entry.options.config.reader.readLimits.pageSize, 25);
  assert.equal(entry.options.config.writeEnabled, false);
});
