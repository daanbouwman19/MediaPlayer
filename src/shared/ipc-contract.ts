import type { AuthIpcContract } from './ipc/auth.contract';
import type { DatabaseIpcContract } from './ipc/database.contract';
import type { MediaIpcContract } from './ipc/media.contract';
import type { SystemIpcContract } from './ipc/system.contract';

export interface IpcContract
  extends
    AuthIpcContract,
    DatabaseIpcContract,
    MediaIpcContract,
    SystemIpcContract {}
