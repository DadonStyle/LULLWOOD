// LUL-529: the mist veil is a *hold* (F held on desktop, read every frame at
// engine/forest-engine.js's `veilHeld = playing && (!!keys['KeyF'] || touchVeil)`),
// not a tap -- components/MobileControls.tsx's HoldBtn tracks pointer
// down/up/cancel to match. This asserts the engine-visible effect
// (qaPlayerState().veilHeld) goes true on press and back to false on
// release, not just that the button renders.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('holding the Veil button drives the same veilHeld the F key drives on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const veilBtn = page.getByTestId('touchVeil');
  await expect(veilBtn).toBeVisible();

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.veilHeld).toBe(false);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await veilBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const held = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(held?.veilHeld).toBe(true);

  await veilBtn.dispatchEvent('pointerup', pointerOpts);
  await page.waitForTimeout(100);
  const released = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(released?.veilHeld).toBe(false);
});

// LUL-2664: the existing test above only proves touchVeil drives the same
// veilHeld boolean the F key drives -- it never holds long enough for the
// ramp to matter. This proves the touch path reaches the same detection cut
// the desktop e2e/veil.spec.ts proves for KeyF, via the identical
// qaOpenVeilTarget/qaSetFixedStep/qaAdvance staging (see
// docs/specs/lul-2664-veil-detection-e2e.md for the distance/threshold math).
test('holding the Veil button cuts a lion\'s sight range the same way the F key does', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const veilBtn = page.getByTestId('touchVeil');
  await expect(veilBtn).toBeVisible();

  const idx = await qaHook(page, 'qaOpenVeilTarget', 'lion');
  expect(idx, 'qaOpenVeilTarget("lion") must find a spawned lion').not.toBeNull();

  const before = await qaHook(page, 'qaPredatorState', idx);
  expect(before?.canSee, 'lion must see the player before the veil is held').toBe(true);

  await qaHook(page, 'qaSetFixedStep', 0.02);
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await veilBtn.dispatchEvent('pointerdown', pointerOpts);

  let veilAmount = 0;
  let steps = 0;
  const MAX_STEPS = 250;
  while (veilAmount < 0.9 && steps < MAX_STEPS) {
    await qaHook(page, 'qaAdvance', 10);
    steps += 10;
    const trail = await qaHook(page, 'qaProbeScentTrail');
    veilAmount = trail?.veilAmount ?? 0;
  }
  expect(veilAmount, `veilAmount must cross 0.9 within ${MAX_STEPS * 0.02}s of holding the Veil button`).toBeGreaterThanOrEqual(0.9);

  const after = await qaHook(page, 'qaPredatorState', idx);
  expect(after?.canSee, 'a ramped veil must cut the lion\'s sight range enough to lose the player, same as the desktop F-hold path').toBe(false);

  await veilBtn.dispatchEvent('pointerup', pointerOpts);
});
