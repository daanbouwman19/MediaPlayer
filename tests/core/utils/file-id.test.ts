import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  assignFileIds,
  generateFileId,
  generateUniqueFileId,
  pathScopedFileId,
  resolveFileIdCollision,
} from '../../../src/core/media/utils/file-id';

const MTIME = new Date('2024-05-01T10:00:00.000Z');

/** The pre-fix content ID (md5 of size and mtime). */
async function contentId(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return crypto
    .createHash('md5')
    .update(`${stats.size}-${stats.mtime.getTime()}`)
    .digest('hex');
}

describe('file-id', () => {
  let dir: string;

  /** Writes a file with fixed content and mtime, like a copy made with cp -p. */
  const writeCopy = async (name: string) => {
    const filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'same bytes');
    await fs.utimes(filePath, MTIME, MTIME);
    return filePath;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-id-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps the size+mtime ID so existing rows keep their identity', async () => {
    const file = await writeCopy('a.jpg');
    expect(await generateFileId(file)).toBe(await contentId(file));
  });

  it('gives copies with the same size and mtime the same content ID', async () => {
    const a = await writeCopy('2024/Trip/photo.jpg');
    const b = await writeCopy('Favorites/photo.jpg');
    expect(await generateFileId(a)).toBe(await generateFileId(b));
  });

  describe('resolveFileIdCollision', () => {
    it('uses the content ID when it is free or already this path', async () => {
      const a = await writeCopy('a.jpg');
      const id = await generateFileId(a);
      expect(await resolveFileIdCollision(a, id, null)).toBe(id);
      expect(await resolveFileIdCollision(a, id, undefined)).toBe(id);
      expect(await resolveFileIdCollision(a, id, a)).toBe(id);
    });

    it('gives a copy its own path-scoped ID while the original still exists', async () => {
      const original = await writeCopy('2024/Trip/photo.jpg');
      const copy = await writeCopy('Favorites/photo.jpg');
      const id = await generateFileId(copy);

      const resolved = await resolveFileIdCollision(copy, id, original);

      expect(resolved).not.toBe(id);
      expect(resolved).toBe(pathScopedFileId(id, copy));
      // Stable: the same path always gets the same scoped ID.
      expect(await resolveFileIdCollision(copy, id, original)).toBe(resolved);
    });

    it('re-points the ID to the new path when the old path is gone (move/rename)', async () => {
      const moved = await writeCopy('new/photo.jpg');
      const id = await generateFileId(moved);
      const oldPath = path.join(dir, 'old', 'photo.jpg');

      expect(await resolveFileIdCollision(moved, id, oldPath)).toBe(id);
    });

    it('gives a hard link its own path-scoped ID while the other link exists', async () => {
      const file = await writeCopy('photo.jpg');
      const alias = path.join(dir, 'link.jpg');
      try {
        await fs.link(file, alias);
      } catch {
        return; // Hard links unsupported on this filesystem.
      }
      const id = await generateFileId(file);

      // Sharing the row would re-point it between the two links every scan.
      expect(await resolveFileIdCollision(alias, id, file)).toBe(
        pathScopedFileId(id, alias),
      );
    });

    it('keeps the owner claim when the owner path cannot be checked', async () => {
      const file = await writeCopy('photo.jpg');
      const id = await generateFileId(file);
      // e.g. a share that denies access: not proof the original is gone.
      const statSpy = vi
        .spyOn(fs, 'stat')
        .mockRejectedValueOnce(
          Object.assign(new Error('denied'), { code: 'EACCES' }),
        );

      try {
        expect(
          await resolveFileIdCollision(file, id, path.join(dir, 'other.jpg')),
        ).toBe(pathScopedFileId(id, file));
      } finally {
        statSpy.mockRestore();
      }
    });

    it('treats an owner path below a file (ENOTDIR) as gone', async () => {
      const file = await writeCopy('photo.jpg');
      const id = await generateFileId(file);
      const belowFile = path.join(file, 'nested.jpg');

      expect(await resolveFileIdCollision(file, id, belowFile)).toBe(id);
    });

    it('never disambiguates Google Drive IDs', async () => {
      expect(
        await resolveFileIdCollision('gdrive://abc', 'abc', 'gdrive://other'),
      ).toBe('abc');
    });
  });

  describe('generateUniqueFileId', () => {
    it('consults the owner lookup for the content ID', async () => {
      const original = await writeCopy('a/photo.jpg');
      const copy = await writeCopy('b/photo.jpg');
      const id = await generateFileId(original);
      const owners = new Map([[id, original]]);

      expect(await generateUniqueFileId(original, (k) => owners.get(k))).toBe(
        id,
      );
      expect(await generateUniqueFileId(copy, (k) => owners.get(k))).toBe(
        pathScopedFileId(id, copy),
      );
    });

    it('still rejects an empty path', async () => {
      await expect(generateUniqueFileId('', () => null)).rejects.toThrow(
        'File path cannot be null or empty',
      );
    });
  });

  describe('assignFileIds', () => {
    it('gives copies indexed in the same batch distinct IDs', async () => {
      const a = await writeCopy('a/photo.jpg');
      const b = await writeCopy('b/photo.jpg');
      const c = await writeCopy('c/photo.jpg');

      const ids = await assignFileIds([a, b, c], () => null);

      expect(new Set([ids.get(a), ids.get(b), ids.get(c)]).size).toBe(3);
      // The first path keeps the plain content ID.
      expect(ids.get(a)).toBe(await contentId(a));
    });

    it('leaves non-colliding files on their content ID', async () => {
      const a = await writeCopy('a.jpg');
      await fs.writeFile(path.join(dir, 'b.jpg'), 'different bytes!');
      const b = path.join(dir, 'b.jpg');

      const ids = await assignFileIds([a, b], () => null);

      expect(ids.get(a)).toBe(await contentId(a));
      expect(ids.get(b)).toBe(await contentId(b));
    });

    it('handles more files than one I/O batch', async () => {
      const paths: string[] = [];
      for (let i = 0; i < 60; i++) {
        const p = path.join(dir, `f${i}.jpg`);
        await fs.writeFile(p, `content ${i}`);
        paths.push(p);
      }
      const ids = await assignFileIds(paths, () => null);
      expect(ids.size).toBe(60);
    });

    it('skips paths whose ID cannot be generated', async () => {
      const a = await writeCopy('a.jpg');
      const ids = await assignFileIds(['', a], () => null);
      expect(ids.has('')).toBe(false);
      expect(ids.has(a)).toBe(true);
    });
  });
});
