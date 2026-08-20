// LUL-275: mobile-only regression for LUL-274 FACT 3 -- the left stick
// pushed up must move the player forward, not backward (the sign was
// inverted: the stick reports screen-down-positive ny, the engine's iz axis
// is forward-positive). components/MobileControls.tsx now flips the sign at
// the source (`setTouchMove(nx, -ny)`); this spec pins that down end to end,
// through the real engine tick, not just as a unit check on the flip itself.
//
// Runs only under the `mobile` Playwright project (playwright.config.ts) --
// a real mobile-emulated context (devices['Pixel 5']: touch, coarse pointer,
// no hover, narrow viewport, chromium-backed -- see that project's comment
// for why not an iPhone preset) so `isMobile()`'s
// `(pointer: coarse) and (hover: none)` match is the real thing that decides
// which controls component mounts, not `hasTouch` layered onto a desktop
// context. See e2e/input-mode.spec.ts for that half of the regression (FACT
// 1 / FACT 2, desktop + hasTouch).
//
// See wiki: game/lul274-input-mode-separation, game/lul275-spec-design.
//
// LUL-69: this project's default viewport (devices['Pixel 5']) is portrait,
// which the new OrientationGate now blocks input behind on a mobile device.
// This spec is about stick-drag behavior, not the rotate prompt, so it opts
// into a landscape viewport (dimensions swapped) the same way a real player
// rotating their phone would -- e2e/mobile/orientation-gate.spec.ts is what
// actually exercises the portrait-blocks/landscape-clears behavior.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('left stick pushed up moves the player forward, not backward', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(preEnter?.mode).toBe('mobile');

  // e2e/helpers.ts's enter() clicks a fixed 1280x720-viewport point, which is
  // outside this project's mobile viewport -- click the gate at the real
  // viewport centre instead.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

  const stick = page.getByTestId('leftStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('leftStick has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drive the stick via dispatched PointerEvents with explicit coordinates,
  // not page.mouse: measured directly in this rig, page.mouse.move/down under
  // a `hasTouch: true` + `isMobile: true` context (this project) reports
  // clientX/clientY as 0 on every resulting pointer/mouse event -- a
  // touch-emulation quirk of headless Chromium's CDP input synthesis in this
  // sandbox, not a page bug (confirmed: the identical drag via
  // locator.dispatchEvent(), which carries real coordinates, drives the stick
  // and moves the player correctly). Dispatching PointerEvents directly on
  // the target exercises the same onPointerDown/onPointerMove/onPointerUp
  // React handlers MobileControls.tsx actually wires up.
  //
  // Drag straight up from the stick's centre. RADIUS=48 and DEAD=0.2 in
  // MobileControls.tsx (0.2*48=9.6px) -- 30px clears the dead-zone without
  // saturating past RADIUS.
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await stick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx, clientY: cy });
  await stick.dispatchEvent('pointermove', { ...pointerOpts, clientX: cx, clientY: cy - 30 });
  await page.waitForTimeout(200); // let the engine tick pick up the new touchMove

  const stateBefore = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await page.waitForTimeout(500); // hold the stick, let the player actually walk
  const stateAfter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  await stick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx, clientY: cy - 30 });

  expect(stateBefore?.z).not.toBeUndefined();
  expect(stateAfter?.z).not.toBeUndefined();
  // Spawn sets yaw = 0 (forest-engine.js:418), so forward is -z.
  expect(stateAfter!.z).toBeLessThan(stateBefore!.z);
});
