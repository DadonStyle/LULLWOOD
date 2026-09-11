// LUL-2122: e2e coverage for the mobile Hide button's new data-testid
// (touchHide), added alongside components/MobileControls.tsx -- the
// death-screen HUD-overlap audit needs to name this button by a stable
// locator instead of the exact text "Hide" (LUL-649's text-based-locator
// history is why e2e/mobile/win-persist.spec.ts drives its own action via
// KeyE rather than a button -- see that spec's header). This proves tapping
// the button reaches the same enterHide() path H reaches on desktop
// (../hide.spec.ts), asserting the engine-visible effect (qaPlayerState().
// hidden), not just that the button renders and is tappable.
//
// Landscape viewport, same as e2e/mobile/jump.spec.ts: this is about the
// Hide button, not the rotate-prompt (that's orientation-gate.spec.ts).
// Also same as jump.spec.ts: enter via a viewport-relative click, not the
// ../helpers `enter()` (hardcoded to the 1280x720 desktop centre), since this
// viewport is overridden to a narrower mobile landscape size below.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('tapping the Hide button enters the same hold-still stance H enters on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

  const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
  if (spot === null) {
    throw new Error('qaTeleportToHideSpot returned null -- no bramble hiding spot was found for this seed');
  }

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.hidden).toBe(false);

  const hideBtn = page.getByTestId('touchHide');
  await expect(hideBtn).toBeVisible();

  // Same dispatch pattern as e2e/mobile/jump.spec.ts -- page.mouse-synthesized
  // events report clientX/clientY as 0 under this sandbox's mobile emulation,
  // but ActionBtn's onTap doesn't read coordinates, so the real PointerEvent
  // keeps this on the same rig-proven path.
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await hideBtn.dispatchEvent('pointerdown', pointerOpts);

  await expect
    .poll(async () => (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.hidden, { timeout: 300 })
    .toBe(true);
});
