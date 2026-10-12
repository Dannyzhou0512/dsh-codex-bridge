/** Real published app-boot/Loader composition over a test-only cordis.yml. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';
import { boot, composeEntries, getDshRuntimeVersion, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';

const directory = process.argv[2];
const packageDirectory = join(directory, 'node_modules/dsh-codex-bridge');
const patches = loadOverlayPatches('p1', join(packageDirectory, 'cordis.patch.yml'));
const rows = composeEntries([patches]);
assert.deepEqual(rows, [{ id: 'dsh-codex-bridge-host', name: 'dsh-codex-bridge' }]);
const config = join(directory, 'cordis.yml');
const patchBefore = await readFile(join(packageDirectory, 'cordis.patch.yml'));
let ctx;
let report;
try {
  ctx = await boot('p1-composition', config, patches);
  assert(ctx instanceof Context, 'app-boot must use the same Cordis Context');
  assert.equal(getDshRuntimeVersion(), '0.2.0-rc.2');
  const bridge = ctx.get('codexHistory');
  assert(bridge instanceof Service, 'Built plugin must inherit the host Cordis Service');
  const missing = ['sessions', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry'];
  assert.deepEqual(bridge.status(), { phase: 'P1', importEnabled: false, state: 'capabilityUnavailable', missingCapabilities: missing });
  const snapshot = bridge.capabilities();
  assert.deepEqual(snapshot, missing.map(name => ({ name, available: false })));
  snapshot[0].available = true;
  assert.equal(bridge.capabilities()[0].available, false, 'Snapshots must not mutate service state');

  // Presence-only seams: touching any method fails. No Session/Workspace implementation is instantiated.
  let capabilityCalls = 0;
  const disposers = [];
  for (const name of missing) {
    const forbidden = () => { capabilityCalls++; throw new Error('P1 invoked ' + name); };
    disposers.push(ctx.provide(name, Object.freeze({ create: forbidden, open: forbidden, append: forbidden, flush: forbidden, list: forbidden, attachSession: forbidden })));
    if (disposers.length < missing.length) assert.deepEqual(bridge.status().missingCapabilities, missing.slice(disposers.length));
  }
  assert.deepEqual(bridge.status(), { phase: 'P1', importEnabled: false, state: 'notConfigured' });
  assert(bridge.capabilities().every(value => value.available));
  for (const dispose of disposers.reverse()) await dispose();
  assert.deepEqual(bridge.status().missingCapabilities, missing);
  assert.equal(capabilityCalls, 0);

  const entry = [...ctx.loader.entries()].find(value => value.options.id === 'dsh-codex-bridge-host');
  assert(entry?.fiber, 'The service must originate in a real Loader entry');
  await entry.fiber.dispose();
  await ctx.loader.await();
  assert.equal(ctx.get('codexHistory'), undefined, 'Unload must remove the service');
  await entry.update({ disabled: false });
  await ctx.loader.await();
  assert(ctx.get('codexHistory') instanceof Service, 'The entry must reload after disposal');
  assert.deepEqual(await readFile(join(packageDirectory, 'cordis.patch.yml')), patchBefore, 'Bundle patch must never be rewritten');
  report = { composition: 'published app-boot + Loader + cordis.yml', runtime: getDshRuntimeVersion(), sharedCordis: true, unloaded: true, reloaded: true, capabilityCalls };
} finally {
  await ctx?.fiber.dispose();
}
assert.equal(ctx.get('codexHistory'), undefined);
console.log('P1_REPORT ' + JSON.stringify(report));
