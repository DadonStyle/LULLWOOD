// LUL-529: jump is the only way to clear a charging wolf/lion (LUL-213), so
// it being unreachable on mobile was a survival-critical gap, not cosmetic --
// see e2e/charge-dodge.spec.ts for the desktop half of that mechanic. This
// spec only proves the touch control is wired to the same beginJump() path
// Space triggers on desktop: it asserts the engine-visible effect
// (qaPlayerState().jumping) from a tap on the "Jump" button in
// components/MobileControls.tsx, not just that the button renders.
//
// Landscape viewport, same as e2e/mobile/input-mode.spec.ts: this is about
// the Jump button, not the rotate-prompt (that's orientation-gate.spec.ts).
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('tapping the Jump button starts the same jump the Space key starts on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const jumpBtn = page.getByTestId('touchJump');
  await expect(jumpBtn).toBeVisible();

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.jumping).toBe(false);

  // Same dispatch pattern as e2e/mobile/input-mode.spec.ts's stick drag --
  // page.mouse-synthesized events report clientX/clientY as 0 under this
  // sandbox's mobile emulation; ActionBtn's onTap doesn't read coordinates,
  // but dispatching the real PointerEvent keeps this on the same rig-proven
  // path rather than introducing a second, unverified one.
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await jumpBtn.dispatchEvent('pointerdown', pointerOpts);

  // JUMP_DURATION (lib/game/jump.ts) is 0.6s; sampling shortly after the tap
  // catches the airborne window without racing the landing.
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(after?.jumping).toBe(true);
});
