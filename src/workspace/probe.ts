/** Read-only native filesystem observation; never mkdir, open a file, read contents or load a URI. */
import { lstat, realpath, stat } from 'node:fs/promises';
import { classifyWorkspacePath } from './paths.js';
import { checkCancellation } from './errors.js';
import type { PathAnalysis, PathState, PathStyle } from './types.js';
function errorState(error: unknown): PathState {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 'ENOENT') return 'missing';
  if (code === 'ENOTDIR') return 'not-directory';
  if (code === 'EACCES' || code === 'EPERM') return 'inaccessible';
  if (code === 'ENAMETOOLONG') return 'over-limit';
  if (code === 'EINVAL' || code === 'ELOOP') return 'invalid';
  return 'io-error';
}
export async function probeDirectory(path: string | null, style: PathStyle, maxBytes: number, signal?: AbortSignal): Promise<PathAnalysis> {
  checkCancellation(signal);
  const syntax = classifyWorkspacePath(path, style, maxBytes);
  const base = { input: path, canonicalPath: null, identity: null, isLink: false };
  if (syntax !== 'qualified' || path === null) return { ...base, state: syntax === 'qualified' ? 'invalid' : syntax };
  let isLink = false;
  try {
    const entry = await lstat(path, { bigint: true });
    checkCancellation(signal); isLink = entry.isSymbolicLink();
    if (!entry.isDirectory() && !isLink) return { ...base, state: 'not-directory' };
    const canonicalPath = await realpath(path);
    checkCancellation(signal);
    const canonicalSyntax = classifyWorkspacePath(canonicalPath, style, maxBytes);
    if (canonicalSyntax !== 'qualified') return { ...base, state: canonicalSyntax, isLink };
    const directory = await stat(canonicalPath, { bigint: true });
    checkCancellation(signal);
    if (!directory.isDirectory()) return { ...base, state: 'not-directory', isLink };
    return { input: path, state: 'directory', canonicalPath, isLink,
      identity: { device: directory.dev.toString(), inode: directory.ino.toString(), birthTimeNs: directory.birthtimeNs.toString() } };
  } catch (error) {
    checkCancellation(signal);
    return { ...base, state: errorState(error), isLink };
  }
}
