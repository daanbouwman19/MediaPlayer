import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import path from 'path';
import { pathToFileURL } from 'url';

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, listener: any) => {
      handlers.set(channel, listener);
    }),
  },
}));

import { handleIpc } from '../../src/main/utils/ipc-helper';
import { setTrustedRenderer } from '../../src/main/renderer-security';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

const indexHtmlPath = path.resolve('out', 'renderer', 'index.html');
const rendererEvent = {
  senderFrame: { url: pathToFileURL(indexHtmlPath).href },
};

describe('handleIpc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setTrustedRenderer(null);
    vi.restoreAllMocks();
  });

  it('wraps handler results', async () => {
    handleIpc(IPC_CHANNELS.GET_SERVER_PORT, () => 1234);
    const result = await handlers.get(IPC_CHANNELS.GET_SERVER_PORT)!(
      rendererEvent,
    );
    expect(result).toEqual({ success: true, data: 1234 });
  });

  it('runs validators before the handler and reports their errors', async () => {
    const handler = vi.fn();
    handleIpc(IPC_CHANNELS.RECORD_MEDIA_VIEW, handler, {
      validators: [
        () => {
          throw new Error('Access denied');
        },
      ],
    });
    const result = await handlers.get(IPC_CHANNELS.RECORD_MEDIA_VIEW)!(
      rendererEvent,
      '/etc/passwd',
    );
    expect(result).toEqual({ success: false, error: 'Access denied' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports non-Error throws generically', async () => {
    handleIpc(IPC_CHANNELS.GET_SERVER_PORT, () => {
      // oxlint-disable-next-line typescript/only-throw-error -- the case under test
      throw 'boom';
    });
    const result = await handlers.get(IPC_CHANNELS.GET_SERVER_PORT)!(
      rendererEvent,
    );
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  describe('sender validation (F71)', () => {
    beforeEach(() => {
      setTrustedRenderer({ kind: 'file', path: indexHtmlPath });
    });

    it('serves the app renderer', async () => {
      const handler = vi.fn(() => 1);
      handleIpc(IPC_CHANNELS.GET_SERVER_PORT, handler);
      const result = await handlers.get(IPC_CHANNELS.GET_SERVER_PORT)!(
        rendererEvent,
      );
      expect(result).toEqual({ success: true, data: 1 });
    });

    it.each([
      ['a dropped HTML file', pathToFileURL(path.resolve('evil.html')).href],
      ['a web page', 'https://example.com/'],
    ])('rejects calls from %s', async (_, url) => {
      const handler = vi.fn();
      handleIpc(IPC_CHANNELS.LOAD_FILE_AS_DATA_URL, handler);
      const result = await handlers.get(IPC_CHANNELS.LOAD_FILE_AS_DATA_URL)!(
        { senderFrame: { url } },
        'C:/Users/me/Documents/secret.pdf',
      );
      expect(result).toEqual({ success: false, error: 'Access denied' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects calls whose frame is gone', async () => {
      const handler = vi.fn();
      handleIpc(IPC_CHANNELS.GET_SERVER_PORT, handler);
      const result = await handlers.get(IPC_CHANNELS.GET_SERVER_PORT)!({
        senderFrame: null,
      });
      expect(result).toEqual({ success: false, error: 'Access denied' });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
