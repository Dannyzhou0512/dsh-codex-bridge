/** Public finite errors never carry raw provider failures or history. */
export type ImportErrorCode = 'invalid-options' | 'invalid-plan' | 'invalid-approval' | 'capability-unavailable';
export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) { super(code); this.name = 'ImportError'; }
}
export class ImportFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImportFailure('cancelled');
}
