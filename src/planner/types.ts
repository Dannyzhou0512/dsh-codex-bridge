import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { ThreadSnapshot } from '../codex/types.js';
import type { ConversionOptions, ConversionResult } from '../converter/types.js';
import type { MappingRequest, WorkspaceMappingPlan } from '../workspace/types.js';
export interface PlanningCapabilities {
  readonly source?: { read(threadId: string, signal?: AbortSignal): Promise<ThreadSnapshot> };
  /** Only metadata and read-mode opens are invoked. Identity binds freshness to this provider. */
  readonly persistence?: Pick<SessionPersistence, 'identity' | 'stat' | 'open'>;
  readonly mapper?: { plan(request: MappingRequest, signal?: AbortSignal): Promise<WorkspaceMappingPlan> };
  /** Required to rule out live, unpersisted Session collisions. Adapt sessions.get without hydrating. */
  readonly liveSession?: (id: SessionId) => boolean;
}
export interface PlanningLimits {
  readonly maxTargetEvents: number; readonly maxTargetBytes: number;
  readonly readChunkEvents: number; readonly maxPlanBytes: number;
}
export interface ImportRequest {
  readonly threadId: string; readonly remapCwd?: string;
  readonly conversion: Omit<ConversionOptions, 'target'>;
}
export interface PlanningOperation { readonly dryRun: true; readonly signal?: AbortSignal }
export interface TargetObservation {
  readonly state: 'absent' | 'imported' | 'conflict' | 'incomplete' | 'source-changed';
  readonly reason: string | null; readonly revision: string | null;
  readonly contentDigest: string | null; readonly eventCount: number;
  readonly importedSourceFingerprint: string | null;
  readonly continuationEvents: number; readonly live: boolean;
}
export type ImportPlanState = 'ready' | 'already-imported' | 'needs-review' | 'needs-remap'
  | 'unsupported' | 'capability-unavailable' | 'conflict' | 'incomplete';
export interface ImportPlan {
  readonly schemaVersion: 1; readonly dryRun: true; readonly state: ImportPlanState;
  readonly request: ImportRequest; readonly sessionId: SessionId;
  readonly sourceFingerprint: string; readonly conversion: ConversionResult;
  readonly workspace: WorkspaceMappingPlan | null; readonly target: TargetObservation | null;
  readonly blockers: readonly string[]; readonly warnings: readonly string[];
  /** Consistency digest, never an authorization token. */
  readonly planDigest: string;
}
export interface FreshnessResult {
  readonly state: 'fresh' | 'stale-plan'; readonly reasons: readonly string[];
  readonly currentPlan: ImportPlan;
}
