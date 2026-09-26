import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
} from '../../src/main/google-secrets';

describe('Google Secrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getGoogleClientId', () => {
    it('should return client id from environment variable', () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      expect(getGoogleClientId()).toBe('test-client-id');
    });

    it('should return empty string if environment variable is not set', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      expect(getGoogleClientId()).toBe('');
    });
  });

  describe('getGoogleClientSecret', () => {
    it('should return client secret from environment variable', () => {
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
      expect(getGoogleClientSecret()).toBe('test-client-secret');
    });

    it('should return empty string if environment variable is not set', () => {
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(getGoogleClientSecret()).toBe('');
    });
  });

  describe('getGoogleRedirectUri', () => {
    it('should return redirect uri from environment variable', () => {
      process.env.GOOGLE_REDIRECT_URI = 'http://test.com/callback';
      expect(getGoogleRedirectUri()).toBe('http://test.com/callback');
    });

    it('should return default redirect uri if environment variable is not set', () => {
      delete process.env.GOOGLE_REDIRECT_URI;
      expect(getGoogleRedirectUri()).toBe(
        'http://localhost:12345/auth/google/callback',
      );
    });
  });
});
