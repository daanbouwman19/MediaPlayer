import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  getGoogleAuthSuccessPage,
  _resetCache,
} from '../../src/server/auth-views';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('auth-views', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();
    // Default to production for these tests to avoid cwd dependency unless needed
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should use dev path in development environment', () => {
    process.env.NODE_ENV = 'development';
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/project/root');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '<link rel="stylesheet" href="/src/renderer/assets/main.css" />',
    );

    const html = getGoogleAuthSuccessPage('code123', 'nonce123');

    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join('/project/root', 'index.html'),
    );
    expect(html).toContain('/src/renderer/assets/main.css');
    expect(html).toContain('code123');

    cwdSpy.mockRestore();
  });

  it('should use prod path in production environment', () => {
    process.env.NODE_ENV = 'production';
    vi.mocked(fs.existsSync).mockImplementation(
      (p) =>
        typeof p === 'string' &&
        p.replace(/\\/g, '/').includes('client/index.html'),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      '<link rel="stylesheet" href="/assets/index-123.css" />',
    );

    const html = getGoogleAuthSuccessPage('code123', 'nonce123');

    expect(html).toContain('/assets/index-123.css');
  });

  it('should extract preconnect links', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '<link rel="preconnect" href="https://fonts.com" /><link rel="stylesheet" href="style.css" />',
    );

    const html = getGoogleAuthSuccessPage('code123', 'nonce123');

    expect(html).toContain('https://fonts.com');
    expect(html).toContain('style.css');
  });

  it('should fallback if index.html is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const html = getGoogleAuthSuccessPage('code123', 'nonce123');

    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Outfit');
  });

  it('should handle read errors gracefully', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Read fail');
    });

    const html = getGoogleAuthSuccessPage('code123', 'nonce123');

    expect(html).toContain('Authentication Successful');
    // Should have empty stylesHtml if caught
    expect(html).not.toContain('style.css');
  });

  it('should use cached results on subsequent calls', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '<link rel="stylesheet" href="FIRST_CALL" />',
    );

    getGoogleAuthSuccessPage('1', 'n');
    const html2 = getGoogleAuthSuccessPage('2', 'n');

    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    expect(html2).toContain('FIRST_CALL');
  });
});
