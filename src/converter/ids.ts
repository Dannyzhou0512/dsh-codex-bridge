/** Deterministic identities exclude cwd, titles, model choices and run time. */
import { createHash } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { MessageId } from '@deepseek-ai/dsh-llm/brand';
import { digest } from './canonical.js';
import { ConversionError } from './errors.js';
import type { ConversionCategory } from './types.js';
/** @param threadId - public Codex id. @returns versioned deterministic native Session identity. */
export function sessionIdFor(threadId: string): SessionId {
  if (typeof threadId !== 'string' || threadId.length === 0) throw new ConversionError('invalid-snapshot');
  return SessionId('codex-' + createHash('sha256').update('dsh-codex-bridge/v1\0').update(threadId).digest('hex'));
}
/** @param threadId - source id. @param turnId - source turn. @param itemId - source item. @param category - semantic segment. @returns stable Message id. */
export function messageIdFor(threadId: string, turnId: string, itemId: string, category: ConversionCategory | 'system-head'): MessageId {
  return MessageId('codex-msg-' + digest('dsh-codex-bridge/message/v1', [threadId, turnId, itemId, category]));
}
