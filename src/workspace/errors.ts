/** Path/service failures are reported without raw exceptions, credentials or private storage locations. */
export type WorkspaceMappingErrorCode = 'invalid-options' | 'invalid-request' | 'invalid-plan' | 'content-limit' | 'workspace-limit' | 'capability-failed' | 'cancelled';
export class WorkspaceMappingError extends Error {
  constructor(readonly code: WorkspaceMappingErrorCode) {
    super('Workspace mapping failed: ' + code);
    this.name = 'WorkspaceMappingError';
  }
}
export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkspaceMappingError('cancelled');
}
