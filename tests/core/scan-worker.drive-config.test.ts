import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));

// The real scan worker, scanner, Drive service and Google auth run here; only
// the thread boundary is simulated.
vi.mock('worker_threads', () => ({
  parentPort: { postMessage, on: vi.fn() },
  isMainThread: false,
}));

describe('scan worker without a Google OAuth client configuration', () => {
  let mediaDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // e.g. tokens saved by a dev build (with .env) meet a packaged app without one.
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-worker-drive-'));
    fs.writeFileSync(path.join(mediaDir, 'photo.jpg'), '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  });

  it('skips the Drive source but still scans local folders', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { handleScanMessage } =
      await import('../../src/core/media/scan-worker');

    await handleScanMessage({
      id: 1,
      type: 'START_SCAN',
      payload: {
        directories: [mediaDir, 'gdrive://folder123'],
        tokens: { refresh_token: 'saved-refresh-token' },
      },
    });

    expect(postMessage).toHaveBeenCalledWith({
      id: 1,
      result: {
        success: true,
        data: [
          {
            id: mediaDir,
            name: path.basename(mediaDir),
            textures: [
              { name: 'photo.jpg', path: path.join(mediaDir, 'photo.jpg') },
            ],
            children: [],
          },
        ],
      },
    });
  });
});
