import { PassThrough, EventEmitter } from 'stream';
import { Mock, vi } from 'vite-plus/test';

/**
 * Creates a mock child process with stdout/stderr streams and basic methods.
 * This helper standardizes the way we mock child_process.spawn.
 *
 * @param mockSpawn - The vitest mock function for spawn (e.g. vi.fn())
 * @returns The mock process object (EventEmitter) with stdout/stderr as PassThrough streams.
 */
export function createMockProcess(mockSpawn: Mock) {
  const mockProc = new EventEmitter() as any;
  mockProc.stdout = new PassThrough();
  mockProc.stderr = new PassThrough();

  // Mock kill method
  mockProc.kill = vi.fn();

  // Setup the mockSpawn to return this process
  mockSpawn.mockReturnValue(mockProc);

  return mockProc;
}
