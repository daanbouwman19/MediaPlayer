/**
 * @file Loopback server that receives Google's OAuth redirect and shows the
 * authorization code for the user to paste into the app.
 *
 * It listens on the loopback address and port of the configured redirect URI
 * only while a sign-in is pending: it closes once a code has been shown, or
 * after AUTH_SERVER_TIMEOUT_MS, and the next sign-in starts it again.
 */
import http from 'http';

/** How long the callback server waits for Google's redirect. */
export const AUTH_SERVER_TIMEOUT_MS = 10 * 60 * 1000;

export interface CallbackEndpoint {
  /** Address to bind (always loopback). */
  host: string;
  port: number;
  pathname: string;
}

// Loopback host names a redirect URI may use, and the address to bind for each.
const LOOPBACK_BIND_ADDRESSES = new Map([
  ['localhost', '127.0.0.1'],
  ['127.0.0.1', '127.0.0.1'],
  ['[::1]', '::1'],
]);

let authServer: http.Server | null = null;
let authServerReady: Promise<void> | null = null;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Derives where to listen from the OAuth redirect URI, so the server always
 * matches the address Google redirects the browser to.
 */
export function getCallbackEndpoint(redirectUri: string): CallbackEndpoint {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error(`Invalid Google redirect URI: ${redirectUri}`);
  }
  const host = LOOPBACK_BIND_ADDRESSES.get(url.hostname);
  if (url.protocol !== 'http:' || !host) {
    throw new Error(
      `The Google redirect URI must be an http://localhost address, got: ${redirectUri}`,
    );
  }
  return {
    host,
    port: url.port ? Number(url.port) : 80,
    pathname: url.pathname,
  };
}

function closeServer(server: http.Server): void {
  if (authServer === server) {
    authServer = null;
    authServerReady = null;
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }
  if (server.listening) {
    server.close();
  }
}

function scheduleShutdown(server: http.Server, timeoutMs: number): void {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    console.log('[AuthServer] No OAuth callback received in time; closing.');
    closeServer(server);
  }, timeoutMs);
  shutdownTimer.unref();
}

function handleCallbackRequest(
  server: http.Server,
  endpoint: CallbackEndpoint,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  getExpectedState?: () => string | null,
): void {
  // [SECURITY] Absolute-form targets such as "http://[" pass the HTTP parser
  // but make URL throw; an uncaught throw here would crash the main process.
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  if (url.pathname !== endpoint.pathname) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (getExpectedState) {
    const expected = getExpectedState();
    if (!expected || state !== expected) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid state parameter');
      return;
    }
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code parameter');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  // The code is on screen now, so stop listening; a new sign-in restarts us.
  res.end(getSuccessHtml(escapeHtml(code)), () => closeServer(server));
}

/**
 * Starts listening for the OAuth callback on the redirect URI's loopback
 * port. Rejects (and can simply be retried) if the port cannot be bound.
 * Calling it while a sign-in is pending reuses the server and restarts the
 * timeout.
 */
export async function startAuthServer(
  redirectUri: string,
  getExpectedState?: () => string | null,
  timeoutMs: number = AUTH_SERVER_TIMEOUT_MS,
): Promise<void> {
  const endpoint = getCallbackEndpoint(redirectUri);

  if (authServer && authServerReady) {
    scheduleShutdown(authServer, timeoutMs);
    return authServerReady;
  }

  const server = http.createServer((req, res) =>
    handleCallbackRequest(server, endpoint, req, res, getExpectedState),
  );
  authServer = server;

  const ready = new Promise<void>((resolve, reject) => {
    let listening = false;
    server.on('error', (err: NodeJS.ErrnoException) => {
      console.error('[AuthServer] Error:', err);
      closeServer(server);
      if (!listening) {
        reject(
          new Error(
            `Could not listen for the Google sign-in callback on ${endpoint.host}:${endpoint.port} (${err.code ?? err.message}). ` +
              'Close the program using that port or set GOOGLE_REDIRECT_URI to a free localhost port.',
          ),
        );
      }
    });

    server.listen(endpoint.port, endpoint.host, () => {
      listening = true;
      console.log(
        `[AuthServer] Listening on ${endpoint.host}:${endpoint.port} for the OAuth callback`,
      );
      resolve();
    });
  });
  authServerReady = ready;
  scheduleShutdown(server, timeoutMs);
  return ready;
}

export function stopAuthServer(): void {
  if (authServer) {
    closeServer(authServer);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSuccessHtml(code: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Google Authentication</title>
        <style>
          body { font-family: sans-serif; background: #222; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .container { background: #333; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center; max-width: 500px; width: 90%; }
          h1 { margin-top: 0; color: #4ade80; }
          p { margin-bottom: 1.5rem; color: #ccc; }
          .code-box { background: #111; padding: 1rem; border: 1px solid #444; border-radius: 4px; font-family: monospace; font-size: 1.2rem; word-break: break-all; margin-bottom: 1.5rem; user-select: all; }
          button { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background 0.2s; }
          button:hover { background: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Authentication Successful</h1>
          <p>Please copy the code below and paste it into the Media Player application.</p>
          <div class="code-box" onclick="selectCode()">${code}</div>
          <button onclick="copyCode()">Copy Code</button>
        </div>
        <script>
          function selectCode() {
            const range = document.createRange();
            range.selectNode(document.querySelector('.code-box'));
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
          }
          function copyCode() {
            const code = document.querySelector('.code-box').innerText;
            navigator.clipboard.writeText(code).then(() => {
              const btn = document.querySelector('button');
              btn.innerText = 'Copied!';
              setTimeout(() => btn.innerText = 'Copy Code', 2000);
            });
          }
        </script>
      </body>
    </html>
  `;
}
