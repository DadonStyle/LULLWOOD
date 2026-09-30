// LUL-2389 slice (b): player-sprint roost flush noise event. Sprinting
// (`running`, not merely moving) within ROOST_TRIGGER_RADIUS(6) of a roost's
// (x,z) fires flushRoost(i) and hearThrowableNoise(p, r.x, r.z,
// ROOST_INVESTIGATE_TIME) for every non-inert predator within
// ROOST_NOISE_RADIUS(14) of the roost -- the roost's own fixed position, never
// the player's. Shares roostCooldown[i] with the ambient (LUL-1914) and
// player-thrown-stone (LUL-4894, e2e/roost.spec.ts) triggers -- this file only
// exercises the new player-sprint path. See docs/specs/lul-2389-startled-roosts-slice-b.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// canopyNE, lib/game/roostSites.ts -- fixed, not part of generateMap()'s rng stream,
// untouched by applyQaWorldMicroPreset() (same as qaTeleportNearRoost relies on).
const ROOST_INDEX = 0;
const ROOST_X = 110;
const ROOST_Z = 90;

async function stageAndApproach(page: import('@playwright/test').Page, predatorDz: number) {
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: ROOST_X, z: ROOST_Z + predatorDz, state: 'roam' }] });
  // 3 units off the roost -- inside ROOST_TRIGGER_RADIUS(6), outside the roost's own
  // ambient-trigger radius(20) doesn't matter here since the player branch doesn't read it.
  await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 3);
}

test.describe('roost flush -- player-sprint noise event (LUL-2389 slice b)', () => {
  test('sprinting within ROOST_TRIGGER_RADIUS flushes and sends a nearby predator to the roost, not the player', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await stageAndApproach(page, 10);   // 10u from roost -- inside ROOST_NOISE_RADIUS(14)

    const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(before.state).toBe('roam');
    expect(before.noiseTarget).toBeNull();

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('ShiftLeft');

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after.state).toBe('investigate');
    // The roost's fixed position -- not the player's own (qaProbePlayer at ROOST_X, ROOST_Z+3).
    expect(after.noiseTarget).toEqual({ x: ROOST_X, z: ROOST_Z });

    const roost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(roost.cooldown).toBeGreaterThan(0);
  });

  test('walking the same radius does not flush', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await stageAndApproach(page, 10);

    // No ShiftLeft held -- running stays false.
    await qaHook(page, 'qaAdvance', stepsFor(1));

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after.state).toBe('roam');
    expect(after.noiseTarget).toBeNull();

    const roost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(roost.cooldown).toBe(0);
  });

  test('per-roost cooldown blocks a second flush inside ROOST_COOLDOWN', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await stageAndApproach(page, 10);

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);

    const firstPredator = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(firstPredator.state).toBe('investigate');
    const firstRoost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(firstRoost.cooldown).toBeGreaterThan(0);

    // Still sprinting, still inside ROOST_TRIGGER_RADIUS, well under the 32s cooldown --
    // a real second flush would reset roostCooldown[i] back up to ROOST_COOLDOWN(32) and
    // re-roll noiseTargetT via a fresh hearThrowableNoise() call.
    await qaHook(page, 'qaAdvance', stepsFor(2));
    await page.keyboard.up('ShiftLeft');

    const secondPredator = await qaHook(page, 'qaProbePredatorState', 'wolf');
    const secondRoost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    // Cooldown only ever ticks down across this window if no second flush fired.
    expect(secondRoost.cooldown).toBeLessThan(firstRoost.cooldown);
    // Same target object, not re-rolled.
    expect(secondPredator.noiseTarget).toEqual(firstPredator.noiseTarget);
  });

  test('a predator outside ROOST_NOISE_RADIUS of the roost is unaffected', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await stageAndApproach(page, 18);   // 18u from roost -- outside ROOST_NOISE_RADIUS(14), still on-map

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('ShiftLeft');

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after.state).toBe('roam');
    expect(after.noiseTarget).toBeNull();

    // The flush itself (burst/sound/cooldown) is unconditional on nearby predators --
    // only the hearThrowableNoise loop is distance-gated.
    const roost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(roost.cooldown).toBeGreaterThan(0);
  });
});

// LUL-5442: sprint-into-cooling-roost denial cue -- mirrors the already-shipped
// throw-into-cooling-roost cue (LUL-5412, roostFlushDeniedCue()). Distance-gated to
// ROOST_TRIGGER_RADIUS and edge-triggered (fires once per approach, not every tick)
// via the roostSprintDeniedPlayed debounce flag.
test.describe('roost flush -- sprint-into-cooldown denial cue (LUL-5442)', () => {
  test('sprinting into a roost already on cooldown fires the denial cue exactly once', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: ROOST_X, z: ROOST_Z + 30, state: 'roam' }] });
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 3);

    // First sprint flushes the roost and starts its cooldown.
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('ShiftLeft');

    const afterFlush = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(afterFlush.cooldown).toBeGreaterThan(0);
    const cueCountAfterFlush = afterFlush.deniedCueCount;

    // Leave and re-approach while still on cooldown, then sprint again -- this should
    // be denied and produce exactly one new cue firing, not one per tick.
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 40);
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 3);
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', stepsFor(2));
    await page.keyboard.up('ShiftLeft');

    const afterDenied = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(afterDenied.deniedCueCount).toBe(cueCountAfterFlush + 1);
  });

  test('holding sprint inside the radius does not refire the denial cue every tick', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: ROOST_X, z: ROOST_Z + 30, state: 'roam' }] });
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 3);

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);
    const cueCountAfterFlush = (await qaHook(page, 'qaProbeRoostState', ROOST_INDEX)).deniedCueCount;

    // Still sprinting, still in radius, still on cooldown for several more seconds --
    // a per-tick refire would inflate deniedCueCount by dozens here.
    await qaHook(page, 'qaAdvance', stepsFor(3));
    await page.keyboard.up('ShiftLeft');

    const afterHold = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(afterHold.deniedCueCount).toBe(cueCountAfterFlush);
  });

  test('sprinting into a cooling roost from outside ROOST_TRIGGER_RADIUS does not fire the cue', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: ROOST_X, z: ROOST_Z + 30, state: 'roam' }] });
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 3);

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('ShiftLeft');
    const cueCountAfterFlush = (await qaHook(page, 'qaProbeRoostState', ROOST_INDEX)).deniedCueCount;

    // 18u from roost -- outside ROOST_TRIGGER_RADIUS(6), still while on cooldown.
    await qaHook(page, 'qaTeleportTo', ROOST_X, ROOST_Z + 18);
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', stepsFor(2));
    await page.keyboard.up('ShiftLeft');

    const afterFar = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(afterFar.deniedCueCount).toBe(cueCountAfterFlush);
  });
});
