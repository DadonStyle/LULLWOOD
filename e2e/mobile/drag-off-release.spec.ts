// LUL-741: no checked-in spec had ever moved a touch pointer outside the
// bounds of the element it started on before releasing it, for any mobile
// control -- exactly the case `setPointerCapture` exists to handle (native
// touch-target retention keeps the release event delivered to the element
// that started the gesture, even though the finger physically left it).
// `Stick` and `HoldBtn` (components/MobileControls.tsx) both call
// `setPointerCapture` in the same order-fixed shape (`HoldBtn` fixed first,
// LUL-643/PR #115; `Stick` fixed the same way later, LUL-702/PR #142) -- this
// generalizes the drag-off-release scenario to both, per
// wiki game/lul702-stick-pointer-capture-fix's forward-looking note.
//
// Uses CdpTouch (real Chrome DevTools Protocol touch input, see
// e2e/mobile/touch-cdp.ts): `locator.dispatchEvent('pointerdown', {...})`
// targets the DOM node directly and never goes through the browser's own
// hit-testing / pointer-capture retargeting, so it can't exercise a release
// that lands outside the origin element for real.
//
// See wiki: game/lul730-verification-results (the ad hoc, uncommitted spec
// this ports the Stick half from).
import { test, expect, type Page } from '@playwright/test';
import { boot } from '../helpers';
import { CdpTouch } from './touch-cdp';

test.use({ viewport: { width: 727, height: 393 } });

async function enterMobile(page: Page) {
  await boot(page, { qaHooks: true });
  const pre = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(pre?.mode).toBe('mobile');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle
}

test('dragging the left stick outside its own bounds before releasing still stops movement cleanly', async ({ page }) => {
  await enterMobile(page);

  const stick = page.getByTestId('leftStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('leftStick has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const touch = await CdpTouch.create(page);
  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  await touch.press(201, cx, cy - 30);
  await page.waitForTimeout(300);
  const dragging = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(dragging?.z).toBeLessThan(before!.z);

  // Drag ~470px away, well outside the stick's ~64px-radius circle
  // (RADIUS=48 + 16 border), before releasing.
  await touch.move(201, cx + 470, cy - 30);
  await page.waitForTimeout(100);
  await touch.release(201);

  await page.waitForTimeout(300);
  const afterRelease1 = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await page.waitForTimeout(300);
  const afterRelease2 = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  // No stuck-on input: z has stopped changing within two samples after release.
  expect(afterRelease2?.z).toBeCloseTo(afterRelease1!.z, 3);
});

test('dragging the Veil hold-button outside its own bounds before releasing still releases the veil', async ({ page }) => {
  await enterMobile(page);

  const veilBtn = page.getByTestId('touchVeil');
  await expect(veilBtn).toBeVisible();
  const box = await veilBtn.boundingBox();
  if (!box) throw new Error('touchVeil has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const touch = await CdpTouch.create(page);
  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.veilHeld).toBe(false);

  await touch.press(202, cx, cy);
  await page.waitForTimeout(100);
  const held = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(held?.veilHeld).toBe(true);

  // Same drag-off shape as the Stick test above, applied to a hold-button
  // instead of a drag-axis control.
  await touch.move(202, cx + 300, cy + 300);
  await page.waitForTimeout(100);
  await touch.release(202);
  await page.waitForTimeout(150);

  const released = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(released?.veilHeld).toBe(false);
});
