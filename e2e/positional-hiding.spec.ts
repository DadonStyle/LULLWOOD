// LUL-22 / LUL-43: `hidden` stopped being a detection gate and became purely
// the hold-still stance (lower eye height, silence footsteps, show the HUD
// timer). Detection is now `canSee(p, dist)` in engine/forest-engine.js: a
// line-of-sight raycast against cover AABBs (the 8-unit `coverGrid` spatial
// hash, via `hasLOS`/`segRayVsAABB`) combined with an effective detect range
// that shrinks the longer you've held still (`STILL_DETECT_CUT`, capped at
// 0.82 -- it never reaches 1). Two acceptance criteria fall straight out of
// that: standing still in the open next to a predator does NOT save you
// (LOS is clear, so `canSee` stays true regardless of stillness), and
// standing still *behind* real cover does (LOS is blocked, so a chasing
// predator loses its lock and drops into the investigate/sniff cycle instead
// of catching you outright).
//
// Both cases use the dedicated `?qaHooks=1` scaffolding added for this ticket
// (qaOpenHideNearLion / qaHideBehindCover / qaHideBehindCoverKind /
// qaPredatorState -- see the LUL-43 block in engine/forest-engine.js) instead
// of hunting the procedural map for a matching predator/cover pair or waiting
// out the real 30s "force a hunt" trigger. That trigger and the predator's
// approach are both measured in game time, not wall time (the render loop
// clamps dt to 0.05, and this rig's software rendering runs well under 60fps,
// so game time and wall time diverge -- wiki: systems/dt-clamp-vs-walltime);
// the hooks place the predator a few units out and let the real
// approach/catch/investigate code run from there, same trick
// e2e/smoke.spec.ts's predator-death case uses.
//
// LUL-121: species coverage added — wolf, bear, and lion each exercise the
// LOS path independently via qaHideBehindCoverKind(kind). The wolf case
// supercedes the old predators[0] coverage in qaHideBehindCover (which
// happened to be a wolf anyway).
import { test, expect } from '@playwright/test';
import { assertInViewport, boot, enter } from './helpers';

