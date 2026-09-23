// LUL-650: mobile half of the win-screen-must-persist regression (see
// ../win-persist.spec.ts for the desktop spec and the full writeup of what
// this is guarding against and why no engine fix was needed for item 1).
//
// Runs under the `mobile` Playwright project (playwright.config.ts) --
// devices['Pixel 5'], real touch/coarse-pointer emulation, so isMobile()
// mounts MobileControls the way a real phone would.
//
// This drives pickup via `page.keyboard.press('KeyE')` rather than tapping
// MobileControls' on-screen "E" button. That is deliberate, not an oversight:
// engine/forest-engine.js's `keydown` listener (~L1506) is not mode-gated --
// only the desktop mouse-look/pointer-lock listeners are -- so KeyE reaches
// pickup() in mobile mode too. This spec exists to isolate win-screen
// persistence (the thing LUL-650 actually asks for) from a separate,
// already-flagged bug: the Game Tester's live-production repro
// (wiki: game/lul649-mobile-actionbtn-repro) found MobileControls' on-screen
// Interact/Hide buttons not firing their onTap at all on mobile, three
// independent ways. That is tracked on its own ticket -- see the LUL-650
// ticket comment -- and driving pickup through it here would make this spec
// red for a reason that has nothing to do with what it's supposed to prove.
import { test, expect } from '../fixtures';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('win screen is mandatory and persists until the player restarts (mobile)', async ({ page }) => {
  test.setTimeout(45_000);
  await boot(page, { qaHooks: true });

  const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(preEnter?.mode).toBe('mobile');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);

  const objective = await page.locator('#objective').textContent();
  expect(objective ?? '', 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

  // LUL-2159 P2 (LUL-2131 mobile end-screen unmount regression coverage):
  // confirm the pre-win baseline before asserting anything disappears --
  // MobileControls/GameMenu unmount outright (return null) on
  // winVisible/deathVisible, #windIndicator/#windIndicatorHint are wrapped in
  // `{state.entered && hudLive && (...)}` in Hud.tsx and unmount the same way.
  // #actionPrompt/#throwPrompt never unmount (ActionPrompt's own wrapper div
  // has no visible/hudLive gate -- only its inner `.actionPromptLine` does via
  // the `visible` prop), so those are asserted via `data-visible` below
  // instead of DOM absence.
  await expect(page.locator('[data-testid="mobileControls"]')).toBeVisible();
  await expect(page.locator('#gameMenu')).toBeVisible();
  await expect(page.locator('#windIndicator')).toBeVisible();
  await expect(page.locator('#windIndicatorHint')).toBeVisible();

  // LUL-2281 (reverts LUL-1307): no carry-home leg -- pressing E and letting
  // the ascend/explode cinematic finish wins outright.
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

  // LUL-2159 P2: the elements that unmount outright on win must actually be
  // gone from the DOM, not just visually covered by #winScreen's z-index.
  await expect(page.locator('[data-testid="mobileControls"]'), 'MobileControls must unmount on win (LUL-2131)').toHaveCount(0);
  await expect(page.locator('#gameMenu'), 'GameMenu must unmount on win (LUL-2131)').toHaveCount(0);
  await expect(page.locator('#windIndicator'), 'windIndicator must unmount on win (LUL-2131)').toHaveCount(0);
  await expect(page.locator('#windIndicatorHint'), 'windIndicatorHint must unmount on win (LUL-2131)').toHaveCount(0);
  // #actionPrompt/#throwPrompt stay mounted (empty row) -- their content is
  // gated by the `visible` prop, reflected in `data-visible`.
  await expect(page.locator('#actionPrompt'), 'actionPrompt must report not-visible on win').toHaveAttribute('data-visible', '0');
  await expect(page.locator('#throwPrompt'), 'throwPrompt must report not-visible on win').toHaveAttribute('data-visible', '0');

  let elapsedMs = 0;
  for (const stepMs of [1000, 2000, 2000]) {
    await page.waitForTimeout(stepMs);
    elapsedMs += stepMs;
    await expect(page.locator('#winScreen'), `#winScreen must still be up ${elapsedMs}ms after arriving home (mobile)`).toBeVisible();
    await expect(page.locator('#winScreen h1')).toHaveText('YOU WON');
  }

  // Same hit-test + mandatory-exit checks as the desktop spec.
  const onTop = await page.evaluate(() => {
    const el = document.querySelector('#winScreen');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || (el.contains(hit) ?? false);
  });
  expect(onTop, '#winScreen must be the hit-tested element at its own centre').toBe(true);

  // el.click(), not a real Playwright click -- see
  // wiki:systems/lul44-diagnosis-and-fix / ../win-persist.spec.ts (a real
  // click's actionability polling can time out under this rig's load even
  // though the hit-test above already proved the button is genuinely on top).
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();
});
