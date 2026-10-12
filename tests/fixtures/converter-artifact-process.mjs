/** Inspect extracted public converter face without launching Codex or mounting persistence. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicSnapshot, options } from './p4-data.mjs';
const directory = process.argv[2];
const require = createRequire(join(directory, 'node_modules/dsh-codex-bridge/package.json'));
const module = await import(pathToFileURL(require.resolve('dsh-codex-bridge/converter')).href);
assert.deepEqual(Object.keys(module).sort(), ['ConversionError', 'convertSnapshot', 'sessionIdFor', 'validateConversionPlan']);
const result = module.convertSnapshot(publicSnapshot(), options());
assert.equal(result.state, 'ready');
module.validateConversionPlan(result.plan);
assert(result.plan.events.every((event, index) => event.seq === index));
console.log('P1_REPORT ' + JSON.stringify({ converterSubpathResolved: true, validatedPlan: true, writes: 0, codexLaunches: 0 }));
