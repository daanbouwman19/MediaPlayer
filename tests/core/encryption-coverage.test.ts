import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';

// We need to reset modules to clear cachedKey
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.clearAllMocks();
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
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    // Create a dummy file with invalid length
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('short-hex');

    const { encrypt } = await import('../../src/core/auth/encryption');
    encrypt('test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid key length'),
    );
    // Should have generated a new key (check writeFileSync was called)
    expect(writeSpy).toHaveBeenCalled();
  });

  it('should handle read error for master.key gracefully', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Read permission denied');
    });

    const { encrypt } = await import('../../src/core/auth/encryption');
    encrypt('test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read'),
      expect.any(Error),
    );
    // Should proceed to generate new key
    expect(writeSpy).toHaveBeenCalled();
  });

  it('should throw if writing master.key fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
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
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    // Mock reading the compromised key
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '50c7a5ac267dc92161817ab092dcfc9dcd64ea5824d9b40b021c0f5e3f514563',
    );

    const { encrypt } = await import('../../src/core/auth/encryption');
    encrypt('test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Compromised master key detected'),
    );
    expect(writeSpy).toHaveBeenCalled();
  });
});
