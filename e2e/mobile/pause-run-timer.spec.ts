// Founder 2026-10-17, mobile half of ../pause-run-timer.spec.ts: the touch
// Pause button stops the run timer too, and the pause is left out of the run.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

const runClock = async (page: import('@playwright/test').Page) => (await qaHook(page, 'qaProbeRunClock')) as { seconds: number };

test('the touch Pause button freezes the run timer; resuming continues from the same time', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
  await expect.poll(async () => (await runClock(page)).seconds, { timeout: 10_000 }).toBeGreaterThan(1.5);

  await page.getByTestId('touchPause').tap();
  await expect(page.locator('#pausePrompt')).toBeVisible();
  const atPause = await runClock(page);
  await page.waitForTimeout(3_000);
  expect((await runClock(page)).seconds).toBeCloseTo(atPause.seconds, 1);

  await page.getByTestId('touchPause').tap();
  await expect(page.locator('#pausePrompt')).toBeHidden();
  const resumed = await runClock(page);
  expect(resumed.seconds - atPause.seconds).toBeLessThan(1.5);
  expect(resumed.seconds).toBeGreaterThanOrEqual(atPause.seconds);
});
