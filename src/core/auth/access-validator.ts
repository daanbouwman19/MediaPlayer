import { Response } from 'express';
import { authorizeFilePath } from './security.ts';
import type { AuthorizationResult } from './security.ts';

export type FileAccessResult =
  | { success: true; path: string }
  | { success: false; error: string; statusCode: number };

/**
 * Helper: Validates access to the file path.
 * Returns a result object indicating success or failure.
 *
 * This encapsulates the logic of checking "gdrive://" bypass vs local file authorization.
 */
export async function validateFileAccess(
  filePath: string,
): Promise<FileAccessResult> {
  try {
    const auth: AuthorizationResult = await authorizeFilePath(filePath);
    if (!auth.isAllowed) {
      return { success: false, error: 'Access denied.', statusCode: 403 };
    }
    if (!auth.realPath) {
      return { success: false, error: 'Access denied.', statusCode: 403 };
    }
    // We return the authorized realPath to ensure subsequent file operations use the validated path.
    return { success: true, path: auth.realPath };
  } catch (error) {
    console.error('[Access] Validation error:', error);
    return { success: false, error: 'Internal server error.', statusCode: 500 };
  }
}

/**
 * Helper to handle the response when access is denied.
 * Returns true if access failed and response was handled, false otherwise.
 */
export function handleAccessCheck(
  res: Response,
  access: FileAccessResult,
): boolean {
  if (!access.success) {
    if (!res.headersSent) {
      res.status(access.statusCode).send(access.error);
    }
    return true;
  }
  return false;
}
