/**
 * @file Encryption for on-disk caches of media-derived data (thumbnails, HLS
 * transcodes, the Drive offline cache), so browsing the cache folders does
 * not reveal the library. Keys are derived from the master key per cache.
 *
 * Cache files are disposable: anything that fails to decrypt (wrong key,
 * corruption, a file from before encryption) is simply a cache miss.
 */
import crypto from 'crypto';
import { deriveKey } from './encryption.ts';

export type CacheKeyLabel = 'thumb' | 'hls' | 'drive';

const GCM_ALGORITHM = 'aes-256-gcm';
const CTR_ALGORITHM = 'aes-256-ctr';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
/** AES block size; also the CTR IV (initial counter block) length. */
export const CTR_BLOCK_SIZE = 16;
/** Marks a sealed buffer and its format version. */
const SEAL_MAGIC = Buffer.from('MPC1', 'ascii');
const SEAL_HEADER_LENGTH = SEAL_MAGIC.length + GCM_IV_LENGTH + GCM_TAG_LENGTH;

/** The 256-bit key for one cache, derived from the master key. */
export function getCacheKey(label: CacheKeyLabel): Buffer {
  return deriveKey(`cache:${label}`);
}

/**
 * Encrypts and authenticates a whole buffer (AES-256-GCM).
 * Layout: magic | iv | tag | ciphertext.
 */
export function sealBuffer(label: CacheKeyLabel, plain: Buffer): Buffer {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getCacheKey(label), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([SEAL_MAGIC, iv, cipher.getAuthTag(), body]);
}

/** Decrypts a buffer made by sealBuffer; null when it is not one or fails to verify. */
export function openBuffer(
  label: CacheKeyLabel,
  sealed: Buffer,
): Buffer | null {
  if (
    sealed.length < SEAL_HEADER_LENGTH ||
    !sealed.subarray(0, SEAL_MAGIC.length).equals(SEAL_MAGIC)
  ) {
    return null;
  }
  const ivEnd = SEAL_MAGIC.length + GCM_IV_LENGTH;
  try {
    const decipher = crypto.createDecipheriv(
      GCM_ALGORITHM,
      getCacheKey(label),
      sealed.subarray(SEAL_MAGIC.length, ivEnd),
    );
    decipher.setAuthTag(sealed.subarray(ivEnd, SEAL_HEADER_LENGTH));
    return Buffer.concat([
      decipher.update(sealed.subarray(SEAL_HEADER_LENGTH)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}

/** A random initial counter block for a new CTR-encrypted file. */
export function createCtrIv(): Buffer {
  return crypto.randomBytes(CTR_BLOCK_SIZE);
}

/**
 * Returns the counter block for the AES block at `blockIndex`: the IV read as
 * a 128-bit big-endian integer plus the index (mod 2^128), as AES-CTR counts.
 */
export function ctrIvAt(iv: Buffer, blockIndex: number): Buffer {
  if (iv.length !== CTR_BLOCK_SIZE) {
    throw new Error(`CTR IV must be ${CTR_BLOCK_SIZE} bytes`);
  }
  const out = Buffer.from(iv);
  let carry = BigInt(blockIndex);
  for (let i = CTR_BLOCK_SIZE - 1; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(out[i] ?? 0) + (carry & 0xffn);
    out[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return out;
}

/**
 * A stream cipher for a CTR-encrypted file (AES-256-CTR). CTR has random
 * access: `offset` (a multiple of the block size) starts at that byte, so a
 * range can be decrypted without reading what precedes it. Encryption and
 * decryption are the same operation.
 */
export function createCtrCipher(
  label: CacheKeyLabel,
  iv: Buffer,
  offset = 0,
): crypto.Cipheriv {
  if (offset % CTR_BLOCK_SIZE !== 0) {
    throw new Error('CTR offset must be block-aligned');
  }
  return crypto.createCipheriv(
    CTR_ALGORITHM,
    getCacheKey(label),
    ctrIvAt(iv, offset / CTR_BLOCK_SIZE),
  );
}
