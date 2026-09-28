import { test, expect } from '@playwright/test';

function parseCsp(content: string): Record<string, Set<string>> {
  return content.split(';').reduce(
    (acc, directive) => {
      const parts = directive.trim().split(/\s+/);
      const key = parts.shift();
      if (key) {
        acc[key] = new Set(parts);
      }
      return acc;
    },
    {} as Record<string, Set<string>>,
  );
}

test.describe('Content Security Policy', () => {
  test('has CSP meta tag with correct directives', async ({ page }) => {
    await page.goto('/');

    const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(meta).toHaveCount(1);

    const content = await meta.getAttribute('content');
    expect(content).toBeDefined();

    if (!content) throw new Error('CSP content is empty');

    const directives = parseCsp(content);

    // Verify key directives exist
    expect(directives['default-src']).toBeDefined();
    expect(directives['script-src']).toBeDefined();
    expect(directives['style-src']).toBeDefined();
    expect(directives['object-src']).toBeDefined();
    expect(directives['base-uri']).toBeDefined();

    // Verify specific sources
    expect(directives['default-src']).toContain("'self'");
    expect(directives['script-src']).toContain("'self'");
    // Nothing in the bundle needs inline or eval'd script, so neither may be
    // allowed (the meta tag is the only CSP in packaged Electron).
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    expect(directives['script-src']).not.toContain("'unsafe-eval'");
    expect(directives['object-src']).toContain("'none'");
    expect(directives['base-uri']).toContain("'self'");

    // hls.js creates its transmuxer worker from a blob: URL.
    expect(directives['worker-src']).toBeDefined();
    expect(directives['worker-src']).toContain("'self'");
    expect(directives['worker-src']).toContain('blob:');

    // Verify connect-src includes localhost for Electron/dev
    expect(directives['connect-src']).toBeDefined();
    expect(directives['connect-src']).toContain("'self'");
    // Only the dev server adds websockets, for HMR.
    expect(directives['connect-src']).toContain('ws:');
    // Check for the wildcard port on localhost
    const hasLocalhost = Array.from(directives['connect-src']).some((src) =>
      src.startsWith('http://127.0.0.1:'),
    );
    expect(hasLocalhost).toBe(true);
  });

  test('loads the app without CSP violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) {
        violations.push(message.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('#app')).not.toBeEmpty();

    expect(violations).toEqual([]);
  });
});
