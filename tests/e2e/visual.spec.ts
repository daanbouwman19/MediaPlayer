import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark', 'pink'] as const) {
  test(`MediaGrid visual regression - ${theme} mode`, async ({
    page,
    isMobile,
  }) => {
    // For system themes (light/dark), we can also emulate the media scheme
    if (theme === 'light' || theme === 'dark') {
      const colorScheme = theme as 'light' | 'dark';
      await page.emulateMedia({ colorScheme });
    }

    // Set theme in localStorage before navigation to ensure it's applied on load
    await page.addInitScript((t) => {
      window.localStorage.setItem('themeMode', t);
    }, theme);

    // Mock backend API
    await page.route('**/api/albums', async (route) => {
      const json = [
        {
          name: 'Test Album',
          textures: [
            { name: 'test1.jpg', path: '/media/test1.jpg' },
            { name: 'test2.mp4', path: '/media/test2.mp4' },
          ],
          children: [],
        },
      ];
      await route.fulfill({ json });
    });

    await page.route('**/api/directories', async (route) => {
      await route.fulfill({
        json: [{ path: '/media', type: 'local', name: 'Media' }],
      });
    });

    await page.route('**/api/smart-playlists', async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.route('**/api/config/extensions', async (route) => {
      await route.fulfill({
        json: { images: ['jpg'], videos: ['mp4'], all: ['jpg', 'mp4'] },
      });
    });

    await page.route('**/api/serve*', async (route) => {
      // Serve a 1x1 pixel transparent gif
      const buffer = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64',
      );
      await route.fulfill({ body: buffer, contentType: 'image/gif' });
    });

    await page.goto('/');

    if (isMobile) {
      // On mobile, sidebar is open by default and covers the grid.
      // We must close it to view the grid.
      // Use .first() to handle strict mode violations if transitions duplicate elements
      const closeSidebarBtn = page
        .getByRole('button', { name: 'Close Sidebar' })
        .first();
      await expect(closeSidebarBtn).toBeVisible();
      await closeSidebarBtn.click();
    }

    // Wait for data to load
    await expect(page.getByText('Test Album')).toBeVisible();

    // Take screenshot
    await expect(page).toHaveScreenshot(`media-grid-${theme}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
