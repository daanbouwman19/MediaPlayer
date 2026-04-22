import ffmpegStatic from 'ffmpeg-static';

/**
 * Resolves the path to the FFmpeg binary.
 * In a packaged Electron app, this path must point to the unpacked binary
 * because the OS cannot execute binaries directly from within the ASAR archive.
 */
export function getFFmpegStaticPath(): string | null {
  if (!ffmpegStatic) return null;

  // In Electron production, we need to point to the asar.unpacked directory
  // because the binary is unpacked there via the 'asarUnpack' configuration.
  const isElectron = !!(process.versions && process.versions.electron);
  if (
    isElectron &&
    ffmpegStatic.includes('app.asar') &&
    !ffmpegStatic.includes('app.asar.unpacked')
  ) {
    return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  }

  return ffmpegStatic;
}
