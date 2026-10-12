/** Public rc.2 compatibility preflight rejects poison modules before import. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boot, getDshRuntimeVersion, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';

const directory = process.argv[2];
const packageDirectory = join(directory, 'node_modules/dsh-codex-bridge');
const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
await writeFile(join(packageDirectory, 'lib/index.js'), 'throw new Error("P1 poison module was imported");\n');
const profile = {
  name: 'p1-test-only', dir: directory, patchPath: join(directory, 'unused.patch.yml'),
  installAnchor: join(directory, 'package.json'), cwd: directory, home: directory,
  startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
};
let ctx;
try {
  ctx = await boot('p1-preflight', join(directory, 'cordis.yml'),
    loadOverlayPatches('p1', join(packageDirectory, 'cordis.patch.yml')),
    host => { host.provide('profileContext', profile); });
  assert.equal(ctx.get('codexHistory'), undefined);
  const denied = [...ctx.loader.entries()].find(entry => entry.options.id === 'dsh-codex-bridge-host');
  assert(denied, 'Denied row should remain observable');
  assert.equal(denied.options.disabled, true);
  console.log('P1_REPORT ' + JSON.stringify({ hostRuntime: getDshRuntimeVersion(), peer: manifest.peerDependencies['@deepseek-ai/dsh-app-boot'], deniedBeforeImport: true }));
} finally {
  await ctx?.fiber.dispose();
}
