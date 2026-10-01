// LUL-5736 (Firefly Rain Dim, cheap slice, accepted per LUL-5735): active rainfall dims
// firefly mote intensity by CONFIG.FIREFLY_RAIN_DIM (0.8, engine/tuning.js) -- applied at the
// mote-intensity assignment inside the firefly-motes loop (engine/forest-engine.js), using the
// same rainfallAmount already driving rainfallFogBoost/rainfallNoiseScalar. Ambient-only, no
// HUD/cues (docs/CUES.md Q15 N/A, decisions/lul-5735-firefly-rain-dim-accepted-2026-10-01).
//
// qaHour=2 (night) puts fireflies in their always-present state (same precedent as
// e2e/firefly-swarms.spec.ts); qaSetRainfallClock drives the real rainfall cycle (same
// technique as e2e/rainfall-event.spec.ts) rather than forcing rainfallAmount directly, so the
// real phase transition and ramp (RAINFALL_RAMP = 4s) both actually run. qaProbeFireflyClusters's
// new maxIntensity field (LUL-5736) is read before, during and after rain since anyVisible alone
// can't distinguish dimmed-not-zeroed from undimmed -- at FIREFLY_RAIN_DIM=0.8 a fully-rained-on
// mote still reads intensity > 0.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const RAINFALL_PERIOD = 80, RAINFALL_ACTIVE_DURATION = 20;

test('firefly mote intensity dims during active rainfall and recovers once rain stops', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  const dry = await qaHook(page, 'qaProbeFireflyClusters');
  expect(dry.anyVisible, 'fireflies must be visible at night before any rain').toBe(true);
  expect(dry.maxIntensity).toBeGreaterThan(0);

  await qaHook(page, 'qaSetRainfallClock', RAINFALL_PERIOD - RAINFALL_ACTIVE_DURATION);
  // Let the active-phase ramp (RAINFALL_RAMP = 4s) fully settle before measuring, same
  // margin e2e/rainfall-event.spec.ts uses for the same ramp.
  await qaHook(page, 'qaAdvance', stepsFor(5));

  const rained = await qaHook(page, 'qaProbeFireflyClusters');
  expect(rained.maxIntensity, 'active rainfall must dim mote intensity below the dry reading')
    .toBeLessThan(dry.maxIntensity);
  expect(rained.maxIntensity, 'FIREFLY_RAIN_DIM=0.8 dims to 20% of dry, not to zero -- motes stay visible')
    .toBeGreaterThan(0);
  expect(rained.maxIntensity).toBeCloseTo(dry.maxIntensity * 0.2, 2);

  // Advance past the active window (20s) plus the ramp-down, back into the dry phase.
  await qaHook(page, 'qaAdvance', stepsFor(RAINFALL_ACTIVE_DURATION + 5));

  const recovered = await qaHook(page, 'qaProbeFireflyClusters');
  expect(recovered.maxIntensity, 'intensity must recover once rainfall ends')
    .toBeCloseTo(dry.maxIntensity, 2);
});
