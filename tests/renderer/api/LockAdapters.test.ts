import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { ElectronAdapter } from '../../../src/renderer/api/ElectronAdapter';
import { WebAdapter } from '../../../src/renderer/api/WebAdapter';
import { HttpError } from '../../../src/renderer/api/http-error';

const ok = <T>(data: T) => Promise.resolve({ success: true, data });

describe('ElectronAdapter app lock', () => {
  const makeBridge = () => ({
    getLockStatus: vi.fn(() => ok({ enabled: true, isAuthenticated: false })),
    unlock: vi.fn((pin: string) => ok(pin === '1234' ? 'ok' : 'invalid')),
    lock: vi.fn(() => ok(undefined)),
    setPin: vi.fn(() => ok(undefined)),
    clearPin: vi.fn(() => ok(undefined)),
    minimizeWindow: vi.fn(),
    onLockRequest: vi.fn(() => () => {}),
  });

  it('forwards lock calls to the bridge', async () => {
    const bridge = makeBridge();
    const adapter = new ElectronAdapter(bridge as any);

    expect(adapter.supportsLocalPin).toBe(true);
    await expect(adapter.getLockStatus()).resolves.toEqual({
      enabled: true,
      isAuthenticated: false,
    });
    await expect(adapter.unlock('1234')).resolves.toBe(true);
    await expect(adapter.unlock('0000')).resolves.toBe(false);
    await adapter.lock();
    await adapter.setPin('5678');
    await adapter.clearPin();
    adapter.minimizeWindow();
    const cb = vi.fn();
    adapter.onLockRequest(cb);

    expect(bridge.lock).toHaveBeenCalled();
    expect(bridge.setPin).toHaveBeenCalledWith('5678');
    expect(bridge.clearPin).toHaveBeenCalled();
    expect(bridge.minimizeWindow).toHaveBeenCalled();
    expect(bridge.onLockRequest).toHaveBeenCalledWith(cb);
  });

  it('reports throttling as a 429 HttpError', async () => {
    const bridge = makeBridge();
    bridge.unlock.mockReturnValue(ok('rateLimited'));
    const error: unknown = await new ElectronAdapter(bridge as any)
      .unlock('1234')
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
  });
});

describe('WebAdapter app lock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('locks through the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new WebAdapter().lock();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/lock',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not manage a local PIN', async () => {
    const adapter = new WebAdapter();
    expect(adapter.supportsLocalPin).toBe(false);
    await expect(adapter.setPin()).rejects.toThrow('GLOBAL_PASSWORD');
    await expect(adapter.clearPin()).rejects.toThrow('GLOBAL_PASSWORD');
    expect(() => adapter.minimizeWindow()).not.toThrow();
    const unsubscribe = adapter.onLockRequest();
    expect(() => unsubscribe()).not.toThrow();
  });
});
