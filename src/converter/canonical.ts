/** Stable JSON and hashes cover only explicitly projected public values. */
import { createHash } from 'node:crypto';
import { ConversionError } from './errors.js';

/** @param value - JSON-only value. @returns locale-independent key-sorted JSON, preserving array order. */
export function canonicalJson(value: unknown): string {
  const stack = new Set<object>();
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) return input;
    if (typeof input !== 'object' || input === null || stack.has(input)) throw new ConversionError('invalid-snapshot');
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
      throw new ConversionError('invalid-snapshot');
    stack.add(input);
    const result = Array.isArray(input) ? input.map(visit) :
      Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, visit(child)]));
    stack.delete(input);
    return result;
  };
  return JSON.stringify(visit(value));
}
/** @param namespace - fixed versioned purpose. @param value - public JSON. @returns SHA-256 hex. */
export function digest(namespace: string, value: unknown): string {
  return createHash('sha256').update(namespace + '\0').update(canonicalJson(value)).digest('hex');
}
/** @param value - complete serializable result. @param limit - explicit UTF-8 byte cap. */
export function assertBytes(value: unknown, limit: number): void {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > limit) throw new ConversionError('content-limit');
}
/** @param value - newly owned acyclic JSON value. @returns deeply immutable output. */
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
