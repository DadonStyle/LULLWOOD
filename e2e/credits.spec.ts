// Third-party asset credits: a Credits MenuButton next to Suggest opens the
// credits (components/CreditsList.tsx, from lib/credits.ts) in the reusable
// InfoDialog popup (founder 2026-10-16), which carries the CC BY 4.0
// attribution for the sky balloon's 3D letters (danny_p3d) and the flag-icons
// credit. app/credits/page.tsx renders the same CreditsList.
import { test, expect } from './fixtures';
import { boot } from './helpers';

test.describe('credits', () => {
  test('the Credits button (next to Suggest) opens the credits in a popup', async ({ page }) => {
    await boot(page);
    const button = page.locator('#gameMenu .menuButtons').getByTestId('menuCredits');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Credits');
    await button.evaluate((el) => (el as HTMLElement).click());
    const dialog = page.getByTestId('creditsPopup');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('Credits');
    await expect(dialog.locator('.credits-page__item').first()).toContainText('Independence AI Studio');
    await expect(dialog.getByRole('link', { name: 'danny_p3d' })).toHaveAttribute('href', 'https://sketchfab.com/dannyp_3d');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
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
