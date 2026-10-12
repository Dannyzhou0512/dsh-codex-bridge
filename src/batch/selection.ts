/** Explicit known-field policy selection. No default scan or implicit selection of all history. */
import { z } from 'zod';
import { canonicalJson } from '../converter/canonical.js';
import { BatchError } from './errors.js';
import type { ImportRequest } from '../planner/types.js';
import type { BatchLimits } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const loss = z.enum(['assistant-role-recall', 'tool-information-recall', 'reasoning-summary-recall',
  'non-text-input-omitted', 'unknown-item-omitted', 'context-compaction-unrestored', 'tool-output-unavailable']);
const requestSchema = z.object({ threadId: z.string().min(1), remapCwd: z.string().min(1).optional(),
  conversion: z.object({ mode: z.enum(['strict', 'recall']), acceptedLosses: z.array(loss).max(7),
    titleMode: z.enum(['pin', 'omit']), limits: z.object({ maxInputBytes: positive, maxResultBytes: positive,
      maxEvents: positive, maxTextBytes: positive, maxToolDepth: positive.max(128), titleMaxBytes: positive }) }) });
export function normalizeSelection(requests: readonly ImportRequest[], limits: BatchLimits) {
  if (!Array.isArray(requests) || requests.length > limits.maxEntries) throw new BatchError('invalid-selection');
  const parsed = z.array(requestSchema).safeParse(requests);
  if (!parsed.success) throw new BatchError('invalid-selection');
  const projected = parsed.data.map(row => ({ threadId: row.threadId, conversion: row.conversion,
    ...row.remapCwd === undefined ? {} : { remapCwd: row.remapCwd } }));
  if (Buffer.byteLength(canonicalJson(projected), 'utf8') > limits.maxSelectionBytes) throw new BatchError('content-limit');
  const byId = new Map<string, { request: ImportRequest; occurrences: number; key: string }>();
  for (const request of projected) {
    const key = canonicalJson({ ...request, conversion: { ...request.conversion, acceptedLosses: [...new Set(request.conversion.acceptedLosses)].sort() } });
    const prior = byId.get(request.threadId);
    if (prior && prior.key !== key) throw new BatchError('conflicting-selection');
    if (prior) prior.occurrences++;
    else byId.set(request.threadId, { request, occurrences: 1, key });
  }
  return [...byId.values()];
}
export function equalLosses(a: readonly string[], b: readonly string[]): boolean {
  return canonicalJson([...new Set(a)].sort()) === canonicalJson([...new Set(b)].sort());
}
