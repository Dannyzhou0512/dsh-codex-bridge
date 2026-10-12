/** Actual unpacked mapper face: lazy construction and safe dry-run of a project-owned directory. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = process.argv[2];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const module = await import(pathToFileURL(require.resolve('dsh-codex-bridge/workspace')).href);
assert.deepEqual(Object.keys(module).sort(), ['WorkspaceMapper', 'WorkspaceMappingError', 'classifyWorkspacePath']);
let calls = 0;
const registry = { list: () => [], create: () => { calls++; throw new Error('Artifact dry-run mutator attempted'); } };
const mapper = new module.WorkspaceMapper({ registry }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
const plan = await mapper.plan({ originalCwd: directory });
assert.equal(plan.status, 'ready');
const result = await mapper.resolve(plan, { dryRun: true });
assert.equal(result.status, 'dry-run'); assert.equal(calls, 0);
console.log('P1_REPORT ' + JSON.stringify({ workspaceSubpath: true, dryRun: true, mutatorCalls: calls }));
