/** Batch errors contain finite codes only, never raw transport/provider errors. */
export type BatchErrorCode = 'invalid-options' | 'invalid-selection' | 'conflicting-selection'
  | 'invalid-plan' | 'invalid-approval' | 'content-limit';
export class BatchError extends Error {
  constructor(readonly code: BatchErrorCode) { super(code); this.name = 'BatchError'; }
}
