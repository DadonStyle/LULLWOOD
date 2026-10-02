// LUL-5426: M8 Lion Roost Flush mission -- 'beaconRoostFlush's own composition (LUL-5160),
// with repositionBeaconHunterForMission() (engine/forest-engine.js) extended to reposition a
// lion (predators.find(p => p.kind === 'lion')) instead of the Beacon Hunter wolf for this
// kind: a mid-difficulty balanced-stat predator between the sight-biased Beacon Hunter and an
// ambient roost's no predator at all. canCompleteFlush() (lib/game/mission.ts) and the
// beaconRoostFlush completion shape are reused unmodified except the kind check. See wiki
// game/mechanics/lion-roost-flush-mission and decisions/lul-5424-lul-5426-3proposals-accepted-2026-09-30.
//
// Unlike M7's beaconHunter, the lion staged here is a regular predator using the normal
// sight/scent detection loop, not the beaconHunter variant's independent beacon-lock channel
// -- this spec proves the mission-completion wiring (kind + roostIndex + canCompleteFlush
// reuse) and that repositionBeaconHunterForMission() actually finds and repositions a real
// lion for this kind, not the beacon-lock mechanic, which does not apply to a plain lion.
// Non-spatial target (`spatial: false`, same shape as flush), so this spec never needs
// @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of fighting the rng.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const LION_IDX = 6;   // wolf/bear/lion each claim a fixed 3-slot range (:1835) -- lion is 6-8, see e2e/wind-pulse.spec.ts's own LION_IDX
const FIXED_DT = 0.5;   // same shape as e2e/bear-roost-ambush-mission.spec.ts

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

test.describe('Lion Roost Flush mission (LUL-5426)', () => {
  test('draws with a repositioned lion near the marked roost and completes via the real roost-throw path', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'lionRoostFlush', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'lion', x: 0, z: -8, state: 'roam' }],
    });

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('lionRoostFlush');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    await expect(page.locator('#missionPanel')).toContainText('Lion Roost Flush');

    const lion = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(lion.kind).toBe('lion');

    // LUL-5644/LUL-5646: qaAdvance() requires qaSetFixedStep() to have run first (engine/
    // forest-engine.js throws otherwise) -- this file never called it, so the qaAdvance()
    // below could never have passed.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

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
    // Mirrors e2e/beacon-roost-flush-mission.spec.ts's own guard test -- canCompleteFlush()'s
    // roostIndex check applies to this kind too, not just 'flush'/'beaconRoostFlush'.
    await boot(page, { qaHooks: true, qaMissionKind: 'lionRoostFlush', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('lionRoostFlush');
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
