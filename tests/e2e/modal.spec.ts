import { test, expect } from '@playwright/test';

// the cyberpunk theme actually responds to light/dark system settings since it's `base: 'system'`
// so we need to test both variations
const testCases = [
  { theme: 'light', colorScheme: 'light' },
  { theme: 'dark', colorScheme: 'dark' },
  { theme: 'pink', colorScheme: 'light' },
  { theme: 'cyberpunk-light', colorScheme: 'light' },
  { theme: 'cyberpunk-dark', colorScheme: 'dark' },
] as const;

for (const tc of testCases) {
  const themeLabel = 'label' in tc ? tc.label : tc.theme;

  test(`Smart Playlist Modal visual regression - ${themeLabel} mode`, async ({
    page,
  }) => {
    // For system themes (light/dark/cyberpunk)
    await page.emulateMedia({ colorScheme: tc.colorScheme });

    // Set theme in localStorage before navigation to ensure it's applied on load
    await page.addInitScript((t) => {
      window.localStorage.setItem('themeMode', t);
    }, tc.theme);

    // Mock backend API
    await page.route('**/api/albums', async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.route('**/api/directories', async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.route('**/api/smart-playlists', async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.route('**/api/config/extensions', async (route) => {
      await route.fulfill({
        json: { images: ['jpg'], videos: ['mp4'], all: ['jpg', 'mp4'] },
      });
    });

    await page.goto('/');

    // Ensure the app loaded
    await expect(
      page.getByRole('heading', { name: 'MediaPlayer' }),
    ).toBeVisible();

    // Click the Add Playlist button (it has title="Add Playlist")
    // Wait for any animations to finish
    await page.locator('button[title="Add Playlist"]').click();

    // Wait for the modal to be visible
    const modalHeading = page.getByRole('heading', {
      name: 'Create Smart Playlist',
    });
    await expect(modalHeading).toBeVisible();

    // Give inputs focus to blur them
    await page.locator('#playlist-name').click();
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    // Disable blinking cursors
    await page.addStyleTag({
      content: 'input { caret-color: transparent !important; }',
    });

    // Take screenshot
    await expect(page).toHaveScreenshot(
      `smart-playlist-modal-${themeLabel}.png`,
      {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
      },
    );
  });
}
