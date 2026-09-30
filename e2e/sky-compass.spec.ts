// LUL-5486: the Sky Compass is four world-space THREE.Sprite glyphs (N/E/S/W),
// not baked into scene.background the way LUL-5485's original proposal
// wanted (a flat, non-rotating CanvasTexture backdrop can't express a
// compass -- see the correction in LUL-5486's description). The thing worth
// proving is exactly that distinction: the sprites sit at real, fixed world
// positions and rotating the camera does not move them, unlike a
// screen-locked overlay would. Micro world (boot()'s default) -- this is a
// passive background object with no opposing system to stage.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

const SKY_COMPASS_RADIUS = 280;
const CARDINAL_DIRS: Record<'N' | 'E' | 'S' | 'W', { x: number; z: number }> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};

test('sky compass sprites sit at the cardinal unit vectors * radius', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const positions = await qaHook(page, 'qaGetSkyCompassPositions');

  for (const glyph of ['N', 'E', 'S', 'W'] as const) {
    const dir = CARDINAL_DIRS[glyph];
    const p = positions[glyph];
    expect(p.x).toBeCloseTo(dir.x * SKY_COMPASS_RADIUS, 1);
    expect(p.y).toBeCloseTo(0, 1);
    expect(p.z).toBeCloseTo(dir.z * SKY_COMPASS_RADIUS, 1);
  }
});

test('rotating the camera does not move the sky compass world positions', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const before = await qaHook(page, 'qaGetSkyCompassPositions');

  await qaHook(page, 'qaSetLookYaw', Math.PI / 2);
  const afterQuarterTurn = await qaHook(page, 'qaGetSkyCompassPositions');

  await qaHook(page, 'qaSetLookYaw', Math.PI);
  const afterHalfTurn = await qaHook(page, 'qaGetSkyCompassPositions');

  for (const glyph of ['N', 'E', 'S', 'W'] as const) {
    expect(afterQuarterTurn[glyph]).toEqual(before[glyph]);
    expect(afterHalfTurn[glyph]).toEqual(before[glyph]);
  }
});

test('N/S and E/W sprites are opposite each other across the origin', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const p = await qaHook(page, 'qaGetSkyCompassPositions');

  expect(p.N.x).toBeCloseTo(-p.S.x, 1);
  expect(p.N.z).toBeCloseTo(-p.S.z, 1);
  expect(p.E.x).toBeCloseTo(-p.W.x, 1);
  expect(p.E.z).toBeCloseTo(-p.W.z, 1);
});
