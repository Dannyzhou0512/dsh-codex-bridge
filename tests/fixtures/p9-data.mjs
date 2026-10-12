/** Synthetic batch capability fixture; the published Loader integration is separate. */
import { ImportPlanner } from '../../lib/planner/index.js';
import { SessionImporter } from '../../lib/importer/index.js';
import { BatchImporter } from '../../lib/batch/index.js';
import { setupImport, importLimits } from './p7-data.mjs';
export const batchLimits = { maxEntries: 30, maxSelectionBytes: 1000000,
  maxPlanBytes: 8000000, maxResultBytes: 1000000, maxItemResultBytes: 8192 };
export async function setupBatch(t, ids = ['a', 'b', 'c']) {
  const f = await setupImport(t), sources = new Map();
  for (const id of ids) { const snapshot = structuredClone(f.source); snapshot.thread.id = id; sources.set(id, snapshot); }
  const reads = [], failReads = new Set();
  const source = { async read(id) { reads.push(id); if (failReads.has(id)) throw new Error('PRIVATE_BATCH_SENTINEL'); return sources.get(id); } };
  const planner = new ImportPlanner({ source, mapper: f.mapper, persistence: f.persistence, liveSession: () => false },
    { maxTargetEvents: 2000, maxTargetBytes: 2000000, readChunkEvents: 3, maxPlanBytes: 4000000 });
  const importer = new SessionImporter({ planner, mapper: f.mapper, persistence: f.persistence,
    liveSession: () => false, cache: f.caps.cache }, importLimits);
  const caps = { planner, importer }, batch = new BatchImporter(caps, batchLimits);
  const requests = ids.map(threadId => ({ threadId, conversion: structuredClone(f.request.conversion) }));
  return { ...f, planner, importer, caps, batch, sources, source, reads, failReads, requests };
}
export function approved(plan, ids = plan.entries.map(entry => entry.threadId)) {
  const selected = new Set(ids);
  return { dryRun: false, selectedThreadIds: ids, approval: { planDigest: plan.planDigest,
    items: plan.entries.filter(entry => selected.has(entry.threadId) && entry.plan).map(entry => ({
      threadId: entry.threadId, planDigest: entry.plan.planDigest, acceptedLosses: entry.plan.request.conversion.acceptedLosses,
    })) } };
}
export const planOptions = { dryRun: true, cache: 'skip' };
