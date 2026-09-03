// LUL-1112: On iOS, new AudioContext() is suspended even inside a user gesture.
// This test is a regression floor for the *desktop* path (headless Chromium
// constructs the context running anyway), but the fix is required for iOS sound
// to work at all. The real proof is on a real iPhone with ?audiodebug=1.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('AudioContext is in running state after first entry', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');

  // Tap the gate to enter.
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(500);

  // Audio should be started and running.
  const probeResult = await page.evaluate(() => window.ForestEngine?.qaProbeAudio?.());
  expect(probeResult).toBeDefined();
  expect(probeResult?.state).toBe('running');
  expect(probeResult?.masterGain).toBeGreaterThan(0.0001);
});
