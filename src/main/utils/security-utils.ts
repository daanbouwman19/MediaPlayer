import { authorizeFilePath } from '../../core/auth/security';
export { filterAuthorizedPaths } from '../../core/auth/security';

/**
 * Validates access to a file path. Throws if access is denied.
 * Local paths must resolve inside a media directory; gdrive:// paths must be
 * files of the scanned library (authorizeFilePath checks both).
 * Returns the authorized real path if applicable.
 */
export async function validatePathAccess(filePath: string): Promise<string> {
  // IPC payloads are untyped at runtime.
  if (typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  const auth = await authorizeFilePath(filePath);
  if (!auth.isAllowed) {
    throw new Error(auth.message || 'Access denied');
  }
  return auth.realPath || filePath;
}
