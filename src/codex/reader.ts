/** Independent P2 reader: no Host construction, storage or migration operations. */
import { z } from 'zod';
import { CodexReadError } from './errors.js';
import { parseHistoryPage, parseReadMetadata, parseThreadPage, parseThreadSnapshot, turnSchema } from './parse.js';
import { ReadOnlyStdioClient } from './transport.js';
import type { ReaderOptions, ScanOptions, ServerIdentity, SourceKind, ThreadMetadata, ThreadSnapshot, TransportObservation } from './types.js';

const sourceKindSchema = z.enum(['cli', 'vscode', 'exec', 'appServer', 'subAgent',
  'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']);
const readLimitsSchema = z.object({
  pageSize: z.number().int().positive(), maxPages: z.number().int().positive(),
  maxThreads: z.number().int().positive(), maxItems: z.number().int().positive(),
  maxJsonDepth: z.number().int().min(1).max(128),
});
const itemEntrySchema = z.object({ turnId: z.string(), item: z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough() });

/** Importing or constructing this class does not launch Codex. */
export class CodexHistoryReader {
  readonly #client: ReadOnlyStdioClient;
  readonly #limits: z.infer<typeof readLimitsSchema>;
  constructor(options: ReaderOptions) {
    const limits = readLimitsSchema.safeParse(options?.readLimits);
    if (!limits.success) throw new CodexReadError('invalid-config');
    this.#limits = limits.data;
    this.#client = new ReadOnlyStdioClient(options);
  }
  /** Establish a stable-surface handshake lazily, without creating/resuming a thread. */
  connect(): Promise<ServerIdentity> { return this.#client.connect(); }

  /** Scan one archive state with explicit source filters and bounded cursor pagination. */
  async list(options: ScanOptions, signal?: AbortSignal): Promise<readonly ThreadMetadata[]> {
    const checked = z.object({ sourceKinds: z.array(sourceKindSchema).min(1), archived: z.boolean() }).safeParse(options);
    if (!checked.success) throw new CodexReadError('invalid-config');
    const sourceKinds: SourceKind[] = [...new Set(checked.data.sourceKinds)];
    const rows = new Map<string, ThreadMetadata>();
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pages = 0; pages < this.#limits.maxPages; pages++) {
      const page = parseThreadPage(await this.#client.request('thread/list', {
        sourceKinds, archived: checked.data.archived, useStateDbOnly: true,
        sortKey: 'created_at', sortDirection: 'desc', limit: this.#limits.pageSize,
        ...cursor === undefined ? {} : { cursor },
      }, signal), checked.data.archived);
      for (const row of page.data) {
        if (!rows.has(row.id)) rows.set(row.id, row);
        if (rows.size > this.#limits.maxThreads) throw new CodexReadError('scan-limit');
      }
      if (page.nextCursor === null) return [...rows.values()];
      if (seen.has(page.nextCursor)) throw new CodexReadError('cursor-cycle');
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new CodexReadError('scan-limit');
  }
  /** Hydrate stored history without resuming; public projection drops raw reasoning and unstable paths. */
  async read(threadId: string, signal?: AbortSignal): Promise<ThreadSnapshot> {
    if (!z.string().min(1).safeParse(threadId).success) throw new CodexReadError('invalid-config');
    const envelope = await this.#client.request('thread/read', { threadId, includeTurns: false }, signal);
    const before = parseReadMetadata(envelope, threadId);
    const useItemPages = before.historyMode === 'paginated';
    let rows: unknown[];
    try {
      rows = await this.#historyPages('thread/turns/list', {
        threadId, itemsView: useItemPages ? 'notLoaded' : 'full',
      }, this.#limits.maxItems, signal);
    } catch (error) {
      if (!(error instanceof CodexReadError && error.code === 'rpc-failed' && error.rpcCode === -32601)) throw error;
      // Older servers can still supply a single complete response. Never try
      // this path after partial, timed-out, or otherwise invalid pagination.
      return parseThreadSnapshot(await this.#client.request('thread/read', { threadId, includeTurns: true }, signal),
        threadId, this.#limits);
    }

    const turnIds = new Set<string>();
    const turns: z.infer<typeof turnSchema>[] = [];
    let remaining = this.#limits.maxItems;
    for (const row of rows) {
      const parsed = turnSchema.safeParse(row);
      if (!parsed.success || turnIds.has(parsed.data.id)) throw new CodexReadError('invalid-response');
      const turn = parsed.data;
      turnIds.add(turn.id);
      if (useItemPages) {
        if (turn.itemsView !== 'notLoaded' || turn.items.length !== 0) throw new CodexReadError('invalid-response');
        const entries = await this.#historyPages('thread/items/list', { threadId, turnId: turn.id }, remaining, signal);
        turn.items = entries.map(entry => {
          const item = itemEntrySchema.safeParse(entry);
          if (!item.success || item.data.turnId !== turn.id) throw new CodexReadError('identity-mismatch');
          return item.data.item;
        });
        turn.itemsView = 'full';
      }
      remaining -= turn.items.length;
      if (remaining < 0) throw new CodexReadError('content-limit');
      turns.push(turn);
    }
    const after = parseReadMetadata(await this.#client.request('thread/read', { threadId, includeTurns: false }, signal), threadId);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new CodexReadError('source-changed');
    return parseThreadSnapshot(envelope, threadId, this.#limits, turns);
  }
  async #historyPages(method: 'thread/turns/list' | 'thread/items/list', params: Record<string, unknown>,
    limit: number, signal?: AbortSignal): Promise<unknown[]> {
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let index = 0; index < this.#limits.maxPages; index++) {
      let result: unknown;
      try {
        result = await this.#client.request(method, {
          ...params, sortDirection: 'asc', limit: Math.min(this.#limits.pageSize, Math.max(1, limit - rows.length)),
          ...cursor === undefined ? {} : { cursor },
        }, signal);
      } catch (error) {
        if (index > 0 && error instanceof CodexReadError && error.rpcCode === -32601) throw new CodexReadError('invalid-response');
        throw error;
      }
      const page = parseHistoryPage(result);
      if (page.data.length > limit - rows.length) throw new CodexReadError('content-limit');
      for (const row of page.data) rows.push(row);
      if (page.nextCursor == null) return rows;
      if (seen.has(page.nextCursor)) throw new CodexReadError('cursor-cycle');
      if (page.data.length === 0) throw new CodexReadError('invalid-response');
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new CodexReadError('scan-limit');
  }
  /** Metadata/limits diagnostics only; does not reveal any history payload. */
  inspect(): TransportObservation { return this.#client.inspect(); }
  /** Await child closure; call in finally, including when a read fails. */
  close(): Promise<void> { return this.#client.close(); }
}
