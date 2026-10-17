// Founder 2026-10-17: pausing stops the top-right run timer, and the paused
// span is left out of the run's time (forest-engine.js runSeconds()), so the
// timer still equals the time the leaderboard stores. Menu clicks use
// `.evaluate(el.click())` for the pointer-lock reason documented in
// e2e/game-menu-suggest-link.spec.ts.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const click = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => (el as HTMLElement).click());
const runClock = async (page: import('@playwright/test').Page) => (await qaHook(page, 'qaProbeRunClock')) as { label: string; seconds: number };

async function togglePause(page: import('@playwright/test').Page) {
  await click(page.getByTestId('menuToggle'));
  await click(page.getByTestId('menuPause'));
}

test('pausing freezes the run timer; resuming continues from the same time', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 10_000 }).toBeGreaterThan(1.5);

  await togglePause(page);
  await expect(page.locator('#pausePrompt')).toBeVisible();
  const atPause = await runClock(page);
  const shownAtPause = await page.locator('#runTimer').textContent();
  await page.waitForTimeout(3_000);
  const stillPaused = await runClock(page);
  expect(stillPaused.seconds).toBeCloseTo(atPause.seconds, 1);
  await expect(page.locator('#runTimer')).toHaveText(shownAtPause!);

  await togglePause(page);
  await expect(page.locator('#pausePrompt')).toBeHidden();
  const resumed = await runClock(page);
  // Picks up where it stopped: the 3 s pause is not in the run time.
  expect(resumed.seconds).toBeGreaterThanOrEqual(atPause.seconds);
  expect(resumed.seconds - atPause.seconds).toBeLessThan(1.5);
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 10_000 }).toBeGreaterThan(resumed.seconds + 0.5);
});
