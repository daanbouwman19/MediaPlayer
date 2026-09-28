import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { google } from 'googleapis';
import * as driveService from '../../src/main/google-drive-service';
import * as googleAuth from '../../src/main/google-auth';
import type { Album } from '../../src/core/media/types';

vi.mock('../../src/main/google-auth');
vi.mock('googleapis');

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

interface FakeEntry {
  id: string;
  name?: string;
  mimeType: string;
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

interface FakeFolder {
  name: string;
  entries: FakeEntry[];
}

/** Drive returns at most this many entries per page, whatever pageSize asks for. */
const FAKE_PAGE_SIZE = 100;

/**
 * An in-memory Drive: files.list answers "'<id>' in parents" queries page by
 * page (honouring the query's mimeType filter), and files.get describes
 * folders and files.
 */
function createFakeDrive(folders: Record<string, FakeFolder>) {
  const failing = new Map<string, Error>();
  const byId = new Map<string, FakeEntry>();
  for (const folder of Object.values(folders)) {
    for (const entry of folder.entries) byId.set(entry.id, entry);
  }

  const matchesQuery = (q: string, entry: FakeEntry) => {
    if (!q.includes('mimeType')) return true;
    return (
      (q.includes("mimeType contains 'image/'") &&
        entry.mimeType.startsWith('image/')) ||
      (q.includes("mimeType contains 'video/'") &&
        entry.mimeType.startsWith('video/')) ||
      q.includes(`mimeType = '${entry.mimeType}'`)
    );
  };

  const list = vi.fn(async (params: { q: string; pageToken?: string }) => {
    const folderId = /^'([^']+)' in parents/.exec(params.q)?.[1] ?? '';
    const error = failing.get(folderId);
    if (error) throw error;

    const entries = (folders[folderId]?.entries ?? []).filter((entry) =>
      matchesQuery(params.q, entry),
    );
    const start = params.pageToken ? Number(params.pageToken) : 0;
    const end = start + FAKE_PAGE_SIZE;
    return {
      data: {
        files: entries.slice(start, end),
        ...(end < entries.length ? { nextPageToken: String(end) } : {}),
      },
    };
  });

  const get = vi.fn(async (params: { fileId: string }) => {
    const folder = folders[params.fileId];
    if (folder) {
      return {
        data: { id: params.fileId, name: folder.name, mimeType: FOLDER },
      };
    }
    const entry = byId.get(params.fileId);
    if (entry) return { data: entry };
    throw Object.assign(new Error('File not found'), { status: 404 });
  });

  return { drive: { files: { list, get } }, failing };
}

function useFakeDrive(folders: Record<string, FakeFolder>) {
  const fake = createFakeDrive(folders);
  (google.drive as any).mockReturnValue(fake.drive);
  return fake;
}

const image = (id: string, name = `${id}.jpg`): FakeEntry => ({
  id,
  name,
  mimeType: 'image/jpeg',
});

const folderEntry = (id: string, name = id): FakeEntry => ({
  id,
  name,
  mimeType: FOLDER,
});

const shortcut = (
  id: string,
  name: string,
  targetId: string,
  targetMimeType: string,
): FakeEntry => ({
  id,
  name,
  mimeType: SHORTCUT,
  shortcutDetails: { targetId, targetMimeType },
});

const childNames = (album: Album) => album.children.map((c) => c.name);
const texturePaths = (album: Album) => album.textures.map((t) => t.path);

