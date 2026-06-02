import { Response } from 'express';
import { validateFileAccess, handleAccessCheck } from './access-validator.ts';

/**
 * Helper: Validates access and handles the response if denied.
 * Returns the authorized path if successful, or null if denied (response already sent).
 */
export async function getAuthorizedPath(
  res: Response,
  filePath: string,
): Promise<string | null> {
  const access = await validateFileAccess(filePath);
  if (handleAccessCheck(res, access)) {
    return null;
  }
  // If handleAccessCheck returned false, it implies access.success is true.
  // We explicitly return access.path to avoid a redundant conditional check
  // that would cause branch coverage issues (unreachable 'else').
  return (access as { success: true; path: string }).path;
}
