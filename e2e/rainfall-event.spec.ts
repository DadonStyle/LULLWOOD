// LUL-5698 (Rainfall Event, cheap slice): active rainfall multiplies the footstep/breathing
// noise channel by RAINFALL_NOISE_MUL (0.65, lib/game/rainfallEvent.ts), applied at the
// checkNoise() call site inside updatePredators() (engine/forest-engine.js:2959) via a new
// rainfallNoiseMul parameter. See docs/specs/lul-5698-rainfall-event-cheap-slice.md.
//
// 18u sits strictly between NOISE_RADIUS_RUN * RAINFALL_NOISE_MUL (24 * 0.65 = 15.6, out of
// range during active rain -- isNoiseHeard returns false unconditionally, no roll) and
// NOISE_RADIUS_RUN (24, in range outside rain -- isNoiseHeard rolls Math.random() < 0.5*dt
// every frame; over 8 sim-seconds at FIXED_DT=0.02 the cumulative miss probability is
// (1-0.5*0.02)^400 ~= e^-4 ~= 1.8%, the same accepted flake budget
// e2e/wind-assisted-evasion.spec.ts's own 20u test documents).
//
// qaSetRainfallClock drives the real cycle (RAINFALL_CONFIG.period - activeDuration lands in
// 'active' immediately) rather than forcing rainfallActive/rainfallAmount directly, so the
// real phase transition and rainfallNoiseScalar(rainfallAmount) ramp both actually run. A
// lion is staged (not a wolf) per the proposal's own Q11 example. No wind, no mud -- isolate
// the rainfall multiplier alone.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Re-pins the lion to a fixed offset from the player every simulated tick (cancelling both
// the player's own travel and the lion's roam-wander drift), probing state right after each
// tick -- same technique as e2e/wind-assisted-evasion.spec.ts's sprintAtFixedDistanceUntilHeard.
async function sprintAtFixedDistanceUntilHeard(page: Page, dx: number, dz: number, ticks: number) {
  return page.evaluate(
    ({ dx, dz, ticks }) => {
      const fe = window.ForestEngine!;
      for (let i = 0; i < ticks; i++) {
        fe.qaStagePredatorNearPlayer!('lion', dx, dz);
        fe.qaAdvance!(1, true);
        const st = fe.qaProbePredatorState!('lion');
        if (st && st.state !== 'roam') return st.state;
      }
      return null;
    },
    { dx, dz, ticks },
  );
}

test.describe('Rainfall Event (LUL-5698)', () => {
  test('a roaming lion hears a running footstep at 18u outside rainfall, and does not hear the same footstep at 18u during active rainfall', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 0, z: -18, state: 'roam' }] });

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    const noRainState = await sprintAtFixedDistanceUntilHeard(page, 0, -18, stepsFor(8));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    expect(noRainState, 'outside rainfall, a running footstep at 18u (< 24 NOISE_RADIUS_RUN) must be heard').not.toBeNull();

    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 0, z: -18, state: 'roam' }] });
    const RAINFALL_PERIOD = 80, RAINFALL_ACTIVE_DURATION = 20;
    await qaHook(page, 'qaSetRainfallClock', RAINFALL_PERIOD - RAINFALL_ACTIVE_DURATION);
    // Let the active-phase ramp (RAINFALL_RAMP = 4s) fully settle before measuring, so
    // rainfallAmount has actually reached its active target, not mid-ease.
    await qaHook(page, 'qaAdvance', stepsFor(5));

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    const rainState = await sprintAtFixedDistanceUntilHeard(page, 0, -18, stepsFor(8));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    expect(rainState, 'during active rainfall, the same running footstep at 18u (< 15.6 = 24 * RAINFALL_NOISE_MUL) must never be heard').toBeNull();
  });
});
