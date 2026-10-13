// Founder 2026-10-13: the top-left menu row carries reusable MenuButtons --
// Suggest (LUL-5983), Credits and "Be the rescuer" -- and two InfoDialog popups:
// the rescuer rules (lib/game/rescuerRules.ts) and the admin-mode warning. A run
// that has admin mode on at any point can't take the top rescuer spot, even if
// admin mode is switched off before the win (forest-engine.js adminUsedThisRun).
// The top-right #runTimer shows the run's time exactly as the leaderboard stores
// it. Menu clicks use `.evaluate(el.click())` for the pointer-lock reason
// documented in e2e/game-menu-suggest-link.spec.ts.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const RECORD = { id: 7, nickname: 'ranger', country: 'IL', timeMs: 125_000, achievedAt: '2026-10-02T10:00:00.000Z' };
const FLOOR_WAIT_MS = 16_500;

const click = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => (el as HTMLElement).click());

async function win(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
}

test.describe('menu buttons, rescuer rules and admin mode', () => {
  test('Suggest, Credits and Be the rescuer sit together in the top-left button row', async ({ page }) => {
    await boot(page);
    const row = page.locator('#gameMenu .menuButtons');
    for (const id of ['menuSuggest', 'menuCredits', 'menuBeTheRescuer']) await expect(row.getByTestId(id)).toBeVisible();
    await expect(row.getByTestId('menuBeTheRescuer')).toHaveText('Be the rescuer');
    const [popup] = await Promise.all([page.waitForEvent('popup'), click(page.getByTestId('menuCredits'))]);
    await expect(popup).toHaveURL(/\/credits$/);
  });

  test('Be the rescuer opens the rules popup, naming the time to beat; Esc and the button close it', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: RECORD } }));
    await boot(page);
    await expect(page.locator('#leaderboardLine')).toHaveAttribute('data-state', 'populated');
    await click(page.getByTestId('menuBeTheRescuer'));
    const dialog = page.getByTestId('rescuerRules');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('Be the rescuer');
    await expect(dialog).toContainText('Blackout');
    await expect(dialog).toContainText('admin mode');
    await expect(dialog).toContainText("beat the current top rescuer's time of 2:05");
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await click(page.getByTestId('menuBeTheRescuer'));
    await page.getByTestId('rescuerRules-close').click();
    await expect(dialog).toHaveCount(0);
  });

  test('turning admin mode on warns that it will not count as the top rescuer', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await click(page.getByTestId('menuToggle'));
    await click(page.locator('#settingsBtn'));
    await click(page.getByTestId('adminModeToggle'));
    const warning = page.getByTestId('adminModeWarning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("can't be counted as the top rescuer");
    await click(page.getByTestId('adminModeWarning-close'));
    await expect(warning).toHaveCount(0);
    expect((await qaHook(page, 'qaProbeRunClock')).adminUsedThisRun).toBe(true);
  });

  test('a run that had admin mode on is refused at the win screen even after switching it off', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.addInitScript(() => {
      window.localStorage.setItem('lullwood:settings', JSON.stringify({ difficulty: 'blackout', adminMode: true }));
    });
    await boot(page, { qaHooks: true });
    await qaHook(page, 'qaRegenerateMap', 1);
    await enter(page);
    expect((await qaHook(page, 'qaProbeRunClock')).adminUsedThisRun).toBe(true);
    // switch admin mode off mid-run
    await click(page.getByTestId('menuToggle'));
    await click(page.locator('#settingsBtn'));
    await click(page.getByTestId('adminModeToggle'));
    await expect(page.getByTestId('adminModeToggle')).not.toBeChecked();
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    await expect(page.locator('#leaderboardAdminNote')).toHaveText("Admin mode was on during this run, so it can't be counted as the top rescuer.");
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
  });

  test('the top-right timer runs during play and ends on exactly the recap time', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    const timer = page.locator('#runTimer');
    await expect(timer).toHaveText(/^\d+:\d{2}$/);
    await expect.poll(async () => (await qaHook(page, 'qaProbeRunClock')).label, { timeout: 5_000 }).not.toBe('0:00');
    await win(page);
    const recap = (await page.locator('#runRecap').textContent()) ?? '';
    const [, recapTime] = /time survived: (\d+:\d{2})/.exec(recap)!;
    await expect(timer).toHaveText(recapTime);
  });
});
