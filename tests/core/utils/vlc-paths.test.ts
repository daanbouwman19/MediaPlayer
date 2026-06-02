import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getVlcPath } from '../../../src/infrastructure/vlc-paths';
import fs from 'fs';

type Platform = NodeJS.Platform;

interface TestCase {
  name: string;
  platform: Platform;
  existingPaths: string[];
  expected: string | null;
}

describe('getVlcPath', () => {
  const originalPlatform = process.platform;
  let accessSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    accessSpy = vi.spyOn(fs.promises, 'access');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    vi.restoreAllMocks();
  });

  const testCases: TestCase[] = [
    // Windows Cases
    {
      name: 'Windows: VLC found in first location',
      platform: 'win32',
      existingPaths: ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'],
      expected: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    },
    {
      name: 'Windows: VLC found in second location',
      platform: 'win32',
      existingPaths: ['C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'],
      expected: 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    },
    {
      name: 'Windows: VLC not found',
      platform: 'win32',
      existingPaths: [],
      expected: null,
    },
    // macOS Cases
    {
      name: 'macOS: VLC found in Application folder',
      platform: 'darwin',
      existingPaths: ['/Applications/VLC.app/Contents/MacOS/VLC'],
      expected: '/Applications/VLC.app/Contents/MacOS/VLC',
    },
    {
      name: 'macOS: VLC not found (fallback to "vlc")',
      platform: 'darwin',
      existingPaths: [],
      expected: 'vlc',
    },
    // Linux Cases
    {
      name: 'Linux: VLC found in /usr/bin',
      platform: 'linux',
      existingPaths: ['/usr/bin/vlc'],
      expected: '/usr/bin/vlc',
    },
    {
      name: 'Linux: VLC found in /usr/local/bin',
      platform: 'linux',
      existingPaths: ['/usr/local/bin/vlc'],
      expected: '/usr/local/bin/vlc',
    },
    {
      name: 'Linux: VLC found in /snap/bin',
      platform: 'linux',
      existingPaths: ['/snap/bin/vlc'],
      expected: '/snap/bin/vlc',
    },
    {
      name: 'Linux: VLC found in flatpak',
      platform: 'linux',
      existingPaths: ['/var/lib/flatpak/exports/bin/org.videolan.VLC'],
      expected: '/var/lib/flatpak/exports/bin/org.videolan.VLC',
    },
    {
      name: 'Linux: VLC not found (fallback to "vlc")',
      platform: 'linux',
      existingPaths: [],
      expected: 'vlc',
    },
    // Unknown Platform
    {
      name: 'Unknown Platform: defaults to "vlc"',
      platform: 'sunos',
      existingPaths: [],
      expected: 'vlc',
    },
  ];

  it.each(testCases)(
    '$name',
    async ({ platform, existingPaths, expected }: any) => {
      Object.defineProperty(process, 'platform', {
        value: platform,
      });

      accessSpy.mockImplementation((path: string) => {
        if (existingPaths.includes(path)) {
          return Promise.resolve();
        }
        return Promise.reject(new Error('Not found'));
      });

      const result = await getVlcPath();
      expect(result).toBe(expected);
    },
  );
});
