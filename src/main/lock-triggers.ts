/**
 * @file Locks the app when the OS session locks or the machine suspends.
 */
import { BrowserWindow, powerMonitor } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { lockApp } from './app-lock';

function requestLock(): void {
  lockApp();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.LOCK_REQUEST);
  }
}

/** Must be called after the app's `ready` event (powerMonitor needs it). */
export function registerLockTriggers(): void {
  powerMonitor.on('lock-screen', requestLock);
  powerMonitor.on('suspend', requestLock);
}
