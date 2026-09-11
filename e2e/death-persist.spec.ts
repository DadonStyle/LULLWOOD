// LUL-2169 (follow-up to LUL-1614/PR #510): the delayed-restart-focus fix in
// components/Hud.tsx was applied symmetrically to winRestartRef and
// deathRestartRef (RESTART_FOCUS_DELAY_MS, disabled={!state.lossRevealed}
// mirrors disabled={!state.winRevealed} exactly, Hud.tsx:857-894), but only
// the win path got a dedicated e2e case (e2e/win-persist.spec.ts) -- the
// death path had no qa hook to force a deterministic death, so it was only
// covered by symmetry-by-inspection. qaTriggerDeath() (engine/forest-engine.js,
// declared in engine/forest-engine.d.ts) closes that gap by routing through
// the real triggerDeath(), the same function every in-game catch calls.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

test('a Space press right after the death reveal must not restart the run, but one after the grace window still does', async ({ page }) => {
  test.setTimeout(45_000);
  await boot(page, { qaHooks: true });
  await enter(page);

  await qaHook(page, 'qaTriggerDeath', 'wolf', 'chase');
  await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
  // deathText only reveals at the end of the (up to CUT_END=3.7s) death cutscene --
  // see revealLoss()/playDeathVideo() in engine/forest-engine.js.
  await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });

  // Worst case: a key already in flight the instant the screen reveals.
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await expect(page.locator('#deathScreen'), 'an in-flight Space right at reveal must not restart the run').toBeVisible();
  // LUL-2312: #objective is one of #actionSlot's always-mounted rows now --
  // the !deathVisible gate on its `visible` prop (Hud.tsx) is what this
  // asserts, not whether the element exists.
  await expectRowHidden(page, 'objective');

  // A deliberate press once the grace window has actually elapsed still works --
  // LUL-1194's accessibility path, not something this fix should remove.
  await page.waitForTimeout(2_000);
  await page.keyboard.press('Space');
  await expect(page.locator('#deathScreen')).toBeHidden({ timeout: 5_000 });
  await expectRowVisible(page, 'objective');
});
