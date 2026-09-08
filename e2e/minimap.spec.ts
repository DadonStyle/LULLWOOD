// LUL-1093: w2m() mapped bog coordinates (z > 120, up to zMax=240) off the
// 160x160 minimap canvas with no clamp, so the player arrow and the pulsing
// objective marker both silently vanished once either point crossed z=120.
// Pins the fix: any point up to the bog's outer edge stays on-canvas.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test.describe('minimap w2m stays on-canvas past the forest/bog seam', () => {
  test('a player-arrow point at z=200 (deep bog) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(0, 200));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });

  test('an objective-marker point at z=150 (past the z=120 seam) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(40, 150));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});
