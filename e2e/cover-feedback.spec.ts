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
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

test.describe('cover-state feedback (LUL-144)', () => {
  test('a predator with clear line of sight in the open reads as exposed, not covered', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
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
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // qaHideBehindCover puts predators[0] (already in 'chase') and the
    // player on opposite sides of a real, non-tree cover prop.
    const idx = await page.evaluate(() => window.ForestEngine?.qaHideBehindCover?.() ?? null);
    if (idx === null) {
      throw new Error('qaHideBehindCover returned null -- no non-tree cover prop was found for this seed');
    }

    // Deliberately do NOT press H. `hasLOS()` doesn't gate on the crouch
    // flag (forest-engine.js's LUL-43 comment is explicit about this), so
    // the signal must flip purely off standing behind the prop the hook
    // placed the player at -- proving the ticket's actual premise, not just
    // that the signal exists. A generous step budget (250 fixed-dt steps =
    // 5s game time) replaces the old 5s wall-clock poll timeout.
    await qaHook(page, 'qaAdvance', 250);
    const covered = await page.evaluate(() => document.body.dataset.losCovered ?? null);
    expect(covered, 'document.body.dataset.losCovered never flipped to "1" behind real cover').toBe('1');
  });
});
