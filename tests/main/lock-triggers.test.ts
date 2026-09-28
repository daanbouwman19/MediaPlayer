import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

const { mockPowerMonitor, mockSend, mockLockApp } = vi.hoisted(() => ({
  mockPowerMonitor: { on: vi.fn() },
  mockSend: vi.fn(),
  mockLockApp: vi.fn(),
}));

vi.mock('electron', () => ({
  powerMonitor: mockPowerMonitor,
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mockSend } }],
  },
}));
vi.mock('../../src/main/app-lock', () => ({ lockApp: mockLockApp }));

import { registerLockTriggers } from '../../src/main/lock-triggers';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

describe('registerLockTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['lock-screen', 'suspend'])(
    'locks the app and notifies windows on %s',
    (eventName) => {
      registerLockTriggers();
      const call = mockPowerMonitor.on.mock.calls.find(
        (c) => c[0] === eventName,
      );
      expect(call).toBeDefined();
      (call![1] as () => void)();
      expect(mockLockApp).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(IPC_CHANNELS.LOCK_REQUEST);
    },
  );
});
