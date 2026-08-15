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
// (qaOpenHideNearLion / qaHideBehindCover / qaPredatorState -- see the LUL-43
// block in engine/forest-engine.js) instead of hunting the procedural map for
// a matching predator/cover pair or waiting out the real 30s "force a hunt"
// trigger. That trigger and the predator's approach are both measured in game
// time, not wall time (the render loop clamps dt to 0.05, and this rig's
// software rendering runs well under 60fps, so game time and wall time
// diverge -- wiki: systems/dt-clamp-vs-walltime); the hooks place the
// predator a few units out and let the real approach/catch/investigate code
// run from there, same trick e2e/smoke.spec.ts's predator-death case uses.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

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

    // qaOpenHideNearLion specifically grabs a lion, so the death surface
    // should name it -- pins the scenario, not just "a death happened".
    await expect(page.locator('#deathKind')).toHaveText('lion');
  });

  test('hiding behind cover makes a chasing predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    // qaHideBehindCover puts predators[0] and the player on opposite sides of
    // a real, non-tree cover prop (log/rock/bramble) with the predator
    // already in 'chase'. Cover props are LOS-blocking only -- not in the
    // movement-collision grid trees use -- so the predator's approach after
    // losing LOS is not at risk of the same stuck/reroute path a straight
    // walk into a tree can hit; what's under test is the state-machine
    // transition, not pathing luck. Null means this seed generated no
    // non-tree cover at all, which would be its own bug (COVER_PROPS=220
    // makes that practically impossible) -- fail loudly rather than pass on
    // an untested scenario.
    const idx = await page.evaluate(() => window.ForestEngine?.qaHideBehindCover?.() ?? null);
    if (idx === null) {
      throw new Error('qaHideBehindCover returned null -- no non-tree cover prop was found for this seed');
    }

    // Hold still. This matters here for a different reason than case 1: the
    // 'investigate' state's own comment in forest-engine.js is explicit that
    // re-escalation back to 'chase' is gated on `hidden` (not `canSee()`,
    // which would flicker true the moment the predator steps past whatever
    // broke LOS). Without holding still the predator would revert to chase
    // on its very next tick and the sniff cycle would never run.
    await page.keyboard.press('KeyH');

    // First transition: LOS is blocked by the cover prop, so the chasing
    // predator's `canSee()` check fails and it drops into 'investigate',
    // picking a sniff budget of 1 + rand(0..3) right on that transition
    // (forest-engine.js: `p.sniffsLeft = 1 + Math.floor(Math.random()*4)`).
    // Poll instead of sleeping: how long the transition takes to land depends
    // on when the predator's next tick happens to fall, which is a frame-timing
    // detail this rig's software rendering makes unpredictable, not something
    // worth pinning to a sleep.
    await expect
      .poll(
        () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.state ?? null, idx),
        {
          message: 'predator never left "chase" for "investigate" after LOS was blocked by cover',
          timeout: 20_000,
        },
      )
      .toBe('investigate');

    const afterTransition = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(afterTransition, 'qaPredatorState went stale between the poll and this read').not.toBeNull();
    expect(
      afterTransition!.sniffsLeft,
      `sniffsLeft (${afterTransition!.sniffsLeft}) should be the 1 + rand(0..3) budget set on the chase->investigate transition`,
    ).toBeGreaterThanOrEqual(1);
    expect(afterTransition!.sniffsLeft).toBeLessThanOrEqual(4);

    // Second transition: the predator actually runs the cycle, not just flags
    // into 'investigate' and stalls. 'approach' walks it up to sniff range
    // (dist < p.rad + 1.7) at 0.45x speed; poll for 'sniff' to prove that
    // walk really happens rather than asserting sniffsLeft alone, which is
    // set at the moment of the first transition and would pass even if the
    // predator never moved another inch.
    await expect
      .poll(
        () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.inv ?? null, idx),
        {
          message: 'predator reached "investigate" but never approached into sniff range/state',
          timeout: 20_000,
        },
      )
      .toBe('sniff');

    // The whole point: the predator backing off into the sniff cycle instead
    // of catching the player. #deathScreen only mounts on triggerDeath(), so
    // its absence here is the real "not killed" surface, not an inference
    // from the state machine being in 'investigate'.
    await expect(
      page.locator('#deathScreen'),
      'a sniffing predator must not have caught the player',
    ).toHaveCount(0);
  });
});
