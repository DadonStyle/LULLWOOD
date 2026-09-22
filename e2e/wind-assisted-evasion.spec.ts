// LUL-3149 (Wind-Assisted Evasion): +20% speed / -30% noise radius while sprinting
// directly against the wind (running && movingAgainstWind), stacking on top of
// LUL-3009's always-on scent reduction. See docs/specs/lul-3149-wind-assisted-evasion.md.
//
// player.yaw is 0 at spawn (generateMap(), engine/forest-engine.js), so held KeyW's
// real per-frame heading is the fixed unit vector (0, -1) -- qaSetWindDirection picks a
// wind vector that's provably dot-negative (or dot-positive) against that known heading,
// same setup e2e/wind-indicator.spec.ts already uses, instead of depending on which way
// the seed's own generateWind() roll landed.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Every key in HINT_PRIORITY ahead of 'windAssist' (engine/forest-engine.js) -- pre-seeding
// these as already-seen guarantees a genuine windAssist trigger can never be preempted by a
// higher-priority hint becoming eligible mid-window (e.g. 'scent' once a real trail exists,
// or 'stamina' once continuous sprinting drains the meter past STAMINA_DRAIN_TIME's 6s).
const HINTS_AHEAD_OF_WIND_ASSIST = ['scent', 'landmark', 'lake', 'bog', 'deepwater', 'oakHollow', 'wolf', 'bear', 'lion', 'stamina'];
async function preSeenHintsAheadOfWindAssist(page: Page) {
  await page.addInitScript((keys) => {
    for (const k of keys) window.localStorage.setItem('lullwood:hints:' + k, '1');
  }, HINTS_AHEAD_OF_WIND_ASSIST);
}

/**
 * Re-pins `kind` to a fixed `(dx, dz)` offset from the player's live position every
 * simulated tick, so the noise-hearing distance stays exactly constant for the whole
 * window even while the player is genuinely, continuously moving (required for
 * `running && movingAgainstWind` to stay true). qaStagePredatorNearPlayer resets the
 * predator's state to 'roam' on every call, so this only works because we probe the
 * state *before* the next reposition overwrites it -- the first tick that flips away
 * from 'roam' is captured and returned immediately. Combined into one page.evaluate
 * (not one qaHook() round-trip per tick) purely for speed; every call inside is an
 * existing hook (qaStagePredatorNearPlayer, qaAdvance, qaProbePredatorState).
 *
 * qaAdvance(1, true) (LUL-4600): this loop calls qaAdvance once per tick (up to 400
 * times for an 8s window) instead of once with steps=ticks, because it needs to
 * re-pin the predator and probe state between every tick. qaAdvance's own "only
 * render the last step" heuristic (LUL-2838) doesn't help a steps=1 call -- every
 * one of those 400 calls rendered, which is what turned this test into a 240s+
 * timeout under CI's software rasterizer. Nothing in this loop reads the canvas
 * (qaProbePredatorState reads engine state, not the DOM), so every render is
 * skippable here.
 */
async function sprintAtFixedDistanceUntilHeard(page: Page, kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number, ticks: number) {
  return page.evaluate(
    ({ kind, dx, dz, ticks }) => {
      const fe = window.ForestEngine!;
      for (let i = 0; i < ticks; i++) {
        fe.qaStagePredatorNearPlayer!(kind, dx, dz);
        fe.qaAdvance!(1, true);
        const st = fe.qaProbePredatorState!(kind);
        if (st && st.state !== 'roam') return st.state;
      }
      return null;
    },
    { kind, dx, dz, ticks },
  );
}

test('sprinting against the wind covers more ground than sprinting with it, over a fixed window', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it
  const againstStart = await qaHook(page, 'qaProbePlayer');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.6));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const againstEnd = await qaHook(page, 'qaProbePlayer');
  const againstDist = Math.hypot(againstEnd.x - againstStart.x, againstEnd.z - againstStart.z);

  await qaHook(page, 'qaTeleportTo', 0, 0);
  await qaHook(page, 'qaSetWindDirection', 0, -1);   // wind blows -Z, same direction as forward (0,-1)
  const withStart = await qaHook(page, 'qaProbePlayer');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.6));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const withEnd = await qaHook(page, 'qaProbePlayer');
  const withDist = Math.hypot(withEnd.x - withStart.x, withEnd.z - withStart.z);

  expect(withDist).toBeGreaterThan(0);
  // WIND_ASSIST_SPEED_MUL = 1.2 (lib/game/stamina.ts) -- allow slack for the
  // stamina-charge-scaled sprintSpeedMul() component both runs share equally.
  expect(againstDist / withDist).toBeGreaterThan(1.1);
});

