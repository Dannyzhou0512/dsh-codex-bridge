import type { Context } from '@deepseek-ai/cordis';
import type { ReaderOptions, ScanOptions, SourceKind } from '../codex/types.js';
import type { ConversionOptions, LossCode } from '../converter/types.js';
import type { MappingOptions } from '../workspace/types.js';
import type { PlanningLimits } from '../planner/types.js';
import type { ImportLimits } from '../importer/types.js';
import type { BatchLimits } from '../batch/types.js';
export interface CliConfig {
  readonly enabled: boolean; readonly reader: ReaderOptions; readonly scan: ScanOptions;
  readonly conversion: Omit<ConversionOptions, 'acceptedLosses' | 'target'>;
  readonly mapping: MappingOptions; readonly planning: PlanningLimits; readonly importing: ImportLimits;
  readonly batch: BatchLimits; readonly cache: 'skip' | 'refresh-if-available';
  readonly io: { readonly maxArgBytes: number; readonly maxOutputBytes: number };
}
export interface CliInvocation {
  readonly action: 'list' | 'preview' | 'plan' | 'apply';
  readonly threads: readonly string[]; readonly losses: readonly LossCode[];
  readonly mode?: 'strict' | 'recall'; readonly remap?: string;
  readonly sourceKinds?: readonly SourceKind[]; readonly archived?: boolean;
  readonly execute: boolean; readonly reviewedDigest?: string;
}
export interface CliOutcome { readonly code: number; readonly output: string }
export type CliContext = Context;
