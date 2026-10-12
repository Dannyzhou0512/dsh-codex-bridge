/** Independent browser registration; no Node or core importer code is loaded. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReactNode } from 'react';
import remote from '../../lib/typert.remote-client.js';
import { CodexHistoryPage } from './Page.js';
import { en, zh, type LocaleKey } from './locales.js';
export const name = 'codex-history-client';
export const inject = ['remote', 'slots', 'locale', 'layout'];
const PANEL = 'codex-history' as MainPanelId;
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'codexBridgeUi': LocaleKey } }
function HistoryIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5v5h5M4 10a8 8 0 1 1 1 8M12 7v5l3 2" /></svg>;
}
/** @param ctx - Harness-owned browser Context. @returns Remote disposer registered with the owning fiber. */
export async function apply(ctx: Context): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(remote);
  ctx.effect(() => disposeRemote, 'codex-ui.remote');
  ctx.effect(() => ctx.locale.register('codexBridgeUi', { zh, en }), 'codex-ui.locale');
  await ctx.plugin({ name: 'codex-history-page', inject: ['remote', 'remote.codexBridgeUi', 'slots', 'locale', 'layout'], apply(pageCtx: Context) {
  const label = pageCtx.locale.bind('codexBridgeUi');
  const unwrap = async <T,>(request: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>): Promise<T> => { const result = await request; if (!result.ok) throw new Error('host-unavailable'); return result.value; };
  const face = { read: () => unwrap(pageCtx.remote.codexBridgeUi.status()), label,
    list: (archived: boolean) => unwrap(pageCtx.remote.codexBridgeUi.list(archived)),
    preview: (threadId: string) => unwrap(pageCtx.remote.codexBridgeUi.preview(threadId)),
    review: (selections: readonly import('../shared.js').ReviewSelection[]) => unwrap(pageCtx.remote.codexBridgeUi.review(selections)),
    execute: (handle: string, digest: string, dryRun: boolean) => unwrap(pageCtx.remote.codexBridgeUi.execute(handle, digest, dryRun)) };
  ctx.effect(() => { const tag = document.createElement('style'); tag.dataset.codexBridgeUi = 'true';
    tag.textContent = '.dsh-codex-ui{box-sizing:border-box;padding:24px;max-width:1440px;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-family:var(--dsw-font-family,sans-serif)}.dsh-codex-ui header,.dsh-codex-toolbar,.dsh-codex-row-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dsh-codex-ui h1{font-size:20px;margin:0 0 8px}.dsh-codex-ui h2{font-size:14px;margin:24px 0 12px}.dsh-codex-ui p,.dsh-codex-ui dt{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dsh-codex-ui-state{margin-top:20px;padding:12px 0;border-block:1px solid var(--dsw-alias-border-l2)}.dsh-codex-ui dl{margin:0}.dsh-codex-ui dl>div{display:flex;justify-content:space-between;gap:16px;padding:10px 0}.dsh-codex-ui dd{margin:0}.dsh-codex-ui button:focus-visible,.dsh-codex-ui input:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px}.dsh-codex-toolbar{justify-content:flex-start;margin:16px 0}.dsh-codex-browser{display:grid;grid-template-columns:minmax(250px,1fr) minmax(300px,1.35fr);gap:24px}.dsh-codex-rows,.dsh-codex-review{list-style:none;padding:0;margin:0}.dsh-codex-rows li,.dsh-codex-review li{padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-wrap:anywhere}.dsh-codex-rows li:hover,.dsh-codex-rows li[data-active=true]{background:var(--dsw-alias-interactive-bg-hover)}.dsh-codex-ui label{display:inline-flex;align-items:center;gap:8px;overflow-wrap:anywhere}.dsh-codex-meta{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dsh-codex-inspector{min-width:0;border-left:1px solid var(--dsw-alias-border-l2);padding-left:24px}.dsh-codex-ui fieldset{border:0;padding:0;margin:16px 0;min-width:0}.dsh-codex-ui legend{font-weight:600;margin:12px 0}.dsh-codex-ui input[type=text]{display:block;box-sizing:border-box;width:100%;margin:8px 0;padding:8px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:4px}.dsh-codex-loss{display:flex!important;margin:10px 0;line-height:1.5}.dsh-codex-ui input:disabled{opacity:.5}.dsh-codex-messages{max-height:60vh;overflow:auto}.dsh-codex-messages article{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-codex-messages pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:13px;line-height:1.65;margin:8px 0}.dsh-codex-ui details summary{cursor:pointer}.dsh-codex-ui details summary:focus-visible{outline:2px solid currentColor}@media(max-width:900px){.dsh-codex-browser{grid-template-columns:1fr}.dsh-codex-inspector{border-left:0;border-top:1px solid var(--dsw-alias-border-l2);padding:0}.dsh-codex-messages{max-height:50vh}}@media(max-width:640px){.dsh-codex-ui{padding:16px}.dsh-codex-ui button,.dsh-codex-ui label{min-height:36px}.dsh-codex-ui header{align-items:flex-start}.dsh-codex-row-title{align-items:flex-start}.dsh-codex-row-title strong{max-width:100%;overflow-wrap:anywhere}}';
    document.head.append(tag); return () => tag.remove(); }, 'codex-ui.style');
  pageCtx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: 'codexBridgeUi', inject: () => face }, CodexHistoryPage));
  pageCtx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 10, label: () => label('title'), locale: 'codexBridgeUi' }, HistoryIcon));
  } });
}
