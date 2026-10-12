/** P8 independent API; Root Host startup does not instantiate recovery. */
export { SessionRecovery, validateRecoveryPlan } from './recovery.js';
export { RecoveryError } from './errors.js';
export type { RecoveryErrorCode } from './errors.js';
export type { RecoveryCapabilities, RecoveryLimits, RecoveryActions, DiagnosisOptions, DiagnosisState,
  RecoveryPlan, StoredSummary, RetryOptions, RecoveryResult, RecoveryEffects } from './types.js';
