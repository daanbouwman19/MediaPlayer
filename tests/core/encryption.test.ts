import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

describe('Encryption Utils', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should encrypt and decrypt a string correctly', async () => {
    const mockKey = crypto.randomBytes(32).toString('hex');
    vi.stubEnv('MASTER_KEY', mockKey);
    const { encrypt, decrypt } =
      await import('../../src/core/auth/encryption.ts');

    const original = 'my-secret-token-123';
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should return original text if decryption fails (legacy support)', async () => {
    const { decrypt } = await import('../../src/core/auth/encryption.ts');
    const legacy = '{"access_token":"foo"}';
    const result = decrypt(legacy);
    expect(result).toBe(legacy);
  });

  it('should return original text if format looks valid but lengths are wrong', async () => {
    const { decrypt } = await import('../../src/core/auth/encryption.ts');
    // Correct format but wrong lengths (too short auth tag)
    const invalid = '000000000000000000000000:0000:deadbeef';
    const result = decrypt(invalid);
    expect(result).toBe(invalid);
  });

  it('should return null if format is correct but decryption fails (wrong key)', async () => {
    vi.stubEnv('MASTER_KEY', crypto.randomBytes(32).toString('hex'));
    const { encrypt } = await import('../../src/core/auth/encryption.ts');

    const original = 'secret';
    const encrypted = encrypt(original);

    // Reset modules to clear cachedKey
    vi.resetModules();
    vi.stubEnv('MASTER_KEY', crypto.randomBytes(32).toString('hex'));
    const { decrypt: decryptNew } =
      await import('../../src/core/auth/encryption.ts');

    const result = decryptNew(encrypted);
    expect(result).toBeNull();
  });

  it('should handle different plain texts', async () => {
    const { encrypt, decrypt } =
      await import('../../src/core/auth/encryption.ts');
    const texts = ['', 'hello', '👍', JSON.stringify({ a: 1 })];
    for (const t of texts) {
      expect(decrypt(encrypt(t))).toBe(t);
    }
  });
});
