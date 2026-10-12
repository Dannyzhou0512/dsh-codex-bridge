import { z } from 'zod';
import { CliError } from './errors.js';
import type { CliConfig } from './types.js';
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const kinds = z.enum(['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact',
  'subAgentThreadSpawn', 'subAgentOther', 'unknown']);
const schema = z.object({
  enabled: z.literal(true),
  reader: z.object({ executable: z.string().min(1), args: z.array(z.string()), cwd: z.string().min(1),
    codexHome: z.string().min(1), clientInfo: z.object({ name: z.string().min(1), title: z.string(), version: z.string().min(1) }),
    limits: z.object({ requestTimeoutMs: positive, shutdownTimeoutMs: positive.max(4000), maxInFlight: positive, maxFrameBytes: positive }),
    readLimits: z.object({ pageSize: positive, maxPages: positive, maxThreads: positive, maxItems: positive, maxJsonDepth: positive.max(128) }) }),
  scan: z.object({ sourceKinds: z.array(kinds).min(1), archived: z.boolean() }),
  conversion: z.object({ mode: z.enum(['strict', 'recall']), titleMode: z.enum(['pin', 'omit']),
    limits: z.object({ maxInputBytes: positive, maxResultBytes: positive, maxEvents: positive,
      maxTextBytes: positive, maxToolDepth: positive.max(128), titleMaxBytes: positive }) }).strict(),
  mapping: z.object({ maxPathBytes: positive, maxPlanBytes: positive, maxWorkspaces: positive }),
  planning: z.object({ maxTargetEvents: positive, maxTargetBytes: positive, readChunkEvents: positive, maxPlanBytes: positive }),
  importing: z.object({ maxReadEvents: positive, maxReadBytes: positive, readChunkEvents: positive, maxResultBytes: positive.min(8192) }),
  batch: z.object({ maxEntries: positive, maxSelectionBytes: positive, maxPlanBytes: positive,
    maxResultBytes: positive.min(8192), maxItemResultBytes: positive.min(8192) }),
  cache: z.enum(['skip', 'refresh-if-available']),
  io: z.object({ maxArgBytes: positive, maxOutputBytes: positive.min(8192) }),
});
export function parseCliConfig(value: unknown): CliConfig {
  const checked = schema.safeParse(value); if (!checked.success) throw new CliError('invalid-config');
  return checked.data;
}
