// LUL-4900/LUL-4646: Stone Marker Retrieval -- a far/timed MISSION_POOL entry keyed to the
// `stoneMarker` LANDMARKS entry (engine/tuning.js:65), same shape as deepwater (LUL-1258)
// and its timed-expiry path (LUL-3010). Reuses 100% of the existing mission
// UI/completion/audio -- see e2e/mission-progression.spec.ts for the deepwater equivalent
// this file mirrors. Micro world only (LUL-2377 default), no @fullmap.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('stoneMarker (far/timed)', () => {
  test('completes via qaTeleportAtMissionTarget and folds MISSION_STONE_MARKER_REWARD into the win total', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'stoneMarker' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('stoneMarker');
    expect(mission?.status).toBe('active');

    await page.waitForTimeout(250);
    const panel = page.locator('#missionPanel');
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await expect(panel).toContainText('Stone Marker');
    await expect(panel.locator('#missionTimer')).toBeVisible();

    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('stoneMarker');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(panel.locator('#missionGlyph')).toHaveText('●');

    // Same identity check as e2e/mission-progression.spec.ts's expiry test, run in reverse:
    // a completed mission's bonus has no field of its own in #runRecap (economy.ts's
    // computeWinPayout folds missionBonus straight into `total`), so a positive bonus shows
    // up as total exceeding the sum of the four rendered fields.
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
    await boot(page, { qaHooks: true, qaMissionKind: 'stoneMarker' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('stoneMarker');

    const shrunk = await qaHook(page, 'qaShrinkMissionTimer', 0.5);
    expect(shrunk).toEqual({ kind: 'stoneMarker', timeLimitSeconds: 0.5 });

    // Real per-tick expiry, not a shortcut -- same convention as
    // e2e/mission-progression.spec.ts's deepwater expiry test.
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