describe('listDriveFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveService.resetDriveClient();
    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the album tree and names the root after the Drive folder', async () => {
    const { drive } = useFakeDrive({
      src: {
        name: 'Holiday Videos',
        entries: [image('f1', 'beach.jpg'), folderEntry('sub', 'Day 1')],
      },
      sub: { name: 'Day 1', entries: [image('f2', 'sunset.jpg')] },
    });

    const album = await driveService.listDriveFiles('src');

    expect(album).toEqual({
      id: 'src',
      name: 'Holiday Videos',
      textures: [{ name: 'beach.jpg', path: 'gdrive://f1' }],
      children: [
        {
          id: 'sub',
          name: 'Day 1',
          textures: [{ name: 'sunset.jpg', path: 'gdrive://f2' }],
          children: [],
        },
      ],
    });
    // Shared-drive items need these flags on every call.
    expect(drive.files.get).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'src', supportsAllDrives: true }),
    );
    for (const [params] of drive.files.list.mock.calls) {
      expect(params).toEqual(
        expect.objectContaining({
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 1000,
        }),
      );
    }
  });

  it("keeps a 'root' source's album ID while naming it after My Drive", async () => {
    useFakeDrive({
      root: { name: 'My Drive', entries: [image('f1')] },
    });

    const album = await driveService.listDriveFiles('root');

    expect(album.id).toBe('root');
    expect(album.name).toBe('My Drive');
  });

  it('lists every page of subfolders, not just the first 100 entries', async () => {
    const days: Record<string, FakeFolder> = {};
    const dayEntries: FakeEntry[] = [];
    for (let i = 0; i < 250; i++) {
      days[`day${i}`] = { name: `Day ${i}`, entries: [image(`img${i}`)] };
      dayEntries.push(folderEntry(`day${i}`, `Day ${i}`));
    }
    // Media shortcuts share the listing with the folders.
    const shortcuts = Array.from({ length: 150 }, (_, i) =>
      shortcut(`sc${i}`, `linked${i}.jpg`, `linked${i}`, 'image/jpeg'),
    );
    useFakeDrive({
      photos: { name: 'Photos', entries: [...shortcuts, ...dayEntries] },
      ...days,
    });

    const album = await driveService.listDriveFiles('photos');

    expect(album.children).toHaveLength(250);
    expect(album.textures).toHaveLength(150);
    expect(childNames(album)).toContain('Day 249');
  });

  it('scans folders nested more than five levels deep', async () => {
    const folders: Record<string, FakeFolder> = {};
    for (let i = 0; i < 8; i++) {
      folders[`level${i}`] = {
        name: `Level ${i}`,
        entries: i < 7 ? [folderEntry(`level${i + 1}`, `Level ${i + 1}`)] : [],
      };
    }
    folders.level7.entries.push(image('deep', 'deep.jpg'));
    useFakeDrive(folders);

    let album = await driveService.listDriveFiles('level0');
    for (let i = 1; i < 8; i++) {
      expect(album.children).toHaveLength(1);
      album = album.children[0];
    }
    expect(album.name).toBe('Level 7');
    expect(texturePaths(album)).toEqual(['gdrive://deep']);
  });

  it('stops at the safety depth cap and reports what it skipped', async () => {
    const folders: Record<string, FakeFolder> = {};
    for (let i = 0; i <= 101; i++) {
      folders[`n${i}`] = {
        name: `N${i}`,
        entries: [
          image(`img${i}`),
          ...(i < 101 ? [folderEntry(`n${i + 1}`)] : []),
        ],
      };
    }
    const { drive } = useFakeDrive(folders);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await driveService.listDriveFiles('n0');

    // Depths 0..100 are listed; the folder at depth 101 is not.
    expect(drive.files.list).toHaveBeenCalledTimes(101);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipped 1 folder(s) nested more than 100 levels',
      ),
    );
  });

  it('follows shortcut cycles only once', async () => {
    const { drive } = useFakeDrive({
      top: {
        name: 'Top',
        entries: [image('f1'), folderEntry('a', 'A')],
      },
      a: {
        name: 'A',
        entries: [
          image('f2'),
          shortcut('back', 'Back to top', 'top', FOLDER),
          shortcut('self', 'Me again', 'a', FOLDER),
        ],
      },
    });

    const album = await driveService.listDriveFiles('top');

    expect(drive.files.list).toHaveBeenCalledTimes(2);
    expect(childNames(album)).toEqual(['A']);
    expect(album.children[0].children).toEqual([]);
  });

  it('gives a file or folder and a shortcut to it a single identity', async () => {
    useFakeDrive({
      trip: {
        name: 'Trip',
        // Shortcuts first: the real items must still win.
        entries: [
          shortcut('sc_img', 'Shortcut to IMG_1.jpg', 'img1', 'image/jpeg'),
          shortcut('sc_best', 'Shortcut to Best', 'best', FOLDER),
          image('img1', 'IMG_1.jpg'),
          folderEntry('best', 'Best'),
        ],
      },
      best: {
        name: 'Best',
        entries: [
          image('img2'),
          shortcut('sc_img1', 'IMG_1.jpg', 'img1', 'image/jpeg'),
        ],
      },
    });

    const album = await driveService.listDriveFiles('trip');

    expect(album.textures).toEqual([
      { name: 'IMG_1.jpg', path: 'gdrive://img1' },
    ]);
    expect(childNames(album)).toEqual(['Best']);
    // The shortcut inside Best points at a file already in the tree.
    expect(texturePaths(album.children[0])).toEqual(['gdrive://img2']);
  });

  describe('real items win over shortcuts anywhere under the root', () => {
    it('keeps a file in its own folder when a shortcut to it sits higher up', async () => {
      useFakeDrive({
        top: {
          name: 'Top',
          entries: [
            shortcut('sc_img', 'Shortcut to IMG_1.jpg', 'img1', 'image/jpeg'),
            folderEntry('x', 'X'),
          ],
        },
        x: { name: 'X', entries: [image('img1', 'IMG_1.jpg')] },
      });

      const album = await driveService.listDriveFiles('top');

      expect(album.textures).toEqual([]);
      expect(album.children).toEqual([
        {
          id: 'x',
          name: 'X',
          textures: [{ name: 'IMG_1.jpg', path: 'gdrive://img1' }],
          children: [],
        },
      ]);
    });

    it.each([
      ['Favorites first', ['favorites', 'y']],
      ['Y first', ['y', 'favorites']],
    ])(
      'keeps a file in its own folder when a sibling folder links to it (%s)',
      async (_order, siblingOrder) => {
        const siblings: Record<string, FakeEntry> = {
          favorites: folderEntry('favorites', 'Favorites'),
          y: folderEntry('y', 'Y'),
        };
        const { drive } = useFakeDrive({
          top: {
            name: 'Top',
            entries: siblingOrder.map((id) => siblings[id]),
          },
          favorites: {
            name: 'Favorites',
            entries: [
              shortcut('sc_img1', 'Best shot.jpg', 'img1', 'image/jpeg'),
              shortcut('sc_ext', 'Elsewhere.jpg', 'ext', 'image/jpeg'),
            ],
          },
          y: { name: 'Y', entries: [image('img1', 'IMG_1.jpg')] },
        });

        const album = await driveService.listDriveFiles('top');

        const byName = new Map(album.children.map((c) => [c.name, c]));
        expect(byName.get('Y')?.textures).toEqual([
          { name: 'IMG_1.jpg', path: 'gdrive://img1' },
        ]);
        // Favorites keeps only the shortcut whose target isn't in the tree.
        expect(byName.get('Favorites')?.textures).toEqual([
          { name: 'Elsewhere.jpg', path: 'gdrive://ext' },
        ]);
        expect(drive.files.list).toHaveBeenCalledTimes(3);
      },
    );

    it('keeps a folder under its real parent, with its real name', async () => {
      const { drive } = useFakeDrive({
        top: {
          name: 'Top',
          entries: [
            shortcut('sc_z', 'Shortcut to Z', 'z', FOLDER),
            folderEntry('x', 'X'),
          ],
        },
        x: { name: 'X', entries: [folderEntry('z', 'Z')] },
        z: { name: 'Z', entries: [image('z1')] },
      });

      const album = await driveService.listDriveFiles('top');

      expect(childNames(album)).toEqual(['X']);
      expect(album.children[0].children).toEqual([
        {
          id: 'z',
          name: 'Z',
          textures: [{ name: 'z1.jpg', path: 'gdrive://z1' }],
          children: [],
        },
      ]);
      // Each folder is still listed once.
      expect(drive.files.list).toHaveBeenCalledTimes(3);
    });

    it('keeps a file inside a followed folder over a shortcut to that file', async () => {
      useFakeDrive({
        top: {
          name: 'Top',
          entries: [
            shortcut('sc_img', 'Link.jpg', 'img_ext', 'image/jpeg'),
            shortcut('sc_ext', 'Shared', 'ext', FOLDER),
          ],
        },
        // Outside Top: only reachable through the shortcut.
        ext: { name: 'External', entries: [image('img_ext', 'real.jpg')] },
      });

      const album = await driveService.listDriveFiles('top');

      expect(album.textures).toEqual([]);
      expect(album.children).toEqual([
        {
          id: 'ext',
          name: 'Shared',
          textures: [{ name: 'real.jpg', path: 'gdrive://img_ext' }],
          children: [],
        },
      ]);
    });

    it('keeps folders that only hold shortcuts, following shortcuts inside followed folders', async () => {
      useFakeDrive({
        top: { name: 'Top', entries: [folderEntry('links', 'Links')] },
        links: {
          name: 'Links',
          entries: [shortcut('sc_ext', 'Ext', 'ext', FOLDER)],
        },
        ext: {
          name: 'External',
          entries: [
            shortcut('sc_more', 'More', 'more', FOLDER),
            // A second way to reach Links must not add it again.
            shortcut('sc_links', 'Back', 'links', FOLDER),
          ],
        },
        more: { name: 'More', entries: [image('m1')] },
      });

      const album = await driveService.listDriveFiles('top');

      const links = album.children[0];
      expect(childNames(album)).toEqual(['Links']);
      expect(childNames(links)).toEqual(['Ext']);
      expect(childNames(links.children[0])).toEqual(['More']);
      expect(texturePaths(links.children[0].children[0])).toEqual([
        'gdrive://m1',
      ]);
    });
  });

  it('skips a failing subfolder but keeps the rest of the root', async () => {
    const fake = useFakeDrive({
      top: {
        name: 'Top',
        entries: [image('f1'), folderEntry('a', 'A'), folderEntry('b', 'B')],
      },
      a: { name: 'A', entries: [image('f2')] },
      b: { name: 'B', entries: [image('f3')] },
    });
    fake.failing.set(
      'a',
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const album = await driveService.listDriveFiles('top');

    expect(texturePaths(album)).toEqual(['gdrive://f1']);
    expect(childNames(album)).toEqual(['B']);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Skipping folder'),
      'A',
      'a',
      expect.any(Error),
    );
  });

  it('fails when the root folder itself cannot be listed', async () => {
    const fake = useFakeDrive({ top: { name: 'Top', entries: [] } });
    fake.failing.set('top', new Error('boom'));

    await expect(driveService.listDriveFiles('top')).rejects.toThrow('boom');
  });

  it('leaves out subfolders without media, as the local scanner does', async () => {
    useFakeDrive({
      top: {
        name: 'Top',
        entries: [
          folderEntry('docs', 'Docs'),
          folderEntry('nested', 'Nested'),
          folderEntry('photos', 'Photos'),
        ],
      },
      docs: {
        name: 'Docs',
        entries: [{ id: 'd1', name: 'notes.txt', mimeType: 'text/plain' }],
      },
      nested: { name: 'Nested', entries: [folderEntry('empty', 'Empty')] },
      empty: { name: 'Empty', entries: [] },
      photos: { name: 'Photos', entries: [image('p1')] },
    });

    const album = await driveService.listDriveFiles('top');

    expect(childNames(album)).toEqual(['Photos']);
  });

  it('keeps only formats the renderer can show, with an extension that matches the MIME type', async () => {
    useFakeDrive({
      top: {
        name: 'Top',
        entries: [
          { id: 'heic', name: 'IMG_0001.HEIC', mimeType: 'image/heic' },
          { id: 'bmp', name: 'scan.bmp', mimeType: 'image/bmp' },
          { id: 'noext', name: 'upload', mimeType: 'image/jpeg' },
          { id: 'mp4', name: 'clip.MP4', mimeType: 'video/mp4' },
          { id: 'wrong', name: 'photo.mp4', mimeType: 'image/png' },
          { id: 'unnamed', mimeType: 'video/webm' },
          shortcut('sc_mov', 'Holiday', 'mov', 'video/quicktime'),
          shortcut('sc_pdf', 'Manual.pdf', 'pdf', 'application/pdf'),
          shortcut('sc_heic', 'Live.heic', 'heic2', 'image/heic'),
        ],
      },
    });

    const album = await driveService.listDriveFiles('top');

    expect(album.textures).toEqual([
      { name: 'upload.jpg', path: 'gdrive://noext' },
      { name: 'clip.MP4', path: 'gdrive://mp4' },
      { name: 'photo.mp4.png', path: 'gdrive://wrong' },
      { name: 'Untitled.webm', path: 'gdrive://unnamed' },
      { name: 'Holiday.mov', path: 'gdrive://mov' },
    ]);
  });

  it('defaults a missing subfolder name', async () => {
    useFakeDrive({
      top: { name: 'Top', entries: [{ id: 'sub', mimeType: FOLDER }] },
      sub: { name: 'ignored', entries: [image('f1')] },
    });

    const album = await driveService.listDriveFiles('top');

    expect(childNames(album)).toEqual(['Untitled Folder']);
  });

  it('rejects a source that is not a folder', async () => {
    useFakeDrive({
      top: { name: 'Top', entries: [image('f1', 'a.jpg')] },
    });

    await expect(driveService.listDriveFiles('f1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Not a Google Drive folder',
    });
  });
});
