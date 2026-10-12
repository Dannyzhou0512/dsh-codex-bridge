/** Exercise the extracted public package subpath, while prohibiting child creation. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports, createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = process.argv[2];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
let launches = 0;
const original = childProcess.spawn;
childProcess.spawn = () => { launches++; throw new Error('Lazy artifact must not launch a child'); };
syncBuiltinESMExports();
try {
  const adapter = await import(pathToFileURL(require.resolve('dsh-codex-bridge/codex')).href);
  assert.deepEqual(Object.keys(adapter).sort(), ['CodexHistoryReader', 'CodexReadError']);
  const reader = new adapter.CodexHistoryReader({
    executable: process.execPath, args: ['app-server', '--stdio'], cwd: directory, codexHome: directory,
    clientInfo: { name: 'fixture', title: 'fixture', version: '0.0.2' },
    limits: { requestTimeoutMs: 2500, shutdownTimeoutMs: 500, maxInFlight: 1, maxFrameBytes: 65536 },
    readLimits: { pageSize: 1, maxPages: 1, maxThreads: 1, maxItems: 1, maxJsonDepth: 32 },
  });
  assert.equal(reader.inspect().pid, null);
  await reader.close();
  assert.equal(launches, 0);
  console.log('P1_REPORT ' + JSON.stringify({ subpathResolved: true, constructAndCloseLaunches: launches }));
} finally { childProcess.spawn = original; syncBuiltinESMExports(); }
