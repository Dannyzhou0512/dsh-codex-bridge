/** Only the launcher-owned CmdlineArgs are parsed. Commander actions are synchronous acceptance, not migration. */
import { Command, Option } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import type { Context } from '@deepseek-ai/cordis';
import type { CliInvocation } from './types.js';
const losses = ['assistant-role-recall', 'tool-information-recall', 'reasoning-summary-recall',
  'non-text-input-omitted', 'unknown-item-omitted', 'context-compaction-unrestored', 'tool-output-unavailable'];
const kinds = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact',
  'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const collect = (value: string, previous: string[] = []) => [...previous, value];
export function parseInvocation(ctx: Context): CliInvocation | null {
  let accepted: CliInvocation | null = null;
  const program = new Command().name('dsh-codex-bridge').version('0.0.9', '--bridge-version')
    .description('Public Codex history import through a dedicated DSH rc.2 profile; writes require a reviewed digest.');
  program.command('list').description('List public history metadata; counts remain unknown until hydration')
    .addOption(new Option('--source-kind <kind>', 'public source filter (repeatable)').choices(kinds).argParser(collect))
    .option('--archived', 'list archived threads')
    .action(options => { accepted = { action: 'list', threads: [], losses: [], execute: false,
      ...options.sourceKind ? { sourceKinds: options.sourceKind } : {}, ...options.archived === undefined ? {} : { archived: options.archived } }; });
  for (const action of ['preview', 'plan', 'apply'] as const) {
    const command = program.command(action).requiredOption('--thread <id>', 'explicit thread id (repeatable)', collect)
      .addOption(new Option('--mode <mode>', 'conversion policy').choices(['strict', 'recall']))
      .addOption(new Option('--accept-loss <code>', 'explicitly accepted conversion loss (repeatable)').choices(losses).argParser(collect))
      .option('--remap <cwd>', 'existing target directory for these selected threads');
    if (action === 'apply') command.option('--execute', 'perform reviewed writes; otherwise dry-run')
      .option('--dry-run', 'read-only execution checks').option('--reviewed-digest <sha256>', 'reviewDigest from a matching plan result');
    command.action(options => {
      if (options.execute && options.dryRun) command.error('error: --execute conflicts with --dry-run');
      if (options.execute && !/^[a-f0-9]{64}$/.test(options.reviewedDigest ?? ''))
        command.error('error: --execute requires --reviewed-digest from plan');
      accepted = { action, threads: options.thread, losses: options.acceptLoss ?? [], execute: options.execute === true,
        ...options.mode ? { mode: options.mode } : {}, ...options.remap ? { remap: options.remap } : {},
        ...options.reviewedDigest ? { reviewedDigest: options.reviewedDigest } : {} };
    });
  }
  program.action(() => { program.error('error: choose list, preview, plan or apply; use --help'); });
  parseCmdline(ctx, program); return accepted;
}
