/**
 * A tiny in-memory stand-in for the parts of fs/promises that directory
 * browsing uses (realpath, stat, readdir). Real temp directories cannot be
 * used for these tests: they live under /tmp (a restricted root on Linux) or
 * <profile>\AppData (a sensitive location on Windows), which is exactly what
 * the real security checks under test reject.
 *
 * Usage: vi.mock('fs/promises', async () => (await import('<this file>')).virtualFsModule)
 */
import path from 'path';

type EntryType = 'dir' | 'file';

const entries = new Map<string, EntryType>();

function key(p: unknown): string {
  return path.resolve(String(p));
}

function enoent(p: unknown): Error {
  return Object.assign(
    new Error(`ENOENT: no such file or directory, '${String(p)}'`),
    {
      code: 'ENOENT',
    },
  );
}

export const virtualFs = {
  reset(): void {
    entries.clear();
  },
  /** Adds a directory (and its missing parents); returns its resolved path. */
  addDir(p: string): string {
    let current = key(p);
    const resolved = current;
    while (!entries.has(current)) {
      entries.set(current, 'dir');
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return resolved;
  },
  /** Adds a file (and its parent directories); returns its resolved path. */
  addFile(p: string): string {
    const resolved = key(p);
    virtualFs.addDir(path.dirname(resolved));
    entries.set(resolved, 'file');
    return resolved;
  },
};

const promises = {
  realpath: async (p: unknown): Promise<string> => {
    const k = key(p);
    if (!entries.has(k)) throw enoent(p);
    return k;
  },
  stat: async (p: unknown) => {
    const type = entries.get(key(p));
    if (!type) throw enoent(p);
    return { isDirectory: () => type === 'dir', isFile: () => type === 'file' };
  },
  readdir: async (p: unknown) => {
    const dir = key(p);
    if (entries.get(dir) !== 'dir') throw enoent(p);
    const children: { name: string; isDirectory: () => boolean }[] = [];
    for (const [entryPath, type] of entries) {
      if (entryPath !== dir && path.dirname(entryPath) === dir) {
        children.push({
          name: path.basename(entryPath),
          isDirectory: () => type === 'dir',
        });
      }
    }
    return children;
  },
  mkdir: async () => undefined,
  readFile: async (p: unknown) => {
    throw enoent(p);
  },
};

export const virtualFsModule = { ...promises, default: promises };
