import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedStylesHtml: string | null = null;

/**
 * Extracts stylesheet links from the main index.html to keep the
 * token page synchronized with the main application's theme.
 */
function getStylesHtml(): string {
  if (cachedStylesHtml !== null) return cachedStylesHtml;

  try {
    const isDev = process.env.NODE_ENV !== 'production';
    let indexPath = '';

    if (isDev) {
      // In dev mode, process.cwd() is typically the project root where index.html resides
      indexPath = path.join(process.cwd(), 'index.html');
    } else {
      // In prod mode, index.html is located in the client dist folder
      indexPath = path.join(__dirname, '../client/index.html');
    }

    if (fs.existsSync(indexPath)) {
      const indexHtml = fs.readFileSync(indexPath, 'utf8');

      const linkRegex = /<link[^>]*rel="stylesheet"[^>]*>/gi;
      const links = indexHtml.match(linkRegex) || [];

      const preconnectRegex = /<link[^>]*rel="preconnect"[^>]*>/gi;
      const preconnects = indexHtml.match(preconnectRegex) || [];

      cachedStylesHtml = [...preconnects, ...links].join('\n');
    } else {
      // Fallback if index.html is not found for some reason
      cachedStylesHtml = `
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;700&display=swap" rel="stylesheet" />
      `;
    }
  } catch (e) {
    console.error('Failed to extract styles from index.html:', e);
    cachedStylesHtml = '';
  }

  return cachedStylesHtml;
}

/**
 * Resets the cached styles HTML. Used for testing purposes.
 */
export function _resetCache(): void {
  cachedStylesHtml = null;
}

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
  const stylesHtml = getStylesHtml();

  return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google Authentication</title>
          ${stylesHtml}
          <style>
            body { 
              display: flex; 
              flex-direction: column; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0; 
              transition: background 0.3s, color 0.3s; 
            }
            .container { 
              background: var(--secondary-bg, #ffffff); 
              padding: 2.5rem; 
              border-radius: 12px; 
              box-shadow: 0 10px 25px rgba(0,0,0,0.5); 
              text-align: center; 
              max-width: 500px; 
              width: 90%; 
              border: 1px solid var(--border-color, rgba(255,255,255,0.1)); 
              transition: all 0.3s; 
            }
            h1 { 
              margin-top: 0; 
              color: var(--accent-color, #8b5cf6); 
              font-family: var(--header-font, 'Outfit', sans-serif); 
              font-weight: 700; 
            }
            p { 
              margin-bottom: 1.5rem; 
              color: var(--text-muted, #64748b); 
              font-weight: 500; 
            }
            .code-box { 
              background: var(--tertiary-bg, #1f1f1f); 
              padding: 1.2rem; 
              border: 1px solid var(--border-color, rgba(255,255,255,0.1)); 
              border-radius: 6px; 
              font-family: monospace; 
              font-size: 1.2rem; 
              word-break: break-all; 
              margin-bottom: 1.5rem; 
              user-select: all; 
              transition: all 0.3s; 
            }
            button { 
              background: var(--accent-color, #8b5cf6); 
              color: var(--button-text-color, white); 
              border: none; 
              padding: 0.85rem 1.75rem; 
              border-radius: 8px; 
              cursor: pointer; 
              font-size: 1rem; 
              font-weight: 600; 
              transition: all 0.2s; 
              text-transform: uppercase; 
              letter-spacing: 0.05em; 
              font-family: var(--body-font, 'Inter', sans-serif); 
            }
            button:hover { 
              background: var(--accent-hover, #7c3aed); 
              transform: translateY(-1px); 
              box-shadow: 0 4px 12px rgba(0,0,0,0.2); 
            }
            button:active { 
              transform: translateY(0); 
            }
          </style>
          <script nonce="${nonce}">
            (function() {
              try {
                let themeId = localStorage.getItem('themeMode') || 'dark';
                
                if (themeId === 'system' || themeId === 'cyberpunk-auto') {
                  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  themeId = themeId === 'cyberpunk-auto' ? (isDark ? 'cyberpunk-dark' : 'cyberpunk-light') : (isDark ? 'dark' : 'light');
                }

                if (themeId !== 'system' && themeId !== 'dark' && themeId !== 'light') {
                  document.documentElement.classList.add('theme-' + themeId);
                } else if (themeId === 'dark' || themeId === 'light') {
                  document.documentElement.classList.add(themeId);
                }
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
