/** Synthetic public P2 snapshots and explicit test policy; no real Codex history. */
import { readFile } from 'node:fs/promises';
import { parseThreadSnapshot } from '../../lib/codex/parse.js';
export const LOSSES = ['assistant-role-recall', 'tool-information-recall', 'reasoning-summary-recall',
  'non-text-input-omitted', 'unknown-item-omitted', 'context-compaction-unrestored', 'tool-output-unavailable'];
export const wire = JSON.parse(await readFile(new URL('./codex/history.json', import.meta.url), 'utf8'));
export function publicSnapshot() { return parseThreadSnapshot(structuredClone(wire), 'fixture-thread', { maxItems: 100, maxJsonDepth: 32 }); }
export function options(cwd = process.platform === 'win32' ? 'C:\\synthetic-selected' : '/synthetic-selected') {
  return { mode: 'recall', acceptedLosses: LOSSES, target: { selectedCwd: cwd, pathStyle: cwd?.startsWith('/') ? 'posix' : 'windows' },
    titleMode: 'pin', limits: { maxInputBytes: 1000000, maxResultBytes: 2000000, maxEvents: 1000, maxTextBytes: 100000, maxToolDepth: 32, titleMaxBytes: 80 } };
}
