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
//
// LUL-2667 (child 5/6, 2026-09-22): migrated off @fullmap. qaStageBehindTree's
// own tree search and neighbour-isolation math (engine/forest-engine.js:5325-
// 5361) are unchanged and don't care how treeData was populated -- a
// qaBuildScene single-tree scene satisfies the isolation check trivially (no
// second tree exists to crowd the lane).
//
// LUL-5046: the rest of this file used to trace via qaStageAndTraceBehindTree,
// which drives the real requestAnimationFrame loop and budgets *wall-clock*
// time (MAX_MS, measured with performance.now()) for the predator to reach
// the player. That looked solid on an idle rig (4x margin over a ~2s
// measurement) but broke on CI's actual 4-core runner and on
// `taskset -c 0-3` locally: wolf/lion (bear happened not to trip it) would
// still be short of contact range with dist *larger* than the staged
// distance when the 8s budget ran out.
//
// Root-caused live (not guessed): staged this way, the predator's committed
// avoidance angle (pickCommittedAvoidDirection, lib/game/steer.ts,
// AVOID_COMMIT_TIME=1.0 *simulated* second) genuinely swings it 2x+ further
// from the player than the staged distance before it curves back in and
// closes -- confirmed with qaSetFixedStep(0.05)+qaStageAndTraceBehindTreeFixed
// below, at full real-time speed too. That's normal, correct steering around
// a trunk at wolf/lion's 8.5-9.2 speed, not a regression. What changes under
// CPU load is only how much *wall-clock* time that fixed amount of
// *simulated* time costs: every frame's dt is clamped to
// DT_CLAMP_CEILING=0.05s (lib/game/scent.ts) so a stall can't teleport a
// predator through a wall, so once real per-frame time regularly exceeds
// 50ms (a loaded 4-core runner, a low-end player machine), simulated time
// falls behind wall-clock time in direct proportion -- the whole simulation
// runs in slow motion relative to performance.now(), and the same ~2.2-2.4s
// arc that comfortably beat an 8s wall-clock budget on an idle box can blow
// straight through it on a contended one, with nothing in the underlying
// physics actually wrong (wiki: systems/dt-clamp-vs-walltime).
//
// Fix: trace in *simulated* time instead of wall-clock time. qaSetFixedStep
// + qaStageAndTraceBehindTreeFixed (engine/forest-engine.js) drive the exact
// same stepFrame() the real loop calls, but through qaAdvance's own
// mechanism (fixed dt, no requestAnimationFrame) -- the trace this produces
// depends only on simulated steps, never on how fast the host machine can
// render them. Same LUL-2107/LUL-2838 pattern already used to de-flake
// other GPU/CPU-timing-sensitive specs (wind-assisted-evasion.spec.ts,
// action-prompt.spec.ts).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

// Extra clearance beyond (tree trunk radius + predator collision radius) on
// each side -- just enough that qaStageBehindTree's own qualifying check
// (predatorBlocked()/blocked() on the two endpoints) reliably finds a clear
// spot without the actor's collision circle already overlapping the trunk.
const MARGIN = 1.0;

// DT_CLAMP_CEILING (lib/game/scent.ts) -- the coarsest dt the real game ever
// legally runs a frame at (every larger raw delta gets clamped down to this).
// Driving the trace at exactly this step size, rather than a smoother
// 60fps-equivalent dt, exercises the worst-case-but-still-legal frame
// granularity a real contended machine converges on, which is exactly the
// condition LUL-5046 needs coverage for.
const FIXED_DT = 0.05;

// Measured live (LUL-5046) with qaSetFixedStep(FIXED_DT) +
// qaStageAndTraceBehindTreeFixed against this seed's synthetic scene: every
// species reaches contact range within 46-48 steps (~2.3-2.4s of simulated
// time), including the full avoid-arc swing described above. 200 steps
// (10s simulated) is better than 4x margin over that -- same margin
// philosophy the old wall-clock MAX_MS used, just measured in simulated
// steps instead of real milliseconds, so CPU load can no longer eat into it.
const MAX_STEPS = 200;

test.describe('predator behind a tree reaches the player (LUL-1091 regression, qaWorld=micro)', () => {
  for (const kind of ['wolf', 'bear', 'lion'] as const) {
    test(`${kind}: staged directly behind a tree trunk, closes to contact range`, async ({ page }) => {
      await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (helpers.ts)
      await enter(page);

      const built = await page.evaluate(
        ({ k }) => window.ForestEngine?.qaBuildScene?.({ trees: [{ x: 10, z: 0 }], predators: [{ kind: k, x: 0, z: 0 }] }),
        { k: kind },
      );
      expect(built).toEqual({ trees: 1, props: 0, predators: 1 });

      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      const result = await qaHook(page, 'qaStageAndTraceBehindTreeFixed', kind, MARGIN, MAX_STEPS);
      if (result === null) {
        throw new Error(
          `qaStageAndTraceBehindTreeFixed('${kind}') returned null -- no tree in this seed left both staged points clear of every obstacle and neighbour-isolated`,
        );
      }
      const { dist: stagedDist, trace } = result;
      expect(trace.length, 'qaStageAndTraceBehindTreeFixed recorded zero steps').toBeGreaterThan(0);
      expect(
        trace[0]!.dist,
        `staged scenario started already inside contact range (dist=${trace[0]!.dist.toFixed(2)}, staged=${stagedDist.toFixed(2)}) -- it never actually had to path around the tree`,
      ).toBeGreaterThan(stagedDist * 0.9);

      const last = trace[trace.length - 1]!;
      console.log('TRACE_DEBUG', JSON.stringify({ kind, stagedDist, n: trace.length, first: trace[0], last }));
      expect(
        last.reached,
        `${kind} never reached the player within ${MAX_STEPS} steps (${(MAX_STEPS * FIXED_DT).toFixed(1)}s simulated) -- stopped at dist=${last.dist.toFixed(2)}, state=${last.state} ` +
          `(pre-LUL-1091 behaviour: grinds into the trunk and never arrives)`,
      ).toBe(true);
    });
  }
});
