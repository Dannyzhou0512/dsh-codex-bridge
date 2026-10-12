/** Converter-owned event grammar complements the host's public storage validator. */
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { materializeCreateHeader, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import { ConversionError } from './errors.js';
import { digest } from './canonical.js';
import { qualifiedTarget } from './paths.js';
import { sessionIdFor } from './ids.js';
import type { ConversionPlan } from './types.js';

/** @param plan - owned or received candidate plan. Refuses mutated metadata, unsupported events and broken relationships. */
export function validateConversionPlan(plan: ConversionPlan): void {
  const fail = (): never => { throw new ConversionError('invalid-plan'); };
  try {
    materializeCreateHeader(plan.header);
    if (plan.header.version !== SESSION_FORMAT_VERSION || plan.header.isSeeded || plan.header.parentSession !== undefined
      || plan.header.origin !== undefined || plan.header.cwd === undefined) fail();
    const events = validateStoredEvents(plan.header, structuredClone([...plan.events]));
    let turn: number | null = null, step: number | null = null, nextTurn = 1, systemHeads = 0;
    const ids = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (event.seq !== index || !Number.isSafeInteger(event.time) || event.time < 0) fail();
      if (event.type !== 'system/message' && event.type !== 'user/message' && Object.hasOwn(event, 'surfaceOp')) fail();
      switch (event.type) {
        case 'turn/start':
          if (turn !== null || event.data.turn !== nextTurn) fail();
          turn = nextTurn++;
          break;
        case 'step/start':
          if (turn !== 1 || step !== null || event.data.turn !== 1 || event.data.step !== 1 || systemHeads !== 0) fail();
          step = 1;
          break;
        case 'system/message':
          if (turn !== 1 || step !== 1 || systemHeads !== 0 || ids.size !== 0 || event.surfaceOp !== 'append'
            || event.data.turn !== 1 || event.data.step !== 1 || event.data.message.content.length !== 0
            || event.data.message.role !== 'system' || event.data.message.source.kind !== 'system-prompt') fail();
          systemHeads++; ids.add(event.data.message.id);
          break;
        case 'user/message':
          if (turn === null || systemHeads !== 1 || event.surfaceOp !== 'append' || ids.has(event.data.id)
            || event.data.content.length === 0 || event.data.content.some(block => block.type !== 'text')) fail();
          if (event.data.source.kind !== 'user' && event.data.source.kind !== 'codex-history') fail();
          ids.add(event.data.id);
          break;
        case 'step/end':
          if (turn !== 1 || step !== 1 || event.data.turn !== 1 || event.data.step !== 1) fail();
          step = null;
          break;
        case 'turn/end':
          if (turn === null || event.data.turn !== turn || step !== null) fail();
          turn = null;
          break;
        case 'session/title':
          if (turn !== null || systemHeads !== 1 || event.data.source.kind !== 'user' || event.data.messageSeqs.length !== 0) fail();
          break;
        case 'codex-bridge/import-receipt':
          if (index !== events.length - 1 || turn !== null || step !== null || event.ignorable !== true
            || event.data.schemaVersion !== 1 || event.data.converterVersion !== 1
            || event.data.sourceFingerprint !== plan.sourceFingerprint || event.data.prefixDigest !== plan.prefixDigest
            || event.data.turns.length !== nextTurn - 1) fail();
          break;
        default: fail();
      }
    }
    if (turn !== null || step !== null || systemHeads !== 1 || events.at(-1)?.type !== 'codex-bridge/import-receipt') fail();
    if (digest('dsh-codex-bridge/prefix/v1', { header: plan.header, events: events.slice(0, -1) }) !== plan.prefixDigest) fail();
    if (digest('dsh-codex-bridge/plan/v1', { header: plan.header, events }) !== plan.planDigest) fail();
    const receipt = events.at(-1);
    if (receipt?.type === 'codex-bridge/import-receipt') {
      const data = receipt.data;
      if ((data.targetPathStyle !== 'windows' && data.targetPathStyle !== 'posix')
        || (data.mode !== 'strict' && data.mode !== 'recall') || data.perItemModelAttribution !== false) fail();
      if (data.mode === 'strict' && (data.acceptedLosses.length !== 0 || data.requiredLosses.length !== 0
        || events.some(event => event.type === 'user/message' && event.data.source.kind === 'codex-history'))) fail();
      if (data.requiredLosses.some(loss => !data.acceptedLosses.includes(loss))) fail();
      const turnIds = new Set<string>();
      for (const [index, row] of data.turns.entries()) {
        if (row.dshTurn !== index + 1 || !row.codexTurnId || turnIds.has(row.codexTurnId)) fail();
        turnIds.add(row.codexTurnId);
        for (const item of row.items) {
          if (item.messageId !== null && !ids.has(item.messageId)) fail();
        }
      }
    }
    if (receipt?.type === 'codex-bridge/import-receipt' && !qualifiedTarget(plan.header.cwd ?? null, receipt.data.targetPathStyle)) fail();
    if (receipt?.type !== 'codex-bridge/import-receipt'
      || plan.header.id !== sessionIdFor(receipt.data.sourceThreadId)) fail();
  } catch (error) {
    if (error instanceof ConversionError && error.code === 'invalid-plan') throw error;
    throw new ConversionError('invalid-plan');
  }
}
