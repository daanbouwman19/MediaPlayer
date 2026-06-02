import { spawn } from 'child_process';
import { MediaRoutes } from '../core/media/routes.ts';
import { isDrivePath } from '../core/media/media-utils.ts';
import { getVlcPath } from './vlc-paths.ts';
import { authorizeFilePath } from '../core/auth/security.ts';

/**
 * Opens a media file in VLC Media Player.
 */
export async function openMediaInVlc(
  filePath: string,
  serverPort: number,
): Promise<{ success: boolean; message?: string }> {
  let fileArg = filePath;

  if (isDrivePath(filePath)) {
    if (serverPort > 0) {
      fileArg = `http://localhost:${serverPort}${MediaRoutes.STREAM}?file=${encodeURIComponent(filePath)}`;
    } else {
      return {
        success: false,
        message: 'Local server is not running to stream files.',
      };
    }
  } else {
    // Local file auth check
    const auth = await authorizeFilePath(filePath);
    if (!auth.isAllowed) {
      return { success: false, message: auth.message || 'Access denied' };
    }
  }

  const vlcPath = await getVlcPath();

  if (!vlcPath) {
    return {
      success: false,
      message:
        'VLC Media Player not found. Please ensure it is installed in the default location.',
    };
  }

  return new Promise((resolve) => {
    try {
      // Use '--' to stop option parsing, preventing argument injection from filenames starting with '-'
      const child = spawn(vlcPath, ['--', fileArg], {
        detached: true,
        stdio: 'ignore',
      });

      const successTimeout = setTimeout(() => {
        child.unref();
        resolve({ success: true });
      }, 300);

      child.on('error', (err) => {
        clearTimeout(successTimeout);
        console.error('[vlc-player] Error launching VLC (async):', err);
        resolve({
          success: false,
          message: `Failed to launch VLC: ${err.message}`,
        });
      });
    } catch (error: unknown) {
      console.error('[vlc-player] Error launching VLC:', error);
      resolve({
        success: false,
        message: `Failed to launch VLC: ${(error as Error).message}`,
      });
    }
  });
}
