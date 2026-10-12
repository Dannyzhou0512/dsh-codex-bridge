/** Re-project the public DTO; extra raw fields cannot enter fingerprints, previews or events. */
import type { PublicInput, PublicItem, ThreadSnapshot } from '../codex/types.js';
import { projectPublicItem } from '../codex/parse.js';
import { ConversionError } from './errors.js';
export function projectSnapshot(snapshot: ThreadSnapshot, maxToolDepth: number): ThreadSnapshot {
  const input = (row: PublicInput): PublicInput => {
    switch (row.type) {
      case 'text': return { type: row.type, text: row.text };
      case 'image': return { type: row.type, ...row.url === undefined ? {} : { url: row.url }, ...row.fileId === undefined ? {} : { fileId: row.fileId } };
      case 'localImage': return { type: row.type, path: row.path };
      case 'reference': return { type: row.type, inputType: row.inputType, name: row.name, path: row.path };
      case 'unsupported': return { type: row.type, inputType: row.inputType };
      default: throw new ConversionError('invalid-snapshot');
    }
  };
  const item = (row: PublicItem): PublicItem => {
    switch (row.type) {
      case 'userMessage': return { type: row.type, id: row.id, content: row.content.map(input) };
      case 'agentMessage': return { type: row.type, id: row.id, text: row.text, phase: row.phase };
      case 'reasoning': return { type: row.type, id: row.id, summary: [...row.summary] };
      case 'unsupported': return { type: row.type, id: row.id, originalType: row.originalType };
      case 'toolInformation': return projectPublicItem({ ...row.fields, type: row.toolType, id: row.id }, { maxJsonDepth: maxToolDepth, maxItems: 1 });
      default: throw new ConversionError('invalid-snapshot');
    }
  };
  const t = snapshot.thread;
  const turns = snapshot.turns.map(turn => ({ id: turn.id, status: turn.status, itemsView: turn.itemsView,
    startedAtMs: turn.startedAtMs, completedAtMs: turn.completedAtMs, durationMs: turn.durationMs,
    hasError: turn.hasError, items: turn.items.map(item) }));
  const all = turns.flatMap(turn => turn.items);
  return {
    thread: { id: t.id, title: t.title, preview: t.preview, cwd: t.cwd, createdAtMs: t.createdAtMs, updatedAtMs: t.updatedAtMs,
      status: t.status, activeFlags: [...t.activeFlags], ephemeral: t.ephemeral, historyMode: t.historyMode,
      modelProvider: t.modelProvider, latestModel: t.latestModel, modelAttribution: 'thread-latest-only',
      sourceKind: t.sourceKind, originator: t.originator, cliVersion: t.cliVersion, archived: t.archived, counts: null },
    turns,
    history: snapshot.history, historyIssues: [...snapshot.historyIssues],
    compatibilityWarnings: [...snapshot.compatibilityWarnings], unsupportedTypes: [...snapshot.unsupportedTypes],
    nonTextInputTypes: [...snapshot.nonTextInputTypes], perTurnModelAttribution: false,
    hasInProgressTurn: snapshot.hasInProgressTurn,
    counts: { turns: turns.length, items: all.length,
      messages: all.filter(row => row.type === 'userMessage' || row.type === 'agentMessage').length,
      toolItems: all.filter(row => row.type === 'toolInformation').length,
      reasoningItems: all.filter(row => row.type === 'reasoning').length },
  };
}
