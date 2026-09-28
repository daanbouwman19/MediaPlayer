/**
 * @file Best-effort housekeeping for on-disk derived-data caches
 * (thumbnails, heatmaps).
 */
import fs from 'fs/promises';
import path from 'path';

export interface CacheSweepOptions {
  /** True for the cache entries this sweep manages. */
  isEntry: (fileName: string) => boolean;
  /** True for temp files left behind by an interrupted write. */
  isTempFile: (fileName: string) => boolean;
  /** Entries not written or used for this long are deleted. */
  maxAgeMs: number;
  /** Temp files older than this are deleted. */
  tempMaxAgeMs: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Delay before the first sweep so it does not compete with startup I/O. */
const SWEEP_DELAY_MS = 60 * 1000;
/** Bound on the "already touched" set; it is simply reset when full. */
const MAX_TOUCHED_ENTRIES = 50_000;

/**
 * Deletes expired entries and stale temp files from `dir`.
 * Files that other code owns (names neither predicate accepts) are left alone.
 * @returns The number of files removed.
 */
export async function pruneCacheDir(
  dir: string,
  options: CacheSweepOptions,
  now = Date.now(),
): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0; // Missing or unreadable cache dir: nothing to prune.
  }

  let removed = 0;
  for (const name of names) {
    const isTemp = options.isTempFile(name);
    if (!isTemp && !options.isEntry(name)) continue;
    const maxAge = isTemp ? options.tempMaxAgeMs : options.maxAgeMs;
    const file = path.join(dir, name);
    try {
      const stats = await fs.stat(file);
      if (stats.isFile() && now - stats.mtimeMs > maxAge) {
        await fs.rm(file, { force: true });
        removed++;
      }
    } catch {
      // Vanished or locked by a concurrent reader: try again next sweep.
    }
  }
  return removed;
}

/**
 * Schedules periodic sweeps of cache directories and keeps entries that are
 * still in use from expiring.
 */
export class CacheSweeper {
  private readonly options: CacheSweepOptions;
  private readonly intervalMs: number;
  private readonly lastSweep = new Map<string, number>();
  private readonly touched = new Set<string>();

  constructor(options: CacheSweepOptions, intervalMs = ONE_DAY_MS) {
    this.options = options;
    this.intervalMs = intervalMs;
  }

  /** Sweeps `dir` in the background, at most once per interval. */
  maybeSweep(dir: string): void {
    const now = Date.now();
    const last = this.lastSweep.get(dir);
    if (last !== undefined && now - last < this.intervalMs) return;
    this.lastSweep.set(dir, now);

    const timer = setTimeout(() => {
      pruneCacheDir(dir, this.options).catch((err: unknown) => {
        console.warn(`[Cache] Failed to prune ${dir}:`, err);
      });
    }, SWEEP_DELAY_MS);
    timer.unref();
  }

  /**
   * Marks a cache entry as used by bumping its mtime, once per process, so a
   * sweep only removes entries nobody has read for `maxAgeMs`.
   */
  touch(file: string): void {
    if (this.touched.has(file)) return;
    if (this.touched.size >= MAX_TOUCHED_ENTRIES) this.touched.clear();
    this.touched.add(file);
    const now = new Date();
    fs.utimes(file, now, now).catch(() => {
      // Best effort: the entry may have been replaced or removed meanwhile.
    });
  }
}
