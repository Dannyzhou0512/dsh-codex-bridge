import type { Context } from '@deepseek-ai/cordis';
import type { ConfigEditor } from '@deepseek-ai/dsh-config-editor';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseConfig, type UiHostConfig } from './config.js';
import { approveInWindows, nativeSetupAvailable, type SetupApproval } from './native-confirm.js';
import type { SourceDraft, SourceSaveResult, SourceSetupError, SourceTestResult } from './shared.js';

const namespace = 'dsh-codex-bridge-ui';
const moduleName = '@dannyzhou/dsh-codex-bridge-ui';
const ticketLifetime = 5 * 60_000;

function entryOf(editor: ConfigEditor) {
  return editor.entries().find(entry => entry.options.id === namespace && entry.options.name === moduleName);
}

function absoluteInput(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[\p{Cc}\p{Cf}]/u.test(value) && isAbsolute(value)
    && (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value));
}

async function canonical(value: string, executable = false): Promise<string | null> {
  if (!absoluteInput(value)) return null;
  try {
    const path = await realpath(value);
    if (!absoluteInput(path)) return null;
    const entry = await stat(path);
    return executable ? (/\.exe$/i.test(path) && entry.isFile() ? path : null) : (entry.isDirectory() ? path : null);
  } catch { return null; }
}

async function resolveDraft(draft: SourceDraft): Promise<SourceDraft | SourceSetupError> {
  const executable = await canonical(draft.executable, true);
  if (!executable) return 'setup-executable';
  const codexHome = await canonical(draft.codexHome);
  if (!codexHome) return 'setup-directory';
  const cwd = draft.cwd ? await canonical(draft.cwd) : codexHome;
  return cwd ? { executable, codexHome, cwd } : 'setup-cwd';
}

function configFor(paths: SourceDraft, existing: UiHostConfig | null): UiHostConfig {
  const tuning = existing?.reader ?? {
    clientInfo: { name: 'dsh-codex-bridge', title: 'Codex history import', version: '0.0.10' },
    limits: { requestTimeoutMs: 30000, shutdownTimeoutMs: 3000, maxInFlight: 2, maxFrameBytes: 16000000 },
    readLimits: { pageSize: 50, maxPages: 20, maxThreads: 500, maxItems: 10000, maxJsonDepth: 64 },
  };
  return { enabled: true, writeEnabled: false, reader: { ...tuning, ...paths, args: ['app-server'] } };
}

async function probe(config: UiHostConfig, signal: AbortSignal): Promise<'setup-connected' | 'setup-empty'> {
  const { CodexHistoryReader } = await import('@dannyzhou/dsh-codex-bridge/codex');
  signal.throwIfAborted();
  const reader = new CodexHistoryReader(config.reader);
  try {
    const scan = { sourceKinds: ['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'] as const };
    for (const archived of [false, true]) {
      signal.throwIfAborted();
      try {
        if ((await reader.list({ ...scan, archived }, signal)).length > 0) return 'setup-connected';
      } catch (error) {
        // A history exceeding the regular scan bounds still establishes the connection.
        if (error instanceof Error && 'code' in error && error.code === 'scan-limit') return 'setup-connected';
        throw error;
      }
    }
    return 'setup-empty';
  } finally { await reader.close(); }
}

interface TestedSource {
  readonly id: string;
  readonly peerId: string;
  readonly paths: SourceDraft;
  readonly config: UiHostConfig;
  readonly baseline: unknown;
  readonly expiresAt: number;
}

export class SourceSetup {
  private readonly lifetime = new AbortController();
  private busy = false;
  private tested: TestedSource | null = null;

  constructor(private readonly approve: SetupApproval = approveInWindows, private readonly check = probe,
    private readonly supported = nativeSetupAvailable) {}

  available(ctx: Context): boolean {
    return this.caller(ctx) !== null;
  }

  private caller(ctx: Context) {
    const call = ctx.invocation;
    const editor = ctx.get('configEditor');
    if (!call || call.peer.principal.kind !== 'owner' || call.signal.aborted || this.lifetime.signal.aborted
      || !editor || !this.supported()) return null;
    const entry = entryOf(editor);
    if (!entry) return null;
    return { editor, entry, peerId: call.peer.id, signal: AbortSignal.any([call.signal, this.lifetime.signal]) };
  }

