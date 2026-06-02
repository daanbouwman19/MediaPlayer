import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/main/google-secrets', () => ({
  getGoogleClientId: vi.fn(() => 'mock-client-id'),
  getGoogleClientSecret: vi.fn(() => 'mock-client-secret'),
  getGoogleRedirectUri: vi.fn(() => 'http://localhost:12345/auth/callback'),
}));

vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
}));

// Mock encryption to be deterministic
vi.mock('../../src/core/auth/encryption', () => ({
  encrypt: vi.fn((text: string) => `ENCRYPTED[${text}]`),
  decrypt: vi.fn((text: string) =>
    text.startsWith('ENCRYPTED[') ? text.slice(10, -1) : text,
  ),
}));

// Hoist mock variables
const { mockOAuth2Client, MockOAuth2, getTokensListener } = vi.hoisted(() => {
  let tokensListener: ((tokens: Record<string, unknown>) => void) | null = null;
  const mockOAuth2Client = {
    setCredentials: vi.fn(),
    generateAuthUrl: vi.fn(),
    getToken: vi.fn(),
    on: vi.fn(
      (event: string, listener: (tokens: Record<string, unknown>) => void) => {
        if (event === 'tokens') {
          tokensListener = listener;
        }
      },
    ),
    credentials: { refresh_token: 'mock-refresh-token' },
  };
  // Ensure constructible
  const MockOAuth2 = vi.fn(function () {
    return mockOAuth2Client;
  });
  return {
    mockOAuth2Client,
    MockOAuth2,
    getTokensListener: () => tokensListener,
  };
});

const mockAboutGet = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { user: {} } }),
);

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: MockOAuth2,
      },
      drive: vi.fn(() => ({
        about: { get: mockAboutGet },
      })),
    },
  };
});

import * as googleAuth from '../../src/main/google-auth';
import * as database from '../../src/core/database/database';
import * as encryption from '../../src/core/auth/encryption';

