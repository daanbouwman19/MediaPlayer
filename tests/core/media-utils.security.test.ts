import { describe, it, expect } from 'vitest';
import { isValidTimeFormat } from '../../src/infrastructure/ffmpeg-utils';

describe('isValidTimeFormat Security & Validation', () => {
  it('should accept valid time formats', () => {
    expect(isValidTimeFormat('10')).toBe(true);
    expect(isValidTimeFormat('10.5')).toBe(true);
    expect(isValidTimeFormat('00:10')).toBe(true);
    expect(isValidTimeFormat('00:00:10')).toBe(true);
    expect(isValidTimeFormat('00:00:10.500')).toBe(true);
    expect(isValidTimeFormat('1:2:3')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(isValidTimeFormat('abc')).toBe(false);
    expect(isValidTimeFormat('10:abc')).toBe(false);
    expect(isValidTimeFormat('10..5')).toBe(false);
    expect(isValidTimeFormat(':10')).toBe(false);
    expect(isValidTimeFormat('10:')).toBe(false);
  });

  it('should reject potentially malicious long chains of colons', () => {
    // Current implementation allows this, which is wrong.
    // We expect the FIX to reject this.
    // "1:1:1:1:1" is not a valid timestamp for FFmpeg seeking usually (HH:MM:SS)
    expect(isValidTimeFormat('00:00:00:00:00:00:01')).toBe(false);

    const longString = '1:'.repeat(100) + '1';
    expect(isValidTimeFormat(longString)).toBe(false);
  });
});
