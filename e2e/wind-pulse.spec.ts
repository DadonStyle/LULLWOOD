// LUL-4893 (Predator Pause): a wind-gated freeze on ordinary chase pursuit --
// a predator sprinting perpendicular to the player's facing, with the wind at
// its back, halts for WIND_PAUSE_DURATION (0.3s, lib/game/predator.ts) before
// resuming. See wiki game/mechanics/predator-pause.md (Q1.5/Q11 corrected
// 2026-09-24) and decisions/predator-pause-roost-scare-dusk-stealth-accepted-2026-09-23.md.
//
// Real, non-QA chase: qaBuildScene's `state: 'chase'` is the same precedented
// staging predator-steering.spec.ts and sight-flicker.spec.ts already use to
// drive a predator through the live `p.state === 'chase'` branch in
// updatePredators() -- the movement/freeze logic under test runs identically
// regardless of how `state` got set (see PREDATOR_IDX comment below).
//
// Geometry: player spawns at (0,0), yaw 0 -- facing (0,-1) (fx,fz =
// -sin(yaw),-cos(yaw)). A lion at (5,0) gives a predator->player unit vector
// (ux,uz) = (-1,0): dot with facing (0,-1) is 0 (perpendicular, |0| <
// WIND_PAUSE_PERPENDICULAR_THRESHOLD=0.2). dist=5 sits below
// CHARGE_TRIGGER_MIN (7, lib/game/charge.ts) so the wolf/lion charge roll
// never fires and can't derail the assertion. Wind (-1,0) is dot 1 against
// (ux,uz) -- downwind, above WIND_PAUSE_DOWNWIND_THRESHOLD (0.6).
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// qaBuildScene() matches a spec's `kind` to the Nth predator of that species
// in the fixed `predators` array (3 wolves, 3 bears, 3 lions) -- same mapping
// e2e/predator-steering.spec.ts's PREDATOR_IDX already documents and relies on.
const LION_IDX = 6;

// Every key in HINT_PRIORITY ahead of 'windPulse' (engine/forest-engine.js) --
// same technique as e2e/wind-assisted-evasion.spec.ts's
// HINTS_AHEAD_OF_WIND_ASSIST. Without this, 'landmark' (unconditionally
// eligible from frame 1) or 'lion' (this spec's own staged predator) wins the
// slot first every time.
const HINTS_AHEAD_OF_WIND_PULSE = ['scent', 'landmark', 'bog', 'deepwater', 'oakHollow', 'wolf', 'bear', 'lion', 'stamina', 'windAssist'];
async function preSeenHintsAheadOfWindPulse(page: Page) {
  await page.addInitScript((keys) => {
    for (const k of keys) window.localStorage.setItem('lullwood:hints:' + k, '1');
  }, HINTS_AHEAD_OF_WIND_PULSE);
}

test.describe('Predator Pause (LUL-4893): wind-gated freeze for downwind-perpendicular chase', () => {
  test('a lion sprinting perpendicular to the player and downwind freezes for ~0.3s, then resumes once the wind turns', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetLookYaw', 0);   // facing (0,-1)
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 5, z: 0, state: 'chase' }] });
    await qaHook(page, 'qaSetWindDirection', -1, 0);   // wind blows -X, same direction the lion travels toward the player

    const before = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(before.windPauseT).toBe(0);

    // One tick is enough for the trigger (evaluated every frame the chase
    // fallback branch runs, with no travel-distance precondition) to fire.
    await qaHook(page, 'qaAdvance', 1, true);
    const triggered = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(triggered.windPauseT, 'perpendicular + downwind must trigger the freeze').toBeGreaterThan(0);
    const { x: fx, z: fz } = triggered;

    // Flip the wind now, immediately after the trigger -- the decay branch
    // (`p.windPauseT > 0`) doesn't re-consult shouldWindPause, so the freeze
    // still runs its full remaining duration unaffected. This is what lets
    // "resumes" be observed deterministically below: with the static
    // geometry here (player never moves), leaving the wind downwind would
    // have the trigger re-fire the instant windPauseT decays back to 0,
    // freezing the predator forever -- a real run never hits this because
    // the player is virtually never perfectly stationary against a live
    // predator for seconds at a stretch.
    await qaHook(page, 'qaSetWindDirection', 1, 0);   // now upwind

    // Still inside the 0.3s window -- position must not have moved.
    await qaHook(page, 'qaAdvance', stepsFor(0.15));
    const mid = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(mid.windPauseT, 'still frozen partway through the 0.3s window').toBeGreaterThan(0);
    expect(Math.hypot(mid.x - fx, mid.z - fz), 'frozen predator must not close distance mid-freeze').toBeLessThan(0.05);

    // Well past the window (0.3s margin) -- windPauseT has decayed to 0 and,
    // with the wind now upwind, the trigger doesn't refire: the predator
    // resumes ordinary chase pursuit.
    await qaHook(page, 'qaAdvance', stepsFor(0.3));
    const resumed = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(resumed.windPauseT).toBe(0);
    expect(Math.hypot(resumed.x - fx, resumed.z - fz), 'must resume closing distance once the wind no longer gates it').toBeGreaterThan(0.1);
  });

  test('a lion sprinting head-on (not perpendicular) never freezes, even downwind', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetLookYaw', 0);   // facing (0,-1)
    // Lion due -Z of the player: ux,uz = (0,-1), dot with facing (0,-1) = 1 -- head-on, not perpendicular.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 0, z: -5, state: 'chase' }] });
    await qaHook(page, 'qaSetWindDirection', 0, -1);   // downwind for this heading, but perpendicular gate must still block it

    // Short window only -- at lion speed (9.2u/s, lib/game/tuning.js) an
    // unpaused head-on chase closes the full 5u gap to catch range (rad+
    // CATCH_MARGIN=2.3) in under 0.3s; this only needs to prove movement
    // happened, not run the chase to its conclusion.
    await qaHook(page, 'qaAdvance', stepsFor(0.15));
    const state = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(state.windPauseT).toBe(0);
    expect(state.dist, 'an unpaused head-on lion must have closed real distance').toBeLessThan(4.5);
  });

  test('the wind-pulse hint caption fires once, the first time a freeze triggers, and not again', async ({ page }) => {
    await preSeenHintsAheadOfWindPulse(page);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetLookYaw', 0);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 5, z: 0, state: 'chase' }] });
    await qaHook(page, 'qaSetWindDirection', -1, 0);

    await qaHook(page, 'qaAdvance', 1, true);
    let probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('windPulse');
    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('nearby predators pause their sprint when moving across the wind');

    // Freeze clears -> hint dismisses via the timer-expiry path (same
    // caveImmune/veilOverload precedent) and is marked seen. The static
    // scene here (player never moves, wind never changes) means the freeze
    // itself keeps re-triggering every ~0.3s indefinitely (a known corner
    // case of the trigger having no re-arm cooldown -- flagged, not fixed,
    // in this ticket), but `hintSeen()`'s one-shot latch means that doesn't
    // reshow the caption once it has dismissed once.
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).not.toBe('windPulse');
    expect(probe.seen.windPulse).toBe(true);

    // Advance through another full re-trigger cycle -- an already-seen hint
    // must not reshow.
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    expect((await qaHook(page, 'qaProbeHints')).activeKey, 'an already-seen hint must not retrigger').not.toBe('windPulse');
  });
});