describe('Google Auth Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getOAuth2Client', () => {
    it('should create and return a singleton client', () => {
      const client1 = googleAuth.getOAuth2Client();
      const client2 = googleAuth.getOAuth2Client();
      expect(client1).toBe(mockOAuth2Client);
      expect(client2).toBe(client1);
      expect(MockOAuth2).toHaveBeenCalled();
      expect(mockOAuth2Client.on).toHaveBeenCalledWith(
        'tokens',
        expect.any(Function),
      );
    });

    it('should auto-save refreshed tokens from OAuth events', async () => {
      googleAuth.getOAuth2Client();
      const listener = getTokensListener();

      expect(listener).toBeTruthy();
      listener?.({ access_token: 'new-access-token' });
      await Promise.resolve();

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          refresh_token: 'mock-refresh-token',
          access_token: 'new-access-token',
        }),
      );
      expect(database.saveSetting).toHaveBeenCalledWith(
        'google_tokens',
        expect.stringContaining('ENCRYPTED['),
      );
    });
  });

  describe('loadSavedCredentialsIfExist', () => {
    it('should load credentials from database (legacy plain text)', async () => {
      const mockCreds = { refresh_token: 'saved-token' };
      vi.mocked(database.getSetting).mockResolvedValue(
        JSON.stringify(mockCreds),
      );

      const result = await googleAuth.loadSavedCredentialsIfExist();

      expect(result).toBe(true);
      expect(database.getSetting).toHaveBeenCalledWith('google_tokens');
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockCreds);
    });

    it('should load credentials from database (encrypted)', async () => {
      const mockCreds = { refresh_token: 'saved-token' };
      const plain = JSON.stringify(mockCreds);
      vi.mocked(database.getSetting).mockResolvedValue(`ENCRYPTED[${plain}]`);

      const result = await googleAuth.loadSavedCredentialsIfExist();

      expect(result).toBe(true);
      expect(database.getSetting).toHaveBeenCalledWith('google_tokens');
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockCreds);
    });

    it('should return false if setting does not exist', async () => {
      vi.mocked(database.getSetting).mockResolvedValue(null);

      const result = await googleAuth.loadSavedCredentialsIfExist();

      expect(result).toBe(false);
      expect(mockOAuth2Client.setCredentials).not.toHaveBeenCalled();
    });

    it('should return false on database error', async () => {
      vi.mocked(database.getSetting).mockRejectedValue(new Error('DB Error'));

      const result = await googleAuth.loadSavedCredentialsIfExist();

      expect(result).toBe(false);
      expect(mockOAuth2Client.setCredentials).not.toHaveBeenCalled();
    });

    it('should return false and warn when decryption fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(database.getSetting).mockResolvedValue('ENCRYPTED[unreadable]');
      vi.mocked(encryption.decrypt).mockReturnValueOnce(null);

      const result = await googleAuth.loadSavedCredentialsIfExist();

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to decrypt saved credentials'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('checkGoogleDriveAuth', () => {
    it('returns true if client already has refresh_token and probe succeeds', async () => {
      mockOAuth2Client.credentials = { refresh_token: 'existing' };
      mockAboutGet.mockResolvedValueOnce({ data: { user: {} } });
      const result = await googleAuth.checkGoogleDriveAuth();
      expect(result).toBe(true);
      expect(database.getSetting).not.toHaveBeenCalled();
    });

    it('loads from DB if client lacks refresh_token and probe succeeds', async () => {
      mockOAuth2Client.credentials = {} as any;
      const mockCreds = { refresh_token: 'saved-token' };
      vi.mocked(database.getSetting).mockResolvedValue(
        JSON.stringify(mockCreds),
      );
      mockAboutGet.mockResolvedValueOnce({ data: { user: {} } });

      const result = await googleAuth.checkGoogleDriveAuth();
      expect(result).toBe(true);
      expect(database.getSetting).toHaveBeenCalled();
    });

    it('returns false if DB load fails', async () => {
      mockOAuth2Client.credentials = null as any;
      vi.mocked(database.getSetting).mockResolvedValue(null);

      const result = await googleAuth.checkGoogleDriveAuth();
      expect(result).toBe(false);
    });

    it('returns false if token is revoked (probe call throws)', async () => {
      mockOAuth2Client.credentials = { refresh_token: 'revoked-token' };
      mockAboutGet.mockRejectedValueOnce(new Error('invalid_grant'));

      const result = await googleAuth.checkGoogleDriveAuth();
      expect(result).toBe(false);
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials to database (encrypted)', async () => {
      await googleAuth.saveCredentials(mockOAuth2Client as any);

      expect(database.saveSetting).toHaveBeenCalledWith(
        'google_tokens',
        `ENCRYPTED[${JSON.stringify(mockOAuth2Client.credentials)}]`,
      );
    });

    it('should propagate database errors', async () => {
      vi.mocked(database.saveSetting).mockRejectedValue(
        new Error('Write fail'),
      );
      await expect(
        googleAuth.saveCredentials(mockOAuth2Client as any),
      ).rejects.toThrow('Write fail');
    });
  });

  describe('generateAuthUrl', () => {
    it('should call generateAuthUrl on client with PKCE params', () => {
      mockOAuth2Client.generateAuthUrl.mockReturnValue('http://auth-url');
      const url = googleAuth.generateAuthUrl();
      expect(url).toBe('http://auth-url');
      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          scope: expect.any(Array),
          code_challenge: expect.any(String),
          code_challenge_method: 'S256',
        }),
      );
    });
  });

  describe('authenticateWithCode', () => {
    it('should exchange code for tokens and save them using PKCE verifier', async () => {
      // 1. Generate auth URL first to set the pending verifier
      googleAuth.generateAuthUrl();

      const mockTokens = { refresh_token: 'new-token' };
      mockOAuth2Client.getToken.mockResolvedValue({ tokens: mockTokens });

      await googleAuth.authenticateWithCode('test-code');

      expect(mockOAuth2Client.getToken).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'test-code',
          codeVerifier: expect.any(String),
        }),
      );
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockTokens);
      expect(database.saveSetting).toHaveBeenCalled();
    });

    it('should throw an error if generateAuthUrl was not called first', async () => {
      // This simulates a state where authenticateWithCode is called without a pending verifier.
      // It should reject because the PKCE flow is mandatory.

      const mockTokens = { refresh_token: 'new-token-no-pkce' };
      mockOAuth2Client.getToken.mockResolvedValue({ tokens: mockTokens });

      await expect(
        googleAuth.authenticateWithCode('test-code-2'),
      ).rejects.toThrow('Code verifier not found');

      expect(mockOAuth2Client.getToken).not.toHaveBeenCalled();
    });
  });
});
