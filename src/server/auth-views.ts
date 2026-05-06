/**
 * @file HTML Templates and Views for the Server.
 */

/**
 * Generates the HTML page for the Google Authentication callback.
 * @param safeCode - The escaped authentication code to display.
 * @param nonce - The security nonce for Content Security Policy.
 * @returns The complete HTML string.
 */
export function getGoogleAuthSuccessPage(
  safeCode: string,
  nonce: string,
): string {
  return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google Authentication</title>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;700&display=swap" rel="stylesheet" />
          <style>
            :root {
              --bg: #050505;
              --container: #0f0f0f;
              --text: #f8fafc;
              --text-muted: #64748b;
              --accent: #8b5cf6;
              --accent-hover: #7c3aed;
              --code-bg: #1f1f1f;
              --border: rgba(255, 255, 255, 0.1);
              --success: #4ade80;
            }
            body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; transition: background 0.3s, color 0.3s; }
            .container { background: var(--container); padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 500px; width: 90%; border: 1px solid var(--border); transition: all 0.3s; }
            h1 { margin-top: 0; color: var(--success); font-family: 'Outfit', sans-serif; font-weight: 700; }
            p { margin-bottom: 1.5rem; color: var(--text-muted); font-weight: 500; }
            .code-box { background: var(--code-bg); padding: 1.2rem; border: 1px solid var(--border); border-radius: 6px; font-family: monospace; font-size: 1.2rem; word-break: break-all; margin-bottom: 1.5rem; user-select: all; transition: all 0.3s; }
            button { background: var(--accent); color: white; border: none; padding: 0.85rem 1.75rem; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Inter', sans-serif; }
            button:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
            button:active { transform: translateY(0); }
          </style>
          <script nonce="${nonce}">
            (function() {
              const themes = {
                light: { bg: '#fbfafe', container: '#ffffff', text: '#1b1b3a', textMuted: '#64748b', accent: '#7c3aed', accentHover: '#6d28d9', codeBg: '#f5f3ff', border: 'rgba(27,27,58,0.08)', success: '#7c3aed' },
                dark: { bg: '#050505', container: '#0f0f0f', text: '#f8fafc', textMuted: '#64748b', accent: '#8b5cf6', accentHover: '#7c3aed', codeBg: '#1f1f1f', border: 'rgba(255,255,255,0.1)', success: '#4ade80' },
                pink: { bg: '#fff1f2', container: '#ffffff', text: '#831843', textMuted: '#be185d', accent: '#db2777', accentHover: '#9d174d', codeBg: '#fce7f3', border: 'rgba(219,39,119,0.1)', success: '#db2777' },
                'cyberpunk-light': { bg: '#fdfaf1', container: '#ffffff', text: '#0f172a', textMuted: '#334155', accent: '#06b6d4', accentHover: '#0891b2', codeBg: '#fef9c3', border: 'rgba(252,234,43,0.5)', success: '#06b6d4' },
                'cyberpunk-dark': { bg: '#09090b', container: '#18181b', text: '#fafafa', textMuted: '#a1a1aa', accent: '#22d3ee', accentHover: '#06b6d4', codeBg: '#27272a', border: 'rgba(254,240,138,0.2)', success: '#22d3ee' }
              };

              try {
                let themeId = localStorage.getItem('themeMode') || 'dark';
                
                if (themeId === 'system' || themeId === 'cyberpunk-auto') {
                  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  themeId = themeId === 'cyberpunk-auto' ? (isDark ? 'cyberpunk-dark' : 'cyberpunk-light') : (isDark ? 'dark' : 'light');
                }

                const theme = themes[themeId] || themes.dark;
                const root = document.documentElement;
                
                root.style.setProperty('--bg', theme.bg);
                root.style.setProperty('--container', theme.container);
                root.style.setProperty('--text', theme.text);
                root.style.setProperty('--text-muted', theme.textMuted);
                root.style.setProperty('--accent', theme.accent);
                root.style.setProperty('--accent-hover', theme.accentHover);
                root.style.setProperty('--code-bg', theme.codeBg);
                root.style.setProperty('--border', theme.border);
                root.style.setProperty('--success', theme.success);
              } catch (e) {
                console.error('Failed to apply theme:', e);
              }
            })();
          </script>
        </head>
        <body>
          <div class="container">
            <h1>Authentication Successful</h1>
            <p>Please copy the code below and paste it into the Media Player application.</p>
            <div id="code-box" class="code-box">${safeCode}</div>
            <button id="copy-btn">Copy Code</button>
          </div>
          <script nonce="${nonce}">
            const codeBox = document.getElementById('code-box');
            const copyBtn = document.getElementById('copy-btn');

            if (codeBox) {
              codeBox.addEventListener('click', () => {
                const range = document.createRange();
                range.selectNode(codeBox);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
              });
            }

            if (copyBtn) {
              copyBtn.addEventListener('click', () => {
                if (!codeBox) return;
                const code = codeBox.innerText;
                navigator.clipboard.writeText(code).then(() => {
                  copyBtn.innerText = 'Copied!';
                  setTimeout(() => copyBtn.innerText = 'Copy Code', 2000);
                });
              });
            }
          </script>
        </body>
      </html>
    `;
}
