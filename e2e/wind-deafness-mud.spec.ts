// LUL-5596 (Wind Deafness in Mud Zones): a roaming predator standing in a Mud Zone
// (LUL-5564) can't be fooled by the player's Wind-Assisted Evasion footstep discount
// (LUL-3149) -- updatePredators()'s footstep channel overrides the passed-in noiseRadius
// back to the plain NOISE_RADIUS_RUN whenever `predInMud && windAssist` both hold
// (engine/forest-engine.js:2914), so a predator standing in mud "hears through" the
// 16.8u wind-assisted radius out to the full 24u running radius.
//
// Geometry, same deterministic-distance technique e2e/wind-assisted-evasion.spec.ts's
// second test documents and relies on, adapted for a STATIC mud zone (that test only
// needs a constant *relative* distance, which tolerates the wolf's absolute position
// drifting right along with the player; a Mud Zone is a fixed world-space circle, so this
// file additionally freezes the player's own position against a staged rock
// (qaStageWalkIntoCover('rock')) so the wolf's re-pinned position is also an unmoving
// absolute point -- otherwise 8s of real sprint travel (~100u) would walk the wolf back out
// of any fixed-radius mud circle long before the probabilistic hearing roll gets a fair shot.
// qaStagePredatorNearPlayer's own per-tick re-pin (same helper e2e/wind-assisted-evasion.spec.ts
// uses) then cancels the wolf's roam-wander drift on top of that, so dist is exactly 20 the
// whole window, not just approximately.
//
// 20u sits strictly between NOISE_RADIUS_RUN_WIND (16.8, wind-assisted radius -- out of range,
// isNoiseHeard returns false unconditionally, no RNG roll, 100% deterministic) and
// NOISE_RADIUS_RUN (24, the mud-override radius -- in range, isNoiseHeard rolls
// Math.random() < 0.5*dt every frame; over 8 sim-seconds at FIXED_DT=0.02 the cumulative miss
// probability is (1-0.5*0.02)^400 ~= e^-4 ~= 1.8%, the same accepted flake budget
// e2e/wind-assisted-evasion.spec.ts's own 20u test documents -- not a hook gap). The ticket's
// plan text says "within ~1s"; that figure undercounts the per-tick 1% hearing roll (close to a
// coin-flip over 1s, not a reliable assertion), so this file uses the precedent's 8s window
// instead -- flagged on the ticket per its own "say so rather than silently picking the other
// reading" instruction.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Re-pins the wolf to a fixed offset from the player every simulated tick (cancelling both
// the player's own travel, were it not frozen, and the wolf's roam-wander drift), probing
// state right after each tick and returning the first non-'roam' state reached -- same
// technique and same reasoning as e2e/wind-assisted-evasion.spec.ts's
// sprintAtFixedDistanceUntilHeard (qaAdvance(1, true) per tick, not qaAdvance(ticks), so the
// re-pin and the state probe both land between every single simulated frame).
async function sprintAtFixedDistanceUntilHeard(page: Page, dx: number, dz: number, ticks: number) {
  return page.evaluate(
    ({ dx, dz, ticks }) => {
      const fe = window.ForestEngine!;
      for (let i = 0; i < ticks; i++) {
        fe.qaStagePredatorNearPlayer!('wolf', dx, dz);
        fe.qaAdvance!(1, true);
        const st = fe.qaProbePredatorState!('wolf');
        if (st && st.state !== 'roam') return st.state;
      }
      return null;
    },
    { dx, dz, ticks },
  );
}

// Freezes the player against a staged rock (yaw -> -PI/2, forward (1,0) -- see
// qaStageWalkIntoCover's own doc comment) and returns that frozen position, so callers can
// derive a wolf offset without hardcoding the rock's standoff math. windX/Z must be set to
// directly oppose (1,0) -- i.e. (-1,0) -- for sprinting "forward" (KeyW) into the rock to also
// register as sprinting against the wind.
async function stageFrozenPlayerAgainstWind(page: Page) {
  const staged = await qaHook(page, 'qaStageWalkIntoCover', 'rock');
  await qaHook(page, 'qaSetWindDirection', -1, 0);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  // sprintWindBonusActive is only recomputed inside stepFrame() -- one tick so the keys
  // just pressed are actually reflected before anything reads it.
  await qaHook(page, 'qaAdvance', 1, true);
  return staged.start;
}

async function releaseSprint(page: Page) {
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}

test.describe('Wind Deafness in Mud Zones (LUL-5596)', () => {
  test('a roaming wolf standing in mud hears a wind-assisted sprint at 20u, where the same sprint outside mud does not', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }],
      props: [{ kind: 'rock', x: 2.95, z: 0 }],
      mudZones: [{ x: 0, z: -20, r: 5 }],
    });

    const start = await stageFrozenPlayerAgainstWind(page);
    const dx = -start.x, dz = -20 - start.z;   // re-pin offset that lands the wolf back at (0,-20) every tick

    const sprintWindBonusActive = (await qaHook(page, 'qaProbePlayer')).sprintWindBonusActive;
    expect(sprintWindBonusActive, 'the staged sprint must actually register as wind-assisted before the mud override can be tested').toBe(true);

    const mudState = await sprintAtFixedDistanceUntilHeard(page, dx, dz, stepsFor(8));
    await releaseSprint(page);
    expect(mudState, 'a wolf standing in mud must hear through the wind-assist discount at 20u (< 24 NOISE_RADIUS_RUN)').toBe('investigate');

    // Companion negative case: identical staging, wolf re-pinned to the same 20u offset but
    // with no mud zone covering that position -- proves the override is mud-gated, not an
    // unconditional loosening of the wind-assist radius.
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }],
      props: [{ kind: 'rock', x: 2.95, z: 0 }],
    });

    const start2 = await stageFrozenPlayerAgainstWind(page);
    const dx2 = -start2.x, dz2 = -20 - start2.z;

    expect((await qaHook(page, 'qaProbePlayer')).sprintWindBonusActive).toBe(true);

    const noMudState = await sprintAtFixedDistanceUntilHeard(page, dx2, dz2, stepsFor(8));
    await releaseSprint(page);
    expect(noMudState, 'the same wind-assisted sprint at 20u must never be heard outside mud (16.8 < 20)').toBeNull();
  });
});
