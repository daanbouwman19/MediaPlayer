/**
 * @file Password and PIN hashing with scrypt, shared by the web password
 * check and the desktop PIN lock.
 */
import crypto from 'crypto';
import { MAX_PASSWORD_LENGTH } from '../media/constants.ts';

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const HASH_PREFIX = 'scrypt';

/** Promisified `crypto.scrypt` with the default cost parameters. */
export function scryptAsync(
  secret: string,
  salt: Buffer,
  keyLength = KEY_LENGTH,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keyLength, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Whether a secret may be hashed at all. The length cap keeps a huge input
 * from tying up scrypt (DoS).
 */
export function isAcceptableSecret(secret: unknown): secret is string {
  return (
    typeof secret === 'string' &&
    secret.length > 0 &&
    secret.length <= MAX_PASSWORD_LENGTH
  );
}

/** Hashes a secret for storage as `scrypt:<salt hex>:<hash hex>`. */
export async function hashSecret(secret: string): Promise<string> {
  if (!isAcceptableSecret(secret)) {
    throw new Error('Secret is empty or too long');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(secret, salt);
  return `${HASH_PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Checks a secret against a value from {@link hashSecret} in constant time.
 * A malformed stored value never matches.
 */
export async function verifySecret(
  secret: unknown,
  stored: string,
): Promise<boolean> {
  if (!isAcceptableSecret(secret)) return false;
  const [prefix, saltHex, hashHex] = stored.split(':');
  if (prefix !== HASH_PREFIX || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(secret, Buffer.from(saltHex, 'hex'));
  return crypto.timingSafeEqual(actual, expected);
}
