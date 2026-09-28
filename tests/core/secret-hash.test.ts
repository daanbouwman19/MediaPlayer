import { describe, it, expect } from 'vite-plus/test';
import {
  hashSecret,
  isAcceptableSecret,
  scryptAsync,
  verifySecret,
} from '../../src/core/auth/secret-hash';
import { MAX_PASSWORD_LENGTH } from '../../src/core/media/constants';

describe('secret-hash', () => {
  it('round-trips a secret', async () => {
    const stored = await hashSecret('1234');
    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifySecret('1234', stored)).toBe(true);
    expect(await verifySecret('4321', stored)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashSecret('same')).not.toBe(await hashSecret('same'));
  });

  it('rejects empty, oversized and non-string secrets', async () => {
    expect(isAcceptableSecret('')).toBe(false);
    expect(isAcceptableSecret(42)).toBe(false);
    expect(isAcceptableSecret('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(false);
    await expect(hashSecret('')).rejects.toThrow();
    const stored = await hashSecret('ok');
    expect(await verifySecret(undefined, stored)).toBe(false);
  });

  it('never matches a malformed stored value', async () => {
    expect(await verifySecret('a', '')).toBe(false);
    expect(await verifySecret('a', 'bcrypt:00:00')).toBe(false);
    expect(await verifySecret('a', 'scrypt:00:abcd')).toBe(false);
  });

  it('scryptAsync rejects on invalid parameters', async () => {
    await expect(scryptAsync('a', Buffer.alloc(16), -1)).rejects.toThrow();
  });
});
