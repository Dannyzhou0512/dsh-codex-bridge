/** Public pure classification; no URI decoding or process-cwd expansion. */
import { posix, win32 } from 'node:path';
import { qualifiedTarget } from '../converter/paths.js';
import type { PathStyle, PathSyntax } from './types.js';
/** @param path - original or explicit target spelling. @param style - intended Host filesystem. @param maxBytes - explicit UTF-8 cap. */
export function classifyWorkspacePath(path: string | null, style: PathStyle, maxBytes: number): PathSyntax {
  if (path === null || path.length === 0 || path.includes('\0')) return 'invalid';
  if (Buffer.byteLength(path, 'utf8') > maxBytes) return 'over-limit';
  if (/^[\\/]{2}[?.][\\/]/.test(path)) return 'device-path';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) && !/^[a-zA-Z]:/.test(path)) return 'uri';
  if (style === 'posix') {
    if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')) return 'foreign-platform';
    return posix.isAbsolute(path) ? 'qualified' : 'unqualified';
  }
  if (path.startsWith('/') && !path.startsWith('//')) return 'foreign-platform';
  const root = win32.parse(path).root;
  if (!win32.isAbsolute(path) || root === '\\' || root === '/') return 'unqualified';
  return qualifiedTarget(win32.normalize(path), 'windows') ? 'qualified' : 'unqualified';
}
