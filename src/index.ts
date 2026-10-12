/** Host-only P1 shell. Construction registers a read-only service and performs no I/O. */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { BridgeStatus, CapabilityName, CapabilityObservation } from './types.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only status of the future Codex history bridge. */
    codexHistory: CodexHistory;
  }
}

/** Fixed host capability names, not deployment configuration. */
const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'sessions', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry',
];

/** Cordis owns service registration and removal with this plugin's fiber. */
export default class CodexHistory extends Service {
  /** @param ctx - Host context; future importer services deliberately remain optional. */
  constructor(ctx: Context) {
    super(ctx, 'codexHistory');
  }

  /**
   * Observe presence without invoking a capability or retaining its instance.
   * @returns A fresh snapshot; availability does not enable import in P1.
   */
  capabilities(): readonly CapabilityObservation[] {
    return CAPABILITY_NAMES.map(name => ({ name, available: this.ctx.get(name) !== undefined }));
  }

  /**
   * Describe the shell without accessing Codex, storage, Session bodies or paths.
   * @returns Missing capabilities, or notConfigured because the separate reader is not wired into Host startup.
   */
  status(): BridgeStatus {
    const missingCapabilities = this.capabilities()
      .filter(capability => !capability.available)
      .map(capability => capability.name);
    if (missingCapabilities.length > 0) {
      return { phase: 'P1', importEnabled: false, state: 'capabilityUnavailable', missingCapabilities };
    }
    return { phase: 'P1', importEnabled: false, state: 'notConfigured' };
  }
}
