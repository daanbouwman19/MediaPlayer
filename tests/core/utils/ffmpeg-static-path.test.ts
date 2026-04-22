import { describe, it, expect, vi } from 'vitest';

// Use a mutable object to store the mock value
const mockState = {
  value: '/usr/bin/ffmpeg' as string | null
};

vi.mock('ffmpeg-static', () => ({
  get default() {
    return mockState.value;
  }
}));

describe('getFFmpegStaticPath', () => {
  it('returns null if ffmpeg-static is null', async () => {
    mockState.value = null;
    const { getFFmpegStaticPath } = await import('../../../src/core/utils/ffmpeg-static-path');
    expect(getFFmpegStaticPath()).toBeNull();
  });

  it('returns unchanged path if not in asar', async () => {
    mockState.value = '/home/user/ffmpeg';
    const { getFFmpegStaticPath } = await import('../../../src/core/utils/ffmpeg-static-path');
    expect(getFFmpegStaticPath()).toBe('/home/user/ffmpeg');
  });

  it('replaces app.asar with app.asar.unpacked', async () => {
    mockState.value = '/tmp/app.asar/node_modules/ffmpeg-static/ffmpeg';
    const { getFFmpegStaticPath } = await import('../../../src/core/utils/ffmpeg-static-path');
    expect(getFFmpegStaticPath()).toBe('/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
  });

  it('returns unchanged path if already in app.asar.unpacked', async () => {
    mockState.value = '/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';
    const { getFFmpegStaticPath } = await import('../../../src/core/utils/ffmpeg-static-path');
    expect(getFFmpegStaticPath()).toBe('/tmp/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
  });
});
