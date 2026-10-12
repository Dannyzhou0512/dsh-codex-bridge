/** Independent P2 reader: no Host construction, storage or migration operations. */
import { z } from 'zod';
import { CodexReadError } from './errors.js';
import { parseThreadPage, parseThreadSnapshot } from './parse.js';
import { ReadOnlyStdioClient } from './transport.js';
import type { ReaderOptions, ScanOptions, ServerIdentity, SourceKind, ThreadMetadata, ThreadSnapshot, TransportObservation } from './types.js';

const sourceKindSchema = z.enum(['cli', 'vscode', 'exec', 'appServer', 'subAgent',
  'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']);
const readLimitsSchema = z.object({
  pageSize: z.number().int().positive(), maxPages: z.number().int().positive(),
  maxThreads: z.number().int().positive(), maxItems: z.number().int().positive(),
  maxJsonDepth: z.number().int().min(1).max(128),
});

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
    return parseThreadSnapshot(await this.#client.request('thread/read', { threadId, includeTurns: true }, signal),
      threadId, this.#limits);
  }
  /** Metadata/limits diagnostics only; does not reveal any history payload. */
  inspect(): TransportObservation { return this.#client.inspect(); }
  /** Await child closure; call in finally, including when a read fails. */
  close(): Promise<void> { return this.#client.close(); }
}
