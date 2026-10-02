// LUL-5673/LUL-5675: regression coverage for the charge-direction avoid-commit
// hijack fix (engine/forest-engine.js:3226, the `!p.charge` guard on the
// avoid-commit override).
//
// Bug shape: startCharge() never touches p.state (engine/forest-engine.js:3029
// only sets p.charge), so a charge beginning mid-chase never actually changes
// the chase state -- the state-change reset at the top of updatePredators()
// (`if (p.state !== p.lastSteerState) { p.commitDir = null; ... }`,
// engine/forest-engine.js:2779) never fires. Before the fix, avoidDir() was
// applied unconditionally to desx/desz whenever speed>0, including the charge
// branch's desx=chargeDirX/chargeDirZ (set once telegraph ends, :2861) -- so a
// leftover commitDir from an ordinary go-around commit picked up moments
// before the charge triggered silently overrode the charge's committed
// straight-line heading, for up to AVOID_COMMIT_TIME/pSpeedScaleMul (1.0s in
// production, 5.0s at qaWorld=micro's speedScaleMul=0.2 -- longer than the
// whole ~1.0s charge window).
//
// This spec reproduces that exact mechanism per the Code Reviewer's PR#969
// (LUL-5675) request: stage a real (non-QA-forced) avoidDir() commit via an
// actual chase encounter with a cover obstacle, trigger a charge on that same
// predator before the commit decays, and assert the charge travels the
// straight line its own chargeDirX/chargeDirZ implies instead of being bent
// by the stale commit.
//
// Wall geometry borrows e2e/predator-steering.spec.ts's 5-trunk-wall shape
// (LUL-2306: s:1.3 trees, 1.6u spacing, 0.69u gap -- impassable for the
// shared moveRad) and its STANDOFF=2.5 (5u total gap) staging distance, but
// rotated 90 degrees (spans z at a fixed x, not x at a fixed z) so the real
// avoid-commit it forces has a z-component: qaTriggerCharge() always drives
// the charge dead straight along x (chargeDirZ=0 always), so any z-axis
// deflection below is an unambiguous signature of the hijack, uncontaminated
// by the charge's own x movement. Small trees (s<=1.4) are never added to
// coverData (engine/forest-engine.js qaBuildScene: `if(!t.culled && t.s >
// 1.4) coverData.push(...)`), and hasLOS() only reads coverGrid/coverData --
// so this wall blocks the predator's movement probe (which reads the raw
// tree `grid`) without blocking canSee(), keeping the chase state alive
// exactly as e2e/predator-steering.spec.ts's own wall test already relies on.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
import { CHARGE_TELL_TIME, CHARGE_RUN_TIME } from '../lib/game/charge';

const FIXED_DT = 1 / 30;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Same STANDOFF=2.5 (5u total gap) e2e/predator-steering.spec.ts uses for its
// own wall-commit staging -- proven safe margin under every species' give-up
// leash (shouldGiveUpChase, dist > effectiveDetect*1.5) at qaWorld=micro's
// detectScaleMul=0.2; see that file's header for the full derivation.
const STANDOFF = 2.5;

