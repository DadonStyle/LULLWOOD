// LUL-2539/2485 cheap slice: reduce scent-trail persistence 20% at high wind.
// windHighSpeed is a per-run 50/50 boolean (generateWind(), engine/forest-engine.js)
// rolled from an independent seeded generator, not the shared rng stream. qaSetWindHighSpeed
// forces it directly so these assertions don't depend on the coin flip landing either way.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

test.describe('high-wind scent persistence (LUL-2539)', () => {
  test('qaSetWindHighSpeed toggles the effective scent lifetime by exactly 20%', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14, 5);
    await qaHook(page, 'qaSetWindHighSpeed', true);
    expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14 * 0.8, 5);
  });

  test('qaProbeWind reports the forced windHighSpeed flag', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', true);
    expect((await qaHook(page, 'qaProbeWind')).windHighSpeed).toBe(true);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    expect((await qaHook(page, 'qaProbeWind')).windHighSpeed).toBe(false);
  });

  // age=12: below the 14s normal-wind lifetime (still live) but past the
  // 14*0.8=11.2s high-wind lifetime (already expired). Reuses the 'bear'
  // species + qaSeedScentPoint/qaProbeScentOnOldest pair e2e/scent.spec.ts
  // already uses for the micro world. Split into two tests (each its own
  // fresh page load) rather than seeding twice in one test -- qaSeedScentPoint
  // only pushes and qaProbeScentOnOldest always reads scentPoints[0], so a
  // second seed in the same test would leave the first, already-expired
  // point at index 0 and the second assertion would check the wrong point.
  test('a scent point ages out before the high-wind-adjusted lifetime', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', true);
    await qaHook(page, 'qaSeedScentPoint', -5, 0, 12);
    expect(await qaHook(page, 'qaProbeScentOnOldest', 'bear')).toBeNull();
  });

  test('the same-age scent point is still detected under normal wind', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    await qaHook(page, 'qaSeedScentPoint', -5, 0, 12);
    expect(await qaHook(page, 'qaProbeScentOnOldest', 'bear')).not.toBeNull();
  });
});
