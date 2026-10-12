/** Public exact-prefix readback; no query/controller activation or private storage access. */
import { assertContiguous, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import type { SessionPersistence, SessionHandle } from '@deepseek-ai/dsh-session-persistence';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';
import { canonicalJson } from '../converter/canonical.js';
import { validateConversionPlan } from '../converter/validate.js';
import type { ConversionPlan } from '../converter/types.js';
import { checkAbort, ImportFailure } from './errors.js';
import type { ImportLimits } from './types.js';
export function headersMatch(a: SessionHeader, b: SessionHeader): boolean {
  return canonicalJson({ ...a, delegationDepth: a.delegationDepth ?? 0 })
    === canonicalJson({ ...b, delegationDepth: b.delegationDepth ?? 0 });
}
export interface VerifiedLog { readonly header: SessionHeader; readonly events: readonly SessionEvent[]; readonly inherited: SessionHandle['inheritedEventCount'] }
export async function verifyReadback(persistence: Pick<SessionPersistence, 'identity' | 'stat' | 'open'>,
  expected: ConversionPlan, limits: ImportLimits, signal?: AbortSignal): Promise<VerifiedLog> {
  validateConversionPlan(expected); checkAbort(signal);
  const identity = persistence.identity, opts = signal ? { signal } : {};
  const before = await persistence.stat(expected.header.id, opts); checkAbort(signal);
  if (!before || !headersMatch(expected.header, before.header)) throw new ImportFailure('readback-header-mismatch');
  if (before.eventCount !== undefined && before.eventCount > limits.maxReadEvents) throw new ImportFailure('readback-content-limit');
  const handle = await persistence.open(expected.header.id, 'read', opts);
  try {
    checkAbort(signal);
    if (handle.access !== 'read' || handle.id !== expected.header.id || handle.inheritedEventCount !== 0
      || !headersMatch(expected.header, handle.header)) throw new ImportFailure('readback-header-mismatch');
    const header = structuredClone(handle.header), events: SessionEvent[] = [];
    let bytes = Buffer.byteLength(canonicalJson(header), 'utf8');
    if (bytes > limits.maxReadBytes) throw new ImportFailure('readback-content-limit');
    for (;;) {
      checkAbort(signal);
      const length = Math.min(limits.readChunkEvents, limits.maxReadEvents - events.length + 1);
      const slice = await handle.read(events.length, length, opts); checkAbort(signal);
      if (slice.events.length > length) throw new ImportFailure('readback-content-limit');
      if (!slice.events.length) break;
      bytes += Buffer.byteLength(canonicalJson(slice.events), 'utf8');
      if (events.length + slice.events.length > limits.maxReadEvents || bytes > limits.maxReadBytes)
        throw new ImportFailure('readback-content-limit');
      events.push(...structuredClone(slice.events));
    }
    assertContiguous(expected.header.id, events, 0);
    validateStoredEvents(header, events);
    if (events.length < expected.events.length
      || canonicalJson(events.slice(0, expected.events.length)) !== canonicalJson(expected.events)
      || events.filter(event => event.type === 'codex-bridge/import-receipt').length !== 1)
      throw new ImportFailure('readback-prefix-mismatch');
    const after = await persistence.stat(expected.header.id, opts); checkAbort(signal);
    if (persistence.identity !== identity || !after || after.revision !== before.revision
      || !headersMatch(header, after.header) || (after.eventCount !== undefined && after.eventCount !== events.length))
      throw new ImportFailure('readback-changed');
    return { header, events, inherited: handle.inheritedEventCount };
  } finally { await handle.close(); }
}

/** Known prefix must fit readback limits before any Workspace or Session write. */
export function assertReadbackCapacity(expected: ConversionPlan, limits: ImportLimits): void {
  if (expected.events.length > limits.maxReadEvents) throw new ImportFailure('readback-content-limit');
  let bytes = Buffer.byteLength(canonicalJson({ ...expected.header, delegationDepth: expected.header.delegationDepth ?? 0 }), 'utf8');
  for (let offset = 0; offset < expected.events.length; offset += limits.readChunkEvents)
    bytes += Buffer.byteLength(canonicalJson(expected.events.slice(offset, offset + limits.readChunkEvents)), 'utf8');
  if (bytes > limits.maxReadBytes) throw new ImportFailure('readback-content-limit');
}
