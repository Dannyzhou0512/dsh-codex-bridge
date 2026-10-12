import type { ImportPlanner } from '../planner/planner.js';
import type { ImportPlan, ImportPlanState } from '../planner/types.js';
import type { SessionImporter } from '../importer/importer.js';
import type { ImportResult, ImportState } from '../importer/types.js';
import type { LossCode } from '../converter/types.js';
import type { SessionId } from '@deepseek-ai/dsh-session';
export interface BatchCapabilities { readonly planner: ImportPlanner; readonly importer: SessionImporter }
export interface BatchLimits {
  readonly maxEntries: number; readonly maxSelectionBytes: number;
  readonly maxPlanBytes: number; readonly maxResultBytes: number;
  /** At least 8192, the maximum finite single-import outcome budget accepted by this batch. */
  readonly maxItemResultBytes: number;
}
export interface BatchPlanOptions { readonly dryRun: true; readonly cache: 'skip' | 'refresh-if-available'; readonly signal?: AbortSignal }
export interface BatchEntryPlan {
  readonly index: number; readonly threadId: string; readonly sessionId: SessionId; readonly occurrences: number;
  readonly state: 'planned' | 'failed' | 'not-planned'; readonly error: string | null; readonly plan: ImportPlan | null;
}
export interface BatchPlan {
  readonly schemaVersion: 1; readonly dryRun: true; readonly cache: 'skip' | 'refresh-if-available';
  readonly state: 'planned' | 'partial' | 'cancelled' | 'empty';
  readonly inputCount: number; readonly duplicateCount: number; readonly entries: readonly BatchEntryPlan[];
  readonly planDigest: string;
}
export interface BatchItemApproval { readonly threadId: string; readonly planDigest: string; readonly acceptedLosses: readonly LossCode[] }
export interface BatchApplyOptions {
  readonly dryRun: boolean; readonly selectedThreadIds: readonly string[];
  readonly approval?: { readonly planDigest: string; readonly items: readonly BatchItemApproval[] };
  readonly signal?: AbortSignal;
}
export interface BatchEntryResult {
  readonly threadId: string; readonly sessionId: SessionId; readonly selected: boolean;
  readonly sourceFingerprint: string | null; readonly sourceCwd: string | null; readonly targetCwd: string | null;
  readonly plannedState: ImportPlanState | null;
  readonly state: ImportState | 'not-selected' | 'not-started' | 'planning-failed';
  readonly error: string | null; readonly invocationStarted: boolean; readonly outcomeMayHaveCommitted: boolean;
  readonly rebasedWorkspace: boolean; readonly originalPlanDigest: string | null; readonly effectivePlanDigest: string | null;
  readonly result: ImportResult | null;
}
export interface BatchResult {
  readonly schemaVersion: 1; readonly dryRun: boolean; readonly planDigest: string;
  readonly state: 'completed' | 'partial' | 'cancelled' | 'empty';
  readonly entries: readonly BatchEntryResult[];
  readonly summary: { readonly selected: number; readonly invoked: number; readonly completed: number; readonly alreadyImported: number;
    readonly dryRun: number; readonly blocked: number; readonly failed: number; readonly notStarted: number; readonly notSelected: number };
  readonly warnings: readonly string[];
}
