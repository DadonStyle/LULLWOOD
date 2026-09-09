// LUL-2248: generalised LUL-1855's radio-mast-only fog-exempt beacon glow to
// all six LANDMARKS[].kind entries (see docs/specs/lul-2248-landmark-beacons-minimap-home.md).
// Pins that every landmark actually got a beacon sprite, and that the sprite
// is fog-exempt (fog: false) so it stays visible past the fog line as a
// bearing -- not just that the tuning object grew six entries.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test('all six landmark kinds have a fog:false beacon sprite visible after enter()', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const beacons = await page.evaluate(() => window.ForestEngine!.qaProbeLandmarkBeacons!());

  expect(beacons).toHaveLength(6);
  for (const b of beacons) {
    expect(b.visible, `${b.kind} beacon sprite missing`).toBe(true);
    expect(b.fog, `${b.kind} beacon sprite should be fog-exempt`).toBe(false);
  }
});
