// LUL-5462/LUL-5460 (Beacon Hunter Deepwater): a `beaconDeepwater` MISSION_POOL entry that
// reuses `beaconEvasion`'s fixed-fireTower target/timing (lib/game/mission.ts) verbatim, drawn
// from the far-mission pool (gated behind MISSION_FAR_UNLOCK_WINS, same as deepwater/
// stoneMarker/radioMast/beaconEvasion/upwindRefuge) instead of being a separate always-eligible
// named mission. repositionBeaconHunterForMission() (engine/forest-engine.js) extended to this
// kind falls through to its existing 'beaconEvasion' branches unchanged -- same spatial anchor,
// same beaconHunter-variant wolf lookup. See wiki game/mechanics/beacon-hunter-deepwater-mission.
//
// Mirrors e2e/beacon-hunter-evasion-mission.spec.ts exactly (same staging, same real Scent
// Veil break sequence per Q1.5 discipline -- no QA-hook force-set of the lock), swapping only
// the mission kind. Micro world (qaBuildScene default), no @fullmap -- a Beacon Hunter is a
// predator variant, not map geometry.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

const FIXED_DT = 0.02;
const WOLF_IDX = 0;   // qaBuildScene stages exactly one wolf -- see e2e/beacon-hunter.spec.ts's own comment on this mapping

async function sprintAgainstWind(page: import('@playwright/test').Page, steps: number) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', steps, true);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}

test.describe('Beacon Hunter Deepwater mission (LUL-5462/LUL-5460)', () => {
  test('completes after a real Scent Veil break clears a real Beacon Hunter lock', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'beaconDeepwater' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconDeepwater');
    expect(mission?.status).toBe('active');

    const before = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(before.canSee, 'bramble at (0,-4) must block the direct sightline').toBe(false);

    // One tick, same reasoning as e2e/beacon-hunter.spec.ts: enough for the
    // beacon check to fire, short enough that roam-wander hasn't drifted the
    // wolf off the bramble-blocking alignment yet.
    await sprintAgainstWind(page, 1);

    const locked = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(locked.canSee, 'sight must still be dark the instant the lock fires').toBe(false);
    expect(locked.state, 'the beacon channel must fire even with sight and scent both dark').toBe('chase');
    expect(locked.beaconHunterLocked).toBe(true);
    // qaPredatorState(idx) has no scentLock field -- qaProbePredatorState(kind) is the
    // one that exposes it (same split e2e/scent-veil.spec.ts relies on).
    const lockedScent = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('wolf') ?? null);
    expect(lockedScent?.scentLock, 'the beacon lock arms the same scentLock leash Scent Veil breaks').toBeGreaterThan(0);

    // Real Scent Veil break -- walking (not sprinting) against the wind is
    // enough to arm scentVeilPromptActive, same setup as e2e/scent-veil.spec.ts.
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'veilPrompt');

    await page.keyboard.press('KeyG');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyW');

    const broken = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('wolf') ?? null);
    expect(broken?.scentLock, 'a successful break clears the leash outright').toBe(0);
    await expectRowHidden(page, 'veilPrompt');

    // Complete the mission via the real E-key interact at the Fire Tower.
    // Fixed-step mode (qaSetFixedStep above) cancelled the rAF loop, so
    // missionCanComplete is only recomputed by an explicit qaAdvance tick --
    // a wall-clock wait does nothing here, unlike the real-RAF specs
    // (e2e/mission-stone-marker.spec.ts) that don't set a fixed step.
    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('beaconDeepwater');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.press('KeyE');
    await qaHook(page, 'qaAdvance', 1);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(page.locator('#missionPanel #missionGlyph')).toHaveText('●');
  });
});
