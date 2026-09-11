// LUL-2187/LUL-2209: backfills e2e coverage for #missionPanel's presence
// gate (state.missionKind && state.missionStatus, components/Hud.tsx:707).
// The completion flow itself (real KeyE interact path, #missionPanel,
// #missionGlyph, objective text) is already covered end-to-end by
// e2e/throwable-mission-hud.spec.ts's "#missionPanel via qaTeleportNearMission()"
// test (LUL-2123) -- not duplicated here. This file covers the one gap that
// test doesn't reach: the panel is gone before entering, and disappears for
// good once the pickup cinematic starts.
//
// LUL-2281: this used to assert the panel stays hidden through the whole
// carry-home leg (decisions/missions-accepted-2026-09-01 §2's "nothing
// offered while carrying" rule). That rule's `carrying`-gated branch
// (forest-engine.js's tick(), the objective/mission pushState block) is now
// unreachable in real play -- completePickup() (lib/game/outcome.ts) wins
// outright instead of ever setting carrying=true (wiki decisions/lul-2281-
// pickup-is-the-win-2026-09-09 Decision 2 -- that machinery is left in place
// but inert, not deleted). This now asserts the reachable equivalent: the
// panel disappears the instant the pickup cinematic starts -- `playing`
// (lib/game/outcome.ts's isPlaying()) goes false the moment pickingUp does,
// and tick()'s `else` HUD branch nulls missionKind/missionStatus
// unconditionally at that point, independent of `carrying` -- and never
// comes back once the cinematic completes into the win screen.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

test('#missionPanel is absent before entering and disappears for good once the pickup cinematic starts', async ({ page }) => {
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

  // Real pickup path (matches smoke.spec.ts's "pressing E lifts the child"
  // convention) -- not a shortcut, the real arms cinematic.
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');

  await expect(page.locator('#missionPanel')).toHaveCount(0);
  // Hold through to the win to prove it never comes back once the cinematic
  // (~11.3s, engine/forest-engine.js key3 timeline) completes.
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#missionPanel')).toHaveCount(0);
});

// LUL-2442: components/GameMenu.tsx's open .menuPanel starts at ~72px absolute
// (top:56px inside #gameMenu's own top:16px) and shares #missionPanel's
// left:16px corner, landing right on top of it (#missionPanel is top:76px,
// GameCanvas.tsx) -- the QA layout audit caught the first menu row ("Fullscreen:
// off (F11)") overlapping the mission pill's "Deepwater" text. LUL-1942 already
// solved this for the *closed* 48px toggle button; the open dropdown is taller
// and was never covered. Same fix family as LUL-2410/2411/2414: hide the
// panel rather than fight z-index, gated on the `menuOpen` state already
// plumbed to MobileControls (components/Hud.tsx).
test('#missionPanel is hidden while the game menu is open, and returns once closed', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission, 'qaProbeMission returned null -- no mission drawn this run').not.toBeNull();
  await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });

  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('.menuPanel')).toBeVisible();
  await expect(page.locator('#missionPanel')).toHaveCount(0);

  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('.menuPanel')).toBeHidden();
  await expect(page.locator('#missionPanel')).toBeVisible();
});
