export const AUTH_IPC_CHANNELS = {
  AUTH_GOOGLE_DRIVE_STATUS: 'auth:google-drive-status',
  AUTH_GOOGLE_DRIVE_START: 'auth:google-drive-start',
  AUTH_GOOGLE_DRIVE_CODE: 'auth:google-drive-code',
  ADD_GOOGLE_DRIVE_SOURCE: 'add-google-drive-source',
} as const;

export interface AuthIpcContract {
  [AUTH_IPC_CHANNELS.AUTH_GOOGLE_DRIVE_STATUS]: {
    payload: [];
    response: boolean;
  };
  [AUTH_IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START]: {
    payload: [];
    response: string;
  };
  [AUTH_IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE]: {
    payload: [string];
    response: boolean;
  };
  [AUTH_IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE]: {
    payload: [string];
    response: { name?: string };
  };
}
