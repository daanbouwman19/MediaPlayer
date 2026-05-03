import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  validatePathAccess,
  filterAuthorizedPaths,
} from '../utils/security-utils';
import { generateFileUrl, getVideoDuration } from '../../core/media-handler';
import {
  getDriveFileMetadata,
  listDriveDirectory,
  getDriveParent,
} from '../google-drive-service';
import {
  recordMediaView,
  getMediaViewCounts,
  getRecentlyPlayed,
} from '../../core/database';
import { MediaService } from '../../core/media-service';
import { isDrivePath, getDriveId } from '../../core/media-utils';
import { MediaAnalyzer } from '../../core/analysis/media-analyzer';
import { HlsManager } from '../../core/hls-manager';
import { generateSessionId } from '../../core/hls-handler';
import { getServerPort } from '../local-server';
import { handleIpc } from '../utils/ipc-helper';
import { getFFmpegStaticPath } from '../../core/utils/ffmpeg-static-path';

async function getFFmpegPath(): Promise<string | null> {
  return getFFmpegStaticPath();
}

export function registerMediaHandlers(mediaService: MediaService) {
  handleIpc(
    IPC_CHANNELS.LOAD_FILE_AS_DATA_URL,
    async (
      _event: IpcMainInvokeEvent,
      filePath: string,
      options: { preferHttp?: boolean } = {},
    ) => {
      return generateFileUrl(filePath, {
        serverPort: getServerPort(),
        preferHttp: options.preferHttp,
      });
    },
  );

  handleIpc(
    IPC_CHANNELS.RECORD_MEDIA_VIEW,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      await recordMediaView(filePath);
    },
    {
      validators: [
        async (filePath) => {
          await validatePathAccess(filePath);
        },
      ],
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_MEDIA_VIEW_COUNTS,
    async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
      const allowedPaths = await filterAuthorizedPaths(filePaths);
      return getMediaViewCounts(allowedPaths);
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_VIDEO_METADATA,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      try {
        if (isDrivePath(filePath)) {
          const fileId = getDriveId(filePath);
          const meta = await getDriveFileMetadata(fileId);
          if (meta.videoMediaMetadata?.durationMillis) {
            return {
              duration: Number(meta.videoMediaMetadata.durationMillis) / 1000,
            };
          }
          throw new Error('Duration not available');
        }

        await validatePathAccess(filePath);

        const ffmpegPath = await getFFmpegPath();
        if (!ffmpegPath) {
          throw new Error('FFmpeg binary not found');
        }

        const res = await getVideoDuration(filePath, ffmpegPath);
        if ('error' in res) throw new Error(res.error);
        return res;
      } catch (error: unknown) {
        console.error('[MediaController] Error getting video metadata:', error);
        throw error;
      }
    },
  );

  handleIpc(IPC_CHANNELS.GET_ALBUMS_WITH_VIEW_COUNTS, async () => {
    const ffmpegPath = await getFFmpegPath();
    return mediaService.getAlbumsWithViewCounts(ffmpegPath || undefined);
  });

  handleIpc(IPC_CHANNELS.REINDEX_MEDIA_LIBRARY, async () => {
    const ffmpegPath = await getFFmpegPath();
    return mediaService.getAlbumsWithViewCountsAfterScan(
      ffmpegPath || undefined,
    );
  });

  handleIpc(
    IPC_CHANNELS.MEDIA_EXTRACT_METADATA,
    async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
      const ffmpegPath = await getFFmpegPath();
      if (!ffmpegPath) {
        console.warn('FFmpeg not found, skipping metadata extraction');
        return;
      }

      // [SECURITY] Filter out unauthorized paths to prevent arbitrary file access
      const allowedPaths = await filterAuthorizedPaths(filePaths);

      mediaService
        .extractAndSaveMetadata(allowedPaths, ffmpegPath, {
          forceCheck: true,
        })
        .catch((err) => console.error('State extraction failed', err));
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_GET_RECENTLY_PLAYED,
    async (_event: IpcMainInvokeEvent, limit?: number) => {
      return getRecentlyPlayed(limit);
    },
  );

  handleIpc(
    IPC_CHANNELS.DRIVE_LIST_DIRECTORY,
    async (_event, folderId: string) => {
      return await listDriveDirectory(folderId || 'root');
    },
  );

  handleIpc(IPC_CHANNELS.DRIVE_GET_PARENT, async (_event, folderId: string) => {
    try {
      return await getDriveParent(folderId);
    } catch (err) {
      console.error('Failed to get drive parent', err);
      return null;
    }
  });

  handleIpc(
    IPC_CHANNELS.GET_HEATMAP,
    async (_event, filePath: string, points?: number) => {
      try {
        await validatePathAccess(filePath);
        return MediaAnalyzer.getInstance().generateHeatmap(filePath, points);
      } catch (err) {
        console.error('[MediaController] Error getting heatmap:', err);
        throw err;
      }
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_HEATMAP_PROGRESS,
    async (_event, filePath: string) => {
      try {
        await validatePathAccess(filePath);
        return MediaAnalyzer.getInstance().getProgress(filePath);
      } catch (err) {
        console.error('[MediaController] Error getting heatmap progress:', err);
        return null;
      }
    },
  );

  handleIpc(IPC_CHANNELS.GET_HLS_STATUS, async (_event, filePath: string) => {
    try {
      const authorizedPath = await validatePathAccess(filePath);
      const sessionId = await generateSessionId(authorizedPath);
      return HlsManager.getInstance().getSessionProgress(sessionId);
    } catch (err) {
      console.error('[MediaController] Error getting HLS status:', err);
      return null;
    }
  });
}