test.describe('LUL-5673 charge-direction avoid-commit hijack (regression)', () => {
  // Only `wolf` is covered -- the fix sits in updatePredators()'s shared
  // steering tail with no species-conditional branch between it and the bug,
  // and bear can't charge at all (LUL-213: wolf/lion only), so one charging
  // species exercises the whole fixed code path.
  test('a stale pre-charge avoid-commit does not bend a charge off its straight line', async ({ page }) => {
    test.setTimeout(45_000);
    const errors = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaHour: 12 });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await qaHook(page, 'qaBuildScene', {
      trees: [
        { x: 0, z: -3.2, s: 1.3 },
        { x: 0, z: -1.6, s: 1.3 },
        { x: 0, z: 0, s: 1.3 },
        { x: 0, z: 1.6, s: 1.3 },
        { x: 0, z: 3.2, s: 1.3 },
      ],
      predators: [{ kind: 'wolf', x: STANDOFF, z: 0, state: 'chase' }],
    });
    await qaHook(page, 'qaTeleportTo', -STANDOFF, 0);

    // qaBuildScene sets state:'chase' directly without touching
    // lastSteerState (still 'roam' from spawn), so the very first
    // updatePredators() tick's own state-change check (:2779) fires once,
    // zeroing commitDir/commitT before any real steering runs -- the commit
    // asserted below is provably a fresh product of the wall encounter
    // below, not an incidental leftover from spawn.
    //
    // The wall sits well within avoidDir()'s far-lookahead probe (moveRad
    // 0.6 + 2.4 = 3.0u) from the wolf's very first position (2.5u away), so
    // the commit is set on this same short advance -- no travel time needed.
    await qaHook(page, 'qaAdvance', 2);
    const staged = await qaHook(page, 'qaPredatorState', 0);
    expect(
      staged?.state,
      'wolf left chase before a charge was ever triggered -- canSee() broke, not just the movement probe ' +
        '(small trees are not in coverData, so this should not happen -- see file header)',
    ).toBe('chase');

    // qaTriggerCharge() re-places the only wolf this scene spawned on a
    // fresh due-+x line from the player and starts a charge directly. It
    // never touches p.state (already 'chase', so the state-change reset
    // still does not fire) or commitDir/commitT -- the live commit from the
    // wall encounter above survives straight into the charge, the exact
    // LUL-5673 bug shape.
    const idx = await qaHook(page, 'qaTriggerCharge', 'wolf');
    expect(idx, "qaTriggerCharge('wolf') returned null -- wolf not spawned").not.toBeNull();

    // Telegraph has speed=0 (desx/desz unused there regardless of the fix --
    // see the fix's own comment, engine/forest-engine.js:3217), so it proves
    // nothing either way; advance straight through it into 'charging', where
    // desx/desz become chargeDirX/chargeDirZ (-1, 0) and -- pre-fix -- a live
    // commit would still override them.
    await qaHook(page, 'qaAdvance', stepsFor(CHARGE_TELL_TIME + FIXED_DT));
    const intoCharging = await qaHook(page, 'qaChargePhase', idx);
    expect(intoCharging?.phase, 'charge did not reach the charging phase in time').toBe('charging');

    const start = await qaHook(page, 'qaPredatorState', idx);
    expect(start, `qaPredatorState(${idx}) returned null right as charging began`).not.toBeNull();

    // Sample the trace across the charging sub-phase in small steps.
    // chargeDirZ is exactly 0, so a correct straight-line charge keeps z
    // pinned at its charge-start value; the LUL-5673 bug deflects it toward
    // whatever z-component the stale wall-detour commit picked (a wall
    // spanning z forces a sizeable one -- see file header).
    const Z_DRIFT_TOLERANCE = 0.05;
    const sampleStep = stepsFor(0.08);
    const budget = stepsFor(CHARGE_RUN_TIME) - sampleStep; // stay inside 'charging', don't run into 'overshoot'
    let sampled = 0;
    for (let advanced = 0; advanced < budget; advanced += sampleStep) {
      await qaHook(page, 'qaAdvance', sampleStep);
      const cs = await qaHook(page, 'qaChargePhase', idx);
      if (cs?.phase !== 'charging') break;
      const ps = await qaHook(page, 'qaPredatorState', idx);
      sampled++;
      expect(
        Math.abs(ps.z - start.z),
        `wolf drifted off the charge's straight line: z went from ${start.z} to ${ps.z} mid-charge -- a ` +
          `stale avoid-commit is overriding the charge direction (LUL-5673 regression)`,
      ).toBeLessThan(Z_DRIFT_TOLERANCE);
    }
    expect(sampled, 'charge resolved before any mid-charge sample was taken -- widen the sampling budget').toBeGreaterThan(0);

    expectNoConsoleErrors(errors);
  });
});
