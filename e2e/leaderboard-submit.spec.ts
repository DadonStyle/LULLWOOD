// LUL-3264 wave 1, S3: the submit form on the win screen is offered only for
// an eligible run (Blackout, admin mode off, time above the plausibility
// floor), and it posts the engine's real survived time.
//
// A teleport win finishes in well under PLAUSIBILITY_FLOOR_MS (~15.7s), and no
// QA hook advances the run clock, so the eligible-path tests wait the floor
// out in real time before winning (THREE.Clock is wall-clock based).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FLOOR_WAIT_MS = 16_500;

// The real applied-settings path (SettingsPanel.tsx's mount effect calls
// actions.setDifficulty() from this key, same seeding as e2e/embers-shop.spec.ts).
// setDifficulty() only takes effect on the next generateMap(), so the map is
// regenerated before entering -- same reason as e2e/minimap-setting.spec.ts.
async function seedSettings(context: import('@playwright/test').BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript((s: Record<string, unknown>) => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify(s));
  }, settings);
}

async function bootBlackout(page: import('@playwright/test').Page) {
  await boot(page, { qaHooks: true });
  await qaHook(page, 'qaRegenerateMap', 1);
  await enter(page);
}

async function win(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
}

test.describe('leaderboard submit form', () => {
  test('appears on an eligible blackout win and posts the real survived time', async ({ page, context }) => {
    test.setTimeout(120_000);
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/leaderboard', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { isRecord: true } });
    });
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);

    const form = page.locator('#leaderboardForm');
    await expect(form).toBeVisible();
    await page.locator('#leaderboardNickname').fill('Ranger 42!');
    await expect(page.locator('#leaderboardNickname')).toHaveValue('ranger42');
    // The restart button's delayed auto-focus must not steal focus mid-typing.
    await page.waitForTimeout(2_500);
    await expect(page.locator('#leaderboardNickname')).toBeFocused();
    await page.locator('#leaderboardCountry').selectOption('IL');
    await page.locator('#leaderboardForm button[type="submit"]').click();
    await expect(page.locator('#leaderboardSubmitted')).toHaveText(/New record! ranger42/);

    expect(posted).not.toBeNull();
    const body = posted as unknown as { nickname: string; country: string; time_ms: number; website: string };
    expect(body.nickname).toBe('ranger42');
    expect(body.country).toBe('IL');
    expect(body.website).toBe('');
    expect(Number.isInteger(body.time_ms)).toBe(true);
    expect(body.time_ms).toBeGreaterThanOrEqual(15_713);
    // Same number RunRecap shows (m:ss of state.survivedSeconds), not a second timer.
    const recap = (await page.locator('#runRecap').textContent()) ?? '';
    const [, m, s] = /time survived: (\d+):(\d{2})/.exec(recap)!;
    expect(Math.abs(body.time_ms / 1000 - (Number(m) * 60 + Number(s)))).toBeLessThanOrEqual(1);
  });

  test('is absent on a lantern win', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
  });

  test('admin mode suppresses it even on an eligible blackout win', async ({ page, context }) => {
    test.setTimeout(120_000);
    await seedSettings(context, { difficulty: 'blackout', adminMode: true });
    await bootBlackout(page);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
  });

  test('a blackout win under the plausibility floor gets no form', async ({ page, context }) => {
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
  });
});