  async suggestions(ctx: Context, configured: UiHostConfig | null): Promise<SourceDraft> {
    const empty = { executable: '', codexHome: '', cwd: '' };
    if (!this.caller(ctx)) return empty;
    if (configured) {
      const { executable, codexHome, cwd } = configured.reader;
      return { executable, codexHome, cwd };
    }
    let executable: string | null = null;
    for (const dir of (process.env.PATH ?? '').split(delimiter).slice(0, 80)) {
      if (!absoluteInput(dir)) continue;
      executable = await canonical(join(dir, 'codex.exe'), true);
      if (executable) break;
    }
    return { ...empty, executable: executable ?? '',
      codexHome: await canonical(process.env.CODEX_HOME || join(homedir(), '.codex')) ?? '' };
  }

  async test(ctx: Context, draft: SourceDraft): Promise<SourceTestResult> {
    const caller = this.caller(ctx);
    if (!caller) return { state: 'setup-unavailable', ticket: null };
    if (this.busy) return { state: 'setup-busy', ticket: null };
    this.busy = true;
    this.tested = null;
    try {
      const paths = await resolveDraft(draft);
      if (typeof paths === 'string') return { state: paths, ticket: null };
      const baseline = structuredClone(caller.entry.options.config ?? {});
      if (!await this.approve('test', paths, caller.signal)) return { state: 'setup-cancelled', ticket: null };
      caller.signal.throwIfAborted();
      if (!isDeepStrictEqual(await resolveDraft(paths), paths)) return { state: 'setup-stale', ticket: null };
      const config = configFor(paths, parseConfig(baseline).config);
      const state = await this.check(config, AbortSignal.any([caller.signal, AbortSignal.timeout(35000)]));
      caller.signal.throwIfAborted();
      const ticket = randomUUID();
      this.tested = { id: ticket, peerId: caller.peerId, paths, config, baseline, expiresAt: Date.now() + ticketLifetime };
      return { state, ticket };
    } catch {
      return { state: caller.signal.aborted ? 'setup-cancelled' : 'setup-connection', ticket: null };
    } finally { this.busy = false; }
  }

  async save(ctx: Context, ticket: string): Promise<SourceSaveResult> {
    const caller = this.caller(ctx);
    if (!caller) return 'setup-unavailable';
    if (this.busy) return 'setup-busy';
    const tested = this.tested;
    if (!tested || tested.peerId !== caller.peerId || tested.id !== ticket || tested.expiresAt <= Date.now()) return 'setup-stale';
    this.busy = true;
    this.tested = null;
    try {
      if (!await this.approve('save', tested.paths, caller.signal)) {
        if (!caller.signal.aborted) this.tested = tested;
        return 'setup-cancelled';
      }
      if (!isDeepStrictEqual(await resolveDraft(tested.paths), tested.paths)) return 'setup-stale';
      await caller.editor.edit(caller.entry, current => {
        caller.signal.throwIfAborted();
        if (!isDeepStrictEqual(current, tested.baseline) || tested.expiresAt <= Date.now()) throw Error('setup-stale');
        return { ...tested.config };
      });
      return 'setup-saved';
    } catch (error) {
      if (error instanceof Error && error.message === 'setup-stale') return 'setup-stale';
      return caller.signal.aborted ? 'setup-cancelled' : 'setup-save-failed';
    } finally { this.busy = false; }
  }

  async enableWrites(ctx: Context): Promise<SourceSaveResult> {
    const caller = this.caller(ctx);
    if (!caller) return 'setup-unavailable';
    if (this.busy) return 'setup-busy';
    this.busy = true;
    try {
      const baseline = structuredClone(caller.entry.options.config ?? {});
      const { config } = parseConfig(baseline);
      if (!config) return 'setup-stale';
      const { executable, codexHome, cwd } = config.reader;
      const paths = await resolveDraft({ executable, codexHome, cwd });
      if (typeof paths === 'string') return paths;
      if (!await this.approve('enable-writes', paths, caller.signal)) return 'setup-cancelled';
      await caller.editor.edit(caller.entry, current => {
        caller.signal.throwIfAborted();
        if (!isDeepStrictEqual(current, baseline)) throw Error('setup-stale');
        return { ...current, writeEnabled: true };
      });
      return 'setup-saved';
    } catch (error) {
      if (error instanceof Error && error.message === 'setup-stale') return 'setup-stale';
      return caller.signal.aborted ? 'setup-cancelled' : 'setup-save-failed';
    } finally { this.busy = false; }
  }

  close(): void { this.lifetime.abort(); this.tested = null; }
}
