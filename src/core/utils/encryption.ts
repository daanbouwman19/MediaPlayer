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

/**
 * Retrieves or generates the encryption key.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  // 1. Check environment variable
  if (process.env.MASTER_KEY) {
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
  if (fs.existsSync(keyPath)) {
    try {
      const keyHex = fs.readFileSync(keyPath, 'utf8').trim();
      const currentKeyHash = crypto
        .createHash('sha256')
        .update(keyHex)
        .digest('hex');

      if (currentKeyHash === COMPROMISED_KEY_HASH) {
        console.warn(
          '[Encryption] Compromised master key detected. Rotating key for security.',
        );
        // Fall through to generation logic
      } else {
        const key = Buffer.from(keyHex, 'hex');
        if (key.length !== KEY_LENGTH) {
          console.warn(
            `[Encryption] Invalid key length in ${MASTER_KEY_FILE}. Regenerating.`,
          );
        } else {
          cachedKey = key;
          return key;
        }
      }
    } catch (err) {
      console.warn(`[Encryption] Failed to read ${MASTER_KEY_FILE}:`, err);
    }
  }

  // 3. Generate new key
  const newKey = crypto.randomBytes(KEY_LENGTH);
  try {
    fs.writeFileSync(keyPath, newKey.toString('hex'), { mode: 0o600 });
    console.log(`[Encryption] Generated new master key at ${keyPath}`);
  } catch (err) {
    console.error(`[Encryption] Failed to write ${MASTER_KEY_FILE}:`, err);
    throw new Error(
      `Failed to persist encryption key to ${MASTER_KEY_FILE}. Aborting to prevent data loss on restart.`,
    );
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
 * Handles legacy plain text gracefully.
 */
export function decrypt(text: string): string {
  if (!text) return text;

  // Check format: iv:authTag:ciphertext
  const parts = text.split(':');
  if (parts.length !== 3) {
    // Assume legacy plain text
    return text;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;

  // Basic validation of hex strings
  // IV is 12 bytes = 24 hex chars
  // AuthTag is 16 bytes = 32 hex chars
  // ciphertext can be empty string
  if (
    !/^[0-9a-fA-F]{24}$/.test(ivHex) ||
    !/^[0-9a-fA-F]{32}$/.test(authTagHex) ||
    (encryptedHex.length > 0 && !/^[0-9a-fA-F]+$/.test(encryptedHex)) ||
    encryptedHex.length % 2 !== 0
  ) {
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
    // If decryption fails (e.g. wrong key, or it was actually a plain text string with 2 colons),
    // we return the original text as fallback, assuming it might be legacy data that looked like encrypted format.
    // But GCM failure usually means tampering or wrong key.
    console.warn(
      '[Encryption] Decryption failed, returning original text:',
      (err as Error).message,
    );
    return text;
  }
}
