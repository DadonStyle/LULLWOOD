// LUL-2246: the 30s force-hunt escalation (engine/forest-engine.js's
// `sinceClose > 30` branch) sets `nearP.hunt = true` -- but the `hunt`
// branch's own LOS-loss collapse used to route into `investigate`/`approach`
// the very next tick a force-hunted predator lost sight of the player, which
// is unconditionally true here (the escalation only exists because the
// predator has been beyond detect range for 30s already). `approach`'s speed
// cap (0.45x species speed, lib/game/predator.ts stepApproach()) meant the
// "relentless" escalation could never actually close the distance.
//
// The fix: a live `FORCE_HUNT_LOCK` (engine/tuning.js) scentLock lets the
// hunt-branch collapse route into `chase` instead, reusing the same blind
// pursuit + leash machinery a scent pickup already uses (LUL-23). This spec
// proves the predator actually closes at full species speed post-escalation,
// and that the scentLock leash holds off `shouldGiveUpChase` for its full
// window rather than reverting early.
//
// qaStageForceHuntApproach(kind, dx, dz) (engine/forest-engine.d.ts) places
// the named species dx/dz from the player, parks every other spawned
// predator far out of range so it's guaranteed to be `nearP`, and
// fast-forwards `sinceClose` to 29.9s -- one real tick past this crosses the
// 30s threshold through updatePredators()'s own escalation check, not by
// setting hunt/scentLock directly, so this exercises the real mechanism.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/
// lul-2071-deterministic-qa-clock.md), same shape as e2e/scent.spec.ts, so
// distance-closed-per-game-second assertions aren't at the mercy of this
// rig's software-rendering dt clamp (wiki: systems/dt-clamp-vs-walltime).
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// wolf's real per-tick speed (engine/forest-engine.js:1446): RUN (CONFIG.walk
// * STAMINA_SPRINT_MUL = 6 * 1.8 = 10.8) + CHASE_GAP (28) / budget (6) =
// ~15.47 u/s. Not PSPEC_BASE's static tuning.js literal (8.5) -- that field
// is overwritten at module load by this derived value.
const WOLF_FULL_SPEED = 10.8 + 28 / 6;

test.describe('force-hunt escalation blind-chases at full species speed instead of collapsing to slow approach (LUL-2246)', () => {
  test('escalated hunt losing sight lands in chase, not investigate, and keeps closing distance', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // 90 units due south: beyond the wolf's 42u detect radius (canSee is
    // false the instant the escalation fires, exercising the hunt branch's
    // collapse), far enough that even after 3 more full-speed seconds of
    // closing the wolf still hasn't reached catch range (rad 0.8 +
    // CATCH_MARGIN 1.3 = 2.1u -- a real catch mid-test would freeze
    // updatePredators() output and make the distance-closed assertion moot),
    // and -- checked empirically against this seed's tree layout via
    // qaProbeMapSeed -- a straight run south from spawn that the wolf
    // actually walks at full speed with zero stuckT the whole way. East
    // (dx=70,dz=0) and north (dz=70) both run straight into this seed's
    // treeline within the first game-second and never move again.
    const staged = await qaHook(page, 'qaStageForceHuntApproach', 'wolf', 0, -90);
    expect(staged, 'qaStageForceHuntApproach must find the wolf').not.toBeNull();

    // Crosses the pre-staged 29.9s threshold (~0.1s), clears the spot "alert"
    // freeze spotOnto() arms (SIGHT_TELL_TIME-independent 0.55s rear-up,
    // frozen at speed=0), and runs several ticks of whatever the hunt
    // branch's collapse routes into.
    await qaHook(page, 'qaAdvance', stepsFor(1.0));

    const first = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(first).not.toBeNull();
    expect(
      first.state,
      'a force-hunted wolf that lost sight must land in chase (LUL-2246 fix), not investigate (the pre-fix collapse)',
    ).toBe('chase');

    const GAME_SECONDS = 3;
    await qaHook(page, 'qaAdvance', stepsFor(GAME_SECONDS));

    const second = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(second).not.toBeNull();
    // Tolerate float summation drift in clock.elapsedTime += dt over 150
    // qaAdvance() steps (observed as low as GAME_SECONDS - 4e-14, same class
    // of drift e2e/scent.spec.ts's identical check hits) -- not a real gap.
    expect(second.t - first.t, 'game clock did not advance far enough to sample distance closed').toBeGreaterThanOrEqual(GAME_SECONDS - 1e-6);

    // The headline assertion: blind chase closes at (close to) full species
    // speed, not the 0.45x `approach` sub-phase's cap. Half of full speed is
    // comfortably above the pre-fix ~0.45x rate (would fail this bound) and
    // comfortably below the expected real rate (won't itself flake).
    expect(
      first.dist - second.dist,
      `wolf only closed ${(first.dist - second.dist).toFixed(2)}u over ${GAME_SECONDS}s -- expected at least half of full species speed (${WOLF_FULL_SPEED.toFixed(2)} u/s), consistent with the pre-fix 0.45x approach collapse still being active`,
    ).toBeGreaterThanOrEqual(0.5 * WOLF_FULL_SPEED * GAME_SECONDS);

    expect(second.state, 'must still be chase -- must not have collapsed to investigate mid-window').toBe('chase');
  });

  test('the scentLock leash holds off give-up for its full window (open ground, no LOS-blocking prop)', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const staged = await qaHook(page, 'qaStageForceHuntApproach', 'wolf', 0, -90);
    expect(staged, 'qaStageForceHuntApproach must find the wolf').not.toBeNull();

    await qaHook(page, 'qaAdvance', stepsFor(1.0));
    const armed = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(armed?.state, 'escalation must land in chase before this test samples the leash').toBe('chase');

    // Sample every game-second out to the 20s mark (comfortably inside the
    // 25s FORCE_HUNT_LOCK leash, so shouldGiveUpChase's `scentLock <= 0` half
    // can never be true yet). On open ground the wolf's own full-speed
    // closing can end this early with a real catch -- that's a legitimate
    // "still chasing, never gave up" outcome for this assertion, not a test
    // failure, so sampling stops the moment the player dies.
    const SAMPLE_SECONDS = 1;
    const TOTAL_SECONDS = 20;
    for (let elapsed = 0; elapsed < TOTAL_SECONDS; elapsed += SAMPLE_SECONDS) {
      await qaHook(page, 'qaAdvance', stepsFor(SAMPLE_SECONDS));

      const death = await qaHook(page, 'qaProbeDeath');
      if (death?.dead) break;

      const sample = await qaHook(page, 'qaProbePredatorState', 'wolf');
      expect(
        sample?.state,
        `wolf gave up (state='${sample?.state}') at t~${(elapsed + SAMPLE_SECONDS).toFixed(0)}s while the 25s FORCE_HUNT_LOCK scentLock should still hold`,
      ).toBe('chase');
    }
  });
});
