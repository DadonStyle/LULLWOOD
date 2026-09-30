// LUL-5465/LUL-5455: Beacon Roost Recovery Evasion -- 'roostRecoveryEvasion's own composition
// (LUL-5447/LUL-5446) verbatim: same non-spatial roost-target shape, same cooldown-expiry
// auto-completion (engine/forest-engine.js's updateRoosts()). The one difference:
// repositionBeaconHunterForMission() repositions the sight-biased Beacon Hunter wolf (the same
// lookup 'beaconRoostFlush' uses) instead of a lion. See wiki
// game/mechanics/beacon-roost-recovery-evasion and
// decisions/lul-5455-beacon-roost-recovery-evasion-accepted-2026-09-30.
//
// Non-spatial target (`spatial: false`, same shape as flush), so this spec never needs
// @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of fighting the rng, and
// qaBuildScene stages a real Beacon Hunter wolf (not a QA-hook force-set) so the flush +
// reposition + cooldown wiring all run through real engine code.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const WOLF_IDX = 0;   // qaBuildScene stages exactly one wolf -- see e2e/beacon-roost-flush-mission.spec.ts's own comment on this mapping
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

test.describe('Beacon Roost Recovery Evasion mission (LUL-5465/LUL-5455)', () => {
  test('spawns with a repositioned Beacon Hunter after a flush and completes when the roost cooldown expires', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'beaconRoostRecoveryEvasion', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
    });

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconRoostRecoveryEvasion');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    await expect(page.locator('#missionPanel')).toContainText('Beacon Roost Recovery');

    // repositionBeaconHunterForMission() (engine/forest-engine.js) should have placed the
    // Beacon Hunter ~50u from ROOSTS[0]'s anchor, same math 'beaconRoostFlush'/'roostRecoveryEvasion'
    // already exercise.
    const wolf = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(wolf.kind).toBe('wolf');
    const roostAnchor = await qaHook(page, 'qaTeleportNearRoost', 0);
    const distFromRoost = Math.hypot(wolf.x - roostAnchor.x, wolf.z - roostAnchor.z);
    expect(distFromRoost, 'the repositioned Beacon Hunter should land close to the documented ~50u radius').toBeGreaterThan(30);
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

  test('does not spawn a repositioned Beacon Hunter or mission progress for an unmarked roost', async ({ page }) => {
    // Mirrors the other roost-mission specs' own guard test: flushing a DIFFERENT roost must
    // not touch this mission's completion state (it never calls canCompleteFlush() at all, but
    // this proves the cooldown-completion branch is scoped to the marked roostIndex only).
    await boot(page, { qaHooks: true, qaMissionKind: 'beaconRoostRecoveryEvasion', qaRoostIndex: 0 });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconRoostRecoveryEvasion');
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
