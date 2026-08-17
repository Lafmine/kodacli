import {lstat, realpath} from 'node:fs/promises';
import path from 'node:path';

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolveWorkspacePath(workspace: string, requested: string, allowMissing = false): Promise<string> {
  const root = await realpath(workspace);
  const candidate = path.resolve(root, requested);
  if (!isInside(root, candidate)) throw new Error('Path is outside the workspace.');

  try {
    const resolved = await realpath(candidate);
    if (!isInside(root, resolved)) throw new Error('Path resolves outside the workspace.');
    return resolved;
  } catch (error) {
    if (!allowMissing) throw error;
    const parent = await realpath(path.dirname(candidate));
    if (!isInside(root, parent)) throw new Error('Parent resolves outside the workspace.');
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error('Refusing to write through a symbolic link.');
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
    }
    return candidate;
  }
}

export function truncateOutput(value: string, maxChars: number): {output: string; truncated: boolean} {
  if (value.length <= maxChars) return {output: value, truncated: false};
  return {output: `${value.slice(0, maxChars)}\n… output truncated`, truncated: true};
}
