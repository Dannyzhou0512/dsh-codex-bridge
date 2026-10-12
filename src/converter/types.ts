/** P4 plans are immutable values; no writer, Context, Workspace or Codex connection is owned here. */
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import type { ThreadMetadata } from '../codex/types.js';

export type LossCode = 'assistant-role-recall' | 'tool-information-recall' | 'reasoning-summary-recall'
  | 'non-text-input-omitted' | 'unknown-item-omitted' | 'context-compaction-unrestored' | 'tool-output-unavailable';
export type ConversionCategory = 'user' | 'assistant' | 'tool-information' | 'reasoning-summary' | 'compaction' | 'unknown-item';
export interface ConversionOptions {
  readonly mode: 'strict' | 'recall';
  /** Explicit consent applies only to a proposed conversion, never to a write operation. */
  readonly acceptedLosses: readonly LossCode[];
  readonly target: { readonly selectedCwd: string | null; readonly pathStyle: 'windows' | 'posix' };
  readonly titleMode: 'pin' | 'omit';
  readonly limits: {
    readonly maxInputBytes: number; readonly maxResultBytes: number; readonly maxEvents: number;
    readonly maxTextBytes: number; readonly maxToolDepth: number; readonly titleMaxBytes: number;
  };
}
export interface ConversionWarning {
  readonly code: string;
  readonly turnId?: string;
  readonly itemId?: string;
}
export interface PreviewMessage {
  readonly turnId: string; readonly itemId: string; readonly messageId: string;
  readonly category: ConversionCategory; readonly proposedRole: 'user';
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
}
export interface TurnReceipt {
  readonly codexTurnId: string; readonly dshTurn: number; readonly status: string;
  readonly startedAtMs: number | null; readonly completedAtMs: number | null;
  readonly durationMs: number | null; readonly hasError: boolean;
  readonly itemTimeBasis: 'turn-start' | 'thread-created';
  readonly items: readonly { readonly itemId: string; readonly type: string; readonly messageId: string | null }[];
}
export interface ImportReceipt {
  readonly schemaVersion: 1;
  readonly converterVersion: 1;
  readonly sourceThreadId: string;
  readonly originalCwd: string;
  readonly originalTitle: string | null;
  readonly sourceStatus: ThreadMetadata['status'];
  readonly sourceKind: ThreadMetadata['sourceKind'];
  readonly originator: string | null;
  readonly sourceCliVersion: string;
  readonly historyMode: ThreadMetadata['historyMode'];
  readonly modelProvider: string;
  /** Thread-level audit only, never used as historical assistant attribution. */
  readonly threadLatestModel: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly sourceFingerprint: string;
  /** Digest of header + complete prefix preceding this receipt; excludes its own envelope. */
  readonly prefixDigest: string;
  readonly mode: 'strict' | 'recall';
  readonly acceptedLosses: readonly LossCode[];
  readonly requiredLosses: readonly LossCode[];
  readonly perItemModelAttribution: false;
  readonly targetPathStyle: 'windows' | 'posix';
  readonly turns: readonly TurnReceipt[];
}
export interface ConversionPlan {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  readonly sourceFingerprint: string;
  readonly prefixDigest: string;
  readonly planDigest: string;
}
export interface ConversionResult {
  readonly schemaVersion: 1;
  readonly state: 'ready' | 'needs-review' | 'needs-remap' | 'unsupported';
  readonly sessionId: SessionId;
  readonly source: Pick<ThreadMetadata, 'id' | 'title' | 'cwd' | 'createdAtMs' | 'updatedAtMs' | 'status' | 'sourceKind'>;
  readonly sourceFingerprint: string;
  readonly mode: 'strict' | 'recall';
  readonly warnings: readonly ConversionWarning[];
  readonly requiredLosses: readonly LossCode[];
  readonly blockers: readonly string[];
  /** Proposed public messages remain inspectable even when consent or mapping is missing. */
  readonly preview: readonly PreviewMessage[];
  readonly statistics: { readonly turns: number; readonly items: number; readonly proposedMessages: number; readonly generatedEvents: number };
  /** A blocked result never offers persistable header/events. */
  readonly plan: ConversionPlan | null;
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Public Codex material represented as native user-role historical context. */
    'codex-history': {
      readonly kind: 'codex-history'; readonly form: 'recall';
      readonly threadId: string; readonly turnId: string; readonly itemId: string;
      readonly category: ConversionCategory;
      readonly originalRole: 'assistant' | 'information';
    };
  }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only import receipt. Writers must mark the envelope ignorable:true. */
    'codex-bridge/import-receipt': ImportReceipt;
  }
}
