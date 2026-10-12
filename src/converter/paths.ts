/** Pure path qualification; directory existence/canonicalization belongs to the Workspace mapper. */
import { posix, win32 } from 'node:path';
export function qualifiedTarget(path: string | null, style: 'windows' | 'posix'): boolean {
  if (path === null || path.includes('\0')) return false;
  if (style === 'posix') return posix.isAbsolute(path);
  return win32.isAbsolute(path) && (/^[a-zA-Z]:[\\/]/.test(path)
    || /^\\\\(?![?.][\\/])[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(path));
}
