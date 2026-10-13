// Third-party asset credits: a "Credits" row in GameMenu.tsx's panel opens
// app/credits/page.tsx (lib/credits.ts), which carries the CC BY 4.0
// attribution for the sky balloon's 3D letters (danny_p3d) and the flag-icons
// credit. Same new-tab convention as the menuSuggest row.
import { test, expect } from './fixtures';
import { boot } from './helpers';

test.describe('credits', () => {
  test('the menu has a Credits link to /credits', async ({ page }) => {
    await boot(page);
    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    const link = page.getByTestId('menuCredits');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/credits');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveText('Credits');
  });

  test('/credits attributes the balloon letters to danny_p3d under CC BY 4.0', async ({ page }) => {
    await page.goto('/credits');
    await expect(page.locator('h1')).toHaveText('credits');
    const balloons = page.locator('.credits-page__item', { hasText: 'Letter-balloons' });
    await expect(balloons.getByRole('link', { name: 'danny_p3d' })).toHaveAttribute('href', 'https://sketchfab.com/dannyp_3d');
    await expect(balloons.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    await expect(balloons.getByRole('link', { name: '“Letter-balloons”' })).toHaveAttribute('href', /sketchfab\.com\/3d-models\/letter-balloons-/);
    await expect(page.locator('.credits-page__item', { hasText: 'flag-icons' })).toContainText('MIT');
  });
});