test('sprinting against the wind keeps a wolf at 20u from ever hearing you, where the same sprint without wind assist is heard', async ({ page }) => {
  // 20u sits strictly between NOISE_RADIUS_RUN_WIND (16.8, out of range -- isNoiseHeard
  // returns false unconditionally, no RNG roll, 100% deterministic) and NOISE_RADIUS_RUN
  // (24, in range -- isNoiseHeard rolls Math.random() < 0.5*dt every frame; over 8
  // sim-seconds at FIXED_DT=0.02 the cumulative miss probability is
  // (1-0.5*0.02)^400 ~= e^-4 ~= 1.8%, an accepted flake budget, not a hook gap).
  //
  // The player must keep genuinely sprinting (mag>0 real movement) for running &&
  // movingAgainstWind to stay true, but a naive straight-line sprint toward a stationary
  // wolf closes a 20u gap in under 2s at sprint speed -- sprintAtFixedDistanceUntilHeard
  // re-pins the wolf 20u ahead of the player's live position every tick instead, so the
  // hearing distance stays exactly 20 the whole window regardless of how far the player
  // has actually travelled.
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const assistedState = await sprintAtFixedDistanceUntilHeard(page, 'wolf', 0, -20, stepsFor(8));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect(assistedState, 'a wind-assisted sprint at 20u must never be heard (16.8 < 20)').toBeNull();

  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }] });
  await qaHook(page, 'qaSetWindDirection', 0, -1);   // wind blows -Z, same direction as forward -- not wind-assisted

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const unassistedState = await sprintAtFixedDistanceUntilHeard(page, 'wolf', 0, -20, stepsFor(8));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect(unassistedState, 'an unassisted sprint at 20u (< 24 NOISE_RADIUS_RUN) must be heard').not.toBeNull();
});

test('walking against the wind does not trigger the sprint speed or noise bonus, only the existing scent reduction', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaBuildScene', { predators: [] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

  const start = await qaHook(page, 'qaProbePlayer');
  await page.keyboard.down('KeyW');   // held only -- no ShiftLeft/toggle-run
  await qaHook(page, 'qaAdvance', stepsFor(1));
  const end = await qaHook(page, 'qaProbePlayer');
  const dist = Math.hypot(end.x - start.x, end.z - start.z);

  // Unassisted walk speed over 1s at CONFIG.walk (no sprint, no wind bonus) -- well under
  // any sprint-speed distance (running*sprintSpeedMul(1)*WIND_ASSIST_SPEED_MUL > 10u/s).
  expect(dist).toBeGreaterThan(0);
  expect(dist).toBeLessThan(8);

  // Scent-only benefit (LUL-3009) is unchanged: the flag is still true while walking
  // against the wind, even though neither new effect applies.
  expect((await qaHook(page, 'qaProbeWind')).movingAgainstWind).toBe(true);
  await page.keyboard.up('KeyW');

  // NOISE_RADIUS_WALK (14) < 20, so a walking approach must never be heard either --
  // confirms noiseRadius fell through to the plain walk radius, not the wind-assisted
  // one. sprintAtFixedDistanceUntilHeard's re-pinning technique works identically at
  // walk speed (no ShiftLeft held): the loop only requires genuine mag>0 movement.
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }] });
  await page.keyboard.down('KeyW');
  const walkState = await sprintAtFixedDistanceUntilHeard(page, 'wolf', 0, -20, stepsFor(8));
  await page.keyboard.up('KeyW');
  expect(walkState, 'walking at 20u (> 14 NOISE_RADIUS_WALK) must not be heard').toBeNull();
});

test('#windIndicatorHint and #windIndicator\'s title both read the updated three-effect copy', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  await expect(page.locator('#windIndicatorHint')).toHaveText(
    'wind — move into the arrow to mask your scent; sprint into it for extra speed and quiet',
  );
  const title = await page.locator('#windIndicator').getAttribute('title');
  expect(title).toBe('Wind direction -- move into the arrow to mask your scent; sprint into it for extra speed and quiet');
});

test('the windAssist hint caption appears once while sprinting against the wind, and not again after being marked seen', async ({ page }) => {
  // Every hint ahead of 'windAssist' in HINT_PRIORITY is pre-seeded seen (see
  // preSeenHintsAheadOfWindAssist's comment) -- without this, 'scent' (eligible once a
  // real trail exists, ~4s in) or 'stamina' (eligible once continuous sprinting drains
  // the meter past 6s, STAMINA_DRAIN_TIME) legitimately preempts windAssist before its
  // own 8s elapses, per the documented "higher-priority key can preempt a lower-priority
  // one already showing" behavior (engine/forest-engine.js) -- observed live in this
  // test without the pre-seed.
  await preSeenHintsAheadOfWindAssist(page);
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaBuildScene', { predators: [] });

  await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.1));

  let probe = await qaHook(page, 'qaProbeHints');
  expect(probe.activeKey).toBe('windAssist');
  const caption = page.locator('#hintCaption');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText('sprinting into the wind moves you faster and quieter');

  await qaHook(page, 'qaAdvance', stepsFor(8.1));
  probe = await qaHook(page, 'qaProbeHints');
  expect(probe.activeKey).not.toBe('windAssist');
  expect(probe.seen.windAssist).toBe(true);

  // Stop and re-trigger -- an already-seen hint must not reshow.
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await qaHook(page, 'qaAdvance', stepsFor(0.5));
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.1));
  expect((await qaHook(page, 'qaProbeHints')).activeKey, 'an already-seen hint must not retrigger').not.toBe('windAssist');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
});
