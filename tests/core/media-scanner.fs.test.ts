/**
 * Scanner tests against a real directory tree (no fs mocks).
 */
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
import { performFullMediaScan } from '../../src/core/media/media-scanner';
import { validatePathAgainstDir } from '../../src/core/auth/security';
import {
  registerDriveBackend,
  resetDriveBackend,
  type DriveBackend,
} from '../../src/core/media/drive-backend';
import type { Album } from '../../src/core/media/types';

const listFolder = vi.fn<DriveBackend['listFolder']>();
const fakeDriveBackend = { listFolder } as unknown as DriveBackend;

function allPaths(albums: Album[]): string[] {
  const paths: string[] = [];
  const stack = albums.slice();
  while (stack.length > 0) {
    const album = stack.pop()!;
    for (const t of album.textures) paths.push(t.path);
    stack.push(...album.children);
  }
  return paths.sort();
}

describe('media scanner (real filesystem)', () => {
  let root: string;

  const touch = async (relative: string) => {
    const filePath = path.join(root, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'x');
    return filePath;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    registerDriveBackend(fakeDriveBackend);
    // os.tmpdir() lies inside <profile>\AppData on Windows, which both the
    // scanner and authorization refuse as a sensitive location. Point the
    // profile roots elsewhere so the temp tree behaves like a media folder.
    if (process.platform === 'win32') {
      vi.spyOn(os, 'homedir').mockReturnValue('Z:\\NoProfiles\\user');
      vi.stubEnv('SystemDrive', 'Z:');
      vi.stubEnv('PUBLIC', 'Z:\\NoProfiles\\Public');
    }
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-')),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetDriveBackend();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('skips hidden/AppleDouble files and OS/NAS housekeeping folders', async () => {
    const kept = [
      await touch('IMG_0001.JPG'),
      await touch('clips/clip.mp4'),
      await touch('Holiday...2023.jpg'),
    ];
    // macOS AppleDouble companions and other dotfiles
    await touch('._IMG_0001.JPG');
    await touch('clips/._clip.mp4');
    await touch('.hidden.png');
    // Hidden and housekeeping folders
    await touch('.Trashes/501/old.jpg');
    await touch('$RECYCLE.BIN/S-1-5-21/deleted.jpg');
    await touch('System Volume Information/restore.jpg');
    await touch('@eaDir/IMG_0001.JPG/SYNOPHOTO_THUMB_M.jpg');
    await touch('#recycle/deleted.png');

    const albums = await performFullMediaScan([root]);

    expect(allPaths(albums)).toEqual(kept.sort());
  });

  it('only indexes files that authorization will serve', async () => {
    await touch('a/photo.jpg');
    await touch('a/._photo.jpg');
    await touch('b/.secret.mp4');
    await touch('b/video.mp4');

    const albums = await performFullMediaScan([root]);
    const paths = allPaths(albums);

    expect(paths.length).toBe(2);
    for (const p of paths) {
      const auth = await validatePathAgainstDir(root, p);
      expect(auth?.isAllowed).toBe(true);
    }
  });

  it('never lists a file twice when the same source is given twice', async () => {
    await touch('photo.jpg');
    await touch('sub/clip.mp4');

    const albums = await performFullMediaScan([root, root]);

    expect(albums).toHaveLength(1);
    expect(allPaths(albums)).toHaveLength(2);
  });

  it('removes files a Drive root already listed and prunes albums it empties', async () => {
    const shared = { name: 'shared.jpg', path: 'gdrive://shared' };
    listFolder.mockImplementation(async (id) => {
      if (id === 'parent') {
        return {
          id: 'parent',
          name: 'Parent',
          textures: [{ name: 'p.jpg', path: 'gdrive://p' }],
          children: [
            {
              id: 'child',
              name: 'Child',
              textures: [shared],
              children: [],
            },
            // Already empty before de-duplication: left alone.
            { id: 'empty', name: 'Empty', textures: [], children: [] },
          ],
        };
      }
      return {
        id: 'child',
        name: 'Child',
        textures: [shared, { ...shared }],
        children: [],
      };
    });

    const albums = await performFullMediaScan([
      'gdrive://parent',
      'gdrive://child',
    ]);

    expect(albums.map((a) => a.id)).toEqual(['parent']);
    expect(albums[0]!.children.map((c) => c.id)).toEqual(['child', 'empty']);
    expect(allPaths(albums)).toEqual(['gdrive://p', 'gdrive://shared']);
  });

  it('drops a repeated file within one album', async () => {
    const dup = { name: 'a.jpg', path: 'gdrive://a' };
    listFolder.mockResolvedValue({
      id: 'folder',
      name: 'Folder',
      textures: [dup, { name: 'b.jpg', path: 'gdrive://b' }, { ...dup }],
      children: [],
    });

    const albums = await performFullMediaScan(['gdrive://folder']);

    expect(albums[0]!.textures.map((t) => t.path)).toEqual([
      'gdrive://a',
      'gdrive://b',
    ]);
  });
});
