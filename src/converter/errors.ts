/** Sanitized converter failures never contain source text or parser causes. */
export type ConversionErrorCode = 'invalid-options' | 'invalid-snapshot' | 'content-limit' | 'invalid-plan';
export class ConversionError extends Error {
  constructor(readonly code: ConversionErrorCode) {
    super('Codex history conversion failed: ' + code);
    this.name = 'ConversionError';
  }
}
