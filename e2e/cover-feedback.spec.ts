// LUL-144: `canSee()` (LUL-22/LUL-43's LOS raycast against cover, see the
// block above it in engine/forest-engine.js) never depended on `hidden` --
// walking behind a rock breaks a predator's line of sight exactly as well as
// crouching behind one -- but nothing on screen ever reflected that. This
// spec asserts the new signal directly: `document.body.dataset.losCovered`,
// set every tick from the same in-range + hasLOS() test canSee() itself
// uses (engine/forest-engine.js, the "cover-state feedback" block in tick()).
//
// Reuses the exact two deterministic setups e2e/positional-hiding.spec.ts
// already relies on for the same reason that spec does: hunting the
// procedural map for a matching predator/cover pair, or waiting out the real
// 30s "force a hunt" trigger, would make this flaky for no reason -- the
// `?qaHooks=1` scaffolding places the scenario directly.
//
// LUL-2107: rewritten to drive time via qaSetFixedStep/qaAdvance
// (docs/specs/lul-2071-deterministic-qa-clock.md) instead of
// page.waitForTimeout/expect.poll against the real RAF loop -- those only
// worked because swiftshader's dt clamp made real ticks a de facto fixed
// cadence (wiki systems/e2e-post-gpu-nondeterminism); real GPU rendering
// (LUL-1910) removed that accident. A fixed step advance is exact regardless
// of rig speed.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

// LUL-2734: qaAdvance() drives the browser's `stepFrame()` loop synchronously
// inside a single `page.evaluate()` call -- if the rig is contended enough
// that 250 real ticks of predator AI/collision/hint-scan work takes long
// enough to trip Playwright's 30s test timeout, the failure is a bare "Test
// timeout of 30000ms exceeded" with no way to tell whether the predator was
// ever actually staged, moving, or already unblocked at the point things
// slowed down (LUL-2611 ask #2, still unmet before this). Splitting the
// advance into chunks and racing each one against its own budget doesn't
// change the simulation at all (same total fixed-dt steps, same order) --
// it only gives a hang or a genuine miss a specific chunk and a real
// `qaPredatorState()` snapshot to fail with, whether that miss is a slow
// rig or an actual regression in the cover-block logic.
const ADVANCE_CHUNK = 25;
const ADVANCE_CHUNK_TIMEOUT_MS = 6000;

async function advanceWithDiagnostics(page: Page, predatorIdx: number, totalSteps: number) {
  let lastState: unknown = null;
  for (let done = 0; done < totalSteps; done += ADVANCE_CHUNK) {
    const steps = Math.min(ADVANCE_CHUNK, totalSteps - done);
    await Promise.race([
      qaHook(page, 'qaAdvance', steps),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `qaAdvance(${steps}) did not return within ${ADVANCE_CHUNK_TIMEOUT_MS}ms ` +
                  `(${done}/${totalSteps} fixed-dt steps already advanced) -- last known ` +
                  `predator state: ${JSON.stringify(lastState)}`,
              ),
            ),
          ADVANCE_CHUNK_TIMEOUT_MS,
        ),
      ),
    ]);
    lastState = await qaHook(page, 'qaPredatorState', predatorIdx);
  }
  return lastState;
}

test.describe('cover-state feedback (LUL-144)', () => {
  test('a predator with clear line of sight in the open reads as exposed, not covered', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // qaOpenHideNearLion drops the player in the spawn clearing (provably
    // tree- and cover-free) with a hunting lion 4 units out and nothing
    // between them -- see that hook's own comment in forest-engine.js.
    const idx = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.() ?? null);
    if (idx === null) {
      throw new Error('qaOpenHideNearLion returned null -- no lion was found in `predators` for this seed');
    }

    // A couple of fixed-dt steps for the tick loop's cover-feedback scan to
    // run before the lion's bee-line catches the player and ends the round.
    await qaHook(page, 'qaAdvance', 5);
    const covered = await page.evaluate(() => document.body.dataset.losCovered ?? null);
    expect(covered, 'LOS is clear in the spawn clearing -- the signal must not read "covered"').toBe('0');
  });

  test('a chasing predator blocked by real cover reads as covered, with no H press needed', async ({ page }) => {
    // 250 steps / ADVANCE_CHUNK(25) = 10 chunks, each individually allowed up
    // to ADVANCE_CHUNK_TIMEOUT_MS(6000) before the per-chunk diagnostic trips
    // -- worst-case healthy total is 10*6000=60000ms before qaPredatorState
    // overhead/boot. A 30_000ms test-level timeout is under half that, so on
    // a rig slow enough to need the diagnostic at all, Playwright's own test
    // timeout won the race every time (nightly 2026-09-16 0745 run, HEAD
    // 569bc47e: both retries died with the generic "Test timeout of 30000ms
    // exceeded" pointing at qaHook's page.evaluate, never our chunk error --
    // the per-chunk diagnostic added by LUL-2734/PR#672 never got a chance to
    // fire). Matching this to the real worst case, with margin, actually lets
    // the diagnostic do its job instead of being pre-empted by the outer cap.
    test.setTimeout(75_000);
    // LUL-2611: `boot()` already defaults to `qaWorld: 'micro'` (LUL-2377) --
    // the LUL-2329 migration-spec comment this used to carry ("left on the
    // full map") was stale; this test has been running on the micro world
    // since that default landed. The real, root-caused-live failure was an
    // isolation gap in `qaHideBehindCover()` itself (it only ever placed
    // `predators[0]`, leaving every other predator live to wander into LOS
    // and flip `exposedNow=true`), not a map-size issue -- fixed by parking
    // every other predator inert in the hook.
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // qaHideBehindCover puts predators[0] (already in 'chase') and the
    // player on opposite sides of a real, non-tree cover prop, and parks
    // every other predator inert so it can't contribute a false "exposed".
    const idx = await page.evaluate(() => window.ForestEngine?.qaHideBehindCover?.() ?? null);
    if (idx === null) {
      throw new Error('qaHideBehindCover returned null -- no non-tree cover prop was found for this seed');
    }

    // Deliberately do NOT press H. `hasLOS()` doesn't gate on the crouch
    // flag (forest-engine.js's LUL-43 comment is explicit about this), so
    // the signal must flip purely off standing behind the prop the hook
    // placed the player at -- proving the ticket's actual premise, not just
    // that the signal exists. A generous step budget (250 fixed-dt steps =
    // 5s game time) replaces the old 5s wall-clock poll timeout. Chunked via
    // advanceWithDiagnostics (LUL-2734) so a hang or a genuine miss reports
    // the predator's actual state instead of a bare Playwright timeout.
    const finalState = await advanceWithDiagnostics(page, idx, 250);
    const covered = await page.evaluate(() => document.body.dataset.losCovered ?? null);
    expect(
      covered,
      `document.body.dataset.losCovered never flipped to "1" behind real cover -- ` +
        `final predator state: ${JSON.stringify(finalState)}`,
    ).toBe('1');
  });
});
