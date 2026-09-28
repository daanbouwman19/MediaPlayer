import { describe, it, expect } from 'vite-plus/test';
import {
  getUnauthenticatedExposureWarning,
  isAuthConfigured,
  isLoopbackHost,
} from '../../src/server/network-exposure';

describe('isLoopbackHost', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    'localhost',
    'LOCALHOST',
    'app.localhost',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
  ])('treats %s as loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '::',
    '192.168.1.20',
    '10.0.0.5',
    '::ffff:192.168.1.20',
    'fe80::1',
    'media.lan',
    '',
  ])('treats %s as reachable from other machines', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('isAuthConfigured', () => {
  it('accepts a global password', () => {
    expect(isAuthConfigured({ GLOBAL_PASSWORD: 'secret' })).toBe(true);
  });

  it('accepts basic auth only when both user and password are set', () => {
    expect(
      isAuthConfigured({ SYSTEM_USER: 'admin', SYSTEM_PASSWORD: 'secret' }),
    ).toBe(true);
    expect(isAuthConfigured({ SYSTEM_USER: 'admin' })).toBe(false);
    expect(isAuthConfigured({ SYSTEM_PASSWORD: 'secret' })).toBe(false);
  });

  it('treats empty values as unset', () => {
    expect(
      isAuthConfigured({
        GLOBAL_PASSWORD: '',
        SYSTEM_USER: '',
        SYSTEM_PASSWORD: '',
      }),
    ).toBe(false);
  });
});

describe('getUnauthenticatedExposureWarning', () => {
  it('warns when a non-loopback host has no authentication', () => {
    const warning = getUnauthenticatedExposureWarning('0.0.0.0', 3000, {});

    expect(warning).toContain('0.0.0.0:3000');
    expect(warning).toContain('no authentication is configured');
    expect(warning).toContain('GLOBAL_PASSWORD');
  });

  it('stays silent on loopback', () => {
    expect(getUnauthenticatedExposureWarning('127.0.0.1', 3000, {})).toBe(null);
  });

  it('stays silent when authentication is configured', () => {
    expect(
      getUnauthenticatedExposureWarning('0.0.0.0', 3000, {
        GLOBAL_PASSWORD: 'secret',
      }),
    ).toBe(null);
  });
});
