import { AUTH_IPC_CHANNELS } from './ipc/auth.contract';
import { DATABASE_IPC_CHANNELS } from './ipc/database.contract';
import { MEDIA_IPC_CHANNELS } from './ipc/media.contract';
import { SYSTEM_IPC_CHANNELS } from './ipc/system.contract';

export const IPC_CHANNELS = {
  ...AUTH_IPC_CHANNELS,
  ...DATABASE_IPC_CHANNELS,
  ...MEDIA_IPC_CHANNELS,
  ...SYSTEM_IPC_CHANNELS,
} as const;
