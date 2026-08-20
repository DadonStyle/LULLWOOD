// LUL-69: the rotate-device prompt and the widened FOV are both mobile-only
// (lib/input-mode.ts's isMobile()), never a function of window aspect ratio
// alone -- "a narrow desktop window should not trigger a rotate prompt" is
// the ticket's own explicit non-goal. This runs under the `chromium` project
// (Desktop Chrome: pointer:fine, hover:hover), so isMobile()'s first check is
// always false here regardless of viewport shape; the width stays above the
// 768px fallback threshold in lib/input-mode.ts so the second check is also
// false. See e2e/mobile/orientation-gate.spec.ts for the mobile-portrait
// case this is the negative counterpart of.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test.use({ viewport: { width: 900, height: 1400 } }); // portrait-shaped, desktop-wide

test('a tall/narrow desktop window gets no rotate prompt and keeps the desktop FOV', async ({ page }) => {
  await boot(page, { qaHooks: true });

  await expect(page.getByTestId('orientationGate')).toHaveCount(0);

  const fov = await page.evaluate(() => window.ForestEngine?.qaCameraFov?.());
  expect(fov).toBe(70);
});
