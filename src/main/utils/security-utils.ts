import { authorizeFilePath } from '../../core/security';
export { filterAuthorizedPaths } from '../../core/security';
import { isDrivePath } from '../../core/media-utils';

/**
 * Validates access to a file path. Throws if access is denied.
 * Allows gdrive:// paths without check (assumed safe/handled by other layers).
 * Returns the authorized real path if applicable.
 */
export async function validatePathAccess(filePath: string): Promise<string> {
  if (isDrivePath(filePath)) return filePath;
  const auth = await authorizeFilePath(filePath);
  if (!auth.isAllowed) {
    throw new Error(auth.message || 'Access denied');
  }
  return auth.realPath || filePath;
}
