import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

describe('Encryption key file', () => {
  let dir: string;
  let keyPath: string;

  const loadEncryption = async () => {
    vi.resetModules();
    return import('../../src/core/auth/encryption.ts');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaplayer-enc-'));
    keyPath = path.join(dir, 'master.key');
    vi.stubEnv('MASTER_KEY_DIR', dir);
    vi.stubEnv('MASTER_KEY', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates master.key when encrypting and reads it back on the next run', async () => {
    const stored = (await loadEncryption()).encrypt('token');
    expect(fs.existsSync(keyPath)).toBe(true);

    expect((await loadEncryption()).decrypt(stored)).toBe('token');
  });

  it('does not create a key when decrypting without one', async () => {
    vi.stubEnv('MASTER_KEY', crypto.randomBytes(32).toString('hex'));
    const stored = (await loadEncryption()).encrypt('token');
    vi.stubEnv('MASTER_KEY', '');

    const { decrypt } = await loadEncryption();

    expect(decrypt(stored)).toBeNull();
    expect(fs.existsSync(keyPath)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('No master key available'),
    );
  });

  it.each([
    [
      'compromised',
      '50c7a5ac267dc92161817ab092dcfc9dcd64ea5824d9b40b021c0f5e3f514563',
    ],
    ['malformed', 'short-hex'],
  ])('does not decrypt with or replace a %s key file', async (_, contents) => {
    vi.stubEnv('MASTER_KEY', crypto.randomBytes(32).toString('hex'));
    const stored = (await loadEncryption()).encrypt('token');
    vi.stubEnv('MASTER_KEY', '');
    fs.writeFileSync(keyPath, contents);

    expect((await loadEncryption()).decrypt(stored)).toBeNull();
    expect(fs.readFileSync(keyPath, 'utf8')).toBe(contents);
  });
});
