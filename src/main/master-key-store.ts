/**
 * @file Keeps the master key that encrypts the stored Google tokens bound to
 * the OS user with Electron's safeStorage (DPAPI on Windows, the Keychain on
 * macOS, libsecret or KWallet on Linux), so a copy of the profile folder no
 * longer decrypts them.
 *
 * An existing plain master.key is migrated on the next launch. Without
 * safeStorage the plain key file keeps being used, as in server mode.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { SafeStorage } from 'electron';
import { COMPROMISED_KEY_HASH } from '../core/auth/encryption';

/** Plain hex key file, also used by server mode (see encryption.ts). */
export const PLAIN_KEY_FILE = 'master.key';
/** The hex key encrypted with safeStorage. */
export const PROTECTED_KEY_FILE = 'master.key.safe';

const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export type KeyProtector = Pick<
  SafeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
> &
  Partial<Pick<SafeStorage, 'getSelectedStorageBackend'>>;

function isProtectionAvailable(protector: KeyProtector): boolean {
  if (!protector.isEncryptionAvailable()) return false;
  // Linux's basic_text backend encrypts with a hard-coded password, which
  // protects nothing beyond the plain file and breaks if the backend changes.
  return protector.getSelectedStorageBackend?.() !== 'basic_text';
}

function parseKeyHex(keyHex: string): Buffer | null {
  const trimmed = keyHex.trim();
  return KEY_HEX_PATTERN.test(trimmed) ? Buffer.from(trimmed, 'hex') : null;
}

function readProtectedKey(
  filePath: string,
  protector: KeyProtector,
): Buffer | null {
  let blob: Buffer;
  try {
    blob = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  try {
    const key = parseKeyHex(protector.decryptString(blob));
    if (key) return key;
    console.warn(`[MasterKey] ${PROTECTED_KEY_FILE} holds an invalid key.`);
  } catch (error) {
    console.warn(
      `[MasterKey] Could not decrypt ${PROTECTED_KEY_FILE} (moved profile or OS user?):`,
      error,
    );
  }
  return null;
}

function readPlainKey(filePath: string): Buffer | null {
  let keyHex: string;
  try {
    keyHex = fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
  const hash = crypto.createHash('sha256').update(keyHex).digest('hex');
  if (hash === COMPROMISED_KEY_HASH) {
    console.warn('[MasterKey] Compromised master key detected; rotating it.');
    return null;
  }
  return parseKeyHex(keyHex);
}

function writeProtectedKey(
  filePath: string,
  key: Buffer,
  protector: KeyProtector,
): void {
  const keyHex = key.toString('hex');
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, protector.encryptString(keyHex), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  // Never drop the plain key unless the protected copy reads back correctly.
  if (readProtectedKey(filePath, protector)?.equals(key) !== true) {
    throw new Error(`Failed to verify ${PROTECTED_KEY_FILE}`);
  }
}

function removePlainKey(plainPath: string): void {
  try {
    fs.rmSync(plainPath, { force: true });
  } catch (error) {
    console.warn(`[MasterKey] Could not remove ${PLAIN_KEY_FILE}:`, error);
  }
}

/**
 * Returns the master key kept with safeStorage in `keyDir`, migrating a plain
 * master.key (or creating a key) as needed. Returns null when safeStorage is
 * unavailable, in which case encryption.ts keeps using the plain key file.
 *
 * A plain key file next to a protected one is always the newer key: it is
 * deleted whenever the protected key is in use, and encryption.ts creates one
 * only in encrypt(), never in decrypt(). So it can only have been written by a
 * launch without safeStorage that saved the tokens again, encrypting them with
 * that key.
 *
 * A protected key that cannot be decrypted is never replaced, and that launch
 * also returns null. The failure may be temporary (on Linux, e.g. another
 * secret-store backend in this session) and the file is the only copy of the
 * key for the saved tokens. If the user reconnects Drive meanwhile, encrypt()
 * writes a plain key, which the next launch moves over the old protected file.
 */
export function loadProtectedMasterKey(
  keyDir: string,
  protector: KeyProtector,
): Buffer | null {
  if (!isProtectionAvailable(protector)) {
    console.warn(
      '[MasterKey] OS-level encryption unavailable; using the plain key file.',
    );
    return null;
  }

  const protectedPath = path.join(keyDir, PROTECTED_KEY_FILE);
  const plainPath = path.join(keyDir, PLAIN_KEY_FILE);
  const plainKey = readPlainKey(plainPath);

  if (!plainKey && fs.existsSync(protectedPath)) {
    const protectedKey = readProtectedKey(protectedPath, protector);
    if (!protectedKey) {
      console.warn(
        `[MasterKey] Leaving ${PROTECTED_KEY_FILE} untouched; using the plain key file for this launch.`,
      );
      return null;
    }
    // Drop a stale, invalid or compromised plain key file.
    removePlainKey(plainPath);
    return protectedKey;
  }

  const key = plainKey ?? crypto.randomBytes(32);
  writeProtectedKey(protectedPath, key, protector);
  console.log(
    plainKey
      ? `[MasterKey] Moved ${PLAIN_KEY_FILE} into OS-protected storage.`
      : '[MasterKey] Generated a new OS-protected master key.',
  );
  removePlainKey(plainPath);
  return key;
}
