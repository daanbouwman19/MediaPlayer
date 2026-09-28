import { spawn } from 'child_process';
import { isDrivePath } from '../core/media/media-utils.ts';
import { createMediaSource } from '../core/media/media-source.ts';
import { getVlcPath } from './vlc-paths.ts';
import { authorizeFilePath } from '../core/auth/security.ts';

/**
 * Opens a media file in VLC Media Player.
 */
export async function openMediaInVlc(
  filePath: string,
): Promise<{ success: boolean; message?: string }> {
  // [SECURITY] Only library files (local or Drive) may be handed to VLC.
  const auth = await authorizeFilePath(filePath);
  if (!auth.isAllowed) {
    return { success: false, message: auth.message || 'Access denied' };
  }

  let fileArg = filePath;
  if (isDrivePath(filePath)) {
    // VLC cannot open gdrive:// paths. Like FFmpeg, it gets a URL on the
    // token-protected internal Drive proxy.
    try {
      fileArg = await createMediaSource(filePath).getFFmpegInput();
    } catch (error: unknown) {
      console.error('[vlc-player] Failed to prepare Drive stream:', error);
      return {
        success: false,
        message: 'Could not prepare the Google Drive file for VLC.',
      };
    }
  }

  const vlcPath = await getVlcPath();

  if (!vlcPath) {
    return {
      success: false,
      message: 'VLC Media Player not found. Please make sure VLC is installed.',
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
