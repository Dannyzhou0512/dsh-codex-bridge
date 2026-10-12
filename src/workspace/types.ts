/** P5 values describe filesystem observations; only explicit resolve/attach may call public mutators. */
import type { Workspace, WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
export type PathStyle = 'windows' | 'posix';
export type PathSyntax = 'qualified' | 'unqualified' | 'foreign-platform' | 'uri' | 'device-path' | 'invalid' | 'over-limit';
export type PathState = Exclude<PathSyntax, 'qualified'> | 'directory' | 'missing' | 'not-directory' | 'inaccessible' | 'io-error' | 'uninspected';
export interface DirectoryIdentity { readonly device: string; readonly inode: string; readonly birthTimeNs: string }
export interface PathAnalysis {
  readonly input: string | null; readonly state: PathState;
  readonly canonicalPath: string | null; readonly identity: DirectoryIdentity | null;
  /** Final input segment is a symlink/junction; parent links may also be resolved by realpath. */
  readonly isLink: boolean;
}
export interface WorkspaceDescriptor { readonly id: WorkspaceId; readonly path: string; readonly title: string }
export interface MappingRequest { readonly originalCwd: string | null; readonly remapCwd?: string }
export interface MappingOptions { readonly maxPathBytes: number; readonly maxPlanBytes: number; readonly maxWorkspaces: number }
export interface MappingCapabilities {
  readonly registry?: Pick<WorkspaceRegistry, 'list' | 'create'>;
  readonly persistence?: Pick<SessionPersistence, 'stat'>;
}
export interface WorkspaceMappingPlan {
  readonly schemaVersion: 1; readonly pathStyle: PathStyle;
  readonly request: { readonly originalCwd: string | null; readonly remapCwd: string | null };
  readonly status: 'ready' | 'needs-remap' | 'capability-unavailable';
  readonly original: PathAnalysis; readonly target: PathAnalysis;
  readonly canonicalCwd: string | null;
  readonly action: 'reuse' | 'create' | null;
  readonly workspace: WorkspaceDescriptor | null;
  readonly warnings: readonly string[];
  readonly fingerprint: string;
}
export interface MappingOperationOptions { readonly dryRun: boolean; readonly signal?: AbortSignal }
export interface MappingOperationResult {
  readonly status: 'dry-run' | 'resolved' | 'attached' | 'already-attached' | 'blocked' | 'stale-plan' | 'cancelled' | 'failed';
  readonly reason: string | null; readonly canonicalCwd: string | null;
  readonly workspace: WorkspaceDescriptor | null;
  /** Invocation facts, not a promise that a failing mutator committed nothing. */
  readonly effects: { readonly createInvoked: boolean; readonly attachInvoked: boolean };
  readonly warnings: readonly string[];
}
export type WorkspaceView = Workspace;
