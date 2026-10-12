import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { ImportPlanner } from '../planner/planner.js';
import type { WorkspaceMapper } from '../workspace/mapper.js';
import type { WorkspaceMappingPlan } from '../workspace/types.js';
import type { ImportCapabilities } from '../importer/types.js';
export interface RecoveryCapabilities {
  readonly planner: ImportPlanner;
  readonly persistence?: Pick<SessionPersistence, 'identity' | 'stat' | 'open'>;
  readonly mapper?: Pick<WorkspaceMapper, 'plan' | 'resolve' | 'attach'>;
  readonly registry?: Pick<WorkspaceRegistry, 'list'>;
  readonly liveSession?: (id: SessionId) => boolean;
  readonly cache?: ImportCapabilities['cache'];
}
export interface RecoveryLimits {
  readonly maxReadEvents: number; readonly maxReadBytes: number; readonly readChunkEvents: number;
  readonly maxWorkspaces: number; readonly maxPlanBytes: number; readonly maxResultBytes: number;
}
export interface RecoveryActions { readonly workspace: 'skip' | 'retry'; readonly cache: 'skip' | 'refresh-if-available' }
export interface DiagnosisOptions extends RecoveryActions { readonly dryRun: true; readonly signal?: AbortSignal }
export type DiagnosisState = 'recoverable' | 'noop' | 'absent' | 'incomplete' | 'conflict' | 'blocked' | 'busy' | 'needs-remap' | 'stale-plan';
export interface StoredSummary {
  readonly cwd: string; readonly revision: string; readonly contentDigest: string;
  readonly prefixDigest: string; readonly eventCount: number; readonly continuationEvents: number;
}
export interface RecoveryPlan {
  readonly schemaVersion: 1; readonly dryRun: true; readonly sessionId: SessionId;
  readonly importPlanDigest: string; readonly sourceFingerprint: string; readonly actions: RecoveryActions;
  readonly state: DiagnosisState; readonly reason: string | null; readonly session: StoredSummary | null;
  readonly workspace: WorkspaceMappingPlan | null;
  readonly membership: 'uninspected' | 'unattached' | 'attached';
  readonly workspaceId: string | null; readonly cacheAvailable: boolean;
  readonly planDigest: string;
}
export interface RetryOptions {
  readonly dryRun: boolean; readonly approval?: { readonly planDigest: string }; readonly signal?: AbortSignal;
}
export interface RecoveryEffects {
  workspaceResolveInvoked: boolean; workspaceCreateInvoked: boolean | null;
  workspaceAttachInvoked: boolean; attachInvoked: boolean | null; cacheInvoked: boolean;
}
export interface RecoveryResult {
  readonly schemaVersion: 1; readonly dryRun: boolean; readonly sessionId: SessionId; readonly planDigest: string;
  readonly state: 'dry-run' | 'completed' | 'noop' | 'blocked' | 'stale-plan' | 'workspace-pending' | 'cancelled' | 'failed';
  readonly stage: 'validation' | 'recheck' | 'resolve' | 'attach' | 'cache' | 'done';
  readonly reason: string | null; readonly sessionVerified: boolean; readonly workspaceId: string | null;
  readonly cacheStatus: 'not-attempted' | 'skipped' | 'unavailable' | 'requested' | 'pending';
  readonly effects: Readonly<RecoveryEffects>; readonly warnings: readonly string[];
}
