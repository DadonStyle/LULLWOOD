// LUL-617: the #chargePrompt pill reads "JUMP" on mobile (LUL-529) but its
// CSS (components/GameCanvas.tsx) is `pointer-events: none` -- a caption on
// desktop, not a control -- so the pill looked interactive during exactly
// the one-second survival window a charging predator gives a player, and
// tapping it did nothing. The real, working control is a separate
// bottom-left ActionBtn (see jump.spec.ts); this spec proves the *pill
// itself* is now also wired to the same triggerTouchJump()/beginJump() path,
// not just that it renders the word "JUMP".
//
// Uses qaTriggerCharge (see e2e/charge-dodge.spec.ts) to reach a live charge
// rather than waiting for a real predator to spot the player -- same
// engine-visible-effect discipline as the rest of e2e/mobile: assert
// qaPlayerState().jumping, not DOM presence of the pill.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('tapping the #chargePrompt pill itself starts a jump, same as the Jump button', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const idxOrNull = await page.evaluate(() => window.ForestEngine?.qaTriggerCharge?.('wolf') ?? null);
  if (idxOrNull === null) {
    throw new Error("qaTriggerCharge('wolf') returned null -- wolf isn't spawned");
  }

  const chargePrompt = page.locator('#chargePrompt');
  await expect(chargePrompt, 'telegraph HUD never appeared after qaTriggerCharge').toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#chargeKey')).toHaveText('JUMP');

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.jumping).toBe(false);

  // Same synthetic-PointerEvent dispatch as jump.spec.ts / input-mode.spec.ts
  // (page.mouse-synthesized events report clientX/clientY as 0 under this
  // sandbox's mobile emulation).
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await chargePrompt.dispatchEvent('pointerdown', pointerOpts);

  // JUMP_DURATION (lib/game/jump.ts) is 0.6s; sample shortly after the tap.
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(after?.jumping).toBe(true);
});
