/**
 * @file Helpers for reasoning about how media sources relate to each other.
 * Nested (overlapping) local sources would index the files in the overlap
 * twice, so adding one is refused and scans collapse any that already exist.
 */
import path from 'path';
import { isDrivePath } from '../media-utils.ts';
import type { MediaDirectory } from '../types.ts';

type PathApi = typeof path.posix;

/** How a candidate source relates to an existing one. */
export type SourceOverlapRelation = 'same' | 'inside' | 'contains';

export interface SourceOverlap {
  /** The existing source that overlaps the candidate. */
  source: string;
  relation: SourceOverlapRelation;
}

/** Raised when a new source would overlap an existing one. */
export class SourceOverlapError extends Error {
  constructor(
    public readonly candidate: string,
    public readonly overlap: SourceOverlap,
  ) {
    super(describeSourceOverlap(candidate, overlap));
    this.name = 'SourceOverlapError';
  }
}

function pathApiFor(platform: NodeJS.Platform): PathApi {
  // path.win32.relative compares case-insensitively, like the filesystem.
  return platform === 'win32' ? path.win32 : path.posix;
}

/** True if `child` is `parent` itself or lies somewhere below it. */
function isWithin(p: PathApi, parent: string, child: string): boolean {
  const rel = p.relative(parent, child);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel))
  );
}

/**
 * Finds an existing local source that the candidate duplicates (under a
 * different spelling), lies inside, or contains. Google Drive sources are
 * identified by folder ID and are never compared. An exact duplicate is not
 * an overlap: re-adding a source just reactivates it.
 * @param candidate - Absolute path of the source being added.
 * @param existingSources - Paths of the sources to compare against.
 * @param platform - Platform whose path rules apply (for tests).
 */
export function findSourceOverlap(
  candidate: string,
  existingSources: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SourceOverlap | null {
  if (!candidate || isDrivePath(candidate)) return null;
  const p = pathApiFor(platform);

  for (const source of existingSources) {
    if (!source || source === candidate || isDrivePath(source)) continue;
    const inside = isWithin(p, source, candidate);
    const contains = isWithin(p, candidate, source);
    if (inside && contains) return { source, relation: 'same' };
    if (inside) return { source, relation: 'inside' };
    if (contains) return { source, relation: 'contains' };
  }
  return null;
}

/** A user-facing explanation of why a source can't be added. */
export function describeSourceOverlap(
  candidate: string,
  { source, relation }: SourceOverlap,
): string {
  switch (relation) {
    case 'same':
      return `"${candidate}" is already a media source ("${source}").`;
    case 'inside':
      return `"${candidate}" is inside the media source "${source}", which already includes it.`;
    case 'contains':
      return `"${candidate}" contains the media source "${source}". Remove that source first to add this folder.`;
  }
}

/**
 * Finds an active source that `candidate` overlaps (see
 * {@link findSourceOverlap}). Inactive sources are ignored (a scan collapses
 * them if they are reactivated later), so a subfolder of a deactivated
 * source can still be added on its own.
 */
export function findActiveSourceOverlap(
  candidate: string,
  directories: readonly MediaDirectory[],
  platform: NodeJS.Platform = process.platform,
): SourceOverlap | null {
  const active: string[] = [];
  for (const dir of directories) {
    if (dir.isActive) active.push(dir.path);
  }
  return findSourceOverlap(candidate, active, platform);
}

/**
 * Throws a {@link SourceOverlapError} if `candidate` overlaps one of the
 * active sources (see {@link findActiveSourceOverlap}).
 */
export function assertNoSourceOverlap(
  candidate: string,
  directories: readonly MediaDirectory[],
  platform: NodeJS.Platform = process.platform,
): void {
  const overlap = findActiveSourceOverlap(candidate, directories, platform);
  if (overlap) {
    throw new SourceOverlapError(candidate, overlap);
  }
}

/**
 * Drops sources that are nested inside another source in the list, keeping
 * the outermost one (and the first of two spellings of the same folder), so
 * the overlap is scanned and indexed once.
 * @param sourcePaths - Paths of the sources to scan, in priority order.
 * @param platform - Platform whose path rules apply (for tests).
 */
export function collapseNestedSources(
  sourcePaths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const p = pathApiFor(platform);
  const result: string[] = [];

  for (let i = 0; i < sourcePaths.length; i++) {
    const candidate = sourcePaths[i];
    if (!candidate) continue;
    let covered = false;
    if (!isDrivePath(candidate)) {
      for (let j = 0; j < sourcePaths.length && !covered; j++) {
        const other = sourcePaths[j];
        if (j === i || !other || isDrivePath(other)) continue;
        if (!isWithin(p, other, candidate)) continue;
        // Strictly inside `other`, or the later spelling of the same folder.
        covered = !isWithin(p, candidate, other) || j < i;
      }
    }
    if (!covered) result.push(candidate);
  }
  return result;
}
