/** Test-only external model replacement; all Session/Agent/Controller services stay real. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const name = 'p3-synthetic-llm';
export const inject = ['llm'];
export function apply(ctx) {
  const probe = { requests: [], systemPrompts: [], errors: [] };
  class SyntheticAdapter extends LlmAdapter {
    async listModels() { return [{ id: 'synthetic-model', name: 'Synthetic model' }]; }
    async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: ['text'] }; }
    async *stream(options) {
      probe.systemPrompts.push(options.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n'));
      probe.requests.push(options.messages.filter(message => message.role !== 'system').map(message => ({
        role: message.role, content: message.content,
      })));
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'P3 synthetic continuation reply' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'P3 synthetic continuation reply' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['p3-mock'], new SyntheticAdapter());
  ctx.provide('p3Probe', probe);
  ctx.on('agent/error', ({ error }) => { probe.errors.push(String(error)); });
}
