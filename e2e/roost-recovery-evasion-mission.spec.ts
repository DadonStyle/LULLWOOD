// LUL-5447/LUL-5446: Roost Recovery Evasion -- 'lionRoostFlush's own composition (LUL-5426)
// verbatim: same non-spatial roost-target shape as 'flush'/'beaconRoostFlush'/'lionRoostFlush',
// same repositionBeaconHunterForMission() lion repositioning as 'lionRoostFlush'. The one
// difference: this mission does NOT complete via canCompleteFlush() on a fresh roost-throw --
// it completes automatically when `roostCooldown[roostIndex]` (the timer a lion-present flush
// just started) reaches 0 while the mission is active (engine/forest-engine.js's updateRoosts()
// cooldown-decrement branch). See wiki game/mechanics/roost-recovery-evasion.
//
// Non-spatial target (`spatial: false`, same shape as flush), so this spec never needs
// @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of fighting the rng, and
// qaBuildScene stages a real lion (not a QA-hook force-set) so the flush + reposition + cooldown
// wiring all run through real engine code.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const LION_IDX = 6;   // wolf/bear/lion each claim a fixed 3-slot range (:1835) -- lion is 6-8, see e2e/wind-pulse.spec.ts's own LION_IDX
const FIXED_DT = 0.5;

async function grabAThrowable(page: Page) {
  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
  await page.keyboard.press('KeyE');
}

async function throwAtLockedTarget(page: Page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
  await page.mouse.click(640, 360);
}

test.describe('Roost Recovery Evasion mission (LUL-5447/LUL-5446)', () => {
  test('spawns with a repositioned lion after a lion-present flush and completes when the roost cooldown expires', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'roostRecoveryEvasion', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'lion', x: 0, z: -8, state: 'roam' }],
    });

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('roostRecoveryEvasion');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    await expect(page.locator('#missionPanel')).toContainText('Roost Recovery Evasion');

    // repositionBeaconHunterForMission() (engine/forest-engine.js) should have placed the lion
    // ~50u from ROOSTS[0]'s anchor, same math 'lionRoostFlush' already exercises.
    const lion = await qaHook(page, 'qaPredatorState', LION_IDX);
    expect(lion.kind).toBe('lion');
    const roostAnchor = await qaHook(page, 'qaTeleportNearRoost', 0);
    const distFromRoost = Math.hypot(lion.x - roostAnchor.x, lion.z - roostAnchor.z);
    expect(distFromRoost, 'the repositioned lion should land close to the documented ~50u radius').toBeGreaterThan(30);
    expect(distFromRoost).toBeLessThan(70);

    // Flush the marked roost via the real player-throw path -- this is what starts
    // roostCooldown[0] counting down and fires the mission's caption (flushRoost()).
    await grabAThrowable(page);
    const roostForThrow = await qaHook(page, 'qaTeleportNearRoost', 0);
    expect(roostForThrow?.i).toBe(0);
    await throwAtLockedTarget(page);
    await qaHook(page, 'qaAdvance', 1);

    const flushed = await qaHook(page, 'qaProbeRoostState', 0);
    expect(flushed.burstActive, 'the player-thrown flush path must have actually fired').toBe(true);
    expect(flushed.cooldown).toBeGreaterThan(0);

    const stillActive = await qaHook(page, 'qaProbeMission');
    expect(stillActive?.status, 'the mission must still be active while the cooldown is counting down').toBe('active');

    // Drive simulated time forward until the cooldown fully expires -- the mission should
    // auto-complete the instant roostCooldown[0] reaches 0, with no further player input.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    let cooldown = flushed.cooldown;
    let guard = 0;
    while (cooldown > 0 && guard < 500) {
      await qaHook(page, 'qaAdvance', 1);
      const probe = await qaHook(page, 'qaProbeRoostState', 0);
      cooldown = probe.cooldown;
      guard++;
    }
    expect(cooldown, 'the cooldown loop above must have actually reached 0, not just timed out').toBeLessThanOrEqual(0);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    expect(completed?.roostIndex).toBe(0);
  });

  test('does not spawn a repositioned lion or mission progress for an unmarked roost', async ({ page }) => {
    // Mirrors the other roost-mission specs' own guard test: flushing a DIFFERENT roost must
    // not touch this mission's completion state (it never calls canCompleteFlush() at all, but
    // this proves the cooldown-completion branch is scoped to the marked roostIndex only).
    await boot(page, { qaHooks: true, qaMissionKind: 'roostRecoveryEvasion', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('roostRecoveryEvasion');
    expect(mission?.roostIndex).toBe(0);

    await grabAThrowable(page);
    const roost1 = await qaHook(page, 'qaTeleportNearRoost', 1);
    expect(roost1?.i).toBe(1);
    await throwAtLockedTarget(page);
    await qaHook(page, 'qaAdvance', 1);

    const roost1State = await qaHook(page, 'qaProbeRoostState', 1);
    expect(roost1State.burstActive, 'the player-thrown flush path must have actually fired').toBe(true);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', 200);

    const stillActive = await qaHook(page, 'qaProbeMission');
    expect(stillActive?.status, 'the OTHER roost expiring its own cooldown must not complete this mission').toBe('active');
  });
});
