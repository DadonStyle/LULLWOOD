// LUL-1331: iOS constructs the AudioContext in suspended state, even during
// user activation. The first call to startAudio() must explicitly resume() the
// context before building the graph; otherwise the game is silent forever.
//
// Headless Chromium constructs the context 'running' anyway, so this test
// passes both before and after the fix — it is a regression floor for the
// *desktop* path, not proof the iOS bug is fixed. Real device testing requires
// a real iPhone and the ?audiodebug=1 readout (see LUL-1331 spec).
import { test, expect } from '@playwright/test';
import { boot } from '../helpers.ts';

test('entering a run resumes the AudioContext and starts the master gain fade-in', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');

  // Before entering: audio not yet initialized
  let probe = await page.evaluate(() => window.ForestEngine?.qaProbeAudio?.());
  expect(probe?.state).toBe(null);

  // Click the gate to enter
  const gate = page.locator('#gate');
  await gate.click();
  await page.waitForTimeout(100);

  // After entering: context should be running
  probe = await page.evaluate(() => window.ForestEngine?.qaProbeAudio?.());
  expect(probe?.state).toBe('running');
  // Master gain should be fading up from 0.0001 toward soundOn state (0.6 or 0.0001)
  expect(probe?.masterGain).toBeGreaterThan(0.0001);
});
