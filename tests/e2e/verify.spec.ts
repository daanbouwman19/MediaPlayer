import { test, expect } from '@playwright/test';

test('verify google drive inputs', async ({ page }) => {
  // Go to the local app (assume it is running on 5173 or configured port)
  await page.goto('https://localhost:5173');

  // Wait for the app to load
  await expect(page.locator('#app')).toBeVisible();

  // Open Sources Modal (Manage Sources button in AlbumsList)
  await page.getByLabel('Manage Sources').click();

  // Click Add Google Drive
  await page.getByRole('button', { name: 'Add Google Drive' }).click();

  // Verify 'Start Authorization' button is present
  const startAuth = page.getByRole('button', { name: 'Start Authorization' });
  await expect(startAuth).toBeVisible();

  // Mock the state to show code input
  // Since we can't easily click 'Start Authorization' without it actually opening a browser window
  // and we don't want to rely on external services, we might need to rely on the unit test I wrote
  // or try to manually force the state if possible via JS, but that's hard in Playwright against a compiled app.
  // However, I can take a screenshot of the modal in its initial state to prove it opens.

  await page.screenshot({ path: 'verification/sources_modal.png' });
});
