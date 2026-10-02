// LUL-5781/LUL-5787: per-species scent-lock endurance asymmetry. `SCENT_LOCK_
// ENDURANCE_MULTIPLIER` (engine/tuning.js) is applied at `p.scentLock =
// SCENT_TRACK_TIME` assignment time (every chase-entry site in forest-engine.js,
// including qaSetPredatorChasing itself at :6376 -- the hook mirrors every
// real-play site's own statement, so driving the chase through it exercises the
// same line this spec is verifying) rather than inside tickTimers()'s shared
// decay (lib/game/predator.ts:172-177, also used by chargeCooldown -- out of
// scope per the accepted proposal's own risk call). Bear hounds the trail
// longest (1.4x), lion gives up soonest (0.8x), wolf is the 1.0 baseline.
//
// Both predators are staged well beyond `detect * 1.5` (qaBuildScene, real
// positions, not inert) so `shouldGiveUpChase`'s distance half is already
// satisfied the instant chase begins -- the only thing that can still be
// ticking down is `scentLock` itself, isolating the asymmetry this spec exists
// to prove. The micro world's speedScaleMul (0.2x, LUL-2422) keeps either
// predator from closing a 90u gap inside the sampling window (same shape as
// e2e/force-hunt-closes.spec.ts's identical 90u staging).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('scent-lock endurance asymmetry (LUL-5781)', () => {
  test('bear scent-lock persists longer than lion at fixed distance', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const built = await qaHook(page, 'qaBuildScene', {
      predators: [
        { kind: 'bear', x: 0, z: -90 },
        { kind: 'lion', x: 90, z: 0 },
      ],
    });
    expect(built?.predators).toBeGreaterThanOrEqual(2);

    const bearStaged = await qaHook(page, 'qaSetPredatorChasing', 'bear');
    const lionStaged = await qaHook(page, 'qaSetPredatorChasing', 'lion');
    expect(bearStaged, 'qaSetPredatorChasing must find the bear').not.toBeNull();
    expect(lionStaged, 'qaSetPredatorChasing must find the lion').not.toBeNull();

    const bear = await qaHook(page, 'qaProbePredatorState', 'bear');
    const lion = await qaHook(page, 'qaProbePredatorState', 'lion');

    // SCENT_TRACK_TIME (lib/game/scent.ts) is 8s. bear: 8*1.4=11.2, lion: 8*0.8=6.4.
    expect(bear?.scentLock).toBeCloseTo(8 * 1.4, 5);
    expect(lion?.scentLock).toBeCloseTo(8 * 0.8, 5);
    expect(
      bear.scentLock / lion.scentLock,
      'bear scent-lock must outlast lion scent-lock by the 1.4/0.8 species ratio',
    ).toBeCloseTo(1.4 / 0.8, 5);
  });

  test('lion scent-lock expires sooner than bear when downwind', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const built = await qaHook(page, 'qaBuildScene', {
      predators: [
        { kind: 'bear', x: 0, z: -90 },
        { kind: 'lion', x: 90, z: 0 },
      ],
    });
    expect(built?.predators).toBeGreaterThanOrEqual(2);

    await qaHook(page, 'qaSetPredatorChasing', 'bear');
    await qaHook(page, 'qaSetPredatorChasing', 'lion');

    const bearStart = await qaHook(page, 'qaProbePredatorState', 'bear');
    const lionStart = await qaHook(page, 'qaProbePredatorState', 'lion');
    expect(bearStart?.state).toBe('chase');
    expect(lionStart?.state).toBe('chase');

    // Confirm both distances are already past their own give-up distance gate
    // (shouldGiveUpChase: scentLock<=0 && dist > detect*1.5) before any time
    // passes, so the only remaining variable for either species is the
    // scentLock countdown this spec is asserting on.
    const bearDetect = await qaHook(page, 'qaProbeEffectiveDetect', 'bear');
    const lionDetect = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');
    expect(bearStart.dist).toBeGreaterThan(bearDetect * 1.5);
    expect(lionStart.dist).toBeGreaterThan(lionDetect * 1.5);

    // 7s: past the lion's 6.4s lock but well inside the bear's 11.2s lock.
    await qaHook(page, 'qaAdvance', stepsFor(7));

    const bearAfter = await qaHook(page, 'qaProbePredatorState', 'bear');
    const lionAfter = await qaHook(page, 'qaProbePredatorState', 'lion');

    expect(
      lionAfter.state,
      `lion should have given up the chase by t~7s (0.8x lock = 6.4s) but is still '${lionAfter.state}'`,
    ).not.toBe('chase');
    expect(
      bearAfter.state,
      `bear should still be chasing at t~7s (1.4x lock = 11.2s) but is '${bearAfter.state}'`,
    ).toBe('chase');
  });
});