test.describe('positional hiding (LUL-22 / LUL-43)', () => {
  test('hiding in the open near a lion still gets you caught', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    // qaOpenHideNearLion drops the player at the spawn clearing (provably
    // tree- and cover-free -- see the hook's own comment in
    // forest-engine.js) and a hunting lion 4 units out, so there is nothing
    // between them for hasLOS() to trip on. If it returns null there was no
    // lion in this seed's spawn to grab; that is a real setup failure, not a
    // "nothing to test here" -- fail loudly instead of letting a `?.()` chain
    // swallow it into a silent pass.
    const idx = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.() ?? null);
    if (idx === null) {
      throw new Error('qaOpenHideNearLion returned null -- no lion was found in `predators` for this seed');
    }

    // Hold still. This is the whole point of the assertion: `hidden` now only
    // buys eye-height/footstep concealment and a shrunk detect range, capped
    // by STILL_DETECT_CUT at 0.82 of the lion's 48-unit detect -- effective
    // detect never drops below ~8.6, and the lion is 4 units away in the
    // open. Holding still must NOT prevent the catch.
    await page.keyboard.press('KeyH');

    // Real death surface (matches e2e/smoke.spec.ts's predator catch/death
    // case): #deathScreen only mounts once `triggerDeath()` -> pushState
    // flips `deathVisible` (components/Hud.tsx), so waiting for it to become
    // visible is waiting on the actual state machine, not a proxy for it.
    // Polling avoids racing the lion's approach against a guessed wall-clock
    // sleep -- the same dt-clamp-vs-walltime hazard as above applies to how
    // long the close-the-last-1.7-units chase takes to land.
    await expect(page.locator('#deathScreen'), 'the lion should have caught the player in the open').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');

    // qaOpenHideNearLion specifically grabs a lion, so the death surface
    // should name it -- pins the scenario, not just "a death happened".
    await expect(page.locator('#deathKind')).toHaveText('lion');
  });

  // LUL-121: parameterised helper — reused by all three species cover tests.
  // Each species has different detect range, speed, and body radius, so they
  // each exercise distinct branches of the canSee() geometry even though the
  // state-machine path is the same. Bear has rad=1.5 (largest), which is the
  // case most likely to reveal a placement bug (blocked endpoint check).
  async function assertCoverHidesFromSpecies(
    page: import('@playwright/test').Page,
    kind: 'wolf' | 'bear' | 'lion',
  ) {
    await boot(page, { qaHooks: true });
    await enter(page);

    const result = await page.evaluate(
      (k) => window.ForestEngine?.qaHideBehindCoverKind?.(k) ?? null,
      kind,
    );
    if (result === null) {
      throw new Error(
        `qaHideBehindCoverKind('${kind}') returned null -- no non-tree cover prop with a clear path was found`,
      );
    }
    const idx: number = result.idx;

    // Hold still so the investigate→sniff cycle can run without re-escalating
    // (forest-engine.js: re-escalation back to chase is gated on !hidden).
    await page.keyboard.press('KeyH');

    // Transition 1: predator was placed in 'chase' with cover between it and
    // the player. On its next tick canSee() returns false; it flips to
    // 'investigate' and sets sniffsLeft = 1 + rand(0..3).
    await expect
      .poll(
        () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.state ?? null, idx),
        {
          message: `${kind}: predator never left "chase" for "investigate" after LOS was blocked by cover`,
          timeout: 20_000,
        },
      )
      .toBe('investigate');

    const afterTransition = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(afterTransition, 'qaPredatorState went stale between poll and read').not.toBeNull();
    expect(
      afterTransition!.sniffsLeft,
      `${kind}: sniffsLeft (${afterTransition!.sniffsLeft}) should be the 1+rand(0..3) budget set on the chase→investigate transition`,
    ).toBeGreaterThanOrEqual(1);
    expect(afterTransition!.sniffsLeft).toBeLessThanOrEqual(4);

    // Transition 2: predator approaches into sniff range. Proves the cycle
    // actually runs, not just that the flag flipped.
    await expect
      .poll(
        () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.inv ?? null, idx),
        {
          message: `${kind}: predator reached "investigate" but never approached into sniff range/state`,
          timeout: 20_000,
        },
      )
      .toBe('sniff');

    // The player must still be alive -- cover did its job.
    await expect(
      page.locator('#deathScreen'),
      `${kind}: a sniffing predator must not have caught the player`,
    ).toHaveCount(0);
  }

  test('wolf: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'wolf');
  });

  test('bear: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'bear');
  });

  test('lion: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'lion');
  });

  test('hold-still alone does not save you when a predator is on top of you (catch path still works)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // This is the L572-L574 catch path: once a predator has closed to within
    // its radius the `hidden` check gates the kill, not canSee(). Cover is
    // irrelevant at that range. Use qaLurePredatorKind so we can pin the
    // species and assert deathKind.
    await boot(page, { qaHooks: true });
    await enter(page);

    const kind = await page.evaluate(() => window.ForestEngine?.qaLurePredatorKind?.('wolf') ?? null);
    if (kind === null) {
      throw new Error('qaLurePredatorKind("wolf") returned null -- no wolf in predators');
    }

    // Hold still immediately -- cover is NOT between us and the wolf (it was
    // just placed 6 units away in the open). This confirms that the catch
    // path (hidden-gated kill at close range) is still wired up and that
    // cover + stillness together do not create an invincibility exploit.
    await page.keyboard.press('KeyH');

    await expect(page.locator('#deathScreen'), 'wolf should catch the player even while holding still in the open').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');
    await expect(page.locator('#deathKind')).toHaveText('wolf');
  });
});
