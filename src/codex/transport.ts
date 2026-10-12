/** Internal newline JSON-RPC transport; only read methods and the initialization handshake are emitted. */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { isAbsolute, extname } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { CodexReadError } from './errors.js';
import type { HistoryMethod, ServerIdentity, TransportObservation, TransportOptions } from './types.js';

const timerMs = z.number().int().min(1).max(2_147_483_647);
const configSchema = z.object({
  executable: z.string().min(1), args: z.array(z.string()), cwd: z.string().min(1), codexHome: z.string().min(1),
  clientInfo: z.object({ name: z.string().min(1), title: z.string().min(1), version: z.string().min(1) }),
  limits: z.object({ requestTimeoutMs: timerMs, shutdownTimeoutMs: timerMs,
    maxInFlight: z.number().int().positive(), maxFrameBytes: z.number().int().positive() }),
});
const identitySchema = z.object({
  codexHome: z.string().min(1), userAgent: z.string(), platformFamily: z.string(), platformOs: z.string(),
});
type Child = ChildProcessByStdio<Writable, Readable, null>;
interface Pending {
  resolve(value: unknown): void;
  reject(error: CodexReadError): void;
  timer: ReturnType<typeof setTimeout>;
  offAbort(): void;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Internal raw results are immediately projected by the reader, never exported by the package face. */
export class ReadOnlyStdioClient {
  readonly #options: z.infer<typeof configSchema>;
  #child: Child | undefined;
  #state: TransportObservation['state'] = 'new';
  #connecting: Promise<ServerIdentity> | undefined;
  #closing: Promise<void> | undefined;
  #stopped: Promise<void> | undefined;
  #failure: CodexReadError | undefined;
  #exit: TransportObservation['exit'] = null;
  #forced = false;
  #nextId = 0;
  #pending = new Map<string, Pending>();
  #parts: Buffer[] = [];
  #bytes = 0;
  #sent = { initialize: 0, list: 0, read: 0, rejectedServerRequests: 0 };

  constructor(options: TransportOptions) {
    const parsed = configSchema.safeParse(options);
    if (!parsed.success || !isAbsolute(parsed.data.executable) || !isAbsolute(parsed.data.cwd)
      || !isAbsolute(parsed.data.codexHome)
      || (process.platform === 'win32' && extname(parsed.data.executable).toLowerCase() !== '.exe')) {
      throw new CodexReadError('invalid-config');
    }
    this.#options = parsed.data;
  }

