/** Lazy Workspace mapper over public host capabilities; no own profile, database or Session writer. */
import { z } from 'zod';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { canonicalJson, digest, freeze } from '../converter/canonical.js';
import { classifyWorkspacePath } from './paths.js';
import { probeDirectory } from './probe.js';
import { checkCancellation, WorkspaceMappingError } from './errors.js';
import type { MappingCapabilities, MappingOperationOptions, MappingOperationResult, MappingOptions, MappingRequest,
  PathAnalysis, PathStyle, WorkspaceDescriptor, WorkspaceMappingPlan, WorkspaceView } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionsSchema = z.object({ maxPathBytes: positive, maxPlanBytes: positive, maxWorkspaces: positive });
const requestSchema = z.object({ originalCwd: z.string().nullable(), remapCwd: z.string().min(1).optional() });
function descriptor(workspace: WorkspaceView): WorkspaceDescriptor { return { id: workspace.id, path: workspace.path, title: workspace.title }; }
export class WorkspaceMapper {
  readonly #options: MappingOptions;
  readonly #caps: MappingCapabilities;
  readonly #style: PathStyle = process.platform === 'win32' ? 'windows' : 'posix';
  /** Construction captures only capabilities/options; it performs no filesystem or service calls. */
  constructor(capabilities: MappingCapabilities, options: MappingOptions) {
    const checked = optionsSchema.safeParse(options);
    if (!checked.success) throw new WorkspaceMappingError('invalid-options');
    this.#options = checked.data; this.#caps = capabilities;
  }
  #workspaces(): readonly WorkspaceView[] {
    const registry = this.#caps.registry;
    if (!registry) return [];
    try {
      const rows = registry.list();
      if (rows.length > this.#options.maxWorkspaces) throw new WorkspaceMappingError('workspace-limit');
      return rows;
    } catch (error) {
      if (error instanceof WorkspaceMappingError) throw error;
      throw new WorkspaceMappingError('capability-failed');
    }
  }
  #bounded<T>(value: T): T {
    if (Buffer.byteLength(canonicalJson(value), 'utf8') > this.#options.maxPlanBytes) throw new WorkspaceMappingError('content-limit');
    return freeze(value);
  }
  /** Read-only path analysis/listing. An explicit remap never probes an unrelated original directory. */
  async plan(request: MappingRequest, signal?: AbortSignal): Promise<WorkspaceMappingPlan> {
    const checked = requestSchema.safeParse(request);
    if (!checked.success) throw new WorkspaceMappingError('invalid-request');
    checkCancellation(signal);
    const req = { originalCwd: checked.data.originalCwd, remapCwd: checked.data.remapCwd ?? null };
    let original: PathAnalysis;
    const warnings: string[] = [];
    if (req.remapCwd !== null) {
      const syntax = classifyWorkspacePath(req.originalCwd, this.#style, this.#options.maxPathBytes);
      original = { input: req.originalCwd, state: syntax === 'qualified' ? 'uninspected' : syntax,
        canonicalPath: null, identity: null, isLink: false };
      warnings.push('explicit-remap', 'original-not-probed-during-remap');
    } else original = await probeDirectory(req.originalCwd, this.#style, this.#options.maxPathBytes, signal);
    const target = req.remapCwd === null ? original : await probeDirectory(req.remapCwd, this.#style, this.#options.maxPathBytes, signal);
    checkCancellation(signal);
    if (target.isLink) warnings.push('symlink-or-junction-resolved');
    if (target.canonicalPath !== null && target.canonicalPath !== target.input) warnings.push('path-canonicalized');
    const existing = target.state === 'directory' && this.#caps.registry
      ? this.#workspaces().find(row => row.path === target.canonicalPath) : undefined;
    const status: WorkspaceMappingPlan['status'] = target.state !== 'directory' ? 'needs-remap' : !this.#caps.registry ? 'capability-unavailable' : 'ready';
    const data = { schemaVersion: 1 as const, pathStyle: this.#style, request: req, status,
      original, target, canonicalCwd: target.state === 'directory' ? existing?.path ?? target.canonicalPath : null,
      action: status === 'ready' ? existing ? 'reuse' as const : 'create' as const : null,
      workspace: existing ? descriptor(existing) : null, warnings };
    return this.#bounded({ ...data, fingerprint: digest('dsh-codex-bridge/workspace-plan/v1', data) });
  }
  #checkPlan(plan: WorkspaceMappingPlan): void {
    try {
      const { fingerprint, ...data } = plan;
      if (plan.schemaVersion !== 1 || plan.pathStyle !== this.#style
        || digest('dsh-codex-bridge/workspace-plan/v1', data) !== fingerprint) throw new WorkspaceMappingError('invalid-plan');
      this.#bounded(structuredClone(plan));
    } catch (error) {
      if (error instanceof WorkspaceMappingError) throw error;
      throw new WorkspaceMappingError('invalid-plan');
    }
  }
  async #current(plan: WorkspaceMappingPlan, signal?: AbortSignal): Promise<{ reason: string | null; workspace: WorkspaceView | undefined }> {
    checkCancellation(signal);
    const path = plan.request.remapCwd ?? plan.request.originalCwd;
    const now = await probeDirectory(path, this.#style, this.#options.maxPathBytes, signal);
    if (now.state !== 'directory' || now.canonicalPath !== plan.canonicalCwd
      || canonicalJson(now.identity) !== canonicalJson(plan.target.identity)) return { reason: 'directory-changed', workspace: undefined };
    const workspace = this.#workspaces().find(row => row.path === plan.canonicalCwd);
    if (plan.workspace && workspace?.id !== plan.workspace.id) return { reason: 'workspace-changed', workspace };
    return { reason: null, workspace };
  }
  #operation(options: MappingOperationOptions): void {
    if (typeof options?.dryRun !== 'boolean') throw new WorkspaceMappingError('invalid-options');
  }
  #result(plan: WorkspaceMappingPlan, status: MappingOperationResult['status'], reason: string | null,
    workspace?: WorkspaceView, createInvoked = false, attachInvoked = false, warnings: readonly string[] = []): MappingOperationResult {
    return this.#bounded({ status, reason, canonicalCwd: workspace?.path ?? plan.canonicalCwd,
      workspace: workspace ? descriptor(workspace) : null, effects: { createInvoked, attachInvoked }, warnings });
  }
  /** Revalidate an existing directory, then explicitly create/reuse its public Workspace. No Session is created. */
  async resolve(plan: WorkspaceMappingPlan, options: MappingOperationOptions): Promise<MappingOperationResult> {
    this.#operation(options); this.#checkPlan(plan);
    if (plan.status !== 'ready' || !this.#caps.registry) return this.#result(plan, 'blocked', 'mapping-not-ready');
    let invoked = false, workspace: WorkspaceView | undefined;
    try {
      const current = await this.#current(plan, options.signal); workspace = current.workspace;
      if (current.reason) return this.#result(plan, 'stale-plan', current.reason, workspace);
      if (options.dryRun) return this.#result(plan, 'dry-run', null, workspace);
      checkCancellation(options.signal);
      if (!workspace) {
        const path = plan.canonicalCwd;
        if (path === null) return this.#result(plan, 'blocked', 'mapping-not-ready');
        invoked = true; workspace = await this.#caps.registry.create(path);
      }
      if (workspace.path !== plan.canonicalCwd) return this.#result(plan, 'stale-plan', 'registry-canonical-path-changed', workspace, invoked);
      const after = await this.#current(plan);
      if (after.reason || after.workspace?.id !== workspace.id)
        return this.#result(plan, 'stale-plan', after.reason ?? 'workspace-changed', workspace, invoked, false, ['mutation-not-rolled-back']);
      return this.#result(plan, 'resolved', null, workspace, invoked, false,
        options.signal?.aborted ? ['cancelled-after-workspace-resolution'] : []);
    } catch (error) {
      const cancelled = error instanceof WorkspaceMappingError && error.code === 'cancelled';
      return this.#result(plan, cancelled ? 'cancelled' : 'failed', cancelled ? 'cancelled' : error instanceof WorkspaceMappingError ? error.code : 'workspace-resolution-failed',
        workspace, invoked, false, invoked ? ['mutation-may-have-committed'] : []);
    }
  }
  /** Attach only to an already resolved Workspace after public header/path revalidation, including already-attached ids. */
  async attach(plan: WorkspaceMappingPlan, sessionId: SessionId, options: MappingOperationOptions): Promise<MappingOperationResult> {
    this.#operation(options); this.#checkPlan(plan);
    if (plan.status !== 'ready' || !this.#caps.registry || !this.#caps.persistence)
      return this.#result(plan, 'blocked', 'required-capability-unavailable');
    let invoked = false, workspace: WorkspaceView | undefined;
    try {
      const current = await this.#current(plan, options.signal); workspace = current.workspace;
      if (current.reason) return this.#result(plan, 'stale-plan', current.reason, workspace);
      if (!workspace) return this.#result(plan, 'blocked', 'workspace-not-resolved');
      const meta = await this.#caps.persistence.stat(sessionId, options.signal === undefined ? {} : { signal: options.signal });
      checkCancellation(options.signal);
      if (!meta || meta.header.id !== sessionId) return this.#result(plan, 'blocked', 'session-not-found', workspace);
      if (meta.header.cwd === undefined) return this.#result(plan, 'blocked', 'session-cwd-missing', workspace);
      const headerPath = await probeDirectory(meta.header.cwd, this.#style, this.#options.maxPathBytes, options.signal);
      if (headerPath.state !== 'directory' || headerPath.canonicalPath !== workspace.path
        || canonicalJson(headerPath.identity) !== canonicalJson(plan.target.identity))
        return this.#result(plan, 'blocked', 'session-cwd-mismatch', workspace);
      const rechecked = await this.#current(plan, options.signal);
      if (rechecked.reason || rechecked.workspace?.id !== workspace.id) return this.#result(plan, 'stale-plan', rechecked.reason ?? 'workspace-changed', workspace);
      if (options.dryRun) return this.#result(plan, 'dry-run', null, workspace);
      if (workspace.sessionIds.includes(sessionId)) return this.#result(plan, 'already-attached', null, workspace);
      checkCancellation(options.signal); invoked = true;
      await workspace.attachSession(sessionId);
      const after = await this.#current(plan);
      if (after.reason || after.workspace?.id !== workspace.id)
        return this.#result(plan, 'stale-plan', after.reason ?? 'workspace-changed', workspace, false, true, ['mutation-not-rolled-back']);
      return this.#result(plan, 'attached', null, workspace, false, true,
        options.signal?.aborted ? ['cancelled-after-attach-commit'] : []);
    } catch (error) {
      const cancelled = error instanceof WorkspaceMappingError && error.code === 'cancelled';
      return this.#result(plan, cancelled ? 'cancelled' : 'failed', cancelled ? 'cancelled' : error instanceof WorkspaceMappingError ? error.code : 'workspace-attach-failed',
        workspace, false, invoked, invoked ? ['mutation-may-have-committed'] : []);
    }
  }
}
