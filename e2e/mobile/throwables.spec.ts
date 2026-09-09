// LUL-2202: mobile half of qaTeleportNearThrowable() -- see ../throwables.spec.ts
// for the desktop half and the full "why" (docs/specs/lul-1623-throwables.md's
// '## e2e' section). Same tap-driven-effect discipline as e2e/mobile/interact.spec.ts:
// asserts #throwPrompt's engine-visible effect (not just that the buttons render),
// via the touchInteract/touchThrow testIds this ticket also adds to
// components/MobileControls.tsx (the only two action buttons that lacked one).
import { test, expect } from '@playwright/test';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)
}

test('tapping E grabs a throwable, the Throw button appears and clears it on tap', async ({ page }) => {
  test.setTimeout(45_000);
  await boot(page, { qaHooks: true });
  await enterMobile(page);

  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

  // Made to fail once on purpose: no throwable held yet, so neither renders.
  await expect(page.locator('#throwPrompt')).toHaveCount(0);
  await expect(page.getByTestId('touchThrow')).toHaveCount(0);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  const interactBtn = page.getByTestId('touchInteract');
  await expect(interactBtn).toBeVisible();
  await interactBtn.dispatchEvent('pointerdown', pointerOpts);

  const prompt = page.locator('#throwPrompt');
  await expect(prompt).toBeVisible({ timeout: 3_000 });
  await expect(prompt).toContainText('tap');

  const throwBtn = page.getByTestId('touchThrow');
  await expect(throwBtn).toBeVisible({ timeout: 3_000 });
  await throwBtn.dispatchEvent('pointerdown', pointerOpts);

  await expect(prompt).toHaveCount(0, { timeout: 3_000 });
  await expect(throwBtn).toHaveCount(0, { timeout: 3_000 });
});
