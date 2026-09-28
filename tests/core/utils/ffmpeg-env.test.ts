import { describe, it, expect } from 'vite-plus/test';
import { getFFmpegEnv } from '../../../src/infrastructure/ffmpeg-env';

describe('getFFmpegEnv', () => {
  it('sets GCONV_PATH on Linux so the static FFmpeg cannot crash in iconv', () => {
    const env = { PATH: '/usr/bin' };
    expect(getFFmpegEnv(env, 'linux')).toEqual({
      PATH: '/usr/bin',
      GCONV_PATH: '',
    });
    expect(env).toEqual({ PATH: '/usr/bin' }); // not mutated
  });

  it('keeps a GCONV_PATH the user already set', () => {
    const env = { GCONV_PATH: '/opt/gconv' };
    expect(getFFmpegEnv(env, 'linux')).toBe(env);
  });

  it('passes the environment through unchanged on other platforms', () => {
    const env = { PATH: 'C:\\Windows' };
    expect(getFFmpegEnv(env, 'win32')).toBe(env);
    expect(getFFmpegEnv(env, 'darwin')).toBe(env);
  });

  it('defaults to the current process environment', () => {
    const env = getFFmpegEnv();
    expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
  });
});
