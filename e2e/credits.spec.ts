// Third-party asset credits: a Credits MenuButton next to Suggest (same
// reusable component, only the URL differs) opens app/credits/page.tsx
// (lib/credits.ts), which carries the CC BY 4.0 attribution for the sky
// balloon's 3D letters (danny_p3d) and the flag-icons credit.
import { test, expect } from './fixtures';
import { boot } from './helpers';

test.describe('credits', () => {
  test('the Credits button (next to Suggest) opens /credits in a new tab', async ({ page }) => {
    await boot(page);
    const button = page.locator('#gameMenu .menuButtons').getByTestId('menuCredits');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Credits');
    const [popup] = await Promise.all([page.waitForEvent('popup'), button.evaluate((el) => (el as HTMLElement).click())]);
    await expect(popup).toHaveURL(/\/credits$/);
  });

  test('/credits attributes the balloon letters to danny_p3d under CC BY 4.0', async ({ page }) => {
    await page.goto('/credits');
    await expect(page.locator('h1')).toHaveText('credits');
    // the studio's author comes first, linking the GitHub profile (not the repo)
    const first = page.locator('.credits-page__item').first();
    await expect(first).toContainText('Independence AI Studio');
    await expect(first.getByRole('link', { name: 'Noam Dadon' })).toHaveAttribute('href', 'https://github.com/DadonStyle');
    const balloons = page.locator('.credits-page__item', { hasText: 'Letter-balloons' });
    await expect(balloons.getByRole('link', { name: 'danny_p3d' })).toHaveAttribute('href', 'https://sketchfab.com/dannyp_3d');
    await expect(balloons.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    await expect(balloons.getByRole('link', { name: '“Letter-balloons”' })).toHaveAttribute('href', /sketchfab\.com\/3d-models\/letter-balloons-/);
    await expect(page.locator('.credits-page__item', { hasText: 'flag-icons' })).toContainText('MIT');
  });
});
