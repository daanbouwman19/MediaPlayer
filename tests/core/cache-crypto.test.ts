import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import crypto from 'crypto';

const KEY_A = 'ab'.repeat(32);
const KEY_B = 'cd'.repeat(32);

async function load(masterKey: string) {
  vi.resetModules();
  vi.stubEnv('MASTER_KEY', masterKey);
  return import('../../src/core/auth/cache-crypto');
}

describe('cache-crypto', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  describe('getCacheKey', () => {
    it('derives a distinct, stable 256-bit key per cache', async () => {
      const { getCacheKey } = await load(KEY_A);
      const thumb = getCacheKey('thumb');
      expect(thumb).toHaveLength(32);
      expect(getCacheKey('thumb')).toBe(thumb); // cached
      expect(getCacheKey('hls').equals(thumb)).toBe(false);
      expect(getCacheKey('drive').equals(getCacheKey('hls'))).toBe(false);
      // Never the master key itself.
      expect(thumb.equals(Buffer.from(KEY_A, 'hex'))).toBe(false);
    });

    it('follows a master key installed later', async () => {
      const { getCacheKey } = await load(KEY_A);
      const before = getCacheKey('thumb');
      const { setMasterKey } = await import('../../src/core/auth/encryption');
      setMasterKey(Buffer.from(KEY_B, 'hex'));
      expect(getCacheKey('thumb').equals(before)).toBe(false);
    });
  });

  describe('sealBuffer / openBuffer', () => {
    it('round-trips and hides the plaintext', async () => {
      const { sealBuffer, openBuffer } = await load(KEY_A);
      const plain = Buffer.from('a thumbnail');
      const sealed = sealBuffer('thumb', plain);
      expect(sealed.includes(plain)).toBe(false);
      expect(openBuffer('thumb', sealed)).toEqual(plain);
      // A fresh IV every time.
      expect(sealBuffer('thumb', plain).equals(sealed)).toBe(false);
    });

    it('returns null for anything it did not seal', async () => {
      const { sealBuffer, openBuffer } = await load(KEY_A);
      const sealed = sealBuffer('thumb', Buffer.from('data'));

      expect(openBuffer('thumb', Buffer.from('short'))).toBeNull();
      expect(openBuffer('thumb', Buffer.alloc(64))).toBeNull(); // no magic
      // Tampered ciphertext fails authentication.
      const tampered = Buffer.from(sealed);
      tampered[tampered.length - 1]! ^= 1;
      expect(openBuffer('thumb', tampered)).toBeNull();
      // Another cache's key cannot open it.
      expect(openBuffer('hls', sealed)).toBeNull();
    });

    it('cannot be opened with another master key', async () => {
      const { sealBuffer } = await load(KEY_A);
      const sealed = sealBuffer('thumb', Buffer.from('data'));
      const { openBuffer } = await load(KEY_B);
      expect(openBuffer('thumb', sealed)).toBeNull();
    });
  });

  describe('CTR', () => {
    it('ctrIvAt adds the block index to the IV as a big-endian counter', async () => {
      const { ctrIvAt } = await load(KEY_A);
      const iv = Buffer.alloc(16, 0);
      iv[15] = 0xff;
      iv[14] = 0xff;
      expect(ctrIvAt(iv, 0)).toEqual(iv);
      expect(ctrIvAt(iv, 1).toString('hex')).toBe(
        '00000000000000000000000000010000',
      );
      // Wraps around at 2^128.
      const max = Buffer.alloc(16, 0xff);
      expect(ctrIvAt(max, 2).toString('hex')).toBe(
        '00000000000000000000000000000001',
      );
      expect(() => ctrIvAt(Buffer.alloc(8), 1)).toThrow(/16 bytes/);
    });

    it('decrypts any block-aligned range independently', async () => {
      const { createCtrCipher, createCtrIv } = await load(KEY_A);
      const iv = createCtrIv();
      expect(iv).toHaveLength(16);
      const plain = crypto.randomBytes(1000);
      const enc = createCtrCipher('drive', iv);
      const cipherText = Buffer.concat([enc.update(plain), enc.final()]);
      expect(cipherText.equals(plain)).toBe(false);

      for (const offset of [0, 16, 512, 992]) {
        const dec = createCtrCipher('drive', iv, offset);
        const part = Buffer.concat([
          dec.update(cipherText.subarray(offset)),
          dec.final(),
        ]);
        expect(part).toEqual(plain.subarray(offset));
      }
    });

    it('rejects an unaligned offset', async () => {
      const { createCtrCipher, createCtrIv } = await load(KEY_A);
      expect(() => createCtrCipher('drive', createCtrIv(), 17)).toThrow(
        /block-aligned/,
      );
    });
  });
});
