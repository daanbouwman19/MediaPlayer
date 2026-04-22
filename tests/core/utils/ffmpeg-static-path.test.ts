import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use a mutable object to store the mock value
const mockState = {
  value: '/usr/bin/ffmpeg' as string | null,
};

vi.mock('ffmpeg-static', () => ({
  get default() {
    return mockState.value;
  },
}));

describe('getFFmpegStaticPath', () => {
  const originalElectron = process.versions.electron;

  beforeEach(() => {
    // We cannot replace process.versions, but we can try to modify its properties
    // or use Object.defineProperty if it's configurable.
    // In Vitest/Node, process.versions is usually not configurable.
    // However, we can use vi.stubGlobal or just rely on the fact that
    // process.versions might be modifiable in some environments.
    // A safer way is to use vi.spyOn if it's a getter, but it's a property.
  });

  afterEach(() => {
    if (originalElectron) {
      (process.versions as any).electron = originalElectron;
    } else {
      delete (process.versions as any).electron;
    }
  });

  it('returns null if ffmpeg-static is null', async () => {
    mockState.value = null;
    const { getFFmpegStaticPath } = await import(
      '../../../src/core/utils/ffmpeg-static-path'
    );
    expect(getFFmpegStaticPath()).toBeNull();
  });

  it('returns unchanged path if not in asar', async () => {
    mockState.value = '/home/user/ffmpeg';
    const { getFFmpegStaticPath } = await import(
      '../../../src/core/utils/ffmpeg-static-path'
    );
    expect(getFFmpegStaticPath()).toBe('/home/user/ffmpeg');
  });

  it('replaces app.asar with app.asar.unpacked if in Electron', async () => {
    // Attempt to set electron version
    Object.defineProperty(process.versions, 'electron', {
      value: '1.0.0',
      configurable: true,
    });

    mockState.value = '/tmp/app.asar/node_modules/ffmpeg-static/ffmpeg';
    const { getFFmpegStaticPath } = await import(
      '../../../src/core/utils/ffmpeg-static-path'
    );
    expect(getFFmpegStaticPath()).toBe(
      '/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    );
  });

  it('returns unchanged path if already in app.asar.unpacked', async () => {
    Object.defineProperty(process.versions, 'electron', {
      value: '1.0.0',
      configurable: true,
    });

    mockState.value = '/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';
    const { getFFmpegStaticPath } = await import(
      '../../../src/core/utils/ffmpeg-static-path'
    );
    expect(getFFmpegStaticPath()).toBe(
      '/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
    );
  });

  it('returns unchanged path if in asar but NOT in Electron', async () => {
    Object.defineProperty(process.versions, 'electron', {
      value: undefined,
      configurable: true,
    });

    mockState.value = '/tmp/app.asar/node_modules/ffmpeg-static/ffmpeg';
    const { getFFmpegStaticPath } = await import(
      '../../../src/core/utils/ffmpeg-static-path'
    );
    expect(getFFmpegStaticPath()).toBe(
      '/tmp/app.asar/node_modules/ffmpeg-static/ffmpeg',
    );
  });
});
