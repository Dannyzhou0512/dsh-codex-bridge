/** Bounded target inspection through public, ownership-free persistence handles. */
import { assertContiguous, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';
import { canonicalJson, digest } from '../converter/canonical.js';
import { validateConversionPlan } from '../converter/validate.js';
import { cancelled, PlanningError } from './errors.js';
import type { ConversionResult } from '../converter/types.js';
import type { PlanningCapabilities, PlanningLimits, TargetObservation } from './types.js';

// rc.2 readback materializes the documented default delegationDepth=0.
function withoutDefaultDepth(header: SessionHeader): SessionHeader {
  if (header.delegationDepth !== 0) return header;
  const { delegationDepth, ...rest } = header;
  return rest;
}

export async function inspectTarget(caps: PlanningCapabilities, limits: PlanningLimits,
  conversion: ConversionResult, signal?: AbortSignal): Promise<TargetObservation> {
  const persistence = caps.persistence;
  if (!persistence || !caps.liveSession) throw new PlanningError('capability-unavailable');
  const identity = persistence.identity;
  const id = conversion.sessionId, opts = signal ? { signal } : {};
  cancelled(signal);
  const before = await persistence.stat(id, opts);
  cancelled(signal);
  const live = caps.liveSession(id);
  const empty = { revision: null, contentDigest: null, eventCount: 0,
    importedSourceFingerprint: null, continuationEvents: 0, live };
  if (!before) {
    const after = await persistence.stat(id, opts);
    cancelled(signal);
    if (persistence.identity !== identity || after || caps.liveSession(id) !== live) throw new PlanningError('target-changed');
    return { ...empty, state: live ? 'conflict' : 'absent', reason: live ? 'live-session-collision' : null };
  }
  if (before.eventCount !== undefined && before.eventCount > limits.maxTargetEvents)
    throw new PlanningError('content-limit');
  const handle = await persistence.open(id, 'read', opts);
  let events: SessionEvent[] = [];
  try {
    let bytes = Buffer.byteLength(canonicalJson(handle.header), 'utf8');
    cancelled(signal);
    if (handle.access !== 'read' || handle.id !== id
      || canonicalJson(before.header) !== canonicalJson(handle.header))
      throw new PlanningError('target-changed');
    if (bytes > limits.maxTargetBytes) throw new PlanningError('content-limit');
    for (;;) {
      cancelled(signal);
      const length = Math.min(limits.readChunkEvents, limits.maxTargetEvents - events.length + 1);
      const slice = await handle.read(events.length, length, opts);
      cancelled(signal);
      if (slice.events.length > length) throw new PlanningError('content-limit');
      if (slice.events.length === 0) break;
      bytes += Buffer.byteLength(canonicalJson(slice.events), 'utf8');
      if (events.length + slice.events.length > limits.maxTargetEvents || bytes > limits.maxTargetBytes)
        throw new PlanningError('content-limit');
      events.push(...structuredClone(slice.events));
    }
    assertContiguous(id, events, 0);
    events = [...validateStoredEvents(handle.header, events)];
    const after = await persistence.stat(id, opts);
    cancelled(signal);
    if (persistence.identity !== identity || !after || before.revision !== after.revision
      || canonicalJson(after.header) !== canonicalJson(handle.header) || caps.liveSession(id) !== live
      || (after.eventCount !== undefined && after.eventCount !== events.length))
      throw new PlanningError('target-changed');
    const base = { ...empty, revision: String(after.revision), eventCount: events.length,
      contentDigest: digest('dsh-codex-bridge/target-content/v1', { header: handle.header, events }) };
    const receipts = events.filter(event => event.type === 'codex-bridge/import-receipt');
    if (receipts.length === 0) {
      const candidate = conversion.plan;
      const matches = candidate && canonicalJson(withoutDefaultDepth(candidate.header)) === canonicalJson(withoutDefaultDepth(handle.header))
        && events.length < candidate.events.length
        && canonicalJson(events) === canonicalJson(candidate.events.slice(0, events.length));
      return { ...base, state: matches ? 'incomplete' : 'conflict',
        reason: matches ? 'matching-prefix-without-receipt-unverified' : 'existing-session-without-valid-receipt' };
    }
    if (receipts.length !== 1) return { ...base, state: 'conflict', reason: 'multiple-import-receipts' };
    const receipt = receipts[0]!;
    if (receipt.type !== 'codex-bridge/import-receipt')
      throw new PlanningError('capability-failed');
    const prefix = events.slice(0, Number(receipt.seq) + 1);
    const actualPrefixDigest = digest('dsh-codex-bridge/prefix/v1', { header: handle.header, events: prefix.slice(0, -1) });
    const receiptHeader = actualPrefixDigest === receipt.data.prefixDigest ? handle.header : withoutDefaultDepth(handle.header);
    const candidate = { header: receiptHeader, events: prefix,
      sourceFingerprint: receipt.data.sourceFingerprint, prefixDigest: receipt.data.prefixDigest,
      planDigest: digest('dsh-codex-bridge/plan/v1', { header: receiptHeader, events: prefix }) };
    try {
      validateConversionPlan(candidate);
      if (receipt.data.sourceThreadId !== conversion.source.id) throw new Error();
    } catch {
      return { ...base, state: 'conflict', reason: 'invalid-import-receipt-or-prefix' };
    }
    const imported = { ...base, importedSourceFingerprint: receipt.data.sourceFingerprint,
      continuationEvents: events.length - prefix.length };
    return { ...imported,
      state: receipt.data.sourceFingerprint === conversion.sourceFingerprint ? 'imported' : 'source-changed',
      reason: receipt.data.sourceFingerprint === conversion.sourceFingerprint ? null : 'previous-import-source-changed' };
  } finally {
    // Close is uncancellable. A failed close must not report a successful plan.
    await handle.close();
  }
}
