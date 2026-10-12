/** Read-only content inventory of the sibling reference; reports stay in this project. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reference = resolve(project, '../deepseek-harness-ref');
const baseline = join(project, '.artifacts/reference-before.json');
const report = join(project, '.artifacts/reference-check.json');
async function inventory(directory, prefix = '') {
  const rows = [];
  for (const entry of (await readdir(directory)).sort()) {
    const filename = join(directory, entry);
    const relative = prefix + entry;
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) rows.push([relative, 'link', await readlink(filename)]);
    else if (stat.isDirectory()) {
      rows.push([relative, 'directory']);
      rows.push(...await inventory(filename, relative + '/'));
    } else if (stat.isFile()) rows.push([relative, createHash('sha256').update(await readFile(filename)).digest('hex')]);
    else throw new Error('Unexpected reference entry: ' + relative);
  }
  return rows;
}
const current = await inventory(reference);
await mkdir(dirname(baseline), { recursive: true });
if (process.argv[2] === 'capture') {
  await writeFile(baseline, JSON.stringify(current), { flag: 'wx' });
  console.log(JSON.stringify({ reference, entries: current.length, captured: true }));
} else if (process.argv[2] === 'check') {
  const before = JSON.parse(await readFile(baseline, 'utf8'));
  assert.deepEqual(current, before, 'Reference content, paths or symlinks changed');
  await writeFile(report, JSON.stringify({ reference, entries: current.length, unchanged: true }, null, 2) + '\n');
  console.log(JSON.stringify({ reference, entries: current.length, unchanged: true }));
} else throw new Error('Use capture or check');
