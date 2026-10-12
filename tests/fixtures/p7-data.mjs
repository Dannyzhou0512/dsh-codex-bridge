/** Stateful public-capability doubles for fault tests; genuine Core composition is a separate process fixture. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionAlreadyExistsError, SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence';
import { ImportPlanner } from '../../lib/planner/index.js';
import { WorkspaceMapper } from '../../lib/workspace/index.js';
import { SessionImporter } from '../../lib/importer/index.js';
import { publicSnapshot, options } from './p4-data.mjs';
import { allocate, cleanup } from '../helpers.mjs';
export const importLimits = { maxReadEvents: 2000, maxReadBytes: 2000000, readChunkEvents: 3, maxResultBytes: 8192 };
export async function setupImport(t) {
  const root = await allocate(); t.after(() => cleanup(root));
  const cwd = join(root, 'P7 中文 workspace'); await mkdir(cwd);
  const source = publicSnapshot(); source.thread.cwd = cwd;
  const calls = { source: 0, create: 0, append: 0, flush: 0, writerClose: 0, readerClose: 0,
    workspaceCreate: 0, attach: 0, cache: 0, writeOpen: 0 };
  const rows = new Map(), workspaces = [];
  let fault = null, live = false;
  const cacheSeen = [];
  const persistence = {
    identity: Symbol('P7-fixture'),
    async stat(id) { const row = rows.get(id); return row ? { header: { ...row.header, delegationDepth: row.header.delegationDepth ?? 0 }, revision: row.revision, eventCount: row.events.length } : undefined; },
    async create(header) {
      calls.create++;
      if (fault === 'already-owned') throw new SessionAlreadyOwnedError(header.id);
      if (rows.has(header.id)) throw new SessionAlreadyExistsError(header.id);
      if (fault === 'create-before') throw new Error('PRIVATE_FAILURE_SENTINEL');
      const row = { header: structuredClone(header), events: [], revision: 'r0', owner: true }; rows.set(header.id, row);
      if (fault === 'create-after') throw new Error('PRIVATE_FAILURE_SENTINEL');
      return { access: 'write', id: header.id, header: row.header, inheritedEventCount: 0,
        async append(events) {
          calls.append++;
          if (fault === 'append-before') throw new Error('PRIVATE_FAILURE_SENTINEL');
          row.events.push(...structuredClone(fault === 'append-partial' ? events.slice(0, 4) : events)); row.revision = 'r1';
          if (fault === 'append-partial' || fault === 'append-after') throw new Error('PRIVATE_FAILURE_SENTINEL');
        },
        async flush() { calls.flush++; if (fault === 'flush') throw new Error('PRIVATE_FAILURE_SENTINEL'); row.revision = 'r2'; },
        async close() { calls.writerClose++; row.owner = false; if (fault === 'close') throw new Error('PRIVATE_FAILURE_SENTINEL'); },
      };
    },
    async open(id, mode) {
      if (mode !== 'read') { calls.writeOpen++; throw new Error('Importer must never reopen write'); }
      if (fault === 'readback-open') throw new Error('PRIVATE_FAILURE_SENTINEL');
      const row = structuredClone(rows.get(id)); assert(row);
      // Materialize only the documented public logical header default.
      row.header.delegationDepth ??= 0;
      if (fault === 'readback-prefix') row.events.find(event => event.type === 'user/message').data.content[0].text += ' changed';
      if (fault === 'readback-gap') row.events[2].seq++;
      if (fault === 'readback-header') row.header.cwd = join(root, 'wrong');
      return { access: 'read', id, header: row.header, inheritedEventCount: 0,
        async read(offset, length) {
          if (fault === 'readback-read') throw new Error('PRIVATE_FAILURE_SENTINEL');
          if (fault === 'readback-revision') rows.get(id).revision = 'changed';
          return { eventState: 'detached', events: row.events.slice(offset, offset + length) };
        },
        async close() { calls.readerClose++; if (fault === 'readback-close') throw new Error('PRIVATE_FAILURE_SENTINEL'); },
      };
    },
  };
  const registry = {
    list: () => workspaces,
    async create(path) {
      calls.workspaceCreate++;
      if (fault === 'workspace-before') throw new Error('PRIVATE_FAILURE_SENTINEL');
      const workspace = { id: 'p7-test-workspace', path, title: 'P7 keep title', sessionIds: [],
        async attachSession(id) {
          calls.attach++;
          if (fault === 'attach-before') throw new Error('PRIVATE_FAILURE_SENTINEL');
          this.sessionIds.push(id);
          if (fault === 'attach-after') throw new Error('PRIVATE_FAILURE_SENTINEL');
        } };
      workspaces.push(workspace);
      if (fault === 'workspace-after') throw new Error('PRIVATE_FAILURE_SENTINEL');
      return workspace;
    },
  };
  const mapper = new WorkspaceMapper({ registry, persistence }, { maxPathBytes: 8192, maxPlanBytes: 65536, maxWorkspaces: 100 });
  const planner = new ImportPlanner({ source: { async read() { calls.source++; return source; } },
    mapper, persistence, liveSession: () => live },
    { maxTargetEvents: 2000, maxTargetBytes: 2000000, readChunkEvents: 3, maxPlanBytes: 4000000 });
  const cache = { coldSnapshot(header, inherited, events) {
    calls.cache++; cacheSeen.push(structuredClone({ header, inherited, events }));
    if (fault === 'cache') throw new Error('PRIVATE_FAILURE_SENTINEL');
    return {};
  } };
  const caps = { planner, mapper, persistence, liveSession: () => live, cache };
  const importer = new SessionImporter(caps, importLimits);
  const { target, ...conversion } = options(cwd);
  const request = { threadId: source.thread.id, conversion };
  return { root, cwd, source, calls, rows, workspaces, cacheSeen, registry, planner, mapper, persistence, importer, caps, request,
    fault(value) { fault = value; }, live(value) { live = value; },
    plan() { return planner.plan(request, { dryRun: true }); } };
}
export function approval(plan, cache = 'skip') {
  return { dryRun: false, cache, approval: { planDigest: plan.planDigest, acceptedLosses: plan.request.conversion.acceptedLosses } };
}
