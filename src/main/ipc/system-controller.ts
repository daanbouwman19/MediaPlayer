import {
  IpcMainInvokeEvent,
  shell,
  dialog,
  ipcMain,
  nativeTheme,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  addMediaDirectory,
  removeMediaDirectory,
  setDirectoryActiveState,
  getMediaDirectories,
} from '../../core/database/database';
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
} from '../../core/media/constants';
import { getServerPort } from '../local-server';
import { openMediaInVlc } from '../../infrastructure/vlc-player';
import {
  getParentDirectory,
  listDirectory,
  resolveMediaSourceDirectory,
} from '../../core/media/file-system';
import { handleIpc } from '../utils/ipc-helper';
import { assertNoSourceOverlap } from '../../core/media/utils/source-paths';

export function registerSystemHandlers() {
  handleIpc(
    IPC_CHANNELS.ADD_MEDIA_DIRECTORY,
    async (_event: IpcMainInvokeEvent, targetPath?: string) => {
      if (!targetPath) return null;
      // Throws a descriptive error (shown by the renderer) when the folder is
      // missing, sensitive or outside the allowed roots, instead of a silent
      // null.
      const resolvedPath = await resolveMediaSourceDirectory(targetPath);
      // Nested sources would index the overlap twice; SourceOverlapError
      // reaches the renderer as the IPC error.
      assertNoSourceOverlap(resolvedPath, await getMediaDirectories());
      await addMediaDirectory({ path: resolvedPath, type: 'local' });
      return resolvedPath;
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
      return openMediaInVlc(filePath);
    },
  );

  handleIpc(
    IPC_CHANNELS.LIST_DIRECTORY,
    async (_event: IpcMainInvokeEvent, directoryPath: string) => {
      // listDirectory handles the 'ROOT' sentinel before any path check and
      // applies the same restriction checks as the web route.
      return listDirectory(directoryPath);
    },
  );

  handleIpc(
    IPC_CHANNELS.GET_PARENT_DIRECTORY,
    async (_event: IpcMainInvokeEvent, targetPath: string) => {
      return getParentDirectory(targetPath);
    },
  );

  ipcMain.on(IPC_CHANNELS.THEME_CHANGED, (_event, theme: string) => {
    nativeTheme.themeSource =
      theme === 'light' || theme === 'dark' || theme === 'system'
        ? theme
        : 'system';
  });
}
