// LUL-529: desktop honours the runMode === 'toggle' accessibility setting
// (engine/forest-engine.js's ShiftLeft/ShiftRight keydown edge); mobile used
// to derive sprint purely from stick magnitude and never read the setting at
// all, so a player who picked toggle-run for accessibility reasons got
// nothing on a phone. This proves the "Run" button in
// components/MobileControls.tsx -- rendered only when runMode === 'toggle'
// -- flips the same qaPlayerState().toggleRunOn flag the keyboard edge
// flips, not just that a button appears.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('the Run button only appears in toggle-run mode, and toggles the engine flag', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  // Default runMode is 'hold' -- the button must not exist yet.
  await expect(page.getByTestId('touchToggleRun')).toHaveCount(0);

  // #settingsBtn is reachable on mobile regardless of pause state (LUL-198
  // repositions #panel, it doesn't hide it) -- see components/Hud.tsx.
  await page.locator('#settingsBtn').click();
  const runModeCheckbox = page.getByRole('checkbox', { name: /toggle to run/i });
  await expect(runModeCheckbox).toBeVisible();
  await runModeCheckbox.check();
  await page.getByRole('button', { name: 'Close settings' }).click();

  const runBtn = page.getByTestId('touchToggleRun');
  await expect(runBtn).toBeVisible();

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.toggleRunOn).toBe(false);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await runBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const on = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(on?.toggleRunOn).toBe(true);

  await runBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const off = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(off?.toggleRunOn).toBe(false);
});
