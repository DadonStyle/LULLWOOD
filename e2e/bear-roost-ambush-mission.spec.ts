// LUL-5456/LUL-5454: Bear Roost Ambush -- 'lionRoostFlush's own composition (LUL-5426),
// with repositionBeaconHunterForMission() (engine/forest-engine.js) extended to reposition a
// bear (predators.find(p => p.kind === 'bear')) instead of a lion for this kind: the
// scent-weighted predator (isScentDetected() call site) anchoring a roost mission for the
// first time, instead of every roost mission defaulting to the lion. canCompleteFlush()
// (lib/game/mission.ts) and the lionRoostFlush completion shape are reused unmodified except
// the kind check. See wiki game/mechanics/bear-roost-ambush and
// decisions/lul-5454-bear-roost-ambush-accepted-2026-09-30.
//
// This spec proves the mission-completion wiring (kind + roostIndex + canCompleteFlush reuse)
// and that repositionBeaconHunterForMission() actually finds and repositions a real bear for
// this kind, not a lion. Non-spatial target (`spatial: false`, same shape as flush), so this
// spec never needs @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of
// fighting the rng.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const BEAR_IDX = 3;   // wolf/bear/lion each claim a fixed 3-slot range (:1848) -- bear is 3-5, see e2e/lion-roost-flush-mission.spec.ts's own LION_IDX

async function grabAThrowable(page: import('@playwright/test').Page) {
  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
  await page.keyboard.press('KeyE');
}

async function throwAtLockedTarget(page: import('@playwright/test').Page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
  await page.mouse.click(640, 360);
}

test.describe('Bear Roost Ambush mission (LUL-5456)', () => {
  test('draws with a repositioned bear near the marked roost and completes via the real roost-throw path', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'bearRoostAmbush', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'bear', x: 0, z: -8, state: 'roam' }],
    });

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('bearRoostAmbush');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    await expect(page.locator('#missionPanel')).toContainText('Bear Roost Ambush');

    const bear = await qaHook(page, 'qaPredatorState', BEAR_IDX);
    expect(bear.kind).toBe('bear');

    // Complete the mission via the real roost-throw path (M6 Flush's own completion channel,
    // canCompleteFlush() -- reused unmodified for this kind).
    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost', 0);
    expect(roost?.i).toBe(0);
    await throwAtLockedTarget(page);
    await qaHook(page, 'qaAdvance', 1);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    expect(completed?.roostIndex).toBe(0);
  });

  test('does not complete when a different (unmarked) roost is flushed by a player throw', async ({ page }) => {
    // Mirrors e2e/lion-roost-flush-mission.spec.ts's own guard test -- canCompleteFlush()'s
    // roostIndex check applies to this kind too, not just 'flush'/'lionRoostFlush'.
    await boot(page, { qaHooks: true, qaMissionKind: 'bearRoostAmbush', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('bearRoostAmbush');
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
