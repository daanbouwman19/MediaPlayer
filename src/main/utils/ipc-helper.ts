import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IpcContract } from '../../shared/ipc-contract';
import { isTrustedIpcSender } from '../renderer-security';

export interface IpcOptions<TArgs extends unknown[]> {
  validators?: ((...args: TArgs) => Promise<void> | void)[];
}

export function handleIpc<K extends keyof IpcContract>(
  channel: K,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcContract[K]['payload']
  ) => Promise<IpcContract[K]['response']> | IpcContract[K]['response'],
  options: IpcOptions<IpcContract[K]['payload']> = {},
) {
  ipcMain.handle(channel, async (event, ...args) => {
    // [SECURITY] Only the app's own renderer may use the bridge, never a
    // file or page the window was tricked into loading.
    if (!isTrustedIpcSender(event)) {
      console.warn(
        `[IPC] Rejected ${channel} from untrusted sender: ${event.senderFrame?.url ?? 'unknown'}`,
      );
      return { success: false, error: 'Access denied' };
    }
    try {
      const typedArgs = args as IpcContract[K]['payload'];
      if (options.validators) {
        for (const validator of options.validators) {
          await validator(...typedArgs);
        }
      }
      const data = await handler(event, ...typedArgs);
      return { success: true, data };
    } catch (error: unknown) {
      console.error(`[IPC] Error on ${channel}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
