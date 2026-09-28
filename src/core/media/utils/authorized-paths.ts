/**
 * @file Authorization filter for paths that key library rows.
 */
import { authorizeFilePath } from '../../auth/security.ts';
import { getMediaDirectories } from '../../database/database.ts';
import { DISK_SCAN_CONCURRENCY } from '../constants.ts';
import { ConcurrencyLimiter } from './concurrency-limiter.ts';

/**
 * Returns the paths the caller may access, spelled exactly as given.
 *
 * filterAuthorizedPaths returns resolved real paths, which suits opening a
 * file. Library rows (metadata, ratings, views), however, are keyed by the
 * path string the scan stored: under a second spelling of a scanned file (a
 * symlinked or differently cased source) a read misses the row and a write
 * forks a new one. Callers that read or write library rows therefore keep
 * the library's own spelling, which is also the key the client looks up in
 * the response.
 * @param filePaths - Candidate paths, as listed by the library.
 */
export async function filterAuthorizedLibraryPaths(
  filePaths: string[],
): Promise<string[]> {
  if (filePaths.length > 1) {
    // Warm the directory cache once instead of once per path.
    await getMediaDirectories();
  }

  const limiter = new ConcurrencyLimiter(DISK_SCAN_CONCURRENCY);
  const results = await Promise.all(
    filePaths.map((filePath) =>
      limiter.run(async () =>
        (await authorizeFilePath(filePath)).isAllowed ? filePath : null,
      ),
    ),
  );
  return results.filter((p): p is string => p !== null);
}
