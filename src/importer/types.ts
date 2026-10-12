import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { ImportPlanner } from '../planner/planner.js';
import type { ImportPlanState } from '../planner/types.js';
import type { LossCode } from '../converter/types.js';
import type { WorkspaceMapper } from '../workspace/mapper.js';
export interface ImportCapabilities {
  readonly planner: ImportPlanner;
  readonly persistence?: Pick<SessionPersistence, 'identity' | 'stat' | 'open' | 'create'>;
  readonly mapper?: Pick<WorkspaceMapper, 'resolve' | 'attach'>;
  readonly liveSession?: (id: SessionId) => boolean;
  /** Structural public coldSnapshot seam. Return does not acknowledge its async durable write-back. */
  readonly cache?: { coldSnapshot(header: SessionHeader, inherited: SessionLogOffset, events: readonly SessionEvent[]): unknown };
}
export interface ImportLimits {
  readonly maxReadEvents: number; readonly maxReadBytes: number;
  readonly readChunkEvents: number;
  /** At least 8192 bytes for the bounded finite outcome envelope. */
  readonly maxResultBytes: number;
}
export interface ImportApproval {
  readonly planDigest: string;
  /** Must equal the reviewed policy, including explicitly accepted optional losses. */
  readonly acceptedLosses: readonly LossCode[];
}
export interface ImportOptions {
  readonly dryRun: boolean; readonly cache: 'skip' | 'refresh-if-available';
  readonly approval?: ImportApproval; readonly signal?: AbortSignal;
}
export type ImportStage = 'approval' | 'freshness' | 'workspace' | 'recheck' | 'create'
  | 'append' | 'flush' | 'close' | 'readback' | 'attach' | 'cache' | 'done';
export type ImportState = 'dry-run' | 'completed' | 'already-imported' | 'blocked' | 'stale-plan'
  | 'conflict' | 'incomplete' | 'workspace-pending' | 'cancelled' | 'failed';
export interface ImportEffects {
  workspaceResolveInvoked: boolean; workspaceCreateInvoked: boolean | null; sessionCreateInvoked: boolean; writerAcquired: boolean;
  appendInvoked: boolean; appendSucceeded: boolean; flushInvoked: boolean; flushSucceeded: boolean;
  writerCloseInvoked: boolean; writerCloseSucceeded: boolean; workspaceAttachInvoked: boolean; attachInvoked: boolean | null; cacheInvoked: boolean;
}
export interface ImportResult {
  readonly schemaVersion: 1; readonly dryRun: boolean; readonly sessionId: SessionId; readonly planDigest: string;
  readonly decision: ImportPlanState; readonly state: ImportState; readonly stage: ImportStage;
  readonly reason: string | null; readonly sessionVerified: boolean;
  readonly workspaceId: string | null;
  readonly workspaceStatus: 'not-attempted' | 'resolved' | 'attached' | 'pending' | 'retained';
  readonly cacheStatus: 'not-attempted' | 'skipped' | 'unavailable' | 'requested' | 'pending';
  readonly effects: Readonly<ImportEffects>; readonly warnings: readonly string[];
}
