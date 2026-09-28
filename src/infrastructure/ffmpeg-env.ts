/**
 * Environment for FFmpeg child processes.
 *
 * The Linux binary shipped by ffmpeg-static is fully static, glibc
 * included, but glibc's iconv still loads charset converters at runtime
 * from the host's gconv directory. FFmpeg uses iconv to decode MPEG-TS
 * service names (the SDT, present in .ts/.m2ts/AVCHD files and every file
 * FFmpeg itself muxes as MPEG-TS). Loading a host converter pulls the host's
 * shared libc into the static process, which then crashes with SIGSEGV
 * right after probing the file, so no MPEG-TS input can be read at all.
 *
 * Setting GCONV_PATH makes glibc skip the precompiled gconv-modules.cache
 * and read the plain gconv-modules files instead, which on current
 * distributions only list the converters built into libc. The static glibc
 * then finds no loadable converter for those charsets, iconv_open fails,
 * and FFmpeg keeps the name undecoded instead of crashing. A GCONV_PATH
 * the user already set is left alone.
 */
export function getFFmpegEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== 'linux' || env.GCONV_PATH !== undefined) return env;
  return { ...env, GCONV_PATH: '' };
}
