/** Explicit app plugin only for a dedicated profile. The normal bundle patch never mounts this face. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-cmdline';
import { parseInvocation } from './parser.js';
import { runCliOperation } from './runner.js';
export const name = 'codex-bridge-cli';
export const inject = ['cmdlineArgs'];
export function apply(ctx: Context, config: unknown): void {
  if (!config || typeof config !== 'object' || !('enabled' in config) || config.enabled !== true) return;
  const invocation = parseInvocation(ctx); if (!invocation) return;
  const ready = ctx.get('appReady'), exit = ctx.get('appExit');
  if (!ready || !exit) return;
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  const off = ready.onReady(() => {
    running = runCliOperation(ctx, config, invocation, controller.signal).then(outcome => {
      process.stdout.write(outcome.output + '\n'); exit(outcome.code);
    }, () => { process.stdout.write('{"schemaVersion":1,"error":"operation-failed"}\n'); exit(1); });
  });
  ctx.effect(() => async () => { off(); controller.abort(); await running; }, 'codex-bridge-cli.operation');
}
export { runCliOperation } from './runner.js';
export { parseCliConfig } from './config.js';
export { CliError } from './errors.js';
export type { CliConfig, CliInvocation, CliOutcome } from './types.js';
