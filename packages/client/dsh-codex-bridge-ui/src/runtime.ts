/** Host-only orchestration over the unchanged 0.0.9 public faces. */
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionStore } from '@deepseek-ai/dsh-session';
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace';
import { CodexHistoryReader } from 'dsh-codex-bridge/codex';
import { convertSnapshot, type LossCode } from 'dsh-codex-bridge/converter';
import { WorkspaceMapper } from 'dsh-codex-bridge/workspace';
import { ImportPlanner } from 'dsh-codex-bridge/planner';
import { SessionImporter } from 'dsh-codex-bridge/importer';
import { BatchImporter, type BatchPlan } from 'dsh-codex-bridge/batch';
import { z } from 'zod';
import type { UiHostConfig } from './config.js';
import type { HistoryList, HistoryPreview, HistoryReview, HistoryOutcome, ReviewSelection } from './shared.js';
const loss = z.enum(['assistant-role-recall','tool-information-recall','reasoning-summary-recall','non-text-input-omitted','unknown-item-omitted','context-compaction-unrestored','tool-output-unavailable']);
const selection = z.array(z.object({ threadId: z.string().min(1).max(256), remapCwd: z.string().min(1).max(8192).nullable(), acceptedLosses: z.array(loss).max(7) }).strict()).min(1).max(20);
const conversion = { mode: 'recall' as const, titleMode: 'pin' as const, limits: { maxInputBytes: 8000000, maxResultBytes: 8000000, maxEvents: 20000, maxTextBytes: 1000000, maxToolDepth: 32, titleMaxBytes: 512 } };
interface StoredReview { readonly plan: BatchPlan; readonly view: HistoryReview; dryChecked: boolean }
export class HistoryRuntime {
  #reader: CodexHistoryReader;
  readonly #planner: ImportPlanner;
  readonly #batch: BatchImporter;
  readonly #reviews = new Map<string, StoredReview>();
  readonly #abort = new AbortController();
  #pending: Promise<unknown> | null = null;
  #closed = false;
  readonly #assertCapabilities: () => void;
  constructor(ctx: Context, private readonly config: UiHostConfig) {
    this.#reader = new CodexHistoryReader(config.reader);
    const persistence = ctx.get('sessionPersistence') as unknown as SessionPersistence | undefined;
    const registry = ctx.get('workspaceRegistry') as unknown as WorkspaceRegistry | undefined;
    const sessions = ctx.get('sessions') as unknown as SessionStore | undefined;
    const liveSession = sessions ? (id: string) => sessions.get(id as Parameters<SessionStore['get']>[0]) !== undefined : undefined;
    const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 1000000, maxWorkspaces: 10000 });
    this.#planner = new ImportPlanner({ source: { read: (id, signal) => this.#reader.read(id, signal) }, persistence, mapper, liveSession },
      { maxTargetEvents: 40000, maxTargetBytes: 16000000, readChunkEvents: 256, maxPlanBytes: 16000000 });
    const importer = new SessionImporter({ planner: this.#planner, persistence, mapper, liveSession },
      { maxReadEvents: 40000, maxReadBytes: 16000000, readChunkEvents: 256, maxResultBytes: 8192 });
    this.#batch = new BatchImporter({ planner: this.#planner, importer },
      { maxEntries: 20, maxSelectionBytes: 200000, maxPlanBytes: 32000000, maxResultBytes: 1000000, maxItemResultBytes: 8192 });
    this.#assertCapabilities = () => {
      if (!persistence || !registry || !sessions || (ctx.get('sessionPersistence') as unknown as SessionPersistence | undefined)?.identity !== persistence.identity || !ctx.get('workspaceRegistry') || !ctx.get('sessions')) throw Error('capability-unavailable');
    };
  }
  async #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw Error('service-unavailable');
    if (this.#pending) throw Error('operation-busy');
    const task = Promise.resolve().then(operation); this.#pending = task;
    try { return await task; } catch (error) {
      // Never put raw Codex stderr, backend errors or history into Gateway failures.
      const allowed = new Set(['capability-unavailable','invalid-selection','review-expired','review-mismatch','dry-run-required','write-disabled','content-limit']);
      throw Error(error instanceof Error && allowed.has(error.message) ? error.message : 'operation-failed');
    } finally {
      // A failed transport is terminal. Release it, revoke old reviews and permit only
      // the next explicit user action to start a fresh read-only process. Never replay writes.
      try {
        if (!this.#closed && this.#reader.inspect().state === 'failed') {
          this.#reviews.clear();
          try { await this.#reader.close(); }
          catch { this.#closed = true; }
          if (!this.#closed) this.#reader = new CodexHistoryReader(this.config.reader);
        }
      } finally { this.#pending = null; }
    }
  }
  list(archived: boolean): Promise<HistoryList> {
    return this.#run(async () => {
      const rows = await this.#reader.list({ sourceKinds: ['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'], archived }, this.#abort.signal);
      const view = { rows: rows.map(row => ({ id: row.id, title: row.title, cwd: row.cwd, createdAtMs: row.createdAtMs, updatedAtMs: row.updatedAtMs, status: row.status, counts: null })) };
      if (Buffer.byteLength(JSON.stringify(view)) > 1000000) throw Error('content-limit');
      return view;
    });
  }
  preview(threadId: string): Promise<HistoryPreview> {
    return this.#run(async () => {
      if (!threadId || threadId.length > 256) throw Error('invalid-selection');
      const source = await this.#reader.read(threadId, this.#abort.signal);
      const value = convertSnapshot(source, { ...conversion, acceptedLosses: [], target: { selectedCwd: null, pathStyle: process.platform === 'win32' ? 'windows' : 'posix' } });
      let remaining = 128000, truncated = value.preview.length > 100;
      const messagesView = value.preview.slice(0,100).map(row => {
        const text = row.content.map(part => part.text).join('\n'); const shown = text.slice(0,Math.min(16000,remaining));
        remaining -= shown.length; truncated ||= shown.length !== text.length;
        return { category: row.category, text: shown };
      });
      return { threadId, turns: source.counts.turns, messages: source.counts.messages, tools: source.counts.toolItems, messagesView, truncated,
        losses: value.requiredLosses, warnings: [...value.blockers,...value.warnings.map(w => w.code)] };
    });
  }
  review(selections: readonly ReviewSelection[]): Promise<HistoryReview> {
    return this.#run(async () => {
      this.#assertCapabilities();
      const checked = selection.safeParse(selections); if (!checked.success) throw Error('invalid-selection');
      for (const [handle, stored] of this.#reviews) if (stored.view.expiresAtMs <= Date.now()) this.#reviews.delete(handle);
      // Invalidate the caller's old plan rather than let editing approvals silently reuse it.
      if (this.#reviews.size >= 8) this.#reviews.delete(this.#reviews.keys().next().value!);
      const plan = await this.#batch.plan(checked.data.map(row => ({ threadId: row.threadId,
        ...row.remapCwd === null ? {} : { remapCwd: row.remapCwd }, conversion: { ...conversion, acceptedLosses: row.acceptedLosses as LossCode[] } })),
        { dryRun: true, cache: 'skip', signal: this.#abort.signal });
      const view: HistoryReview = { handle: randomUUID(), digest: plan.planDigest, expiresAtMs: Date.now()+600000,
        rows: plan.entries.map(entry => ({ threadId: entry.threadId, sessionId: entry.sessionId, state: entry.plan?.state ?? entry.state,
          targetCwd: entry.plan?.workspace?.canonicalCwd ?? null, workspaceAction: entry.plan?.workspace?.action ?? null,
          losses: entry.plan?.conversion.requiredLosses ?? [], blockers: entry.plan?.blockers ?? [entry.error ?? 'planning-failed'], warnings: entry.plan?.warnings ?? [] })) };
      this.#reviews.set(view.handle, { plan, view, dryChecked: false }); return view;
    });
  }
  execute(handle: string, digest: string, dryRun: boolean): Promise<HistoryOutcome> {
    return this.#run(async () => {
      this.#assertCapabilities();
      const stored = this.#reviews.get(handle);
      if (!stored || stored.view.expiresAtMs <= Date.now()) { this.#reviews.delete(handle); throw Error('review-expired'); }
      if (stored.view.digest !== digest) throw Error('review-mismatch');
      if (!dryRun && !this.config.writeEnabled) throw Error('write-disabled');
      if (!dryRun && !stored.dryChecked) throw Error('dry-run-required');
      if (!dryRun) this.#reviews.delete(handle); // Consume before any possible write, including response loss.
      const result = await this.#batch.apply(stored.plan, { dryRun, signal: this.#abort.signal,
        selectedThreadIds: stored.plan.entries.map(entry => entry.threadId),
        ...dryRun ? {} : { approval: { planDigest: stored.plan.planDigest, items: stored.plan.entries.flatMap(entry => entry.plan ? [{ threadId: entry.threadId, planDigest: entry.plan.planDigest, acceptedLosses: entry.plan.request.conversion.acceptedLosses }] : []) } } });
      stored.dryChecked = dryRun && result.entries.length > 0 && result.entries.every(entry => entry.state === 'dry-run');
      return { dryRun, state: result.state, rows: result.entries.map(entry => ({ threadId: entry.threadId, sessionId: entry.sessionId, state: entry.state,
        verified: entry.result?.sessionVerified ?? false, mayHaveCommitted: entry.outcomeMayHaveCommitted,
        reason: entry.result?.reason ?? entry.error, warnings: entry.result?.warnings ?? [] })) };
    });
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true; this.#abort.abort(); this.#reviews.clear();
    try { await this.#pending; } catch { /* Original caller gets the finite failure. */ }
    await this.#reader.close();
  }
}
