// LUL-702: Stick.handlePointerDown (components/MobileControls.tsx) had the
// same bug shape LUL-643 found and fixed in HoldBtn -- setPointerCapture()
// called before the move/look state write. A synthetic PointerEvent (as
// Playwright/some real touch paths dispatch) has no active pointer for the
// browser to capture, so the call throws NotFoundError and, pre-fix, aborted
// handlePointerDown before update() (and therefore onMove/setTouchMove or
// setTouchLook) ever ran.
//
// This was latent, not reproducing, in e2e/mobile/input-mode.spec.ts: that
// spec dispatches pointerdown *then* pointermove, and pointermove's own call
// to update() recovers the state regardless of whether pointerdown's handler
// threw. This spec isolates a single pointerdown with no follow-up move, the
// one path where the bug actually bites (e.g. a real touch-and-hold that
// registers as a single low-movement pointer sequence).
//
// See wiki: game/lul274-input-mode-separation, game/lul275-spec-design.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

async function enterMobile(page: import('@playwright/test').Page) {
  await boot(page, { qaHooks: true });
  const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(preEnter?.mode).toBe('mobile');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle
}

test('a single pointerdown on the left stick (no follow-up pointermove) still moves the player', async ({ page }) => {
  await enterMobile(page);

  const stick = page.getByTestId('leftStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('leftStick has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const stateBefore = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  // Single dispatch, offset from centre already -- clears the 9.6px dead
  // zone (RADIUS=48, DEAD=0.2) in one event, unlike the down-at-centre /
  // move-to-offset sequence in input-mode.spec.ts. No pointermove follows,
  // so if handlePointerDown's own update() call didn't run, nothing else
  // will make it run.
  //
  // pointerId deliberately NOT 1: Chromium reserves pointerId 1 for the
  // page's persistent mouse-pointer device (already touched once by the
  // page.mouse.click() gate-entry step above), and setPointerCapture on that
  // reserved id does not throw NotFoundError the way it does for an
  // arbitrary touch pointerId that was never a real native pointer --
  // confirmed empirically: with pointerId 1 this test stayed green against
  // the pre-fix handler (didn't reproduce), with 101 it failed as expected.
  const pointerOpts = { pointerId: 101, pointerType: 'touch', isPrimary: true, bubbles: true };
  await stick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx, clientY: cy - 30 });
  await page.waitForTimeout(600); // let the engine tick pick up touchMove and walk

  const stateAfter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await stick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx, clientY: cy - 30 });

  expect(stateBefore?.z).not.toBeUndefined();
  expect(stateAfter?.z).not.toBeUndefined();
  // Spawn sets yaw = 0 (forest-engine.js:418), so forward (stick pushed up,
  // ny negative) is -z.
  expect(stateAfter!.z).toBeLessThan(stateBefore!.z);
});

test('a single pointerdown on the right stick (no follow-up pointermove) still turns the camera', async ({ page }) => {
  await enterMobile(page);

  const stick = page.getByTestId('rightStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('rightStick has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const stateBefore = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  const pointerOpts = { pointerId: 102, pointerType: 'touch', isPrimary: true, bubbles: true };
  await stick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx + 30, clientY: cy });
  await page.waitForTimeout(600); // let the engine tick apply touchLook to yaw

  const stateAfter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await stick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx + 30, clientY: cy });

  expect(stateBefore?.yaw).not.toBeUndefined();
  expect(stateAfter?.yaw).not.toBeUndefined();
  expect(stateAfter!.yaw).not.toBeCloseTo(stateBefore!.yaw, 3);
});
