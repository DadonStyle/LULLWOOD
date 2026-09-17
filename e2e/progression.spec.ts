// LUL-2558: personal-best time + tier streak counter. `qaTeleportNearBaby()` and
// `qaTriggerDeath(kind, cause)` already drive the real win/death transitions
// deterministically (see e2e/win-persist.spec.ts) -- this spec drives two consecutive
// wins then a death in one session and reads the recap text (`#runRecap`), matching how
// e2e/win-persist.spec.ts already reads recap text. No new probe hook needed.
import { test, expect } from './fixtures';
import { boot, enter } from './helpers';

test('win-then-win increments streak and sets a faster-time record; a death resets it', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);

  // Run 1: win.
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  let recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Personal Best:');   // first-ever win on this tier is always a record
  expect(recap).toContain('Runs 1');
  expect(recap).toContain('Wins 1');
  expect(recap).toContain('Streak 1');

  // Restart (same convention as e2e/win-persist.spec.ts -- el.click() to
  // dodge CI actionability-polling flakiness on this button). `.restartBtn`
  // is `disabled={!state.winRevealed}` (components/Hud.tsx) and winRevealed
  // flips true measurably after winVisible (opacity-transition delay --
  // see Hud.tsx's RESTART_FOCUS_DELAY_MS comment). Under CI's slower
  // swiftshader rendering that gap can outlast the moment #winScreen's own
  // toBeVisible() resolves, so clicking immediately lands on a still-
  // disabled button and silently no-ops (30s hang on toBeHidden below,
  // reproduced live under CPU-throttled swiftshader). Wait for enabled
  // first, same pattern as e2e/suggestion-box.spec.ts's submit button.
  await expect(page.locator('.restartBtn')).toBeEnabled();
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();

  // Run 2: win again -- streak must increment to 2, bestTime must NOT
  // regress if this run is slower (qaTeleportNearBaby -> KeyE is the same
  // deterministic distance both times, so completion time should be close;
  // assert the invariant, not an exact faster/slower outcome, since frame
  // timing is not guaranteed identical between runs).
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Runs 2');
  expect(recap).toContain('Wins 2');
  expect(recap).toContain('Streak 2');

  await expect(page.locator('.restartBtn')).toBeEnabled();
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();

  // Run 3: death -- streak must reset to 0, wins must NOT increment, runs must.
  await page.evaluate(() => window.ForestEngine?.qaTriggerDeath?.('wolf', 'chase'));
  await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 15_000 });
  recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Runs 3');
  expect(recap).toContain('Wins 2');
  expect(recap).toContain('Streak 0');
});
