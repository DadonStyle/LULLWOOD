// LUL-2187/LUL-2209: backfills e2e coverage for #missionPanel's presence
// gate (state.missionKind && state.missionStatus, components/Hud.tsx:707).
// The completion flow itself (real KeyE interact path, #missionPanel,
// #missionGlyph, objective text) is already covered end-to-end by
// e2e/throwable-mission-hud.spec.ts's "#missionPanel via qaTeleportNearMission()"
// test (LUL-2123) -- not duplicated here. This file covers the one gap that
// test doesn't reach: the panel is gone before entering and while carrying
// the child (decisions/missions-accepted-2026-09-01 §2's "nothing offered
// while carrying" rule).
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, readObjective } from './helpers';

test('#missionPanel is absent before entering and while carrying the child', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true });

  // Gate screen -- no tick has run yet, missionKind/missionStatus are still
  // their initial null (components/Hud.tsx's default HUD state).
  await expect(page.locator('#missionPanel')).toHaveCount(0);

  await enter(page);
  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission, 'qaProbeMission returned null -- no mission drawn this run').not.toBeNull();
  expect(mission.status).toBe('active');
  await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });

  // Reach `carrying` via the real pickup path (matches smoke.spec.ts's
  // "pressing E lifts the child" convention) -- not a shortcut, the real
  // arms cinematic + finishPickup() handoff.
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect
    .poll(() => readObjective(page), {
      message: 'pickup did not hand off to the carry-home objective (LUL-38)',
      timeout: 30_000,
    })
    .toContain('Carry the child home');

  await expect(page.locator('#missionPanel')).toHaveCount(0);
});
