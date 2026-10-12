/** Safe errors never include history bodies, raw errors or credentials. */
export type PlanningErrorCode = 'invalid-options' | 'invalid-request' | 'invalid-plan' | 'capability-unavailable'
  | 'capability-failed' | 'cancelled' | 'content-limit' | 'target-changed';
export class PlanningError extends Error {
  constructor(readonly code: PlanningErrorCode) { super(code); this.name = 'PlanningError'; }
}
export function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PlanningError('cancelled');
}
