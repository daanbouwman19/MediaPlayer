import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  generateAuthUrl,
  authenticateWithCode,
  checkGoogleDriveAuth,
} from '../google-auth';
import { startAuthServer } from '../auth-server';
import { getDriveClient } from '../google-drive-service';
import { addMediaDirectory } from '../../core/database/database';
import { handleIpc } from '../utils/ipc-helper';

export function registerAuthHandlers() {
  handleIpc(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_STATUS, async () => {
    return await checkGoogleDriveAuth();
  });

  handleIpc(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START, async () => {
    const url = generateAuthUrl();
    startAuthServer(3000).catch((err) =>
      console.error('Failed to start auth server', err),
    );
    return url;
  });

  handleIpc(
    IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE,
    async (_event: IpcMainInvokeEvent, code: string) => {
      await authenticateWithCode(code);
      return true;
    },
  );

  handleIpc(
    IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE,
    async (_event: IpcMainInvokeEvent, folderId: string) => {
      const drive = await getDriveClient();
      const res = await drive.files.get({
        fileId: folderId,
        fields: 'id, name',
      });
      await addMediaDirectory({
        path: `gdrive://${res.data.id}`,
        type: 'google_drive',
        name: res.data.name || 'Google Drive Folder',
      });
      return { name: res.data.name || undefined };
    },
  );
}
