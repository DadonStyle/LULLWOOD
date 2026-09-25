// LUL-5116/LUL-5135: M6 Flush mission -- completes when a player-thrown stone flushes the
// ONE roost this run's mission named at draw time (mission.target.roostIndex, resolved in
// generateMap() right after placeCave(), see docs/specs/lul-5135-flush-mission.md). No world
// target (`spatial: false`, same non-spatial shape as Slack Water), so this spec never needs
// @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of fighting the rng.
//
// The opposing-system tests below are the point of this file, not the happy path alone: the
// pre-existing ambient chase-proximity trigger (updateRoosts()) and the player-thrown path
// both flush roosts through the same flushRoost()/roostCooldown machinery, and only
// canCompleteFlush()'s roostIndex check stops the WRONG roost from completing the mission.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, advanceChunked, VIEW_X, VIEW_Y } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function grabAThrowable(page: Page) {
  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
  await page.keyboard.press('KeyE');
}

async function throwAtLockedTarget(page: Page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
  await page.mouse.click(VIEW_X, VIEW_Y);
}

test.describe('flush mission (LUL-5116)', () => {
  test('completes Flush when the marked roost is flushed by a player throw', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('flush');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    // LUL-5056: the generic #missionPanel is not gated by mission kind -- prove the actual
    // pixel a player sees before the throw.
    await expect(page.locator('#missionPanel')).toContainText('Flush');

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost', 0);
    expect(roost?.i).toBe(0);

    await throwAtLockedTarget(page);

    const after = await qaHook(page, 'qaProbeMission');
    expect(after?.status).toBe('complete');
    expect(after?.roostIndex).toBe(0);
  });

  test('does NOT complete when an unrelated roost is flushed by the ambient chase-proximity trigger', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.roostIndex).toBe(0);

    // Teleport to a DIFFERENT (unmarked) roost, then stage a live wolf chasing near it --
    // updateRoosts() only fires its ambient trigger for a predator in 'chase' state.
    const roost1 = await qaHook(page, 'qaTeleportNearRoost', 1);
    expect(roost1?.i).toBe(1);
    await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 5, 0);
    await qaHook(page, 'qaSetPredatorChasing', 'wolf');

    await advanceChunked(page, stepsFor(2));

    const roost1State = await qaHook(page, 'qaProbeRoostState', 1);
    expect(roost1State.burstActive, 'the ambient chase-proximity path must have actually fired').toBe(true);

    const stillActive = await qaHook(page, 'qaProbeMission');
    expect(stillActive?.status, 'flushing the WRONG roost must not complete the mission').toBe('active');

    // The marked roost still completes normally in the same run -- proves the guard is
    // roost-specific, not a general "any flush already happened" block.
    await grabAThrowable(page);
    const roost0 = await qaHook(page, 'qaTeleportNearRoost', 0);
    expect(roost0?.i).toBe(0);
    await throwAtLockedTarget(page);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
  });

  test('does not complete when a different (unmarked) roost is flushed by a player throw', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.roostIndex).toBe(0);

    await grabAThrowable(page);
    const roost1 = await qaHook(page, 'qaTeleportNearRoost', 1);
    expect(roost1?.i).toBe(1);
    await throwAtLockedTarget(page);

    const roost1State = await qaHook(page, 'qaProbeRoostState', 1);
    expect(roost1State.burstActive, 'the player-thrown flush path must have actually fired').toBe(true);

    const stillActive = await qaHook(page, 'qaProbeMission');
    expect(stillActive?.status, 'flushing the WRONG roost must not complete the mission').toBe('active');
  });
});
