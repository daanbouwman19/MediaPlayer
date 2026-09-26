import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

describe('API Index', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).electronAPI;
  });

  it('should return ElectronAdapter when window.electronAPI is defined', async () => {
    (window as any).electronAPI = {};

    // Dynamic import to trigger evaluation of createBackend()
    const { api } = await import('../../../src/renderer/api/index');
    const { ElectronAdapter } =
      await import('../../../src/renderer/api/ElectronAdapter');

    expect(api).toBeInstanceOf(ElectronAdapter);
  });

  it('should return WebAdapter when window.electronAPI is undefined', async () => {
    delete (window as any).electronAPI;

    vi.resetModules();
    const { api } = await import('../../../src/renderer/api/index');
    const { WebAdapter } = await import('../../../src/renderer/api/WebAdapter');

    expect(api).toBeInstanceOf(WebAdapter);
  });
});
