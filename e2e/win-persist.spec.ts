// LUL-650: regression coverage for the founder's report that "after winning
// the game reset but dont show the you won screen" -- it must be mandatory
// and event-driven, exactly like the loss path (#deathScreen), not a timer
// that quietly ticks past it.
//
// e2e/smoke.spec.ts already asserts #winScreen appears on arrival; what it
// doesn't assert is that the screen *stays* up on its own, with nothing
// -- an accidental restart(), a HUD remount, a stray pushState -- tearing it
// back down a moment later. This spec holds past that first assertion and
// polls again, then drives the actual "Play again" flow so the mandatory
// exit path is covered too.
//
// Investigation note (see LUL-650 ticket comment / wiki
// game/lul649-mobile-actionbtn-repro): a live-production repro against
// `main` found the win screen already persists correctly on desktop --
// engine/forest-engine.js's arriveHome()/restart() only flip winVisible via
// pushState(), and restart() only ever runs from the button's onClick. No
// engine change landed for item 1; this spec is the regression guard the
// ticket asked for regardless.
import { test, expect } from '@playwright/test';
import { boot, enter, readObjective } from './helpers';

test('win screen is mandatory and persists until the player restarts', async ({ page }) => {
  test.setTimeout(45_000);
  await boot(page, { qaHooks: true });
  await enter(page);

  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);

  const objective = await readObjective(page);
  expect(objective, 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

  await page.keyboard.press('KeyE');
  await expect
    .poll(() => readObjective(page), { timeout: 30_000 })
    .toContain('Carry the child home');

  await page.evaluate(() => window.ForestEngine?.qaTeleportHome?.());
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 5_000 });

  // Hold well past a single frame/tick, at several checkpoints -- if some
  // other path (a stray restart(), a re-init, a timer) were tearing the
  // screen down again, this is where it would show up.
  let elapsedMs = 0;
  for (const stepMs of [1000, 2000, 2000]) {
    await page.waitForTimeout(stepMs);
    elapsedMs += stepMs;
    await expect(page.locator('#winScreen'), `#winScreen must still be up ${elapsedMs}ms after arriving home`).toBeVisible();
    await expect(page.locator('#winScreen h1')).toHaveText('YOU WON');
  }

  // The screen must be hit-testable, not just `display:flex` under something else.
  const onTop = await page.evaluate(() => {
    const el = document.querySelector('#winScreen');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || (el.contains(hit) ?? false);
  });
  expect(onTop, '#winScreen must be the hit-tested element at its own centre').toBe(true);

  // Mandatory means it only goes away when the player acts. `.evaluate((el) =>
  // el.click())`, not a real Playwright `.click()`: this rig's HUD buttons are
  // known to time out a real click's multi-step actionability polling under
  // CI contention (wiki: systems/lul44-diagnosis-and-fix) -- an el.click()
  // still dispatches a genuine bubbling DOM click React's handler treats the
  // same way, it just skips that polling.
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();
});
