/** Wire-boundary parsers project allowlisted public information before returning any history. */
import { z } from 'zod';
import { CodexReadError } from './errors.js';
import type { JsonRecord, JsonValue, ParseLimits, PublicInput, PublicItem, PublicTurn, SourceKind, ThreadMetadata, ThreadPage, ThreadSnapshot } from './types.js';

const identifier = z.string().min(1);
const seconds = z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000));
const optionalSeconds = seconds.nullable().optional();
const optionalText = z.string().nullable().optional();
const optionalInteger = z.number().int().nonnegative().nullable().optional();
const statusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notLoaded') }), z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('systemError') }),
  z.object({ type: z.literal('active'), activeFlags: z.array(z.string()) }),
]);
const metadataSchema = z.object({
  id: identifier, name: optionalText, preview: z.string(), cwd: identifier,
  createdAt: seconds, updatedAt: seconds, status: statusSchema, ephemeral: z.boolean(),
  historyMode: z.enum(['legacy', 'paginated']), modelProvider: identifier,
  model: optionalText, cliVersion: z.string(), originator: optionalText,
  source: z.union([z.string(), z.record(z.string(), z.unknown())]),
});
const headerSchema = z.object({ id: identifier, type: identifier });
const turnSchema = z.object({
  id: identifier, status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  itemsView: z.enum(['full', 'summary', 'notLoaded']), items: z.array(z.unknown()),
  startedAt: optionalSeconds, completedAt: optionalSeconds, durationMs: optionalInteger,
  error: z.unknown().optional(),
});
const SOURCES: readonly SourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'subAgent',
  'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const BLOCKED_KEYS = new Set(['reasoningcontent', 'rawreasoning', 'encryptedcontent', 'chainofthought']);

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CodexReadError('invalid-response');
  return result.data;
}
function milliseconds(value: number | null | undefined): number | null {
  return value === undefined || value === null ? null : value * 1000;
}
/** Protect free-form tool JSON as well as the dedicated reasoning item. */
function publicJson(value: unknown, limits: ParseLimits, depth = 0): JsonValue {
  if (depth > limits.maxJsonDepth) throw new CodexReadError('content-limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => publicJson(item, limits, depth + 1));
  if (typeof value !== 'object' || value === null) throw new CodexReadError('invalid-response');
  const record = value as Record<string, unknown>;
  if (record.type === 'reasoning') {
    return { type: 'reasoning', summary: decode(z.array(z.string()), record.summary ?? []) };
  }
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => !BLOCKED_KEYS.has(key.toLowerCase().replace(/[_-]/g, '')) && key.toLowerCase() !== '_meta')
    .map(([key, child]) => [key, publicJson(child, limits, depth + 1)]));
}
function publicFields(value: object, limits: ParseLimits): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, publicJson(child, limits)]));
}
function sourceKind(value: string | Record<string, unknown>): SourceKind {
  if (typeof value === 'string') return SOURCES.find(source => source === value) ?? 'unknown';
  if (Object.hasOwn(value, 'subAgent')) return 'subAgent';
  return 'unknown';
}
function metadata(value: unknown, archived: boolean | null): ThreadMetadata {
  const row = decode(metadataSchema, value);
  return {
    id: row.id, title: row.name ?? null, preview: row.preview, cwd: row.cwd,
    createdAtMs: row.createdAt * 1000, updatedAtMs: row.updatedAt * 1000,
    status: row.status.type, activeFlags: row.status.type === 'active' ? row.status.activeFlags : [],
    ephemeral: row.ephemeral, historyMode: row.historyMode, modelProvider: row.modelProvider,
    latestModel: row.model ?? null, modelAttribution: 'thread-latest-only',
    sourceKind: sourceKind(row.source), originator: row.originator ?? null, cliVersion: row.cliVersion,
    archived, counts: null,
  };
}
/** Decode metadata; the unhydrated turns array is deliberately never interpreted as a count. */
export function parseThreadPage(value: unknown, archived: boolean): ThreadPage {
  const page = decode(z.object({ data: z.array(z.unknown()), nextCursor: z.string().nullable() }), value);
  return { data: page.data.map(row => metadata(row, archived)), nextCursor: page.nextCursor };
}
function input(value: unknown): PublicInput {
  const item = decode(z.object({ type: identifier }), value);
  switch (item.type) {
    case 'text': {
      const row = decode(z.object({ text: z.string() }), value);
      return { type: 'text', text: row.text };
    }
    case 'image': {
      const row = decode(z.object({ url: z.string().optional(), fileId: z.string().optional() }), value);
      if (row.url === undefined && row.fileId === undefined) throw new CodexReadError('invalid-response');
      return { type: 'image', ...row.url === undefined ? {} : { url: row.url }, ...row.fileId === undefined ? {} : { fileId: row.fileId } };
    }
    case 'localImage': return { type: 'localImage', path: decode(z.object({ path: identifier }), value).path };
    case 'skill':
    case 'mention': {
      const row = decode(z.object({ name: z.string(), path: z.string() }), value);
      return { type: 'reference', inputType: item.type, name: row.name, path: row.path };
    }
    default: return { type: 'unsupported', inputType: item.type };
  }
}
/** Internal shared public-item projection; not exported by the package reader face. */
export function projectPublicItem(value: unknown, limits: ParseLimits): PublicItem {
  const header = decode(headerSchema, value);
  switch (header.type) {
    case 'userMessage': {
      const row = decode(z.object({ content: z.array(z.unknown()) }), value);
      return { type: 'userMessage', id: header.id, content: row.content.map(input) };
    }
    case 'agentMessage': {
      const row = decode(z.object({ text: z.string(), phase: optionalText }), value);
      return { type: 'agentMessage', id: header.id, text: row.text, phase: row.phase ?? null };
    }
    case 'reasoning': {
      // Raw content is neither accessed nor validated; only summary enters the public object.
      const row = decode(z.object({ summary: z.array(z.string()) }), value);
      return { type: 'reasoning', id: header.id, summary: row.summary };
    }
    default: break;
  }
  let fields: object;
  switch (header.type) {
    case 'commandExecution':
      fields = decode(z.object({ command: z.string(), cwd: z.string(), status: identifier,
        aggregatedOutput: optionalText, exitCode: z.number().int().nullable().optional(), durationMs: optionalInteger }), value);
      break;
    case 'fileChange':
      fields = decode(z.object({ status: identifier, changes: z.array(z.object({
        path: z.string(), kind: z.object({ type: identifier, move_path: optionalText }), diff: z.string(),
      })) }), value);
      break;
    case 'mcpToolCall':
      fields = decode(z.object({ server: z.string(), tool: z.string(), status: identifier, arguments: z.unknown(),
        result: z.object({ content: z.array(z.unknown()), structuredContent: z.unknown().optional() }).nullable().optional(),
        error: z.unknown().optional(), durationMs: optionalInteger }), value);
      break;
    case 'dynamicToolCall':
      fields = decode(z.object({ tool: z.string(), namespace: optionalText, arguments: z.unknown(), status: identifier,
        contentItems: z.array(z.unknown()).nullable().optional(), success: z.boolean().nullable().optional(),
        durationMs: optionalInteger }), value);
      break;
    case 'functionCallOutput':
      fields = decode(z.object({ name: z.string(), namespace: optionalText,
        output: z.union([z.string(), z.array(z.unknown())]) }), value);
      break;
    case 'plan': fields = decode(z.object({ text: z.string() }), value); break;
    case 'webSearch': fields = decode(z.object({ query: z.string(), action: z.unknown().optional() }), value); break;
    case 'imageView': fields = decode(z.object({ path: z.string() }), value); break;
    case 'enteredReviewMode':
    case 'exitedReviewMode': fields = decode(z.object({ review: z.string() }), value); break;
    case 'contextCompaction': fields = {}; break;
    default: return { type: 'unsupported', id: header.id, originalType: header.type };
  }
  return { type: 'toolInformation', id: header.id, toolType: header.type, fields: publicFields(fields, limits) };
}
/** Decode a hydrated public snapshot; never reconstruct or claim the original model-request state. */
export function parseThreadSnapshot(value: unknown, threadId: string, limits: ParseLimits): ThreadSnapshot {
  const envelope = decode(z.object({ thread: z.unknown() }), value);
  const thread = metadata(envelope.thread, null);
  if (thread.id !== threadId) throw new CodexReadError('identity-mismatch');
  const body = decode(z.object({ turns: z.array(turnSchema) }), envelope.thread);
  if (body.turns.reduce((count, turn) => count + turn.items.length, 0) > limits.maxItems) throw new CodexReadError('content-limit');
  const turnIds = new Set<string>();
  const turns: PublicTurn[] = body.turns.map(turn => {
    if (turnIds.has(turn.id)) throw new CodexReadError('invalid-response');
    turnIds.add(turn.id);
    const itemIds = new Set<string>();
    const items = turn.items.map(value => {
      const decoded = projectPublicItem(value, limits);
      if (itemIds.has(decoded.id)) throw new CodexReadError('invalid-response');
      itemIds.add(decoded.id);
      return decoded;
    });
    return { id: turn.id, status: turn.status, itemsView: turn.itemsView,
      startedAtMs: milliseconds(turn.startedAt), completedAtMs: milliseconds(turn.completedAt),
      durationMs: turn.durationMs ?? null, hasError: turn.error !== undefined && turn.error !== null, items };
  });
  const all = turns.flatMap(turn => turn.items);
  const historyIssues = [
    ...turns.some(turn => turn.itemsView !== 'full') ? ['items-not-full'] : [],
    ...thread.ephemeral ? ['ephemeral-thread'] : [],
  ];
  const nonTextInputTypes = all.flatMap(item => item.type !== 'userMessage' ? [] :
    item.content.flatMap(input => input.type === 'text' ? [] : [input.type === 'unsupported' || input.type === 'reference' ? input.inputType : input.type]));
  return { thread, turns, history: historyIssues.length === 0 ? 'full' : 'unsupported', historyIssues,
    compatibilityWarnings: thread.historyMode === 'paginated' ? ['paginated-full-read-deprecated'] : [],
    unsupportedTypes: [...new Set(all.flatMap(item => item.type === 'unsupported' ? [item.originalType] : []))],
    nonTextInputTypes: [...new Set(nonTextInputTypes)], perTurnModelAttribution: false,
    hasInProgressTurn: turns.some(turn => turn.status === 'inProgress'),
    counts: { turns: turns.length, items: all.length,
      messages: all.filter(item => item.type === 'userMessage' || item.type === 'agentMessage').length,
      toolItems: all.filter(item => item.type === 'toolInformation').length,
      reasoningItems: all.filter(item => item.type === 'reasoning').length } };
}
