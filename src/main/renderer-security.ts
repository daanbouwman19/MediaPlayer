/**
 * @file Decides what the Electron window loads and which pages are trusted.
 *
 * The preload bridge exposes privileged IPC to whatever document the window
 * shows, so the window may only ever show the app's own renderer: the Vite
 * dev server during `npm run electron:dev`, and the built `index.html`
 * otherwise. The same check guards navigation and every IPC call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WebContents } from 'electron';

/** Dev server used when running unpackaged without a built renderer. */
export const DEFAULT_DEV_SERVER_URL = 'http://localhost:5173';

export type RendererSource =
  | { kind: 'dev-server'; url: string }
  | { kind: 'file'; path: string };

export interface RendererSourceOptions {
  isPackaged: boolean;
  /** VITE_DEV_SERVER_URL; only `npm run electron:dev` should set it. */
  devServerUrl: string | undefined;
  /** Absolute path of the built renderer's index.html. */
  indexHtmlPath: string;
  /** Injectable for tests; defaults to checking the file system. */
  hasBuiltRenderer?: (indexHtmlPath: string) => boolean;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Picks the renderer to load. Packaged builds always load the bundled
 * index.html. Unpackaged runs use the dev server only when one is named
 * explicitly, so `npm run electron:preview` shows the freshly built renderer;
 * without either, the default dev server keeps `electron .` usable in dev.
 */
export function resolveRendererSource(
  options: RendererSourceOptions,
): RendererSource {
  const indexHtmlPath = path.resolve(options.indexHtmlPath);
  if (options.isPackaged) {
    return { kind: 'file', path: indexHtmlPath };
  }

  if (options.devServerUrl) {
    const devServerUrl = parseHttpUrl(options.devServerUrl);
    if (devServerUrl) {
      return { kind: 'dev-server', url: devServerUrl.href };
    }
    console.warn(
      `[renderer-security] Ignoring invalid VITE_DEV_SERVER_URL: ${options.devServerUrl}`,
    );
  }

  const hasBuiltRenderer = options.hasBuiltRenderer ?? fs.existsSync;
  if (hasBuiltRenderer(indexHtmlPath)) {
    return { kind: 'file', path: indexHtmlPath };
  }
  return { kind: 'dev-server', url: new URL(DEFAULT_DEV_SERVER_URL).href };
}

function isSameFile(a: string, b: string): boolean {
  const resolvedA = path.resolve(a);
  const resolvedB = path.resolve(b);
  return process.platform === 'win32'
    ? resolvedA.toLowerCase() === resolvedB.toLowerCase()
    : resolvedA === resolvedB;
}

/**
 * Whether `candidate` is the app's own renderer: the dev server's exact
 * origin, or the built index.html itself (query and hash ignored). Any other
 * file, such as an HTML or SVG file dropped onto the window, is untrusted.
 */
export function isTrustedRendererUrl(
  source: RendererSource,
  candidate: string,
): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (source.kind === 'dev-server') {
    return url.origin === new URL(source.url).origin;
  }

  if (url.protocol !== 'file:') {
    return false;
  }
  // A host is fine: on Windows it maps to a UNC path (an app run from a
  // network share), which the exact comparison below still has to match; on
  // other platforms fileURLToPath rejects it.
  try {
    return isSameFile(fileURLToPath(url), source.path);
  } catch {
    return false;
  }
}

/**
 * Origins the renderer sends with CORS requests to the local media server:
 * the dev server's origin, or `file://` for the built renderer.
 */
export function getRendererOrigins(source: RendererSource): string[] {
  return source.kind === 'dev-server'
    ? [new URL(source.url).origin]
    : ['file://'];
}

/**
 * Denies new windows and blocks navigation away from the renderer.
 */
export function secureWebContents(
  contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  source: RendererSource,
): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(source, url)) {
      console.warn('[renderer-security] Blocked navigation to:', url);
      event.preventDefault();
    }
  });
}

let trustedRenderer: RendererSource | null = null;

/** Sets the renderer whose frames may call IPC handlers (null disables). */
export function setTrustedRenderer(source: RendererSource | null): void {
  trustedRenderer = source;
}

/** The part of an IpcMainInvokeEvent needed to identify its sender. */
export interface IpcSenderEvent {
  readonly senderFrame?: { readonly url: string } | null;
}

/**
 * Whether an IPC call comes from the trusted renderer. Until main.ts
 * configures the renderer (unit tests exercising handlers directly), every
 * sender is accepted.
 */
export function isTrustedIpcSender(
  event: IpcSenderEvent | null | undefined,
): boolean {
  if (!trustedRenderer) return true;
  const url = event?.senderFrame?.url;
  return typeof url === 'string' && isTrustedRendererUrl(trustedRenderer, url);
}
