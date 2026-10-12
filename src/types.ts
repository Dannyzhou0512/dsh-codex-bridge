/** Read-only P1 status vocabulary; no runtime declarations. */

/** Optional host services needed by the future importer. */
export type CapabilityName = 'sessions' | 'sessionPersistence' | 'sessionQuery' | 'workspaceRegistry';

/** Presence observation only; it does not validate or activate the host service. */
export interface CapabilityObservation {
  readonly name: CapabilityName;
  readonly available: boolean;
}

/** Import remains disabled throughout P1, even when all host capabilities exist. */
export type BridgeStatus =
  | { readonly phase: 'P1'; readonly importEnabled: false; readonly state: 'capabilityUnavailable'; readonly missingCapabilities: readonly CapabilityName[] }
  | { readonly phase: 'P1'; readonly importEnabled: false; readonly state: 'notConfigured' };
