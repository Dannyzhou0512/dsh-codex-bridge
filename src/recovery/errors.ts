/** Finite diagnostics never expose raw provider errors or history. */
export type RecoveryErrorCode = 'invalid-options' | 'invalid-plan' | 'invalid-approval' | 'capability-unavailable'
  | 'capability-failed' | 'cancelled' | 'content-limit' | 'target-changed' | 'invalid-receipt';
export class RecoveryError extends Error {
  constructor(readonly code: RecoveryErrorCode) { super(code); this.name = 'RecoveryError'; }
}
export function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RecoveryError('cancelled');
}
