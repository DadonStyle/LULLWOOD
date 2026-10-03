// LUL-5160/LUL-5376: M7 Beacon Roost Flush mission -- composes 'flush's non-spatial
// roost-target completion (canCompleteFlush(), lib/game/mission.ts, reused verbatim for this
// kind) with 'beaconEvasion's post-draw Beacon Hunter repositioning
// (repositionBeaconHunterForMission(), engine/forest-engine.js, extended to anchor on
// ROOSTS[roostIndex] instead of a fixed landmark for this kind). See
// wiki game/mechanics/beacon-roost-flush-mission and decisions/lul-5160-beacon-roost-flush-accepted-2026-09-29.
//
// Per the wiki's Q1.5/Q11 discipline, the lock/break is driven through the real code path
// (sprint against the wind at a staged beaconHunter wolf, same staging as
// e2e/beacon-hunter-evasion-mission.spec.ts), not a QA-hook force-set. qaBuildScene stages the
// predator explicitly -- repositionBeaconHunterForMission()'s own ~50u-from-roost placement
// runs at generateMap() time and is overwritten by this staging, same as the beaconEvasion
// spec's own predator staging overwrites its landmark-anchored placement; this spec proves the
// mission-completion wiring (kind + roostIndex + canCompleteFlush reuse), not the placement
// math itself, which repositionBeaconHunterForMission shares unmodified with the already-tested
// beaconEvasion kind. Non-spatial target (`spatial: false`, same shape as flush), so this spec
// never needs @fullmap -- ?qaRoostIndex= pins the draw deterministically instead of fighting the rng.
//
// LUL-5644: `boot()` must pin `qaHour` -- see e2e/beacon-hunter.spec.ts's header (LUL-5146)
// for the full mechanism (unpinned hour -> 'night' detect multiplier -> beacon channel never
// fires at this file's fixed staging distance). Not an engine regression.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden, VIEW_X, VIEW_Y } from './helpers';

const FIXED_DT = 0.02;
const WOLF_IDX = 0;   // qaBuildScene stages exactly one wolf -- see e2e/beacon-hunter.spec.ts's own comment on this mapping

async function sprintAgainstWind(page: Page, steps: number) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', steps, true);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}

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

test.describe('Beacon Roost Flush mission (LUL-5160)', () => {
  test('completes after a real Scent Veil break clears a real Beacon Hunter lock, then the marked roost is flushed', async ({ page }) => {
    await boot(page, { qaHooks: true, qaHour: 12, qaMissionKind: 'beaconRoostFlush', qaRoostIndex: 0 });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconRoostFlush');
    expect(mission?.status).toBe('active');
    expect(mission?.roostIndex).toBe(0);

    await expect(page.locator('#missionPanel')).toContainText('Beacon Roost Flush');

    const before = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(before.canSee, 'bramble at (0,-4) must block the direct sightline').toBe(false);

    // One tick, same reasoning as e2e/beacon-hunter-evasion-mission.spec.ts: enough for the
    // beacon check to fire, short enough that roam-wander hasn't drifted the wolf off the
    // bramble-blocking alignment yet.
    await sprintAgainstWind(page, 1);

    const locked = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(locked.canSee, 'sight must still be dark the instant the lock fires').toBe(false);
    expect(locked.state, 'the beacon channel must fire even with sight and scent both dark').toBe('chase');
    expect(locked.beaconHunterLocked).toBe(true);

    // Real Scent Veil break -- walking (not sprinting) against the wind is enough to arm
    // scentVeilPromptActive, same setup as e2e/scent-veil.spec.ts.
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'veilPrompt');

    await page.keyboard.press('KeyG');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyW');

    const broken = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('wolf') ?? null);
    expect(broken?.scentLock, 'a successful break clears the leash outright').toBe(0);
    await expectRowHidden(page, 'veilPrompt');

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
    // Proves the roost-specific guard (canCompleteFlush()'s roostIndex check) applies to this
    // kind too, not just plain 'flush' -- mirrors e2e/mission-flush.spec.ts's own guard test.
    await boot(page, { qaHooks: true, qaHour: 12, qaMissionKind: 'beaconRoostFlush', qaRoostIndex: 0 });
    await enter(page);
    // LUL-5859: this kind's repositionBeaconHunterForMission() (engine/forest-engine.js)
    // relocates a live, roaming beaconHunter wolf to within 50u of ROOSTS[0] -- well inside
    // reach of ROOSTS[1] too at this seed's compressed inter-roost spacing. Without pinning
    // the clock, the real RAF loop keeps ticking across every await below (page.evaluate/
    // keyboard/mouse round-trips all cost real wall-clock ms), long enough for that wolf to
    // wander into updateRoosts()'s ambient flush trigger for roost 1 BEFORE the player's own
    // throw -- which puts roost 1 on cooldown and makes the deliberate throw below a no-op
    // (the roostFlushDeniedCue() branch, not flushRoost()), so burstActive reads false. Same
    // qaSetFixedStep()-cancels-the-real-RAF-loop fix LUL-5046 already established for
    // e2e/tree-pathing.spec.ts's identical real-time-vs-simulated-time class of flake.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconRoostFlush');
    expect(mission?.roostIndex).toBe(0);

    await grabAThrowable(page);
    const roost1 = await qaHook(page, 'qaTeleportNearRoost', 1);
    expect(roost1?.i).toBe(1);
    await throwAtLockedTarget(page);
    await qaHook(page, 'qaAdvance', 1);

    const roost1State = await qaHook(page, 'qaProbeRoostState', 1);
    expect(roost1State.burstActive, 'the player-thrown flush path must have actually fired').toBe(true);

    const stillActive = await qaHook(page, 'qaProbeMission');
    expect(stillActive?.status, 'flushing the WRONG roost must not complete the mission').toBe('active');
  });
});
