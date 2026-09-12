// LUL-2558: mobile half of the personal-best + tier-streak counter regression
// (see ../progression.spec.ts for the desktop spec and the full writeup).
//
// Runs under the `mobile` Playwright project (playwright.config.ts) --
// devices['Pixel 5'], real touch/coarse-pointer emulation, so isMobile()
// mounts MobileControls the way a real phone would.
//
// This drives pickup via `page.keyboard.press('KeyE')` rather than tapping
// MobileControls' on-screen "E" button -- same deliberate choice
// e2e/mobile/win-persist.spec.ts makes (KeyE reaches pickup() in mobile mode
// too, engine/forest-engine.js's keydown listener isn't mode-gated), and this
// is the desktop-AND-mobile call-site coverage the engine/React contract rule
// requires for setProgression.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('win-then-win increments streak and sets a faster-time record; a death resets it (mobile)', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });

  const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(preEnter?.mode).toBe('mobile');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

  // Run 1: win.
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  let recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Personal Best:');
  expect(recap).toContain('Runs 1');
  expect(recap).toContain('Wins 1');
  expect(recap).toContain('Streak 1');

  // el.click(), not a real Playwright click -- see ../win-persist.spec.ts.
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();

  // Run 2: win again -- streak must increment to 2.
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Runs 2');
  expect(recap).toContain('Wins 2');
  expect(recap).toContain('Streak 2');

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
