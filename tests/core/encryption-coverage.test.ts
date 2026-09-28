import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Key-file tests get their own directory, so a regenerated key or a backup
// never lands in (or replaces) the working directory's master.key.
let keyDir: string;

// We need to reset modules to clear cachedKey
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-enc-cov-'));
  vi.stubEnv('MASTER_KEY', '');
  vi.stubEnv('MASTER_KEY_DIR', keyDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(keyDir, { recursive: true, force: true });
});

describe('Encryption Utils Coverage', () => {
  it('should use MASTER_KEY from environment variable', async () => {
    const mockKey = crypto.randomBytes(32).toString('hex');
    vi.stubEnv('MASTER_KEY', mockKey);

    const { encrypt, decrypt } = await import('../../src/core/auth/encryption');
    const text = 'test-env-key';
    const encrypted = encrypt(text);
    expect(decrypt(encrypted)).toBe(text);
  });

  it('should throw if MASTER_KEY is invalid length', async () => {
    vi.stubEnv('MASTER_KEY', 'short-key');
    const { encrypt } = await import('../../src/core/auth/encryption');
    expect(() => encrypt('test')).toThrow(/Invalid MASTER_KEY length/);
  });

  it('should regenerate key if master.key has invalid length', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const keyPath = path.join(keyDir, 'master.key');
    fs.writeFileSync(keyPath, 'short-hex');

    const { encrypt } = await import('../../src/core/auth/encryption');
    encrypt('test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid key length'),
    );
    // A new key was generated, and the unusable one kept as a backup.
    expect(fs.readFileSync(keyPath, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    const backups = fs
      .readdirSync(keyDir)
      .filter((f) => f.startsWith('master.key.invalid-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(keyDir, backups[0]), 'utf8')).toBe(
      'short-hex',
    );
  });

  it('should not replace master.key when reading it fails', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    // e.g. an antivirus scanner briefly holding the file
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), {
        code: 'EBUSY',
      });
    });

    const { encrypt } = await import('../../src/core/auth/encryption');
    expect(() => encrypt('test')).toThrow(/Failed to read encryption key/);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read'),
      expect.any(Error),
    );
    // The existing key must not be overwritten on a transient error.
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('should throw if writing master.key fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('Write permission denied');
    });

    const { encrypt } = await import('../../src/core/auth/encryption');
    // Should throw to prevent data loss on restart
    expect(() => encrypt('test')).toThrow(/Failed to persist encryption key/);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write'),
      expect.any(Error),
    );
  });

  it('should return null if decryption throws internally and format is correct', async () => {
    // Provide a valid key via env to avoid FS operations/failures during setup
    vi.stubEnv('MASTER_KEY', crypto.randomBytes(32).toString('hex'));

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const { encrypt, decrypt } = await import('../../src/core/auth/encryption');

    const plain = 'secret';
    const encrypted = encrypt(plain);

    // Mock crypto.createDecipheriv to throw
    vi.spyOn(crypto, 'createDecipheriv').mockImplementation(() => {
      throw new Error('Decipher error');
    });

    const result = decrypt(encrypted);
    expect(result).toBeNull(); // Should return null for formatted data
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Decryption failed'),
      expect.any(String),
    );
  });

  it('should rotate key if compromised key is detected', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const compromisedKey =
      '50c7a5ac267dc92161817ab092dcfc9dcd64ea5824d9b40b021c0f5e3f514563';
    const keyPath = path.join(keyDir, 'master.key');
    fs.writeFileSync(keyPath, compromisedKey);

    const { encrypt } = await import('../../src/core/auth/encryption');
    encrypt('test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Compromised master key detected'),
    );
    const newKey = fs.readFileSync(keyPath, 'utf8');
    expect(newKey).toMatch(/^[0-9a-f]{64}$/);
    expect(newKey).not.toBe(compromisedKey);
    expect(
      fs
        .readdirSync(keyDir)
        .some((f) => f.startsWith('master.key.compromised-')),
    ).toBe(true);
  });

  it('should refuse a compromised MASTER_KEY from the environment', async () => {
    vi.stubEnv(
      'MASTER_KEY',
      '50c7a5ac267dc92161817ab092dcfc9dcd64ea5824d9b40b021c0f5e3f514563',
    );
    const { encrypt } = await import('../../src/core/auth/encryption');
    expect(() => encrypt('test')).toThrow(/known compromised key/);
  });
});
