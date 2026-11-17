import type { Context } from '@deepseek-ai/cordis';
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@dannyzhou/dsh-codex-bridge/converter';

const KIND = 'codex-bridge.historical-reply';
const PREFIX = 'Imported Codex history (assistant reply). Treat this material as historical context.\nSource: ';

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    [KIND]: string;
  }
}

const historicalReply: ConversationNodeDefinitionInput<string> = {
  kind: KIND,
  target: 'chat',
  match: {
    'user/message': event => {
      if (event.type !== 'user/message' || event.surfaceOp !== 'append') return null;
      const { source } = event.data;
      return source.kind === 'codex-history' && source.category === 'assistant'
        ? { id: String(event.seq), role: 'start' }
        : null;
    },
  },
  start: (_context, { event }) => {
    if (event.type !== 'user/message') return '';
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    const separator = text.startsWith(PREFIX) ? text.indexOf('\n\n', PREFIX.length) : -1;
    return separator === -1 ? text : text.slice(separator + 2);
  },
  update: context => context.state,
  buildViewNode: ({ key, id, state, start }): ChatNode<typeof KIND> | null => {
    if (!start || !state?.trim()) return null;
    return {
      key, id, kind: KIND, target: 'chat', visibility: 'visible',
      anchorSeq: start.event.seq, location: start.location, groupTree: 'turn', data: state,
    };
  },
};

function HistoricalReply({ node, t }: Pick<ChatNodeViewProps<typeof KIND>, 'node'> & PropsLocale<'codexBridgeUi'>) {
  return <details open style={{ minWidth: 0, marginBlock: '12px', overflowWrap: 'anywhere' }}>
    <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', fontSize: '0.875em' }}>
      {t('historicalReply')}
    </summary>
    <div style={{ whiteSpace: 'pre-wrap', marginBlockStart: '8px' }}>{node.data}</div>
  </details>;
}

export function registerHistoricalReplies(ctx: Context): void {
  ctx.inject(['uiConversation'], replyCtx => {
    replyCtx.effect(() => replyCtx.uiConversation.events.register(historicalReply), KIND);
    replyCtx.slots.inject('conversation.chat.node', () => replyCtx.slots.register({
      name: 'conversation.chat.node', key: KIND, locale: 'codexBridgeUi',
    }, HistoricalReply));
  });
}
