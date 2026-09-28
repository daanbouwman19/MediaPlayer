/**
 * master.key handling against a real (temporary) key directory: the key file
 * must only ever be created when missing or replaced (with a backup) when it
 * is unusable, never overwritten because of a transient read error.
 */
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

let keyDir: string;
let keyPath: string;

async function loadEncryption() {
  vi.resetModules();
  return import('../../src/core/auth/encryption');
}

describe('master.key file handling', () => {
  beforeEach(() => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-master-key-'));
    keyPath = path.join(keyDir, 'master.key');
    vi.stubEnv('MASTER_KEY', '');
    vi.stubEnv('MASTER_KEY_DIR', keyDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  it('creates a private key file when none exists and leaves no temp files', async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const secret = encrypt('token');

    const keyHex = fs.readFileSync(keyPath, 'utf8');
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readdirSync(keyDir)).toEqual(['master.key']);
    if (process.platform !== 'win32') {
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    }

    // A restart reads the same key back.
    const reloaded = await loadEncryption();
    expect(reloaded.decrypt(secret)).toBe('token');
    expect(decrypt(secret)).toBe('token');
    expect(fs.readFileSync(keyPath, 'utf8')).toBe(keyHex);
  });

  it('keeps the existing key through a transient read failure', async () => {
    const first = await loadEncryption();
    const secret = first.encrypt('token');
    const originalKey = fs.readFileSync(keyPath, 'utf8');

    const second = await loadEncryption();
    const realRead = fs.readFileSync;
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), {
        code: 'EPERM',
      });
    });

    // While locked, decryption fails softly and nothing is written...
    expect(second.decrypt(secret)).toBeNull();
    expect(() => second.encrypt('other')).toThrow(
      /Failed to read encryption key/,
    );
    readSpy.mockRestore();
    expect(realRead(keyPath, 'utf8')).toBe(originalKey);

    // ...and once the lock is gone the original key is used again.
    expect(second.decrypt(secret)).toBe('token');
  });

  it('uses the key another process created first instead of overwriting it', async () => {
    const otherKey = 'ab'.repeat(32);
    const realLink = fs.linkSync;
    vi.spyOn(fs, 'linkSync').mockImplementation((existing, target) => {
      // Another instance wins the race between our read and our link.
      fs.writeFileSync(target, otherKey);
      return realLink(existing, target);
    });

    const { encrypt, decrypt } = await loadEncryption();
    const secret = encrypt('token');

    expect(fs.readFileSync(keyPath, 'utf8')).toBe(otherKey);
    expect(fs.readdirSync(keyDir)).toEqual(['master.key']);
    vi.restoreAllMocks();
    const reloaded = await loadEncryption();
    expect(reloaded.decrypt(secret)).toBe('token');
    expect(decrypt(secret)).toBe('token');
  });

  it('falls back to an exclusive create when hard links are unsupported', async () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted, link'), {
        code: 'EPERM',
      });
    });

    const { encrypt } = await loadEncryption();
    encrypt('token');

    expect(fs.readFileSync(keyPath, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readdirSync(keyDir)).toEqual(['master.key']);
  });

  it('does not replace an unusable key when it cannot be backed up', async () => {
    fs.writeFileSync(keyPath, 'not-a-key');
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied, copyfile');
    });

    const { encrypt } = await loadEncryption();
    expect(() => encrypt('token')).toThrow(/Failed to persist encryption key/);
    expect(fs.readFileSync(keyPath, 'utf8')).toBe('not-a-key');
  });
});
