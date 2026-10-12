/** Minimal published rc.2 Loader assembly, confined to a per-test directory. */
import { join } from 'node:path';
export function hostEntries(directory, bridge = true, compression = 'none') {
  const rows = [];
  const mount = (name, config = undefined, id = name) => rows.push({ id, name, ...config === undefined ? {} : { config } });
  for (const name of ['llm', 'session', 'agent', 'session-projection', 'typert-registry', 'storage', 'commands'])
    mount('@deepseek-ai/dsh-' + name);
  mount('@deepseek-ai/dsh-session-persistence-jsonl', { root: join(directory, 'sessions'), compression });
  mount('@deepseek-ai/dsh-session-query-sqlite', { path: ':memory:', openAt: 'never' });
  mount('@deepseek-ai/dsh-storage-json', { root: join(directory, 'storage') });
  mount('@deepseek-ai/dsh-storage-domain', { backend: 'json' });
  mount('@deepseek-ai/dsh-workspace');
  mount('@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'P3 current host system prompt' });
  mount('@deepseek-ai/dsh-tools', { mode: 'native' });
  mount('@deepseek-ai/dsh-agent-default-model', { provider: 'p3-mock', model: 'synthetic-model' });
  mount('@deepseek-ai/dsh-agent-loop', { maxParallelToolCalls: 1 });
  mount('@deepseek-ai/dsh-session-title', { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 });
  mount('@deepseek-ai/dsh-fs-local', { cwd: join(directory, 'workspace') });
  mount('@deepseek-ai/dsh-attachment-local', { dshHome: directory });
  mount('@deepseek-ai/dsh-credentials-local', { dshHome: directory, path: join(directory, 'credentials.yml'), watch: false });
  mount('@deepseek-ai/dsh-client-connection', { trustedHosts: [] });
  mount('@deepseek-ai/dsh-client-file-upload');
  mount('@deepseek-ai/dsh-api-session-controller', { nativeOpen: false });
  mount('@deepseek-ai/dsh-invariants', { enabled: true });
  mount('@deepseek-ai/dsh-session/invariant');
  mount('p3-mock-model');
  if (bridge) mount('dsh-codex-bridge', undefined, 'dsh-codex-bridge-host');
  return rows;
}
