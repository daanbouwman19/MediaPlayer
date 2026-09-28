import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { validatePathAccess } from '../utils/security-utils';
import {
  generateFileUrl,
  getVideoDuration,
} from '../../core/media/media-handler';
import {
  getDriveFileMetadata,
  listDriveDirectory,
  getDriveParent,
} from '../google-drive-service';
import { getDriveCacheManager } from '../drive-cache-manager';
import {
  recordMediaView,
  getMediaViewCounts,
  getRecentlyPlayed,
  listTranscodeJobs,
  deleteTranscodeJob,
} from '../../core/database/database';
import { TranscodeQueueManager } from '../../core/media/transcode-queue-manager';
import { MediaService } from '../../core/media/media-service';
import { filterAuthorizedLibraryPaths } from '../../core/media/utils/authorized-paths';
import { isDrivePath, getDriveId } from '../../core/media/media-utils';
import { MediaAnalyzer } from '../../core/media/analysis/media-analyzer';
import { HlsManager } from '../../core/media/hls-manager';
import { generateSessionId } from '../../core/media/hls-handler';
import { getServerPort } from '../local-server';
import { handleIpc } from '../utils/ipc-helper';
import { getFFmpegStaticPath } from '../../infrastructure/ffmpeg-static-path';

async function getFFmpegPath(): Promise<string | null> {
  return getFFmpegStaticPath();
}

/** In-flight heatmap requests per window and file, for CANCEL_HEATMAP. */
const pendingHeatmapRequests = new Map<string, Set<AbortController>>();

function heatmapRequestKey(event: IpcMainInvokeEvent, filePath: string) {
  return `${event.sender.id}\0${filePath}`;
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
      // Rows are keyed by the library's spelling, not the resolved real path.
      const allowedPaths = await filterAuthorizedLibraryPaths(filePaths);
      return getMediaViewCounts(allowedPaths);
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_VIDEO_METADATA,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      try {
        // [SECURITY] Drive IDs must belong to the library, like local paths.
        await validatePathAccess(filePath);

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

      // [SECURITY] Filter out unauthorized paths to prevent arbitrary file access.
      // Keeps the library's spelling so metadata lands on the scanned rows.
      const allowedPaths = await filterAuthorizedLibraryPaths(filePaths);

      // Joins the single background extraction job instead of running
      // another one alongside it.
      mediaService.queueMetadataExtraction(allowedPaths, ffmpegPath, {
        forceCheck: true,
      });
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
    async (event, filePath: string, points?: number) => {
      // Tracked so CANCEL_HEATMAP from the same window can leave the analysis.
      const key = heatmapRequestKey(event, filePath);
      const controller = new AbortController();
      const requests =
        pendingHeatmapRequests.get(key) ?? new Set<AbortController>();
      requests.add(controller);
      pendingHeatmapRequests.set(key, requests);
      try {
        await validatePathAccess(filePath);
        return await MediaAnalyzer.getInstance().generateHeatmap(
          filePath,
          points,
          { signal: controller.signal },
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[MediaController] Error getting heatmap:', err);
        }
        throw err;
      } finally {
        requests.delete(controller);
        if (
          requests.size === 0 &&
          pendingHeatmapRequests.get(key) === requests
        ) {
          pendingHeatmapRequests.delete(key);
        }
      }
    },
  );

  handleIpc(
    IPC_CHANNELS.CANCEL_HEATMAP,
    (event: IpcMainInvokeEvent, filePath: string) => {
      const requests = pendingHeatmapRequests.get(
        heatmapRequestKey(event, filePath),
      );
      for (const controller of requests ?? []) controller.abort();
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

  handleIpc(
    IPC_CHANNELS.TRANSCODE_JOB_ADD,
    async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
      const manager = TranscodeQueueManager.getInstance();
      for (const filePath of filePaths) {
        const authorized = await validatePathAccess(filePath);
        await manager.enqueue(authorized);
      }
    },
  );

  handleIpc(IPC_CHANNELS.TRANSCODE_JOB_LIST, async () => {
    return listTranscodeJobs();
  });

  handleIpc(
    IPC_CHANNELS.TRANSCODE_JOB_CANCEL,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      const authorized = await validatePathAccess(filePath);
      await TranscodeQueueManager.getInstance().cancel(authorized);
      await deleteTranscodeJob(authorized);
    },
  );

  handleIpc(
    IPC_CHANNELS.DRIVE_CACHE_STATUS,
    async (_event: IpcMainInvokeEvent, fileId: string) => {
      try {
        const cacheManager = getDriveCacheManager();
        return await cacheManager.getCacheStatus(fileId);
      } catch (err) {
        console.error('[MediaController] Error getting cache status:', err);
        return { status: 'cloud', progress: 0 };
      }
    },
  );

  handleIpc(
    IPC_CHANNELS.DRIVE_CACHE_TRIGGER,
    async (_event: IpcMainInvokeEvent, fileId: string) => {
      try {
        // [SECURITY] Only cache Drive files that are part of the library.
        await validatePathAccess(`gdrive://${fileId}`);
        const cacheManager = getDriveCacheManager();
        await cacheManager.triggerDownload(fileId);
      } catch (err) {
        console.error('[MediaController] Error triggering download:', err);
        throw err;
      }
    },
  );
}
