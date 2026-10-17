// Founder 2026-10-17: the run's time stops the moment the child is picked up
// (E accepted), not when the ~11 s pickup cinematic ends. The top-right timer,
// the win screen's time and the leaderboard time are all that frozen value.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';
import { formatRunTime } from '../lib/ui/format-duration';
import { computeSurvival } from '../lib/game/economy';

const runClock = async (page: import('@playwright/test').Page) => (await qaHook(page, 'qaProbeRunClock')) as { seconds: number };

test('pressing E on the child stops the run clock; the win screen shows that time', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 10_000 }).toBeGreaterThan(1.5);

  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
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

test('the survival embers are paid on real elapsed time including the ~11 s cinematic, not frozen at the grab', async ({ page }) => {
  // LUL-6012 (review P1 on PR#1104): pickup() freezes the *displayed* clock at the
  // grab, but the survival-ember payout must not freeze with it -- that would be a
  // real balance change (every win banks ~11.3s less survival credit) no one signed
  // off on. Grab between 9s and 20s: the frozen grab-time clock alone stays under
  // the 20s survival-unit boundary, but the cinematic's ~11.3s of real elapsed time
  // pushes the run past it, same as before PR#1104.
  await boot(page, { qaHooks: true });
  await enter(page);
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 30_000 }).toBeGreaterThan(12);
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const atGrab = (await runClock(page)).seconds;
  expect(atGrab).toBeGreaterThan(9);
  expect(atGrab).toBeLessThan(20);
  expect(computeSurvival(atGrab)).toBe(0);   // the frozen grab-time clock alone hasn't crossed the boundary

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  // Real elapsed time (atGrab + however long the cinematic and the rig's own
  // render pace actually took) crosses the 20s boundary -- the payout must
  // earn at least the one survival unit the frozen clock alone would deny.
  // Not asserting an exact unit count: the cinematic's wall-clock duration
  // varies with rig speed (swiftshader software rendering), unlike atGrab's
  // bounds above, which only depend on the poll/press timing before it.
  const recap = await page.locator('#runRecap').textContent();
  const survival = Number(recap?.match(/\+(\d+) survival/)?.[1]);
  expect(survival, recap ?? '').toBeGreaterThan(0);
});
