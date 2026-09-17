// LUL-2612: a first-time visitor sees a full-screen marketing splash
// (WelcomeSplash.tsx) before the entry gate, once ever. `boot()`'s
// `seedWelcomeSplashSeen` option (default true) pre-seeds
// `lullwood:welcomeSeen` for every other spec in the suite; only this file
// opts out, since it is the one place that actually exercises the
// first-visit path.
import { test, expect } from './fixtures';
import { boot, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const WELCOME_SEEN_KEY = 'lullwood:welcomeSeen';

test('a first-time visitor sees the welcome splash before the gate, and dismissing it persists', async ({ page }) => {
  const tracked = trackConsoleErrors(page);
  await boot(page, { seedWelcomeSplashSeen: false });

  const splash = page.locator('#welcomeSplash');
  await expect(splash).toBeVisible();
  await expect(splash).toContainText('Welcome to Lullwood');
  await expect(splash).toContainText('Built by Independence AI Studio!');
  // The bold studio credit must actually render bold, not just as plain text
  // next to it -- Q6/Q9 of the feature checklist: noticeable means the markup
  // says so, not just the words.
  await expect(splash.locator('.welcomeSplashStudio strong')).toHaveText('Built by Independence AI Studio!');

  // The splash sits above the gate (z-index 60 vs 20) and must intercept the
  // click a returning-player test would otherwise send straight to #gate.
  await expect(page.locator('#gate')).toBeVisible();

  await page.locator('#welcomeSplashDismiss').click();
  await expect(splash).toHaveCount(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), WELCOME_SEEN_KEY)).toBe('1');

  // The gate itself is now reachable -- clicking it should not be blocked by
  // a stale overlay.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);
  expectNoConsoleErrors(tracked);
});

test('a returning visitor (welcome already seen) never sees the splash', async ({ page }) => {
  const tracked = trackConsoleErrors(page);
  await boot(page); // default seeds lullwood:welcomeSeen=1
  await expect(page.locator('#welcomeSplash')).toHaveCount(0);
  await expect(page.locator('#gate')).toBeVisible();
  expectNoConsoleErrors(tracked);
});