  /** Lazy startup; repeat callers share exactly one handshake. */
  connect(): Promise<ServerIdentity> {
    if (this.#state === 'closed') return Promise.reject(new CodexReadError('closed'));
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    this.#connecting ??= this.#initialize();
    return this.#connecting;
  }
  async #initialize(): Promise<ServerIdentity> {
    this.#state = 'connecting';
    // Only public location/OS variables; never inherit Desktop-internal state or provider secrets.
    const permittedEnv = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
      'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
      'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROCESSOR_ARCHITECTURE',
      'NUMBER_OF_PROCESSORS', 'CODEX_SQLITE_HOME', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE']);
    const env: NodeJS.ProcessEnv = {};
    for (const key of Object.keys(process.env)) {
      if (permittedEnv.has(key.toUpperCase())) env[key] = process.env[key];
    }
    env.CODEX_HOME = this.#options.codexHome;
    try {
      const child = spawn(this.#options.executable, this.#options.args, {
        cwd: this.#options.cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      });
      this.#child = child;
      this.#stopped = new Promise(resolve => child.once('close', (code, signal) => {
        this.#exit = { code, signal, forced: this.#forced };
        if (this.#state !== 'closed' && this.#failure === undefined) {
          this.#fail(new CodexReadError(this.#bytes > 0 ? 'truncated-frame' : 'process-exited'));
        }
        this.#parts = [];
        this.#bytes = 0;
        resolve();
      }));
      child.once('error', () => { this.#fail(new CodexReadError('spawn-failed')); });
      child.stdin.on('error', () => {
        if (this.#state !== 'closed') this.#fail(new CodexReadError('process-exited'));
      });
      child.stdout.on('data', (chunk: Buffer) => { this.#feed(chunk); });
      const result = await this.#call('initialize', {
        clientInfo: this.#options.clientInfo,
        capabilities: { experimentalApi: false, requestAttestation: false, explicitGatewayOauth: true },
      });
      const identity = identitySchema.safeParse(result);
      if (!identity.success) throw new CodexReadError('invalid-response');
      this.#assertOpen();
      this.#write({ method: 'initialized', params: {} });
      this.#state = 'ready';
      return identity.data;
    } catch (error) {
      const safe = error instanceof CodexReadError ? error : new CodexReadError('spawn-failed');
      this.#fail(safe);
      throw safe;
    }
  }

  /** Reject arbitrary method names at runtime, even for JavaScript callers. */
  async request(method: HistoryMethod, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (method !== 'thread/list' && method !== 'thread/read') throw new CodexReadError('write-method-denied');
    if (signal?.aborted) throw new CodexReadError('cancelled');
    await this.connect();
    if (signal?.aborted) throw new CodexReadError('cancelled');
    return this.#call(method, params, signal);
  }

  #call(method: 'initialize' | HistoryMethod, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.#state === 'closed') return Promise.reject(new CodexReadError('closed'));
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.#pending.size >= this.#options.limits.maxInFlight) return Promise.reject(new CodexReadError('concurrency-limit'));
    const id = 'dsh-readonly-' + String(++this.#nextId);
    return new Promise((resolve, reject) => {
      const abort = (): void => { this.#fail(new CodexReadError('cancelled')); };
      const timer = setTimeout(() => { this.#fail(new CodexReadError('request-timeout')); }, this.#options.limits.requestTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      this.#pending.set(id, { resolve, reject, timer, offAbort: () => { signal?.removeEventListener('abort', abort); } });
      if (method === 'initialize') this.#sent.initialize++;
      else if (method === 'thread/list') this.#sent.list++;
      else this.#sent.read++;
      try { this.#write({ id, method, params }); }
      catch (error) { this.#fail(error instanceof CodexReadError ? error : new CodexReadError('invalid-frame')); }
    });
  }
  #assertOpen(): void {
    if (this.#state === 'closed') throw new CodexReadError('closed');
    if (this.#failure !== undefined) throw this.#failure;
  }
  #write(message: object): void {
    if (this.#child === undefined || !this.#child.stdin.writable) throw new CodexReadError('not-connected');
    const frame = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(frame) > this.#options.limits.maxFrameBytes) throw new CodexReadError('frame-too-large');
    this.#child.stdin.write(frame);
  }
  #feed(chunk: Buffer): void {
    if (this.#state === 'closed' || this.#failure !== undefined) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, end < 0 ? chunk.length : end);
      this.#bytes += part.length;
      if (this.#bytes > this.#options.limits.maxFrameBytes) {
        this.#fail(new CodexReadError('frame-too-large')); return;
      }
      this.#parts.push(part);
      if (end < 0) return;
      const line = Buffer.concat(this.#parts, this.#bytes);
      this.#parts = []; this.#bytes = 0;
      if (line.length > 0) this.#receive(line);
      if (this.#failure !== undefined) return;
      offset = end + 1;
    }
  }
  #receive(line: Buffer): void {
    let message: unknown;
    try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
    catch { this.#fail(new CodexReadError('invalid-frame')); return; }
    if (!record(message)) { this.#fail(new CodexReadError('invalid-frame')); return; }
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        if (typeof message.id !== 'string' && typeof message.id !== 'number') {
          this.#fail(new CodexReadError('invalid-frame')); return;
        }
        this.#sent.rejectedServerRequests++;
        try { this.#write({ id: message.id, error: { code: -32601, message: 'Read-only history client declines server requests' } }); }
        catch { this.#fail(new CodexReadError('process-exited')); }
      }
      // Unsolicited notifications, including raw reasoning, are not retained or forwarded.
      return;
    }
    const pending = typeof message.id === 'string' ? this.#pending.get(message.id) : undefined;
    if (pending === undefined || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) {
      this.#fail(new CodexReadError('unexpected-response')); return;
    }
    this.#pending.delete(message.id as string);
    clearTimeout(pending.timer); pending.offAbort();
    if (Object.hasOwn(message, 'error')) {
      const code = record(message.error) && typeof message.error.code === 'number' ? message.error.code : undefined;
      pending.reject(new CodexReadError('rpc-failed', code));
    } else pending.resolve(message.result);
  }
  #fail(error: CodexReadError): void {
    if (this.#state === 'closed' || this.#failure !== undefined) return;
    this.#failure = error; this.#state = 'failed';
    this.#rejectPending(error);
    this.#parts = []; this.#bytes = 0;
    if (this.#child?.pid !== undefined && this.#exit === null) {
      this.#forced = true; this.#child.kill();
    }
  }
  #rejectPending(error: CodexReadError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer); pending.offAbort(); pending.reject(error);
    }
    this.#pending.clear();
  }

  /** Idempotent, awaited teardown. A bounded EOF grace period precedes termination. */
  close(): Promise<void> {
    this.#closing ??= this.#shutdown();
    return this.#closing;
  }
  async #shutdown(): Promise<void> {
    this.#state = 'closed';
    this.#rejectPending(new CodexReadError('closed'));
    if (this.#child === undefined || this.#stopped === undefined) return;
    this.#child.stdin.end();
    const timer = setTimeout(() => {
      if (this.#exit === null) { this.#forced = true; this.#child?.kill(); }
    }, this.#options.limits.shutdownTimeoutMs);
    try { await this.#stopped; }
    finally { clearTimeout(timer); this.#parts = []; this.#bytes = 0; }
  }
  /** Only counters/process facts are exposed, never messages, IDs, stderr or parameters. */
  inspect(): TransportObservation {
    return { state: this.#state, pid: this.#child?.pid ?? null, sent: { ...this.#sent }, exit: this.#exit === null ? null : { ...this.#exit } };
  }
}
