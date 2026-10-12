/** Ownership-free public inspection of an existing complete import, including native continuation. */
import { assertContiguous, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';
import { canonicalJson, digest } from '../converter/canonical.js';
import { validateConversionPlan } from '../converter/validate.js';
import { abort, RecoveryError } from './errors.js';
import type { RecoveryLimits, StoredSummary } from './types.js';
import type { ImportPlan } from '../planner/types.js';
export interface StoredImport { readonly summary: StoredSummary; readonly header: SessionHeader; readonly events: readonly SessionEvent[] }
export async function readStoredImport(persistence: Pick<SessionPersistence, 'identity' | 'stat' | 'open'>,
  plan: ImportPlan, limits: RecoveryLimits, signal?: AbortSignal): Promise<StoredImport> {
  abort(signal);
  const identity = persistence.identity, opts = signal ? { signal } : {};
  const before = await persistence.stat(plan.sessionId, opts); abort(signal);
  if (!before) throw new RecoveryError('target-changed');
  if (before.eventCount !== undefined && before.eventCount > limits.maxReadEvents) throw new RecoveryError('content-limit');
  const handle = await persistence.open(plan.sessionId, 'read', opts);
  try {
    abort(signal);
    if (handle.access !== 'read' || handle.id !== plan.sessionId || handle.inheritedEventCount !== 0
      || canonicalJson(handle.header) !== canonicalJson(before.header)) throw new RecoveryError('target-changed');
    const header = structuredClone(handle.header), events: SessionEvent[] = [];
    let bytes = Buffer.byteLength(canonicalJson(header), 'utf8');
    if (bytes > limits.maxReadBytes) throw new RecoveryError('content-limit');
    for (;;) {
      abort(signal);
      const length = Math.min(limits.readChunkEvents, limits.maxReadEvents - events.length + 1);
      const slice = await handle.read(events.length, length, opts); abort(signal);
      if (slice.events.length > length) throw new RecoveryError('content-limit');
      if (!slice.events.length) break;
      bytes += Buffer.byteLength(canonicalJson(slice.events), 'utf8');
      if (events.length + slice.events.length > limits.maxReadEvents || bytes > limits.maxReadBytes) throw new RecoveryError('content-limit');
      events.push(...structuredClone(slice.events));
    }
    assertContiguous(plan.sessionId, events, 0); validateStoredEvents(header, events);
    const receipts = events.filter(event => event.type === 'codex-bridge/import-receipt');
    const receipt = receipts[0];
    if (receipts.length !== 1 || receipt?.type !== 'codex-bridge/import-receipt') throw new RecoveryError('invalid-receipt');
    const prefix = events.slice(0, Number(receipt.seq) + 1);
    const actualDigest = digest('dsh-codex-bridge/prefix/v1', { header, events: prefix.slice(0, -1) });
    let receiptHeader = header;
    if (actualDigest !== receipt.data.prefixDigest && header.delegationDepth === 0) {
      const { delegationDepth, ...rest } = header; receiptHeader = rest;
    }
    validateConversionPlan({ header: receiptHeader, events: prefix, prefixDigest: receipt.data.prefixDigest,
      sourceFingerprint: receipt.data.sourceFingerprint,
      planDigest: digest('dsh-codex-bridge/plan/v1', { header: receiptHeader, events: prefix }) });
    if (receipt.data.sourceThreadId !== plan.request.threadId || receipt.data.sourceFingerprint !== plan.sourceFingerprint
      || typeof header.cwd !== 'string') throw new RecoveryError('invalid-receipt');
    const after = await persistence.stat(plan.sessionId, opts); abort(signal);
    if (persistence.identity !== identity || !after || after.revision !== before.revision
      || canonicalJson(after.header) !== canonicalJson(header)
      || (after.eventCount !== undefined && after.eventCount !== events.length)) throw new RecoveryError('target-changed');
    const contentDigest = digest('dsh-codex-bridge/target-content/v1', { header, events });
    if (contentDigest !== plan.target?.contentDigest || String(after.revision) !== plan.target.revision) throw new RecoveryError('target-changed');
    return { header, events, summary: { cwd: header.cwd, revision: String(after.revision), contentDigest,
      prefixDigest: receipt.data.prefixDigest, eventCount: events.length, continuationEvents: events.length - prefix.length } };
  } finally { await handle.close(); }
}
