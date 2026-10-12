/** Public P2 values; no Harness runtime or Session schema is involved. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonRecord;
export interface JsonRecord { readonly [key: string]: JsonValue }
export type HistoryMethod = 'thread/list' | 'thread/read';
export type SourceKind = 'cli' | 'vscode' | 'exec' | 'appServer' | 'subAgent'
  | 'subAgentReview' | 'subAgentCompact' | 'subAgentThreadSpawn' | 'subAgentOther' | 'unknown';

/** All deployment limits are explicit, rather than hidden plugin defaults. */
export interface TransportOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly codexHome: string;
  readonly clientInfo: { readonly name: string; readonly title: string; readonly version: string };
  readonly limits: {
    readonly requestTimeoutMs: number;
    readonly shutdownTimeoutMs: number;
    readonly maxInFlight: number;
    readonly maxFrameBytes: number;
  };
}
export interface ReaderOptions extends TransportOptions {
  readonly readLimits: {
    readonly pageSize: number;
    readonly maxPages: number;
    readonly maxThreads: number;
    readonly maxItems: number;
    readonly maxJsonDepth: number;
  };
}
export interface ServerIdentity {
  readonly codexHome: string;
  readonly userAgent: string;
  readonly platformFamily: string;
  readonly platformOs: string;
}
export interface TransportObservation {
  readonly state: 'new' | 'connecting' | 'ready' | 'failed' | 'closed';
  readonly pid: number | null;
  readonly sent: { readonly initialize: number; readonly list: number; readonly read: number; readonly rejectedServerRequests: number };
  readonly exit: { readonly code: number | null; readonly signal: string | null; readonly forced: boolean } | null;
}
export interface ThreadMetadata {
  readonly id: string;
  readonly title: string | null;
  readonly preview: string;
  readonly cwd: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly status: 'notLoaded' | 'idle' | 'systemError' | 'active';
  readonly activeFlags: readonly string[];
  readonly ephemeral: boolean;
  readonly historyMode: 'legacy' | 'paginated';
  readonly modelProvider: string;
  readonly latestModel: string | null;
  readonly modelAttribution: 'thread-latest-only';
  readonly sourceKind: SourceKind;
  readonly originator: string | null;
  readonly cliVersion: string;
  readonly archived: boolean | null;
  /** list does not hydrate turns; absence is not a count of zero. */
  readonly counts: null;
}
export type PublicInput =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly url?: string; readonly fileId?: string }
  | { readonly type: 'localImage'; readonly path: string }
  | { readonly type: 'reference'; readonly inputType: 'skill' | 'mention'; readonly name: string; readonly path: string }
  | { readonly type: 'unsupported'; readonly inputType: string };
export type PublicItem =
  | { readonly type: 'userMessage'; readonly id: string; readonly content: readonly PublicInput[] }
  | { readonly type: 'agentMessage'; readonly id: string; readonly text: string; readonly phase: string | null }
  | { readonly type: 'reasoning'; readonly id: string; readonly summary: readonly string[] }
  | { readonly type: 'toolInformation'; readonly id: string; readonly toolType: string; readonly fields: JsonRecord }
  | { readonly type: 'unsupported'; readonly id: string; readonly originalType: string };
export interface PublicTurn {
  readonly id: string;
  readonly status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  readonly itemsView: 'full' | 'summary' | 'notLoaded';
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly durationMs: number | null;
  readonly hasError: boolean;
  readonly items: readonly PublicItem[];
}
export interface ThreadSnapshot {
  readonly thread: ThreadMetadata;
  readonly turns: readonly PublicTurn[];
  readonly history: 'full' | 'unsupported';
  readonly historyIssues: readonly string[];
  readonly compatibilityWarnings: readonly string[];
  readonly unsupportedTypes: readonly string[];
  readonly nonTextInputTypes: readonly string[];
  readonly perTurnModelAttribution: false;
  readonly hasInProgressTurn: boolean;
  readonly counts: { readonly turns: number; readonly items: number; readonly messages: number; readonly toolItems: number; readonly reasoningItems: number };
}
export interface ThreadPage { readonly data: readonly ThreadMetadata[]; readonly nextCursor: string | null }
export interface ScanOptions { readonly sourceKinds: readonly SourceKind[]; readonly archived: boolean }
export interface ParseLimits { readonly maxItems: number; readonly maxJsonDepth: number }
