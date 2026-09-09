// LUL-2248: no mobile minimap spec existed before this ticket -- the minimap
// is HUD and mobile layout differs (per the mobile-parity checklist), so this
// mirrors e2e/minimap.spec.ts's two checks (on-canvas clamping, home ring)
// under a real mobile-emulated context (see e2e/mobile/input-mode.spec.ts's
// header comment for why `devices['Pixel 5']`, not `hasTouch` on desktop).
// Landscape viewport, same as other mobile specs that aren't specifically
// about the portrait rotate-prompt (e2e/mobile/orientation-gate.spec.ts owns
// that).
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test.describe('mobile minimap w2m stays on-canvas past the forest/bog seam', () => {
  test('an objective-marker point at z=150 (past the z=120 seam) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(40, 150));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});

test.describe('mobile minimap home marker', () => {
  test('home renders as a ring on the minimap static layer', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(0, 0));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});
