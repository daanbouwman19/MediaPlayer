export const AUTH_IPC_CHANNELS = {
  AUTH_GOOGLE_DRIVE_STATUS: 'auth:google-drive-status',
  AUTH_GOOGLE_DRIVE_START: 'auth:google-drive-start',
  AUTH_GOOGLE_DRIVE_CODE: 'auth:google-drive-code',
  ADD_GOOGLE_DRIVE_SOURCE: 'add-google-drive-source',
  AUTH_LOCK_STATUS: 'auth:lock-status',
  AUTH_UNLOCK: 'auth:unlock',
  AUTH_LOCK: 'auth:lock',
  AUTH_SET_PIN: 'auth:set-pin',
  AUTH_CLEAR_PIN: 'auth:clear-pin',
} as const;

export type PinUnlockResult = 'ok' | 'invalid' | 'rateLimited';

export interface AuthIpcContract {
  [AUTH_IPC_CHANNELS.AUTH_LOCK_STATUS]: {
    payload: [];
    response: { enabled: boolean; isAuthenticated: boolean };
  };
  [AUTH_IPC_CHANNELS.AUTH_UNLOCK]: {
    payload: [string];
    response: PinUnlockResult;
  };
  [AUTH_IPC_CHANNELS.AUTH_LOCK]: {
    payload: [];
    response: void;
  };
  [AUTH_IPC_CHANNELS.AUTH_SET_PIN]: {
    payload: [string];
    response: void;
  };
  [AUTH_IPC_CHANNELS.AUTH_CLEAR_PIN]: {
    payload: [];
    response: void;
  };
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
    response: { name?: string | undefined };
  };
}
