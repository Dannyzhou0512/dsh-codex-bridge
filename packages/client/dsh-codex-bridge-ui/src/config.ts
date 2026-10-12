import { z } from 'zod';

const positive = z.number().int().positive().max(64_000_000);
const schema = z.object({
  enabled: z.literal(true), writeEnabled: z.boolean().default(false),
  reader: z.object({ executable: z.string().min(1).max(8192), args: z.array(z.string().max(8192)).max(30), cwd: z.string().min(1).max(8192),
    codexHome: z.string().min(1).max(8192), clientInfo: z.object({ name: z.string().min(1), title: z.string(), version: z.string().min(1) }).strict(),
    limits: z.object({ requestTimeoutMs: positive.max(120000), shutdownTimeoutMs: positive.max(4000), maxInFlight: positive.max(4), maxFrameBytes: positive.max(16000000) }).strict(),
    readLimits: z.object({ pageSize: positive.max(100), maxPages: positive.max(20), maxThreads: positive.max(500), maxItems: positive.max(10000), maxJsonDepth: positive.max(64) }).strict() }).strict(),
}).strict();
export interface UiHostConfig { readonly enabled: true; readonly writeEnabled: boolean; readonly reader: z.infer<typeof schema>['reader'] }
export function parseConfig(value: unknown): { config: UiHostConfig | null; invalid: boolean } {
  if (value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0)) return { config: null, invalid: false };
  const checked = schema.safeParse(value); return checked.success ? { config: checked.data, invalid: false } : { config: null, invalid: true };
}
