/** Bounded browser wire values. No Node or Harness core runtime imports. */
export interface BridgeUiStatus {
  readonly schemaVersion: 1;
  readonly companionVersion: '0.0.3';
  readonly harnessVersion: '0.2.0-rc.2';
  readonly sourceState: 'not-configured' | 'configured' | 'invalid-config';
  readonly importEnabled: boolean;
  readonly capabilities: readonly { readonly name: string; readonly available: boolean }[];
}
export interface ThreadRow {
  readonly id: string; readonly title: string | null; readonly cwd: string;
  readonly createdAtMs: number; readonly updatedAtMs: number; readonly status: string;
  readonly counts: null;
}
export interface HistoryList { readonly rows: readonly ThreadRow[] }
export interface PublicMessage { readonly category: string; readonly text: string }
export interface HistoryPreview {
  readonly threadId: string; readonly turns: number; readonly messages: number; readonly tools: number;
  readonly messagesView: readonly PublicMessage[]; readonly truncated: boolean;
  readonly losses: readonly string[]; readonly warnings: readonly string[];
}
export interface ReviewSelection { readonly threadId: string; readonly remapCwd: string | null; readonly acceptedLosses: readonly string[] }
export interface ReviewRow {
  readonly threadId: string; readonly sessionId: string; readonly state: string;
  readonly targetCwd: string | null; readonly workspaceAction: string | null;
  readonly losses: readonly string[]; readonly blockers: readonly string[]; readonly warnings: readonly string[];
}
export interface HistoryReview {
  readonly handle: string; readonly digest: string; readonly expiresAtMs: number;
  readonly rows: readonly ReviewRow[];
}
export interface OutcomeRow {
  readonly threadId: string; readonly sessionId: string; readonly state: string;
  readonly verified: boolean; readonly mayHaveCommitted: boolean; readonly reason: string | null;
  readonly warnings: readonly string[];
}
export interface HistoryOutcome { readonly dryRun: boolean; readonly state: string; readonly rows: readonly OutcomeRow[] }
