import { execa } from 'execa';
import path from 'path';
import fs from 'fs/promises';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Utility to generate a diverse collection of media files for testing purposes.
 * This avoids bloating the repository with large binary files while ensuring
 * robust coverage across different containers and codecs.
 */
export async function generateTestMediaMatrix(outputDir: string) {
  if (!ffmpegStatic) throw new Error('FFmpeg not found');

  await fs.mkdir(outputDir, { recursive: true });

  const matrix = [
    // [Container, Video Codec, Audio Codec, Duration]
    ['mp4', 'libx264', 'aac', '5'],
    ['mkv', 'libx264', 'aac', '5'],
    ['mkv', 'libx265', 'aac', '5'], // HEVC
    ['webm', 'libvpx-vp9', 'libopus', '5'], // VP9
    ['avi', 'mpeg4', 'mp3', '5'], // Legacy AVI
    ['mov', 'libx264', 'aac', '5'],
  ];

  for (const [ext, vcodec, acodec, duration] of matrix) {
    const fileName = `test_${vcodec}_${acodec}.${ext}`;
    const filePath = path.join(outputDir, fileName);

    // Skip if already exists
    try {
      await fs.access(filePath);
      continue;
    } catch {
      // Generate
    }

    console.log(`Generating test media: ${fileName}...`);

    // Generate a simple test video with moving color bars and sound
    const args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${duration}:size=640x360:rate=24`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${duration}`,
      '-c:v',
      vcodec,
      '-c:a',
      acodec,
      filePath,
    ];

    try {
      await execa(ffmpegStatic, args);
    } catch (err) {
      console.error(`Failed to generate ${fileName}:`, err);
    }
  }
}

// If run directly
if (process.argv[1] === import.meta.filename) {
  const output = path.join(process.cwd(), 'tests/fixtures/diversity');
  generateTestMediaMatrix(output).catch(console.error);
}
