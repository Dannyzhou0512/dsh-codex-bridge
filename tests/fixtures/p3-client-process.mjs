/** Published Chat projection/renderer unit: shared chrome and UI consumers are test doubles. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as cordis from '@deepseek-ai/cordis';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as store from '@deepseek-ai/dsh-client-store';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import { history } from './p3/events.mjs';
const directory = process.argv[2];
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://p3.invalid/' });
const prior = new Map(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let ctx;
try {
  for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['navigator', dom.window.navigator]])
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const facade = { mode: 'queue', pendingQueue: [], load(registration) { this.pendingQueue.push(registration); } };
  window.__ModuleLoader__ = facade;
  const primitiveCalls = [];
  // Observe props to the shared visual provider; do not claim real CSS/chrome/interaction coverage.
  const primitives = new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : function Primitive(props) {
    primitiveCalls.push({ name: String(name), props });
    return React.createElement('div', { 'data-fixture-primitive': String(name) },
      props.title, props.collapsedContent, props.children);
  } });
  const staticModules = { '@deepseek-ai/cordis': cordis, 'react': React, 'react-dom': ReactDOM,
    'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-primitives': primitives, '@deepseek-ai/dsh-client-ui-slots': slots };
  for (const name of ['modules', 'ui-conversation', 'ui-chat'])
    await import('@deepseek-ai/dsh-client-' + name + '/client');
  const registration = facade.pendingQueue.find(row => row.id === '@deepseek-ai/dsh-client-modules');
  const bootstrap = registration.factory(name => { assert(name in staticModules, name); return staticModules[name]; });
  const ids = facade.pendingQueue.map(row => row.id);
  facade.pendingQueue = facade.pendingQueue.filter(row => row !== registration);
  const modules = bootstrap.createClientModuleSystem(facade, { id: registration.id, exports: bootstrap }, {
    boot: { rev: 'p3', entries: ids.map(id => ({ id, url: 'fixture/' + id, rev: 'p3' })),
      batches: [{ phase: 'bootstrap', url: 'fixture/all', rev: 'p3', entries: ids }] },
    staticModules, loadBundle: async () => { throw new Error('No P3 network or dynamic artifact fallback'); },
  });
  const conversation = await modules.import('@deepseek-ai/dsh-client-ui-conversation', '', {});
  const chat = await modules.import('@deepseek-ai/dsh-client-ui-chat', '', {});
  ctx = new cordis.Context();
  const uiConversation = new conversation.UiConversation(ctx, {});
  const { events, views, groups } = uiConversation;
  const contributions = [];
  ctx.provide('slots', {
    inject: (_name, callback) => callback(),
    register: (descriptor, component) => { contributions.push({ descriptor, component }); return () => {}; },
  });
  ctx.provide('uiSession', { provide: () => () => {} });
  const dictionaries = {};
  ctx.provide('locale', {
    register: (namespace, entries) => { dictionaries[namespace] = entries.en; return () => {}; },
    bind: namespace => key => dictionaries[namespace]?.[key] ?? key,
  });
  const settings = store.createSnapshotStore({ value: {} });
  ctx.provide('configForms', { get: () => settings });
  await chat.apply(ctx);
  const renderer = contributions.find(row => row.descriptor.name === 'conversation.chat.node' && row.descriptor.key === 'context');
  assert(renderer?.component, 'Public Chat apply registers its production Context renderer');
  const outcomes = [];
  for (const variant of ['recall', 'unknown', 'assistant']) {
    const assembler = new conversation.ConversationNodeAssembler(events, views, groups);
    assembler.activateTarget('chat');
    assembler.replaceWindow(history(directory, variant).events.map(event => ({ type: 'event', event })), false);
    assembler.flush();
    const snapshot = assembler.snapshot('chat');
    assert(snapshot, 'Production Chat view builder produces a snapshot');
    const nodes = snapshot.nodes.values();
    const contexts = nodes.filter(node => node.kind === 'context');
    if (variant === 'assistant') {
      const assistant = nodes.find(node => node.kind === 'assistant-step');
      assert(assistant, 'Empty historical stream still produces the settled assistant node');
      assert.equal(assistant.data.blocks[0].text, 'P3 known-model historical assistant');
      assert.equal(assistant.data.finalNode.timing.firstTokenTime, null, 'No invented token timing');
    } else {
      assert.equal(contexts.length, 3);
      for (const node of contexts) {
        assert.equal(node.data.producer.role, 'inject');
        assert.equal(node.data.producer.label, variant === 'recall' ? 'codex-history' : 'future-context-producer');
        assert.equal(node.data.form, variant === 'recall' ? 'recall' : null);
        const html = renderToStaticMarkup(React.createElement(renderer.component, { node, t: key => key }));
        assert(html.includes(node.data.producer.label));
        assert(html.includes(node.data.content[0].text));
        const row = primitiveCalls.findLast(call => call.name === 'DisclosureRow');
        assert.equal(row.props.open, false, 'Native Context renderer starts collapsed');
        assert.equal(row.props.title, 'message.contextInjection', 'Unknown producer is contextual injection, not an assistant bubble');
      }
    }
    outcomes.push({ variant, contextNodes: contexts.length, nativeAssistantNode: variant === 'assistant', rendererBodyForwarded: variant !== 'assistant' });
  }
  await ctx.fiber.dispose();
  assert.equal(events.entries().length, 0);
  assert.equal(views.entries().length, 0);
  ctx = undefined;
  console.log('P1_REPORT ' + JSON.stringify({ publicModuleSystem: true, outcomes, rendererRegistered: true,
    sharedPrimitivesMocked: true, desktopVisualTest: false }));
} finally {
  await ctx?.fiber.dispose();
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
