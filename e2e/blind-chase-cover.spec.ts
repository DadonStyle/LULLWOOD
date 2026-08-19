// LUL-388: an e2e-level regression for LUL-387 ("chase's blind-scent branch
// could kill through cover"). LUL-387 itself only landed a unit test on the
// extracted pure function (`canCatchInChase` in lib/game/predator.test.ts) --
// real, and it does prove the decision function is correct in isolation, but
// nothing at the engine level proves `updatePredators()`'s 'chase' branch
// actually calls that function with the right arguments on every tick, for a
// real predator, against a real cover prop's rotated AABB. That's the gap
// this spec closes.
//
// Why not reuse qaHideBehindCover(Kind): that hook places predator and player
// several units apart -- clear of the cover prop entirely -- which is exactly
// right for e2e/positional-hiding.spec.ts's investigate/sniff coverage, but
// never reaches isCaught()'s `dist < rad+CATCH_MARGIN` threshold, so it can't
// exercise the kill check at all. qaStageAndTraceBlindChase (added with this
// spec) instead places both points close together, straddling only the cover
// prop's thinner local axis, so the prop still fully blocks canSee() while
// the raw distance sits inside catch range -- the precise shape of the
// LUL-387 bug (predators never physically collide with cover, LUL-119/211, so
// closing to catch range while blind is completely reachable).
//
// Two things had to be true before this spec could actually mean anything,
// both measured live while building it, both documented on the hooks
// themselves in engine/forest-engine.d.ts:
//   1. Isolation -- the player gets relocated to wherever the chosen cover
//      prop happens to be, which can land inside a *different*, untouched
//      predator's own detect range (nine animals roam independently, and
//      #deathKind only reports species). First version of this hook caught a
//      false regression this way. qaStageAndTraceBlindChase now marks every
//      other predator `inert` before returning.
//   2. No IPC round trip between staging and the first observed frame -- the
//      staged gap is necessarily small (has to land inside catch range), and
//      since predators never collide with cover they close it, into a
//      genuine sightline, in fewer frames than one page.evaluate() round trip
//      takes. Staging and tracing used to be two separate hooks; every case
//      "failed" with canSee already true on the trace's very first frame,
//      even with the LUL-387 fix fully intact. qaStageAndTraceBlindChase
//      stages and starts its rAF trace loop in one synchronous call instead.
//
// Confirmed this spec actually asserts something (LUL-388's "fail once on
// purpose" rule): temporarily reverted engine/forest-engine.js's chase kill
// check from `canCatchInChase(canSee(p,dist), dist, p.rad)` back to bare
// `isCaught(dist, p.rad)` (pre-LUL-387 `main` behaviour) and every case below
// failed, with `dead: true` on the trace's very first frame while `canSee`
// was still `false`. Restored before committing -- see the PR description
// for the transcript.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('blind scent-chase cannot kill through cover (LUL-387 regression)', () => {
  for (const kind of ['wolf', 'bear', 'lion'] as const) {
    test(`${kind}: mid blind chase, blocked by cover at catch range, does not kill while blind`, async ({ page }) => {
      test.setTimeout(30_000);
      await boot(page, { qaHooks: true });
      await enter(page);

      // Deliberately never press H over the course of this test. The chase
      // branch's kill check (canCatchInChase) is gated on canSee(), not on
      // `hidden` -- proving the raw mechanism, not the crouch stance, is what
      // protects the player.
      const result = await page.evaluate(
        ({ k, maxMs }) => window.ForestEngine?.qaStageAndTraceBlindChase?.(k, maxMs) ?? null,
        { k: kind, maxMs: 4_000 },
      );
      if (result === null) {
        throw new Error(
          `qaStageAndTraceBlindChase('${kind}') returned null -- no cover prop in this seed was thin enough to fit inside ${kind}'s catch range`,
        );
      }
      const { trace } = result;
      expect(trace.length, 'qaStageAndTraceBlindChase recorded zero frames').toBeGreaterThan(0);
      expect(
        trace[0]!.canSee,
        `staged scenario started with a clear sightline (dist=${trace[0]!.dist.toFixed(2)}) -- it never actually exercised the blind branch`,
      ).toBe(false);

      let sawBlindTick = false;
      for (const sample of trace) {
        if (sample.canSee) break; // genuine sightline gained; further frames are a legitimate catch, out of scope
        sawBlindTick = true;
        expect(
          sample.dead,
          `${kind} was dead at t=${sample.t.toFixed(0)}ms while canSee was still false (dist=${sample.dist.toFixed(2)}) -- the LUL-387 regression is back`,
        ).toBe(false);
      }
      expect(sawBlindTick, 'no frame in the trace had canSee=false -- this run proved nothing').toBe(true);
    });
  }
});
