// LUL-4900/LUL-4646: Radio Mast Bearing Chase -- a far/timed MISSION_POOL entry keyed to the
// `radioMast` LANDMARKS entry (engine/tuning.js:68), same shape as deepwater/stoneMarker.
// missionWaypointHum() (engine/forest-engine.js:2482-2500) already drives the bearing-pan/
// proximity-pitch audio cue for every active mission via the shared bearingPan() helper --
// this mission needs no new audio code, only the pool entry itself. Micro world only
// (LUL-2377 default), no @fullmap.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('radioMast (far/timed)', () => {
  test('completes via qaTeleportAtMissionTarget and folds MISSION_RADIO_MAST_REWARD into the win total', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'radioMast' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('radioMast');
    expect(mission?.status).toBe('active');

    await page.waitForTimeout(250);
    const panel = page.locator('#missionPanel');
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await expect(panel).toContainText('Radio Mast');
    await expect(panel.locator('#missionTimer')).toBeVisible();

    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('radioMast');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(panel.locator('#missionGlyph')).toHaveText('●');

    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

    const recap = await page.locator('#runRecap').textContent();
    expect(recap).not.toBeNull();
    const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
    const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
    const carried = Number(recap!.match(/\+(\d+) child/)?.[1]);
    const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1]);
    const spentMatch = recap!.match(/−(\d+) charm/);
    const spent = spentMatch ? Number(spentMatch[1]) : 0;
    const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
    expect([depth, survival, carried, rescue, total].every(Number.isFinite)).toBe(true);
    expect(total + spent).toBeGreaterThan(depth + survival + carried + rescue);

    expectNoConsoleErrors(errs);
  });

  test('timer expiry flips the glyph to ✕ and forfeits the mission bonus at win', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'radioMast' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('radioMast');

    const shrunk = await qaHook(page, 'qaShrinkMissionTimer', 0.5);
    expect(shrunk).toEqual({ kind: 'radioMast', timeLimitSeconds: 0.5 });

    await expect(page.locator('#missionPanel #missionGlyph'), 'expiry must flip the glyph to the expired state').toHaveText('✕', { timeout: 3_000 });

    const expired = await qaHook(page, 'qaProbeMission');
    expect(expired?.status).toBe('expired');

    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

    const recap = await page.locator('#runRecap').textContent();
    expect(recap).not.toBeNull();
    const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
    const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
    const carried = Number(recap!.match(/\+(\d+) child/)?.[1]);
    const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1]);
    const spentMatch = recap!.match(/−(\d+) charm/);
    const spent = spentMatch ? Number(spentMatch[1]) : 0;
    const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
    expect([depth, survival, carried, rescue, total].every(Number.isFinite)).toBe(true);
    expect(total + spent).toBe(depth + survival + carried + rescue);

    expectNoConsoleErrors(errs);
  });
});
