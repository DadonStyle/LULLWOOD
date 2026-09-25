// LUL-5134 (Beacon Hunter Evasion, M1 Fire Tower variant): a `beaconEvasion`
// MISSION_POOL entry that reuses deepwater's fireTower target/timing but adds
// a permanent beaconHunter-variant wolf repositioned ~50u from the target
// after the mission draw (repositionBeaconHunterForMission(),
// engine/forest-engine.js). See docs/specs/lul-5134-beacon-hunter-evasion-mission.md.
//
// Per that SPEC's Q1.5 discipline, this drives the lock/break through the
// real code path, not a QA-hook force-set: stages a beaconHunter wolf and
// sprints against the wind into it (mirrors e2e/beacon-hunter.spec.ts's own
// staging exactly, including the bramble blocking sight so only the beacon
// channel can fire), breaks the resulting scentLock with a real KeyG press
// while moving against wind (mirrors e2e/scent-veil.spec.ts's break sequence
// exactly), then completes the mission via qaTeleportAtMissionTarget() + a
// real KeyE press. Micro world (qaBuildScene default), no @fullmap -- a
// Beacon Hunter is a predator variant, not map geometry.
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

test.describe('Beacon Hunter Evasion mission (LUL-5134)', () => {
  test('completes after a real Scent Veil break clears a real Beacon Hunter lock', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'beaconEvasion' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('beaconEvasion');
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
    expect(target?.kind).toBe('beaconEvasion');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.press('KeyE');
    await qaHook(page, 'qaAdvance', 1);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(page.locator('#missionPanel #missionGlyph')).toHaveText('●');
  });
});
