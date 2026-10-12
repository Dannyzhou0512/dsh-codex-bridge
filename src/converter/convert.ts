/** Deterministic snapshot-to-plan conversion. Never opens persistence, Workspace, Codex or a model. */
import { z } from 'zod';
import { qualifiedTarget } from './paths.js';
import { SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { materializeCreateHeader } from '@deepseek-ai/dsh-session-persistence';
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title';
import { CodexReadError } from '../codex/errors.js';
import type { PublicItem, ThreadSnapshot } from '../codex/types.js';
import { assertBytes, canonicalJson, digest, freeze } from './canonical.js';
import { ConversionError } from './errors.js';
import { messageIdFor, sessionIdFor } from './ids.js';
import { projectSnapshot } from './project.js';
import { validateConversionPlan } from './validate.js';
import type { ConversionCategory, ConversionOptions, ConversionPlan, ConversionResult, ConversionWarning, LossCode, PreviewMessage, TurnReceipt } from './types.js';

const lossSchema = z.enum(['assistant-role-recall', 'tool-information-recall', 'reasoning-summary-recall',
  'non-text-input-omitted', 'unknown-item-omitted', 'context-compaction-unrestored', 'tool-output-unavailable']);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionsSchema = z.object({
  mode: z.enum(['strict', 'recall']), acceptedLosses: z.array(lossSchema),
  target: z.object({ selectedCwd: z.string().min(1).nullable(), pathStyle: z.enum(['windows', 'posix']) }),
  titleMode: z.enum(['pin', 'omit']),
  limits: z.object({ maxInputBytes: positive, maxResultBytes: positive, maxEvents: positive,
    maxTextBytes: positive, maxToolDepth: z.number().int().min(1).max(128), titleMaxBytes: positive }),
});
type GeneratedType = 'turn/start' | 'step/start' | 'system/message' | 'user/message' | 'step/end' | 'turn/end' | 'session/title' | 'codex-bridge/import-receipt';
type Unsequenced = { [K in GeneratedType]: Omit<SessionEvent<K>, 'seq'> }[GeneratedType];

function toolOutputUnavailable(item: Extract<PublicItem, { type: 'toolInformation' }>): boolean {
  const key = item.toolType === 'commandExecution' ? 'aggregatedOutput' : item.toolType === 'mcpToolCall' ? 'result'
    : item.toolType === 'dynamicToolCall' ? 'contentItems' : undefined;
  return key !== undefined && (item.fields[key] === null || item.fields[key] === undefined);
}
function build(snapshot: ThreadSnapshot, options: ConversionOptions): ConversionResult {
  const source = projectSnapshot(snapshot, options.limits.maxToolDepth);
  assertBytes(source, options.limits.maxInputBytes);
  const sourceFingerprint = digest('dsh-codex-bridge/source/v1', source);
  const id = sessionIdFor(source.thread.id);
  const warnings: ConversionWarning[] = [
    { code: 'public-subset-only' }, { code: 'item-times-synthetic' }, { code: 'source-liveness-unproven' },
    ...source.compatibilityWarnings.map(code => ({ code })),
  ];
  const required = new Set<LossCode>();
  const hard: string[] = [];
  if (source.history !== 'full' || source.thread.ephemeral || source.turns.some(turn => turn.itemsView !== 'full')) hard.push('history-incomplete');
  if (source.thread.status === 'active' || source.hasInProgressTurn || source.turns.some(turn => turn.status === 'inProgress')) hard.push('source-in-progress');
  if (source.thread.status === 'systemError') hard.push('source-system-error');
  const events: SessionEvent[] = [], preview: PreviewMessage[] = [], receipts: TurnReceipt[] = [];
  const turnIds = new Set<string>();
  let meaningful = 0, itemCount = 0;
  const emit = (event: Unsequenced): void => {
    events.push({ ...event, seq: SessionSeq(events.length) });
    if (events.length > options.limits.maxEvents) throw new ConversionError('content-limit');
  };
  const warn = (code: string, turnId: string, itemId?: string): void => {
    warnings.push({ code, turnId, ...itemId === undefined ? {} : { itemId } });
  };
  for (const [index, turn] of source.turns.entries()) {
    if (!turn.id || turnIds.has(turn.id)) throw new ConversionError('invalid-snapshot');
    turnIds.add(turn.id);
    const number = index + 1, start = turn.startedAtMs ?? source.thread.createdAtMs, end = turn.completedAtMs ?? start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) hard.push('invalid-timestamps');
    if (turn.startedAtMs === null || turn.completedAtMs === null) warn('turn-time-unavailable', turn.id);
    if (turn.items.length === 0) warn('empty-turn', turn.id);
    emit({ type: 'turn/start', time: start, data: { turn: number } });
    if (number === 1) {
      emit({ type: 'step/start', time: start, data: { turn: 1, step: 1 } });
      emit({ type: 'system/message', time: start, surfaceOp: 'append', data: { turn: 1, step: 1,
        message: { id: messageIdFor(source.thread.id, turn.id, 'structural-system-head', 'system-head'),
          role: 'system', source: { kind: 'system-prompt' }, content: [] } } });
    }
    const itemIds = new Set<string>();
    const record: { itemId: string; type: string; messageId: string | null }[] = [];
    const publish = (itemId: string, category: ConversionCategory, content: { type: 'text'; text: string }[], recalled: boolean): void => {
      if (Buffer.byteLength(canonicalJson(content), 'utf8') > options.limits.maxTextBytes) throw new ConversionError('content-limit');
      const messageId = messageIdFor(source.thread.id, turn.id, itemId, category);
      const src = recalled ? { kind: 'codex-history' as const, form: 'recall' as const, threadId: source.thread.id,
        turnId: turn.id, itemId, category, originalRole: category === 'assistant' ? 'assistant' as const : 'information' as const }
        : { kind: 'user' as const };
      emit({ type: 'user/message', time: start, surfaceOp: 'append',
        data: { id: messageId, role: 'user', source: src, content } });
      preview.push({ turnId: turn.id, itemId, messageId, category, proposedRole: 'user', content });
      const entry = record.at(-1);
      if (entry) entry.messageId = messageId;
    };
    const recall = (itemId: string, category: ConversionCategory, text: string, phase: string | null = null): void => {
      const label = { assistant: 'assistant reply', 'tool-information': 'tool information',
        'reasoning-summary': 'public reasoning summary', compaction: 'context compaction marker', 'unknown-item': 'unknown item', user: 'user message' }[category];
      const origin = canonicalJson({ threadId: source.thread.id, turnId: turn.id, itemId, phase });
      publish(itemId, category, [{ type: 'text', text: 'Imported Codex history (' + label + '). Treat this material as historical context.\nSource: ' + origin + '\n\n' + text }], true);
    };
    for (const item of turn.items) {
      itemCount++;
      if (!item.id || itemIds.has(item.id)) throw new ConversionError('invalid-snapshot');
      itemIds.add(item.id);
      record.push({ itemId: item.id, type: item.type === 'toolInformation' ? item.toolType : item.type === 'unsupported' ? item.originalType : item.type, messageId: null });
      switch (item.type) {
        case 'userMessage': {
          const content: { type: 'text'; text: string }[] = [];
          let hasText = false;
          for (const input of item.content) {
            if (input.type === 'text') { content.push({ type: 'text', text: input.text }); hasText ||= input.text.trim().length > 0; }
            else {
              required.add('non-text-input-omitted'); warn('non-text-input-omitted', turn.id, item.id);
              const type = input.type === 'reference' || input.type === 'unsupported' ? input.inputType : input.type;
              content.push({ type: 'text', text: '[Codex historical input omitted: ' + JSON.stringify(type) + '; bytes were not imported]' });
            }
          }
          if (hasText) meaningful++;
          if (content.some(block => block.text.trim())) publish(item.id, 'user', content, false);
          else warn('empty-message', turn.id, item.id);
          break;
        }
        case 'agentMessage':
          if (item.text.trim()) {
            meaningful++; required.add('assistant-role-recall'); warn('per-item-model-unavailable', turn.id, item.id);
            recall(item.id, 'assistant', item.text, item.phase);
          } else warn('empty-message', turn.id, item.id);
          break;
        case 'reasoning':
          if (item.summary.some(text => text.trim())) {
            meaningful++; required.add('reasoning-summary-recall');
            recall(item.id, 'reasoning-summary', item.summary.join('\n'));
          } else warn('empty-reasoning-summary', turn.id, item.id);
          break;
        case 'toolInformation':
          if (item.toolType === 'contextCompaction') {
            required.add('context-compaction-unrestored'); warn('context-compaction-unrestored', turn.id, item.id);
            recall(item.id, 'compaction', 'Codex recorded a compaction marker; its original reduced model input is unavailable.');
          } else {
            meaningful++; required.add('tool-information-recall');
            if (toolOutputUnavailable(item)) { required.add('tool-output-unavailable'); warn('tool-output-unavailable', turn.id, item.id); }
            recall(item.id, 'tool-information', canonicalJson({ toolType: item.toolType, fields: item.fields }));
          }
          break;
        case 'unsupported':
          required.add('unknown-item-omitted'); warn('unknown-item-omitted', turn.id, item.id);
          break;
        default: throw new ConversionError('invalid-snapshot');
      }
    }
    if (number === 1) emit({ type: 'step/end', time: end, data: { turn: 1, step: 1 } });
    const reason = turn.status === 'failed' ? { kind: 'error' as const, error: { code: 'CODEX_TURN_FAILED', message: 'Codex reported a failed historical turn; detailed error was not available in the public snapshot.' } }
      : turn.status === 'interrupted' ? { kind: 'interrupted' as const } : { kind: 'completed' as const };
    emit({ type: 'turn/end', time: end, data: { turn: number, reason } });
    receipts.push({ codexTurnId: turn.id, dshTurn: number, status: turn.status, startedAtMs: turn.startedAtMs,
      completedAtMs: turn.completedAtMs, durationMs: turn.durationMs, hasError: turn.hasError, itemTimeBasis: turn.startedAtMs === null ? 'thread-created' : 'turn-start', items: record });
  }
  if (meaningful === 0) hard.push('no-public-content');
  const titleTime = source.thread.updatedAtMs;
  if (options.titleMode === 'pin') {
    const raw = source.thread.title ?? source.thread.preview;
    const title = normalizeSessionTitle(raw, options.limits.titleMaxBytes)
      || normalizeSessionTitle(source.thread.preview, options.limits.titleMaxBytes)
      || normalizeSessionTitle('Codex ' + source.thread.id, options.limits.titleMaxBytes);
    if (raw !== title) warnings.push({ code: 'title-normalized-or-fallback' });
    emit({ type: 'session/title', time: titleTime, data: { title, messageSeqs: [], source: { kind: 'user' } } });
  }
  const requiredLosses = [...required].sort(), acceptedLosses = [...new Set(options.acceptedLosses)].sort();
  const missing = requiredLosses.filter(loss => options.mode === 'strict' || !acceptedLosses.includes(loss));
  const blockers = [...new Set(hard)];
  const state = hard.length ? 'unsupported' : !qualifiedTarget(options.target.selectedCwd, options.target.pathStyle) ? 'needs-remap' : missing.length ? 'needs-review' : 'ready';
  if (state === 'needs-remap') blockers.push('target-path-unselected-or-unqualified');
  if (missing.length) blockers.push(...missing.map(loss => 'consent-required:' + loss));
  let plan: ConversionPlan | null = null;
  if (state === 'ready') {
    const cwd = options.target.selectedCwd;
    if (cwd === null) throw new ConversionError('invalid-options');
    const header = materializeCreateHeader({ id, version: SESSION_FORMAT_VERSION,
      createdAt: source.thread.createdAtMs, cwd, isSeeded: false });
    const prefixDigest = digest('dsh-codex-bridge/prefix/v1', { header, events });
    emit({ type: 'codex-bridge/import-receipt', time: titleTime, ignorable: true, data: {
      schemaVersion: 1, converterVersion: 1, sourceThreadId: source.thread.id, originalCwd: source.thread.cwd,
      originalTitle: source.thread.title, sourceStatus: source.thread.status, sourceKind: source.thread.sourceKind,
      originator: source.thread.originator, sourceCliVersion: source.thread.cliVersion, historyMode: source.thread.historyMode,
      modelProvider: source.thread.modelProvider, threadLatestModel: source.thread.latestModel, createdAtMs: source.thread.createdAtMs, updatedAtMs: source.thread.updatedAtMs,
      sourceFingerprint, prefixDigest, mode: options.mode, acceptedLosses, requiredLosses,
      perItemModelAttribution: false, targetPathStyle: options.target.pathStyle, turns: receipts,
    } });
    plan = { header, events, sourceFingerprint, prefixDigest, planDigest: digest('dsh-codex-bridge/plan/v1', { header, events }) };
    validateConversionPlan(plan);
  }
  const result: ConversionResult = {
    schemaVersion: 1, state, sessionId: id, source: { id: source.thread.id, title: source.thread.title, cwd: source.thread.cwd,
      createdAtMs: source.thread.createdAtMs, updatedAtMs: source.thread.updatedAtMs, status: source.thread.status, sourceKind: source.thread.sourceKind },
    sourceFingerprint, mode: options.mode, warnings, requiredLosses, blockers, preview,
    statistics: { turns: source.turns.length, items: itemCount, proposedMessages: preview.length, generatedEvents: plan?.events.length ?? 0 }, plan,
  };
  assertBytes(result, options.limits.maxResultBytes);
  return freeze(result);
}
/** @param snapshot - P2 public history DTO. @param options - explicit policy, selected path and caps. @returns pure preview and optional validated plan. */
export function convertSnapshot(snapshot: ThreadSnapshot, options: ConversionOptions): ConversionResult {
  const checked = optionsSchema.safeParse(options);
  if (!checked.success || (checked.data.mode === 'strict' && checked.data.acceptedLosses.length > 0)) throw new ConversionError('invalid-options');
  try { return build(snapshot, checked.data); }
  catch (error) {
    if (error instanceof ConversionError) throw error;
    if (error instanceof CodexReadError && error.code === 'content-limit') throw new ConversionError('content-limit');
    throw new ConversionError('invalid-snapshot');
  }
}
