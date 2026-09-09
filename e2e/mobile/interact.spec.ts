// LUL-2122: e2e coverage for the mobile Interact (E) button's new
// data-testid (touchInteract), added alongside components/MobileControls.tsx
// so the on-screen button can be located by a stable, non-text locator --
// LUL-649's text-based-locator history is why e2e/mobile/win-persist.spec.ts
// drives pickup via KeyE instead of the button (see that spec's header).
// This proves tapping the button reaches the same triggerTouchInteract() ->
// pickup() path KeyE reaches on mobile, asserting the engine-visible effect
// (qaProbeBabyLight()), not just that the button renders and is tappable.
//
// Landscape viewport, same as e2e/mobile/jump.spec.ts: this is about the
// Interact button, not the rotate-prompt (that's orientation-gate.spec.ts).
// Also same as jump.spec.ts: enter via a viewport-relative click, not the
// ../helpers `enter()` (hardcoded to the 1280x720 desktop centre), since this
// viewport is overridden to a narrower mobile landscape size below.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)
}

test.describe('mobile Interact (E) button -- touchInteract', () => {
  test('tapping touchInteract picks up and carries the child, same as KeyE on desktop', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enterMobile(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
    await page.waitForTimeout(300);

    const objective = await page.locator('#objective').textContent();
    expect(objective ?? '', 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

    const before = await page.evaluate(() => window.ForestEngine?.qaProbeBabyLight?.());
    expect(before?.pickingUp).toBe(false);

    const interactBtn = page.getByTestId('touchInteract');
    await expect(interactBtn).toBeVisible();

    // Same dispatch pattern as e2e/mobile/jump.spec.ts -- page.mouse-synthesized
    // events report clientX/clientY as 0 under this sandbox's mobile emulation,
    // but ActionBtn's onTap doesn't read coordinates, so the real PointerEvent
    // keeps this on the same rig-proven path.
    const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
    await interactBtn.dispatchEvent('pointerdown', pointerOpts);

    await expect
      .poll(
        async () => (await page.evaluate(() => window.ForestEngine?.qaProbeBabyLight?.()))?.pickingUp,
        { timeout: 300 },
      )
      .toBe(true);

    await expect
      .poll(
        async () => (await page.evaluate(() => window.ForestEngine?.qaProbeBabyLight?.()))?.carrying,
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.evaluate(() => window.ForestEngine?.qaTeleportHome?.());
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 5_000 });
  });

  test('tapping touchInteract out of pickup range does nothing', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enterMobile(page);

    const before = await page.evaluate(() => window.ForestEngine?.qaProbeBabyLight?.());
    expect(before?.pickingUp).toBe(false);
    expect(before?.carrying).toBe(false);

    const interactBtn = page.getByTestId('touchInteract');
    await expect(interactBtn).toBeVisible();
    const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
    await interactBtn.dispatchEvent('pointerdown', pointerOpts);

    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.ForestEngine?.qaProbeBabyLight?.());
    expect(after?.pickingUp).toBe(false);
    expect(after?.carrying).toBe(false);
  });
});
