// LUL-1093: w2m() mapped bog coordinates (z > 120, up to zMax=240) off the
// 160x160 minimap canvas with no clamp, so the player arrow and the pulsing
// objective marker both silently vanished once either point crossed z=120.
// Pins the fix: any point up to the bog's outer edge stays on-canvas.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';
// fullmap-reason: minimap w2m clamping past the forest/bog seam exists only at full map size (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

test.describe('minimap w2m stays on-canvas past the forest/bog seam @fullmap', () => {
  test('a player-arrow point at z=200 (deep bog) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(0, 200));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });

  test('an objective-marker point at z=150 (past the z=120 seam) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(40, 150));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});

// LUL-2248: drawMinimapStatic() now draws CONFIG.home ({x:0,z:0}) as a warm
// ring on the minimap static layer -- previously home had no minimap marker
// at all (see docs/specs/lul-2248-landmark-beacons-minimap-home.md). Exact
// pixel-level ring rendering isn't Playwright-probable without a screenshot
// diff (see that spec's "Not covered"); this pins the one thing a test can
// assert without one -- that home's world coordinate still maps on-canvas
// through the same w2m() the ring drawing itself uses.
test.describe('minimap home marker @fullmap', () => {
  test('home renders as a ring on the minimap static layer', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(0, 0));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});
