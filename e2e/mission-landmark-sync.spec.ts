// LUL-2740: full-map-only regression coverage for syncMissionTargetToLandmark()
// (lib/game/mission.ts). Before this fix, mission.target.x/z stayed at
// MISSION_POOL's stale nominal (x:-95, z:-95) even when clearLandmarkSpot()
// nudged the fireTower landmark off that spot to dodge a collision -- at seed
// QA_PINNED_SEED this left a continuous collision wall between any straight-line
// approach and the stale target, so no walk-in could ever complete the mission.
// Promotes the timing-out shared/local-qa/requests/lul-2187-mission-panel-overlap.md
// manual scenario into real, always-running CI coverage (see that request file).
//
// fullmap-reason: the bug is specifically that the full-map mission target must
// sync to clearLandmarkSpot()'s real (unscaled) placement -- the micro world's
// mission target is a different, intentionally-decoupled synthetic position
// (LUL-2578) that never exercises this code path at all, so no micro-world
// staging can express this case.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('mission target stays synced to the landmark @fullmap', () => {
  test('walking straight at the synced mission target from qaTeleportNearMission() completes the deepwater mission', async ({ page }) => {
    test.setTimeout(45_000);
    const errs = trackConsoleErrors(page);
    // LUL-3010: this test asserts deepwater-specific behaviour (fireTower sync); force
    // it past the new eligibility gate.
    await boot(page, { qaHooks: true, qaWorld: 'full', qaMissionKind: 'deepwater' });
    await enter(page);

    const target = await qaHook(page, 'qaTeleportNearMission');
    expect(target, 'qaTeleportNearMission returned null -- no active mission').not.toBeNull();
    expect(target.kind).toBe('deepwater');

    // qaTeleportNearMission() always spawns the player at
    // (target.x + interactRadius + 1, target.z) -- a fixed +x offset from the
    // target regardless of seed -- so the yaw needed to face the target back
    // along -x is always Math.PI/2 (same derivation as
    // e2e/throwable-mission-hud.spec.ts's dynamic atan2 computation, constant
    // here only because this offset never changes).
    await qaHook(page, 'qaSetLookYaw', Math.PI / 2);

    await page.waitForTimeout(250);
    await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyW');

    await expect(page.locator('#objective'), 'mission target must be reachable by a straight walk-in once synced to the landmark\'s real placement').toContainText('fire tower', { timeout: 3_000 });

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const probed = await qaHook(page, 'qaProbeMission');
    expect(probed?.status).toBe('complete');
    await expect(page.locator('#missionPanel #missionGlyph')).toHaveText('●');

    expectNoConsoleErrors(errs);
  });
});
