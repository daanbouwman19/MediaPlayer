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
import {
  loadProtectedMasterKey,
  PLAIN_KEY_FILE,
  PROTECTED_KEY_FILE,
  type KeyProtector,
} from '../../src/main/master-key-store';

// Stand-in for safeStorage: reversible, but not the plain text.
function createProtector(overrides: Partial<KeyProtector> = {}): KeyProtector {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) =>
      Buffer.from(`protected:${Buffer.from(text).toString('base64')}`),
    decryptString: (blob: Buffer) => {
      const value = blob.toString();
      if (!value.startsWith('protected:')) throw new Error('bad blob');
      return Buffer.from(value.slice('protected:'.length), 'base64').toString();
    },
    ...overrides,
  };
}

describe('loadProtectedMasterKey (F80)', () => {
  let dir: string;
  let plainPath: string;
  let protectedPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaplayer-key-'));
    plainPath = path.join(dir, PLAIN_KEY_FILE);
    protectedPath = path.join(dir, PROTECTED_KEY_FILE);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writePlainKey = () => {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(plainPath, key.toString('hex'));
    return key;
  };

  it('moves an existing plain key into protected storage', () => {
    const key = writePlainKey();
    const protector = createProtector();

    const loaded = loadProtectedMasterKey(dir, protector);

    expect(loaded?.equals(key)).toBe(true);
    expect(fs.existsSync(plainPath)).toBe(false);
    const blob = fs.readFileSync(protectedPath);
    expect(blob.toString()).not.toContain(key.toString('hex'));
    expect(protector.decryptString(blob)).toBe(key.toString('hex'));
  });

  it('keeps using the protected key on later launches', () => {
    const key = writePlainKey();
    loadProtectedMasterKey(dir, createProtector());
    const encryptString = vi.fn();

    const loaded = loadProtectedMasterKey(
      dir,
      createProtector({ encryptString }),
    );

    expect(loaded?.equals(key)).toBe(true);
    expect(encryptString).not.toHaveBeenCalled();
  });

  it('creates a protected key when there is none', () => {
    const loaded = loadProtectedMasterKey(dir, createProtector());
    expect(loaded).toHaveLength(32);
    expect(fs.existsSync(protectedPath)).toBe(true);
    expect(fs.existsSync(plainPath)).toBe(false);
  });

  it('prefers a plain key written by a launch without safeStorage', () => {
    loadProtectedMasterKey(dir, createProtector());
    const newerKey = writePlainKey();

    const loaded = loadProtectedMasterKey(dir, createProtector());

    expect(loaded?.equals(newerKey)).toBe(true);
    expect(fs.existsSync(plainPath)).toBe(false);
  });

  it.each([
    ['no plain key', null],
    ['an invalid plain key', 'not-a-key'],
  ])(
    'leaves a protected key it cannot decrypt untouched (%s)',
    (_label, plainContent) => {
      const k1 = loadProtectedMasterKey(dir, createProtector());
      const blob = fs.readFileSync(protectedPath);
      if (plainContent !== null) fs.writeFileSync(plainPath, plainContent);
      const encryptString = vi.fn();

      // E.g. Linux with another secret-store backend in this session.
      const loaded = loadProtectedMasterKey(
        dir,
        createProtector({
          encryptString,
          decryptString: () => {
            throw new Error('backend unavailable');
          },
        }),
      );

      expect(loaded).toBeNull();
      expect(encryptString).not.toHaveBeenCalled();
      expect(fs.readFileSync(protectedPath).equals(blob)).toBe(true);
      // Once the original backend is back, K1 is still there.
      expect(loadProtectedMasterKey(dir, createProtector())?.equals(k1!)).toBe(
        true,
      );
    },
  );

  it('moves a key saved during a fallback launch over an undecryptable one', async () => {
    fs.writeFileSync(protectedPath, 'from another machine');
    vi.stubEnv('MASTER_KEY_DIR', dir);
    vi.stubEnv('MASTER_KEY', '');
    try {
      // Fallback launch: main.ts installs no key, and reconnecting Drive
      // saves the tokens with a new plain key.
      expect(loadProtectedMasterKey(dir, createProtector())).toBeNull();
      vi.resetModules();
      const fallback = await import('../../src/core/auth/encryption');
      const stored = fallback.encrypt('{"refresh_token":"r"}');

      const loaded = loadProtectedMasterKey(dir, createProtector());
      expect(fs.existsSync(plainPath)).toBe(false);
      expect(
        createProtector().decryptString(fs.readFileSync(protectedPath)),
      ).toBe(loaded!.toString('hex'));
      vi.resetModules();
      const next = await import('../../src/core/auth/encryption');
      next.setMasterKey(loaded!);
      expect(next.decrypt(stored)).toBe('{"refresh_token":"r"}');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rotates a compromised or malformed plain key', () => {
    fs.writeFileSync(plainPath, 'not-a-key');
    const loaded = loadProtectedMasterKey(dir, createProtector());
    expect(loaded).toHaveLength(32);
    expect(fs.existsSync(plainPath)).toBe(false);
  });

  it('returns null and leaves the plain key alone without safeStorage', () => {
    writePlainKey();
    const loaded = loadProtectedMasterKey(
      dir,
      createProtector({ isEncryptionAvailable: () => false }),
    );
    expect(loaded).toBeNull();
    expect(fs.existsSync(plainPath)).toBe(true);
    expect(fs.existsSync(protectedPath)).toBe(false);
  });

  it("treats Linux's basic_text backend as unavailable", () => {
    const loaded = loadProtectedMasterKey(
      dir,
      createProtector({ getSelectedStorageBackend: () => 'basic_text' }),
    );
    expect(loaded).toBeNull();
  });

  it('keeps the plain key if the protected copy does not read back', () => {
    writePlainKey();
    const protector = createProtector({
      decryptString: () => 'f'.repeat(64),
    });

    expect(() => loadProtectedMasterKey(dir, protector)).toThrow(
      /Failed to verify/,
    );
    expect(fs.existsSync(plainPath)).toBe(true);
  });

  it('decrypts tokens encrypted before the migration', async () => {
    const key = writePlainKey();
    vi.stubEnv('MASTER_KEY_DIR', dir);
    vi.stubEnv('MASTER_KEY', '');
    try {
      vi.resetModules();
      const before = await import('../../src/core/auth/encryption');
      const stored = before.encrypt('{"refresh_token":"r"}');

      const loaded = loadProtectedMasterKey(dir, createProtector());
      expect(loaded?.equals(key)).toBe(true);

      // Next launch: the plain key file is gone; main.ts installs the key.
      vi.resetModules();
      const after = await import('../../src/core/auth/encryption');
      after.setMasterKey(loaded!);
      expect(after.decrypt(stored)).toBe('{"refresh_token":"r"}');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the protected key after a launch without safeStorage that only read tokens', async () => {
    vi.stubEnv('MASTER_KEY_DIR', dir);
    vi.stubEnv('MASTER_KEY', '');
    const tokens = '{"refresh_token":"r"}';
    try {
      // Launch N: the tokens are saved with the protected key K1.
      const k1 = loadProtectedMasterKey(dir, createProtector());
      expect(k1).toHaveLength(32);
      vi.resetModules();
      const launchN = await import('../../src/core/auth/encryption');
      launchN.setMasterKey(k1!);
      const stored = launchN.encrypt(tokens);

      // Launch N+1: safeStorage is unavailable, so main.ts installs no key and
      // loading the saved tokens (google-auth, then media-service) fails.
      // That must not leave a plain key behind.
      expect(
        loadProtectedMasterKey(
          dir,
          createProtector({ isEncryptionAvailable: () => false }),
        ),
      ).toBeNull();
      vi.resetModules();
      const launchN1 = await import('../../src/core/auth/encryption');
      expect(launchN1.decrypt(stored)).toBeNull();
      expect(launchN1.decrypt(stored)).toBeNull();
      expect(fs.existsSync(plainPath)).toBe(false);

      // Launch N+2: safeStorage is back and K1 still decrypts the tokens.
      const loaded = loadProtectedMasterKey(dir, createProtector());
      expect(loaded?.equals(k1!)).toBe(true);
      vi.resetModules();
      const launchN2 = await import('../../src/core/auth/encryption');
      launchN2.setMasterKey(loaded!);
      expect(launchN2.decrypt(stored)).toBe(tokens);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('setMasterKey', () => {
  it('rejects keys of the wrong length', async () => {
    const { setMasterKey } = await import('../../src/core/auth/encryption');
    expect(() => setMasterKey(Buffer.alloc(16))).toThrow(/length/);
  });
});
