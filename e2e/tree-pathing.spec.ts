// LUL-1461: e2e regression carved out of LUL-1091's own "Done when" (PR #251,
// "predators path around trees instead of grinding into them"). PR #251
// shipped unit coverage for the two pure functions it changed
// (pickAvoidDirection()/slideVelocity() in lib/game/cover.test.ts, 94/94
// green) but explicitly deferred this spec: "no browser in this environment
// to verify a Playwright spec I write actually passes." This is that spec --
// the integrated behaviour those unit tests can't reach, because
// updatePredators() calling pickAvoidDirection() correctly every tick against
// a real tree from the live spatial grid is exactly what was untested.
//
// Why not qaLurePredator(Kind) (LUL-1461's own ticket text calls this out):
// that hook's `hunt` flag requires canSee() to keep chasing at all -- staged
// behind a tree, canSee() is false on the very first tick, so `hunt` would
// drop straight to `investigate` before ever exercising the pathing code.
// qaStageAndTraceBehindTree instead uses `chase` + a live scentLock, which
// keeps closing blind while scentLock holds (LUL-23's contract) -- the same
// mechanism e2e/blind-chase-cover.spec.ts already relies on for the same
// reason.
//
// Note on LUL-1597: the stuck-recovery threshold LUL-1091 also touched (3s ->
// 0.8s) was reverted back to 3s for predator-determinism reasons; only the
// pathing improvements this spec covers (pickAvoidDirection's near+far probe,
// least-blocked fallback, and slideVelocity) were retained. A predator that
// never gets stuck long enough to hit that fallback at all is the common
// case and exactly what this spec drives.
//
// MARGIN, MAX_MS and the whole "hug the trunk tightly" shape below were all
// found by actually measuring, not guessed -- see the "Confirmed this spec
// actually asserts something" note further down. An earlier version of this
// spec used a fixed STANDOFF=6 (12 units of open ground between predator and
// player, straddling one tree). Measured live: wolf and lion reached in
// ~7-8s, but bear never reached the player at all within 12s -- ON ALREADY-
// FIXED `release/next` code. The 12-unit gap routinely contained a second or
// third tree the staging hook never checked for (it only validated the two
// endpoints, not the path between them), so the trace was measuring open-
// field multi-obstacle navigation, not the single-trunk case LUL-1091 fixed.
// qaStageBehindTree now derives the standoff per-tree (trunk radius + the
// predator's own collision radius + `margin`) instead of taking a fixed
// distance, and rejects any tree with a neighbour close enough to crowd the
// direct line or a reasonable sidestep -- keeping the scenario to exactly
// one obstacle, close enough that the total gap for every species stays
// under 4 units.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

// Extra clearance beyond (tree trunk radius + predator collision radius) on
// each side -- just enough that qaStageBehindTree's own qualifying check
// (predatorBlocked()/blocked() on the two endpoints) reliably finds a clear
// spot without the actor's collision circle already overlapping the trunk.
const MARGIN = 1.0;

// Measured baseline (see PR description) with the tight, neighbour-isolated
// staging above: on this seed, every species reaches contact range in well
// under 2s of trace time once it has to go around the tree instead of
// through it. 8s gives better than 4x margin over that measurement -- enough
// to absorb CI's slower, more jittery frame timing (wiki:
// systems/dt-clamp-vs-walltime) without masking a real regression, since the
// pre-fix behaviour here isn't "a little slower", it's "never arrives"
// (grinds into the trunk indefinitely, confirmed below).
const MAX_MS = 8_000;

test.describe('predator behind a tree reaches the player (LUL-1091 regression) @fullmap', () => {
  for (const kind of ['wolf', 'bear', 'lion'] as const) {
    test(`${kind}: staged directly behind a tree trunk, closes to contact range`, async ({ page }) => {
      // Deliberately no explicit test.setTimeout() override here -- the trace
      // itself resolves in ~2s (MAX_MS above), but a real triggerDeath() plus
      // Playwright's own trace-capture teardown measured ~57.5s wall-clock on
      // this rig's swiftshader software rendering (LUL-1461, 2026-09-09). An
      // earlier version of this spec set test.setTimeout(60_000), which is
      // *tighter* than playwright.config.ts's own already-tuned defaults
      // (90s locally, 240s on CI) and was the actual cause of every prior
      // "Test timeout exceeded" failure here -- the in-page trace and the
      // real death sequence were both completing fine; only the explicit
      // override was too tight. Rely on the config defaults instead.
      await boot(page, { qaHooks: true });
      await enter(page);

      const result = await page.evaluate(
        ({ k, margin, maxMs }) => window.ForestEngine?.qaStageAndTraceBehindTree?.(k, margin, maxMs) ?? null,
        { k: kind, margin: MARGIN, maxMs: MAX_MS },
      );
      if (result === null) {
        throw new Error(
          `qaStageAndTraceBehindTree('${kind}') returned null -- no tree in this seed left both staged points clear of every obstacle and neighbour-isolated`,
        );
      }
      const { dist: stagedDist, trace } = result;
      expect(trace.length, 'qaStageAndTraceBehindTree recorded zero frames').toBeGreaterThan(0);
      expect(
        trace[0]!.dist,
        `staged scenario started already inside contact range (dist=${trace[0]!.dist.toFixed(2)}, staged=${stagedDist.toFixed(2)}) -- it never actually had to path around the tree`,
      ).toBeGreaterThan(stagedDist * 0.9);

      const last = trace[trace.length - 1]!;
      console.log('TRACE_DEBUG', JSON.stringify({ kind, stagedDist, n: trace.length, first: trace[0], last }));
      expect(
        last.reached,
        `${kind} never reached the player within ${MAX_MS}ms -- stopped at dist=${last.dist.toFixed(2)}, state=${last.state} ` +
          `(pre-LUL-1091 behaviour: grinds into the trunk and never arrives)`,
      ).toBe(true);
    });
  }
});
