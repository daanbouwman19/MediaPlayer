import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  DEFAULT_DEV_SERVER_URL,
  getRendererOrigins,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  resolveRendererSource,
  secureWebContents,
  setTrustedRenderer,
  type RendererSource,
} from '../../src/main/renderer-security';

const indexHtmlPath = path.resolve('out', 'renderer', 'index.html');
const fileSource: RendererSource = { kind: 'file', path: indexHtmlPath };
const devSource: RendererSource = {
  kind: 'dev-server',
  url: 'http://localhost:5173/',
};

describe('resolveRendererSource (F167)', () => {
  const built = () => true;
  const notBuilt = () => false;

  it('always loads the bundled renderer when packaged', () => {
    expect(
      resolveRendererSource({
        isPackaged: true,
        devServerUrl: 'http://localhost:5173',
        indexHtmlPath,
        hasBuiltRenderer: notBuilt,
      }),
    ).toEqual(fileSource);
  });

  it('uses the dev server named by VITE_DEV_SERVER_URL when unpackaged', () => {
    expect(
      resolveRendererSource({
        isPackaged: false,
        devServerUrl: 'http://localhost:5174',
        indexHtmlPath,
        hasBuiltRenderer: built,
      }),
    ).toEqual({ kind: 'dev-server', url: 'http://localhost:5174/' });
  });

  it('loads the built renderer for an unpackaged preview run', () => {
    expect(
      resolveRendererSource({
        isPackaged: false,
        devServerUrl: undefined,
        indexHtmlPath,
        hasBuiltRenderer: built,
      }),
    ).toEqual(fileSource);
  });

  it('falls back to the default dev server when nothing is built', () => {
    expect(
      resolveRendererSource({
        isPackaged: false,
        devServerUrl: '',
        indexHtmlPath,
        hasBuiltRenderer: notBuilt,
      }),
    ).toEqual({
      kind: 'dev-server',
      url: new URL(DEFAULT_DEV_SERVER_URL).href,
    });
  });

  it('ignores an invalid dev server URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveRendererSource({
        isPackaged: false,
        devServerUrl: 'file:///etc/passwd',
        indexHtmlPath,
        hasBuiltRenderer: built,
      }),
    ).toEqual(fileSource);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('checks the file system by default', () => {
    expect(
      resolveRendererSource({
        isPackaged: false,
        devServerUrl: undefined,
        indexHtmlPath: path.resolve('package.json'),
      }),
    ).toEqual({ kind: 'file', path: path.resolve('package.json') });
  });
});

describe('isTrustedRendererUrl (F71)', () => {
  const indexUrl = pathToFileURL(indexHtmlPath).href;

  it('trusts the built index.html, ignoring query and hash', () => {
    expect(isTrustedRendererUrl(fileSource, indexUrl)).toBe(true);
    expect(isTrustedRendererUrl(fileSource, `${indexUrl}?a=1#/route`)).toBe(
      true,
    );
  });

  it.each([
    ['another file next to it', pathToFileURL(path.resolve('evil.html')).href],
    [
      'a dropped SVG',
      pathToFileURL(path.resolve('Downloads', 'image.svg')).href,
    ],
    ['a file on another host', 'file://evil-host/share/index.html'],
    ['a web page', 'https://example.com/'],
    ['garbage', 'not a url'],
  ])('rejects %s in production', (_, url) => {
    expect(isTrustedRendererUrl(fileSource, url)).toBe(false);
  });

  it('trusts only the exact dev server origin', () => {
    expect(isTrustedRendererUrl(devSource, 'http://localhost:5173/')).toBe(
      true,
    );
    expect(
      isTrustedRendererUrl(devSource, 'http://localhost:5173/src/App.vue'),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(devSource, 'http://localhost:5173.evil.com/'),
    ).toBe(false);
    expect(isTrustedRendererUrl(devSource, 'http://localhost:5174/')).toBe(
      false,
    );
    expect(isTrustedRendererUrl(devSource, 'file:///index.html')).toBe(false);
  });

  // fileURLToPath only maps a URL host to a UNC path on Windows.
  it.runIf(process.platform === 'win32')(
    'trusts an index.html on a network share (UNC path)',
    () => {
      const uncSource: RendererSource = {
        kind: 'file',
        path: '\\\\nas\\apps\\out\\renderer\\index.html',
      };
      const uncUrl = pathToFileURL(uncSource.path).href;
      expect(new URL(uncUrl).host).toBe('nas');

      expect(isTrustedRendererUrl(uncSource, uncUrl)).toBe(true);
      expect(isTrustedRendererUrl(uncSource, `${uncUrl}#/route`)).toBe(true);
      expect(
        isTrustedRendererUrl(uncSource, 'file://evil-host/share/index.html'),
      ).toBe(false);
      expect(
        isTrustedRendererUrl(uncSource, 'file://nas/apps/out/renderer/x.html'),
      ).toBe(false);
      expect(isTrustedRendererUrl(fileSource, uncUrl)).toBe(false);
    },
  );

  it('compares Windows paths case-insensitively', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const upper = pathToFileURL(indexHtmlPath.toUpperCase()).href;
      expect(isTrustedRendererUrl(fileSource, upper)).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });
});

describe('getRendererOrigins', () => {
  it('returns the dev server origin or file://', () => {
    expect(getRendererOrigins(devSource)).toEqual(['http://localhost:5173']);
    expect(getRendererOrigins(fileSource)).toEqual(['file://']);
  });
});

describe('secureWebContents', () => {
  function setup(source: RendererSource) {
    const listeners = new Map<string, (...args: any[]) => void>();
    const contents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners.set(event, listener);
      }),
    };
    secureWebContents(contents as any, source);
    const navigate = (url: string) => {
      const event = { preventDefault: vi.fn() };
      listeners.get('will-navigate')!(event, url);
      return event.preventDefault.mock.calls.length > 0;
    };
    return { contents, navigate };
  }

  it('denies every new window', () => {
    const { contents } = setup(fileSource);
    const handler = contents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://example.com' })).toEqual({
      action: 'deny',
    });
  });

  it('blocks navigation to a dropped file but allows the app itself', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { navigate } = setup(fileSource);
    expect(navigate(pathToFileURL(path.resolve('dropped.html')).href)).toBe(
      true,
    );
    expect(navigate(pathToFileURL(indexHtmlPath).href)).toBe(false);
    warn.mockRestore();
  });
});

describe('isTrustedIpcSender', () => {
  afterEach(() => {
    setTrustedRenderer(null);
  });

  it('accepts any sender until a renderer is configured', () => {
    expect(isTrustedIpcSender(null)).toBe(true);
  });

  it('accepts the renderer and rejects other frames once configured', () => {
    setTrustedRenderer(fileSource);
    expect(
      isTrustedIpcSender({
        senderFrame: { url: pathToFileURL(indexHtmlPath).href },
      }),
    ).toBe(true);
    expect(
      isTrustedIpcSender({
        senderFrame: { url: pathToFileURL(path.resolve('x.html')).href },
      }),
    ).toBe(false);
    expect(isTrustedIpcSender({ senderFrame: null })).toBe(false);
    expect(isTrustedIpcSender(undefined)).toBe(false);
  });
});
