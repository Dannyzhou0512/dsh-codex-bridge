/** Lazy optional Host: no Codex/persistence I/O until a user action. */
import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { parseConfig } from './config.js';
import { SourceSetup } from './setup.js';
interface HistoryBackend {
  list(archived: boolean): Promise<HistoryList>;
  preview(threadId: string): Promise<HistoryPreview>;
  review(selections: readonly ReviewSelection[]): Promise<HistoryReview>;
  execute(handle: string, digest: string, dryRun: boolean): Promise<HistoryOutcome>;
  confirmSingle(handle: string, digest: string, dryRun: boolean): Promise<HistoryOutcome>;
  close(): Promise<void>;
}
import type { BridgeUiStatus, HistoryList, HistoryPreview, HistoryReview, HistoryOutcome, ReviewSelection,
  SourceDraft, SourceSaveResult, SourceTestResult } from './shared.js';
export type { BridgeUiStatus } from './shared.js';
declare module '@deepseek-ai/cordis' { interface Context { codexBridgeUi: CodexBridgeUi } }
/** @typert service codexBridgeUi */
export class CodexBridgeUi extends TypertRemoteService {
  private readonly settings: ReturnType<typeof parseConfig>;
  private readonly setup = new SourceSetup();
  private runtime: Promise<HistoryBackend> | null = null;
  private closed = false;
  private runtimeContext: Context | null = null;
  constructor(ctx: Context, config: unknown) {
    super(ctx, 'codexBridgeUi');
    this.settings = parseConfig(config);
    // Only lifecycle registration here. Source/persistence I/O stays behind explicit actions.
    ctx.inject(['sessions', 'sessionPersistence', 'workspaceRegistry'], scope => {
      this.runtimeContext = scope;
      scope.effect(() => () => this.releaseCapabilities(scope), 'codex-ui.capabilities');
    });
  }
  private getRuntime(): Promise<HistoryBackend> {
    if (this.closed || !this.settings.config) throw Error('source-unavailable');
    const context = this.runtimeContext;
    if (!context) throw Error('capability-unavailable');
    const config = this.settings.config;
    const specifier: string = './runtime.js';
    return this.runtime ??= import(specifier).then((module: { HistoryRuntime: new (ctx: Context, options: typeof config) => HistoryBackend }) => {
      if (this.closed || this.runtimeContext !== context) throw Error('service-unavailable');
      return new module.HistoryRuntime(context, config);
    }).catch(() => { if (this.runtimeContext === context) this.runtime = null; throw Error('service-unavailable'); });
  }
  @Remote
  status(): BridgeUiStatus {
    const capabilities = ['sessions','sessionPersistence','workspaceRegistry'].map(name => ({ name, available: this.ctx.get(name) !== undefined }));
    return { schemaVersion: 1, companionVersion: '0.0.10', harnessVersion: '0.2.2-rc.3',
      sourceState: this.settings.invalid ? 'invalid-config' : this.settings.config ? 'configured' : 'not-configured',
      importEnabled: Boolean(this.runtimeContext && this.settings.config?.writeEnabled && capabilities.every(row => row.available)),
      setupAvailable: this.setup.available(this.ctx), capabilities };
  }
  @Remote
  sourceSuggestions(): Promise<SourceDraft> { return this.setup.suggestions(this.ctx, this.settings.config); }
  @Remote
  testSource(draft: SourceDraft): Promise<SourceTestResult> { return this.setup.test(this.ctx, draft); }
  @Remote
  saveSource(ticket: string): Promise<SourceSaveResult> { return this.setup.save(this.ctx, ticket); }
  @Remote
  enableImportWrites(): Promise<SourceSaveResult> { return this.setup.enableWrites(this.ctx); }
  @Remote
  list(archived: boolean): Promise<HistoryList> { return this.getRuntime().then(runtime => runtime.list(archived)); }
  @Remote
  preview(threadId: string): Promise<HistoryPreview> { return this.getRuntime().then(runtime => runtime.preview(threadId)); }
  @Remote
  review(selections: readonly ReviewSelection[]): Promise<HistoryReview> { return this.getRuntime().then(runtime => runtime.review(selections)); }
  @Remote
  execute(handle: string, digest: string, dryRun: boolean): Promise<HistoryOutcome> { return this.getRuntime().then(runtime => runtime.execute(handle, digest, dryRun)); }
  @Remote
  confirmSingle(handle: string, digest: string, dryRun: boolean): Promise<HistoryOutcome> { return this.getRuntime().then(runtime => runtime.confirmSingle(handle, digest, dryRun)); }
  private async releaseCapabilities(context: Context): Promise<void> {
    if (this.runtimeContext !== context) return;
    this.runtimeContext = null;
    const previous = this.runtime; this.runtime = null;
    if (!previous) return;
    let backend: HistoryBackend; try { backend = await previous; } catch { return; }
    await backend.close();
  }
  async close(): Promise<void> { this.closed = true; this.setup.close(); if (!this.runtime) return; let backend: HistoryBackend; try { backend = await this.runtime; } catch { return; } await backend.close(); }
}
export const name = 'codex-bridge-ui-host';
export function apply(ctx: Context, config?: unknown): void {
  const service = new CodexBridgeUi(ctx, config);
  ctx.effect(() => () => service.close(), 'codex-ui.host');
}
