import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MASTER_KEY_FILE = 'master.key';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM

// Known compromised key hash (SHA-256 of the hex string)
export const COMPROMISED_KEY_HASH =
  '8d83d79e7490634b1be7f3c05713dbcbc73abe47da99151aa6e85d5562aed005';

let cachedKey: Buffer | null = null;

function isCompromisedKey(keyHex: string): boolean {
  const hash = crypto
    .createHash('sha256')
    .update(keyHex.toLowerCase())
    .digest('hex');
  return hash === COMPROMISED_KEY_HASH;
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Writes a new key file without ever leaving a partial file behind: the key
 * goes to a private temp file first, which is then moved into place. A fresh
 * key is linked in, which fails instead of overwriting a key file that
 * appeared in the meantime; a replacement (after backing the old key up) is
 * renamed over it.
 * @returns false if another process created the key file first.
 */
function writeKeyFile(
  keyPath: string,
  keyHex: string,
  replace: boolean,
): boolean {
  const tmpPath = `${keyPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, keyHex, { mode: 0o600, flag: 'wx' });
  try {
    if (replace) {
      fs.renameSync(tmpPath, keyPath);
      return true;
    }
    try {
      fs.linkSync(tmpPath, keyPath);
    } catch (err) {
      if (errorCode(err) === 'EEXIST') return false;
      // The filesystem has no hard links (e.g. FAT): exclusive create.
      fs.writeFileSync(keyPath, keyHex, { mode: 0o600, flag: 'wx' });
    }
    return true;
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

/**
 * Persists a newly generated key. When an unusable key file is replaced, the
 * old file is kept as master.key.<reason>-<timestamp>.bak first.
 */
function persistNewKey(
  keyPath: string,
  newKey: Buffer,
  replacedReason?: string,
): boolean {
  try {
    if (replacedReason) {
      const backupPath = `${keyPath}.${replacedReason}-${Date.now()}.bak`;
      fs.copyFileSync(keyPath, backupPath, fs.constants.COPYFILE_EXCL);
      console.warn(
        `[Encryption] Previous master key backed up to ${backupPath}`,
      );
    }
    const written = writeKeyFile(
      keyPath,
      newKey.toString('hex'),
      replacedReason !== undefined,
    );
    if (written) {
      console.log(`[Encryption] Generated new master key at ${keyPath}`);
    }
    return written;
  } catch (err) {
    console.error(`[Encryption] Failed to write ${MASTER_KEY_FILE}:`, err);
    throw new Error(
      `Failed to persist encryption key to ${MASTER_KEY_FILE}. Aborting to prevent data loss on restart.`,
    );
  }
}

/**
 * Retrieves or generates the encryption key.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  // 1. Check environment variable
  if (process.env.MASTER_KEY) {
    if (isCompromisedKey(process.env.MASTER_KEY.trim())) {
      throw new Error(
        'MASTER_KEY is a known compromised key. Generate a new one (e.g. `openssl rand -hex 32`).',
      );
    }
    const key = Buffer.from(process.env.MASTER_KEY, 'hex');
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid MASTER_KEY length. Expected ${KEY_LENGTH} bytes (hex encoded).`,
      );
    }
    cachedKey = key;
    return key;
  }

  // 2. Check key file
  const keyDir = process.env.MASTER_KEY_DIR || process.cwd();
  const keyPath = path.resolve(keyDir, MASTER_KEY_FILE);

  let keyHex: string | null = null;
  try {
    keyHex = fs.readFileSync(keyPath, 'utf8').trim();
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') {
      // A transient failure (antivirus or backup tool holding a lock,
      // permissions) must not replace the key: everything encrypted with it
      // would become unreadable. Fail now; the next call retries.
      console.warn(`[Encryption] Failed to read ${MASTER_KEY_FILE}:`, err);
      throw new Error(
        `Failed to read encryption key from ${MASTER_KEY_FILE}. Not generating a new one to protect the existing key.`,
        { cause: err },
      );
    }
  }

  let replacedReason: string | undefined;
  if (keyHex !== null) {
    if (isCompromisedKey(keyHex)) {
      console.warn(
        '[Encryption] Compromised master key detected. Rotating key for security.',
      );
      replacedReason = 'compromised';
    } else {
      const key = Buffer.from(keyHex, 'hex');
      if (key.length === KEY_LENGTH) {
        cachedKey = key;
        return key;
      }
      console.warn(
        `[Encryption] Invalid key length in ${MASTER_KEY_FILE}. Regenerating.`,
      );
      replacedReason = 'invalid';
    }
  }

  // 3. Generate new key
  const newKey = crypto.randomBytes(KEY_LENGTH);
  if (!persistNewKey(keyPath, newKey, replacedReason)) {
    // Another process created the key file first: use that key.
    return getEncryptionKey();
  }
  cachedKey = newKey;
  return newKey;
}

/**
 * Encrypts a string using AES-256-GCM.
 * format: iv:authTag:ciphertext (hex encoded)
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string using AES-256-GCM.
 * Handles legacy plain text gracefully by returning it as-is if format doesn't match.
 * Returns null if decryption fails for a string that looks like encrypted data.
 */
export function decrypt(text: string): string | null {
  if (!text) return text;

  // Check format: iv:authTag:ciphertext
  const parts = text.split(':');
  if (parts.length !== 3) {
    // Assume legacy plain text
    return text;
  }

  // The length check above guarantees all three parts exist.
  const [ivHex = '', authTagHex = '', encryptedHex = ''] = parts;

  // Basic validation of hex strings
  // IV is 12 bytes = 24 hex chars
  // AuthTag is 16 bytes = 32 hex chars
  if (
    !/^[0-9a-fA-F]{24}$/.test(ivHex) ||
    !/^[0-9a-fA-F]{32}$/.test(authTagHex) ||
    (encryptedHex.length > 0 && !/^[0-9a-fA-F]+$/.test(encryptedHex)) ||
    encryptedHex.length % 2 !== 0
  ) {
    // If it has 3 parts but doesn't look like valid hex, it's likely just plain text
    // that happened to contain two colons.
    return text;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    // If decryption fails (e.g. wrong key), we return null to indicate a genuine failure.
    // This allows the caller to handle the case where data exists but is unreadable.
    console.warn(
      '[Encryption] Decryption failed (possibly wrong key):',
      (err as Error).message,
    );
    return null;
  }
}
