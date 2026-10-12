export type CliErrorCode = 'invalid-config' | 'capability-unavailable' | 'review-required'
  | 'review-stale' | 'output-limit' | 'cancelled' | 'operation-failed' | 'reader-close-failed';
export class CliError extends Error {
  constructor(readonly code: CliErrorCode) { super(code); this.name = 'CliError'; }
}
