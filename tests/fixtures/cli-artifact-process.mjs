/** Actual extracted third-party CLI, launched by the published dsh bin. No boot/provideCmdline shortcut. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createProfile, cliConfig, run, selectedArgs, rpcLog } from './p10-launch.mjs';
const directory = process.argv[2], root = join(directory, 'p10-actual-profile');
await (await import('node:fs/promises')).mkdir(root, { recursive: true });
await createProfile(root, cliConfig(root));
const help = await run(root, ['--help']); assert.equal(help.code, 0, help.stderr);
const list = await run(root, ['list']); assert.equal(list.code, 0, list.stderr); assert.equal(list.json.threads.length, 2);
const args = selectedArgs(root);
const preview = await run(root, ['preview', ...args]); assert.equal(preview.code, 0, preview.stderr); assert.equal(preview.json.entries.length, 2);
const plan = await run(root, ['plan', ...args]); assert.equal(plan.code, 0, plan.stderr);
const dry = await run(root, ['apply', ...args]); assert.equal(dry.code, 0, dry.stderr); assert.equal(dry.json.result.summary.dryRun, 2);
const applied = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', plan.json.reviewDigest]);
assert.equal(applied.code, 0, applied.stderr + applied.stdout); assert.equal(applied.json.result.summary.completed, 2);
const fresh = await run(root, ['plan', ...args]), repeat = await run(root, ['apply', ...args, '--execute', '--reviewed-digest', fresh.json.reviewDigest]);
assert.equal(repeat.code, 0, repeat.stderr); assert.equal(repeat.json.result.summary.alreadyImported, 2);
const messages = (await rpcLog(root)).filter(message => message.method);
assert(messages.every(message => ['initialize', 'initialized', 'thread/list', 'thread/read'].includes(message.method)));
assert.doesNotMatch(applied.stdout, /HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
console.log('P1_REPORT ' + JSON.stringify({ phase: 'P10', actualPublishedLauncher: true, externalBundle: true,
  help: true, listPreviewPlan: true, strictDryRun: true, nativeSessionsImported: 2, restartDedup: true, sourceMethodsReadOnly: true }));
