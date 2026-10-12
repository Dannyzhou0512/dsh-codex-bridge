/** Sanitized failures; raw RPC messages, stderr and causes never cross this boundary. */
export type ReadErrorCode =
  | 'invalid-config' | 'not-connected' | 'closed' | 'spawn-failed' | 'process-exited'
  | 'invalid-frame' | 'frame-too-large' | 'truncated-frame' | 'unexpected-response'
  | 'rpc-failed' | 'request-timeout' | 'cancelled' | 'concurrency-limit'
  | 'write-method-denied' | 'invalid-response' | 'identity-mismatch'
  | 'cursor-cycle' | 'scan-limit' | 'content-limit';

/** Safe to log; no server text or hidden reasoning is attached. */
export class CodexReadError extends Error {
  constructor(readonly code: ReadErrorCode, readonly rpcCode?: number) {
    super(`Codex read-only adapter: ${code}`);
    this.name = 'CodexReadError';
  }
}
