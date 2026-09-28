// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalFileSystemProvider } from '../../../src/infrastructure/providers/local-provider';

/**
 * Exercises the real provider against real files: names that merely contain
 * '..' (an ellipsis) are legitimate, only '..' path segments are traversal.
 */
describe('LocalFileSystemProvider path validation', () => {
  const provider = new LocalFileSystemProvider();
  let dir: string;
  let ellipsisFile: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-provider-'));
    ellipsisFile = path.join(dir, 'Holiday...2023.jpg');
    await fs.writeFile(ellipsisFile, 'jpeg-bytes');
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads metadata for a file whose name contains an ellipsis', async () => {
    const meta = await provider.getMetadata(ellipsisFile);
    expect(meta.size).toBe('jpeg-bytes'.length);
    expect(meta.mimeType).toBe('image/jpeg');
  });

  it('streams a file whose name contains an ellipsis', async () => {
    const { stream } = await provider.getStream(ellipsisFile);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe('jpeg-bytes');
  });

  it.each([
    ['a POSIX parent segment', '/media/../etc/passwd'],
    ['a Windows parent segment', 'C:\\media\\..\\secret.txt'],
    ['a leading parent segment', '../secret.txt'],
    ['a NUL byte', '/media/file\0.jpg'],
  ])('rejects a path with %s', async (_label, badPath) => {
    await expect(provider.getMetadata(badPath)).rejects.toThrow(
      'Invalid file path',
    );
    await expect(provider.getStream(badPath)).rejects.toThrow(
      'Invalid file path',
    );
  });
});
