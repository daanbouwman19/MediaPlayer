import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { EventEmitter } from 'events';

const { MockOAuth2, clients } = vi.hoisted(() => {
  const clients: any[] = [];
  const MockOAuth2 = vi.fn(function () {
    const client = new EventEmitter() as any;
    client.credentials = {};
    client.setCredentials = vi.fn((credentials: Record<string, unknown>) => {
      client.credentials = credentials;
    });
    clients.push(client);
    return client;
  });
  return { MockOAuth2, clients };
});

vi.mock('googleapis', () => ({
  google: { auth: { OAuth2: MockOAuth2 }, drive: vi.fn() },
}));

vi.mock('../../../src/core/database/database', () => ({
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
}));

vi.mock('../../../src/core/auth/encryption', () => ({
  encrypt: vi.fn((text: string) => `ENCRYPTED[${text}]`),
  decrypt: vi.fn((text: string) => text),
}));

/** Loads a fresh google-auth module (no client yet) for the given environment. */
async function loadGoogleAuth({
  configured = true,
  mainThread = true,
}: { configured?: boolean; mainThread?: boolean } = {}) {
  vi.resetModules();
  vi.doMock('../../../src/infrastructure/google-secrets', () => ({
    getGoogleClientId: () => (configured ? 'client-id' : ''),
    getGoogleClientSecret: () => (configured ? 'client-secret' : ''),
    getGoogleRedirectUri: () => 'http://localhost:12345/auth/google/callback',
  }));
  vi.doMock('worker_threads', () => ({ isMainThread: mainThread }));
  return import('../../../src/infrastructure/google-auth');
}

const tokens = { access_token: 'stale', refresh_token: 'refresh' };

describe('google-auth manual credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.length = 0;
  });

  afterEach(() => {
    vi.doUnmock('worker_threads');
    vi.doUnmock('../../../src/infrastructure/google-secrets');
    vi.restoreAllMocks();
  });

  it('accepts tokens without an OAuth client configuration; only Drive use fails', async () => {
    const auth = await loadGoogleAuth({ configured: false });

    expect(() => auth.initializeManualCredentials(tokens)).not.toThrow();
    expect(() => auth.getOAuth2Client()).toThrow(
      'Google OAuth credentials not configured',
    );
  });

  it('applies tokens given before the client exists once it is created', async () => {
    const auth = await loadGoogleAuth();

    auth.initializeManualCredentials(tokens);
    expect(MockOAuth2).not.toHaveBeenCalled();

    const client = auth.getOAuth2Client();
    expect(client.setCredentials).toHaveBeenCalledWith(tokens);
    expect(client.credentials).toEqual(tokens);
  });

  it('applies tokens to an existing client directly', async () => {
    const auth = await loadGoogleAuth();
    const client = auth.getOAuth2Client();

    auth.initializeManualCredentials(tokens);

    expect(client.setCredentials).toHaveBeenLastCalledWith(tokens);
  });

  it('saves refreshed tokens on the main thread', async () => {
    const auth = await loadGoogleAuth({ mainThread: true });
    const database = await import('../../../src/core/database/database');
    const client = auth.getOAuth2Client() as unknown as EventEmitter;
    auth.initializeManualCredentials(tokens);

    client.emit('tokens', { access_token: 'fresh' });

    await vi.waitFor(() =>
      expect(database.saveSetting).toHaveBeenCalledWith(
        'google_tokens',
        expect.stringContaining('"access_token":"fresh"'),
      ),
    );
  });

  it('does not try to save refreshed tokens from a worker thread, which has no database', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const auth = await loadGoogleAuth({ mainThread: false });
    const database = await import('../../../src/core/database/database');
    auth.initializeManualCredentials(tokens);
    const client = auth.getOAuth2Client() as unknown as EventEmitter;

    client.emit('tokens', { access_token: 'fresh' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.listenerCount('tokens')).toBe(0);
    expect(database.saveSetting).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
