import {
  IpcMainInvokeEvent,
  shell,
  dialog,
  ipcMain,
  nativeTheme,
} from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  addMediaDirectory,
  removeMediaDirectory,
  setDirectoryActiveState,
  getMediaDirectories,
} from '../database';
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
} from '../../core/constants';
import { getServerPort } from '../local-server';
import { openMediaInVlc } from '../../core/vlc-player';
import { listDirectory } from '../../core/file-system';
import { handleIpc } from '../utils/ipc-helper';
import { isSensitiveDirectory, isRestrictedPath } from '../../core/security';

export function registerSystemHandlers() {
  handleIpc(
    IPC_CHANNELS.ADD_MEDIA_DIRECTORY,
    async (_event: IpcMainInvokeEvent, targetPath?: string) => {
      if (targetPath) {
        try {
          // Resolve symlinks to prevent bypass of sensitive directory checks
          let resolvedPath = targetPath;
          try {
            resolvedPath = await fs.realpath(targetPath);
          } catch {
            return null; // File likely doesn't exist
          }

          if (isSensitiveDirectory(resolvedPath)) {
            console.warn(
              `[Security] Blocked attempt to add sensitive directory: ${targetPath} (resolved to ${resolvedPath})`,
            );
            return null;
          }

          await addMediaDirectory({ path: resolvedPath, type: 'local' });
          return resolvedPath;
        } catch (e) {
          console.error('Failed to add directory by path', e);
          return null;
        }
      }
      return null;
    },
  );

  handleIpc(
    IPC_CHANNELS.REMOVE_MEDIA_DIRECTORY,
    async (_event: IpcMainInvokeEvent, directoryPath: string) => {
      await removeMediaDirectory(directoryPath);
    },
  );

  handleIpc(
    IPC_CHANNELS.SET_DIRECTORY_ACTIVE_STATE,
    async (
      _event: IpcMainInvokeEvent,
      { directoryPath, isActive }: { directoryPath: string; isActive: boolean },
    ) => {
      await setDirectoryActiveState(directoryPath, isActive);
    },
  );

  handleIpc(IPC_CHANNELS.GET_MEDIA_DIRECTORIES, async () => {
    return getMediaDirectories();
  });

  handleIpc(IPC_CHANNELS.GET_SUPPORTED_EXTENSIONS, () => {
    return {
      images: SUPPORTED_IMAGE_EXTENSIONS,
      videos: SUPPORTED_VIDEO_EXTENSIONS,
      all: ALL_SUPPORTED_EXTENSIONS,
    };
  });

  handleIpc(IPC_CHANNELS.GET_SERVER_PORT, () => {
    return getServerPort();
  });

  handleIpc(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (_event: IpcMainInvokeEvent, url: string) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          console.warn(
            `[Security] Blocked non-http protocol: ${parsed.protocol}`,
          );
          return;
        }

        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Cancel', 'Open'],
          defaultId: 1,
          title: 'Open External Link',
          message: `Do you want to open this external link?\n\n${url}`,
        });

        if (response === 1) {
          await shell.openExternal(url);
        }
      } catch {
        console.warn(`[Security] Invalid URL: ${url}`);
      }
    },
  );

  handleIpc(
    IPC_CHANNELS.OPEN_IN_VLC,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      return openMediaInVlc(filePath, getServerPort());
    },
  );

  handleIpc(
    IPC_CHANNELS.LIST_DIRECTORY,
    async (_event: IpcMainInvokeEvent, directoryPath: string) => {
      if (isRestrictedPath(directoryPath)) {
        console.warn(
          `[Security] Blocked attempt to list restricted directory: ${directoryPath}`,
        );
        throw new Error('Access denied');
      }
      return listDirectory(directoryPath);
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_PARENT_DIRECTORY,
    async (_event: IpcMainInvokeEvent, targetPath: string) => {
      if (!targetPath) return null;
      const parent = path.dirname(targetPath);
      if (parent === targetPath) return null;
      return parent;
    },
  );

  ipcMain.on(IPC_CHANNELS.THEME_CHANGED, (_event, theme: string) => {
    nativeTheme.themeSource =
      (theme as 'light' | 'dark' | 'system') || 'system';
  });
}
