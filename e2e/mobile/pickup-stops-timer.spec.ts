// Mobile half of ../pickup-stops-timer.spec.ts (touch Interact instead of E).
// Founder 2026-10-17: the run's time stops the moment the child is picked up
// (E accepted), not when the ~11 s pickup cinematic ends. The top-right timer,
// the win screen's time and the leaderboard time are all that frozen value.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';
import { formatRunTime } from '../../lib/ui/format-duration';

const runClock = async (page: import('@playwright/test').Page) => (await qaHook(page, 'qaProbeRunClock')) as { seconds: number };

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('tapping Interact on the child stops the run clock; the win screen shows that time', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 10_000 }).toBeGreaterThan(1.5);

  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.getByTestId('touchInteract').tap();
  await page.waitForTimeout(300);
  const atGrab = (await runClock(page)).seconds;

  // The cinematic plays for ~11 s; the clock must not move during it.
  await page.waitForTimeout(3_000);
  expect((await runClock(page)).seconds).toBe(atGrab);

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  expect((await runClock(page)).seconds).toBe(atGrab);
  await expect(page.locator('#runTimer')).toHaveText(formatRunTime(atGrab));
  await expect(page.locator('#runRecap')).toContainText(`time survived: ${formatRunTime(atGrab)}`);
});
