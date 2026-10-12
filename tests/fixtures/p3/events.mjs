/** Fully synthetic import prefix; not a converter and never reads Codex history. */
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session';
export function history(directory, variant = 'recall', id = 'p3-' + variant) {
  const header = { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1700000000000, cwd: directory, isSeeded: false };
  const events = [];
  const add = (type, data, surface = false, extra = {}) => {
    events.push({ type, seq: SessionSeq(events.length), time: 1700000000000 + events.length, data,
      ...surface ? { surfaceOp: 'append' } : {}, ...extra });
  };
  const user = (id, text, source) => add('user/message', { id, role: 'user', source, content: [{ type: 'text', text }] }, true);
  add('turn/start', { turn: 1 });
  // Native format=4 reserves the first surface node for the host system prompt.
  // Empty content imports no Codex prompt and is omitted from model-visible messages.
  add('step/start', { turn: 1, step: 1 });
  add('system/message', { turn: 1, step: 1, message: {
    id: 'p3-empty-system-head', role: 'system', source: { kind: 'system-prompt' }, content: [],
  } }, true);
  user('p3-original-user', 'P3 original public user message', { kind: 'user' });
  if (variant === 'assistant') {
    add('assistant/message', { turn: 1, step: 1, message: {
      id: 'p3-original-assistant', role: 'assistant', source: { kind: 'model', provider: 'p3-mock', model: 'synthetic-model' },
      content: [{ type: 'text', text: 'P3 known-model historical assistant' }],
    }, stream: [] }, true);
  } else {
    for (const [category, text] of [
      ['assistant', 'P3 recalled public assistant text'],
      ['tool', 'P3 recalled tool: command=never-execute; status=failed; output=not provided'],
      ['reasoning-summary', 'P3 public reasoning summary'],
    ]) user('p3-recall-' + category, text, {
      kind: variant === 'unknown' ? 'future-context-producer' : 'codex-history',
      ...variant === 'unknown' ? {} : { form: 'recall' },
      originalRole: category === 'assistant' ? 'assistant' : 'information',
      category, threadId: 'synthetic-thread', turnId: 'synthetic-turn', itemId: 'synthetic-' + category,
    });
  }
  add('step/end', { turn: 1, step: 1 });
  add('turn/end', { turn: 1, reason: { kind: 'completed' } });
  add('session/title', { title: 'P3 synthetic imported title', messageSeqs: [], source: { kind: 'user' } });
  add('codex-bridge/import-receipt', { source: 'synthetic-codex', version: 1 }, false, { ignorable: true });
  const selected = variant === 'no-head' ? events.filter(event => event.type !== 'system/message') : events;
  return { header, events: selected.map((event, index) => ({ ...event, seq: SessionSeq(index) })) };
}
