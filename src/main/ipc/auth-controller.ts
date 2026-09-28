import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  generateAuthUrl,
  authenticateWithCode,
  checkGoogleDriveAuth,
  getPendingAuthState,
} from '../../infrastructure/google-auth';
import { startAuthServer } from '../auth-server';
import { getDriveFolderInfo } from '../../infrastructure/google-drive-service';
import { getGoogleRedirectUri } from '../../infrastructure/google-secrets';
import { addMediaDirectory } from '../../core/database/database';
import { handleIpc } from '../utils/ipc-helper';

export function registerAuthHandlers() {
  handleIpc(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_STATUS, async () => {
    return await checkGoogleDriveAuth();
  });

  handleIpc(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START, async () => {
    const url = generateAuthUrl();
    // Listen where the redirect URI points before sending the user to Google;
    // a failure reaches the renderer instead of a dead redirect later. Pass a
    // getter (not the current value) so a restarted auth flow validates
    // against the freshest state if the server is reused.
    await startAuthServer(getGoogleRedirectUri(), getPendingAuthState);
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
      const folder = await getDriveFolderInfo(folderId);
      await addMediaDirectory({
        path: `gdrive://${folder.id}`,
        type: 'google_drive',
        name: folder.name,
      });
      return { name: folder.name };
    },
  );
}
