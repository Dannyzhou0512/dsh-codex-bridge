/** Opt-in real read-only protocol probe. Only aggregate facts are written, never raw history. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexHistoryReader, CodexReadError } from '../lib/codex/index.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.argv[2];
const codexHome = process.env.CODEX_HOME;
if (!executable || !codexHome) throw new Error('Provide the explicit Codex executable and public CODEX_HOME');
const version = execFileSync(executable, ['--version'], { cwd: project, encoding: 'utf8', windowsHide: true }).trim();
const reader = new CodexHistoryReader({
  executable, args: ['app-server', '--stdio'], cwd: project, codexHome,
  clientInfo: { name: 'dsh_codex_bridge', title: 'DSH Codex Bridge read-only P2 probe', version: '0.0.2' },
  limits: { requestTimeoutMs: 30000, shutdownTimeoutMs: 5000, maxInFlight: 4, maxFrameBytes: 67108864 },
  readLimits: { pageSize: 25, maxPages: 200, maxThreads: 5000, maxItems: 50000, maxJsonDepth: 32 },
});
const report = { observedAtUtc: new Date().toISOString(), version, executable, requestedHome: codexHome, archiveScans: [], samples: [], completed: false };
const sourceKinds = ['cli', 'vscode', 'exec', 'appServer', 'unknown'];
try {
  const identity = await reader.connect();
  report.identity = identity;
  const all = [];
  for (const archived of [false, true]) {
    const rows = await reader.list({ archived, sourceKinds });
    all.push(...rows);
    const sourceCounts = Object.fromEntries(sourceKinds.map(kind => [kind, rows.filter(row => row.sourceKind === kind).length]));
    const originators = [...new Set(rows.map(row => row.originator).filter(value => value !== null))];
    report.archiveScans.push({ archived, count: rows.length, sourceCounts, originators,
      countFieldsNotLoaded: rows.every(row => row.counts === null) });
  }
  const unique = [...new Map(all.map(row => [row.id, row])).values()];
  report.uniqueThreads = unique.length;
  report.desktopOriginatorThreads = unique.filter(row => /desktop/i.test(row.originator ?? '')).length;
  report.workspaceThreads = unique.filter(row => row.cwd.toLowerCase().includes('dsh-codex-bridge-dev')).length;
  report.historyModes = Object.fromEntries(['legacy', 'paginated'].map(mode => [mode, unique.filter(row => row.historyMode === mode).length]));
  report.ephemeralThreads = unique.filter(row => row.ephemeral).length;
  const eligible = unique.filter(row => !row.ephemeral);
  const workspaceSample = eligible.find(row => row.cwd.toLowerCase().includes('dsh-codex-bridge-dev'));
  const otherSample = eligible.find(row => row.id !== workspaceSample?.id && row.status !== 'active');
  for (const row of [workspaceSample, otherSample].filter(value => value !== undefined)) {
    try {
    const snapshot = await reader.read(row.id);
    const repeat = await reader.read(row.id);
    const ordering = value => value.turns.map(turn => ({ id: turn.id, items: turn.items.map(item => item.id) }));
    const toolTypes = [...new Set(snapshot.turns.flatMap(turn => turn.items.flatMap(item =>
      item.type === 'toolInformation' ? [item.toolType] : [])))];
    report.samples.push({
      threadIdSha256: createHash('sha256').update(row.id).digest('hex'),
      historyMode: row.historyMode, history: snapshot.history, historyIssues: snapshot.historyIssues, compatibilityWarnings: snapshot.compatibilityWarnings,
      sourceKind: row.sourceKind, originator: row.originator,
      workspaceMatch: row.cwd.toLowerCase().includes('dsh-codex-bridge-dev'),
      counts: snapshot.counts, hasInProgressTurn: snapshot.hasInProgressTurn,
      itemViews: [...new Set(snapshot.turns.map(turn => turn.itemsView))],
      turnTimesPresent: snapshot.turns.filter(turn => turn.startedAtMs !== null).length,
      latestModelPresent: row.latestModel !== null, perTurnModelAttribution: snapshot.perTurnModelAttribution,
      orderingStableAcrossTwoReads: JSON.stringify(ordering(snapshot)) === JSON.stringify(ordering(repeat)),
      toolTypes, toolOutputAvailability: toolTypes.map(type => {
        const tools = snapshot.turns.flatMap(turn => turn.items.filter(item => item.type === 'toolInformation' && item.toolType === type));
        const key = { commandExecution: 'aggregatedOutput', mcpToolCall: 'result', dynamicToolCall: 'contentItems', functionCallOutput: 'output', webSearch: 'action', fileChange: 'changes', imageView: 'path' }[type];
        return { type, count: tools.length, field: key ?? null,
          provided: key ? tools.filter(tool => tool.fields[key] !== null && tool.fields[key] !== undefined).length : null,
          statusCounts: Object.fromEntries([...new Set(tools.map(tool => tool.fields.status).filter(value => typeof value === 'string'))].map(status => [status, tools.filter(tool => tool.fields.status === status).length])) };
      }), unsupportedTypes: snapshot.unsupportedTypes, nonTextInputTypes: snapshot.nonTextInputTypes,
    });
    } catch (error) {
      report.samples.push({ threadIdSha256: createHash('sha256').update(row.id).digest('hex'), historyMode: row.historyMode, workspaceMatch: row.cwd.toLowerCase().includes('dsh-codex-bridge-dev'), failure: error instanceof CodexReadError ? { code: error.code, rpcCode: error.rpcCode ?? null } : { code: 'read-failed' } });
    }
  }
  report.historyReadsSucceeded = report.samples.filter(sample => !sample.failure).length;
  report.historyReadsFailed = report.samples.filter(sample => sample.failure).length;
  report.completed = report.historyReadsSucceeded > 0;
  if (!report.completed) process.exitCode = 1;
} catch (error) {
  report.failure = error instanceof CodexReadError ? { code: error.code, rpcCode: error.rpcCode ?? null } : { code: 'probe-failed' };
  process.exitCode = 1;
} finally {
  await reader.close();
  report.transport = reader.inspect();
  const directory = join(project, '.artifacts/codex-probe');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
