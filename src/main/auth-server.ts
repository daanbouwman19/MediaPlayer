import http from 'http';

let authServer: http.Server | null = null;

export function startAuthServer(
  port: number = 3000,
  getExpectedState?: () => string | null,
): Promise<void> {
  return new Promise((resolve) => {
    if (authServer) {
      console.log('[AuthServer] Server already running.');
      resolve();
      return;
    }

    authServer = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);
      if (url.pathname === '/auth/google/callback') {
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

        if (code) {
          const safeCode = escapeHtml(code);
          const html = getSuccessHtml(safeCode);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code parameter');
        }

        // Optional: Close server after successful retrieval?
        // Let's keep it open for a bit or until app close to avoid premature shutdown if user refreshes.
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    authServer.on('error', (err) => {
      console.error('[AuthServer] Error:', err);
      // If port is in use, we just log it. The user might have the web server running.
      // We resolve anyway so main process doesn't hang.
      resolve();
    });

    authServer.listen(port, () => {
      console.log(`[AuthServer] Listening on port ${port} for OAuth callback`);
      resolve();
    });
  });
}

export function stopAuthServer() {
  if (authServer) {
    authServer.close();
    authServer = null;
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
