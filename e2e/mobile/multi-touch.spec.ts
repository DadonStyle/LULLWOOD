// LUL-741: no checked-in spec had ever driven two simultaneously-active touch
// pointers, for any mobile control -- grepped e2e/ for pointerId/pointerdown
// and confirmed every existing spec (stick-pointer-capture.spec.ts,
// input-mode.spec.ts, veil.spec.ts, jump.spec.ts, ...) drives exactly one
// active pointer at a time. That's a real coverage gap: a phone player
// routinely holds a stick with one thumb while tapping a HUD button with the
// other, or pushes both sticks at once, and nothing here proved that stays
// wired correctly.
//
// Uses CdpTouch (real Chrome DevTools Protocol touch input, see
// e2e/mobile/touch-cdp.ts) rather than Playwright's `locator.dispatchEvent`,
// which is single-pointer and bypasses the browser's own hit-testing --
// Playwright's `page.touchscreen` is single-touch only and can't drive two
// fingers at once either.
//
// See wiki: game/lul730-verification-results (the ad hoc, uncommitted spec
// this ports from), game/lul702-stick-pointer-capture-fix.
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

test('holding both sticks at once moves the player and turns the camera concurrently, neither pointer clobbering the other', async ({ page }) => {
  await enterMobile(page);

  const left = page.getByTestId('leftStick');
  const right = page.getByTestId('rightStick');
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const lb = await left.boundingBox();
  const rb = await right.boundingBox();
  if (!lb || !rb) throw new Error('both sticks need a bounding box');
  const lcx = lb.x + lb.width / 2;
  const lcy = lb.y + lb.height / 2;
  const rcx = rb.x + rb.width / 2;
  const rcy = rb.y + rb.height / 2;

  const touch = await CdpTouch.create(page);
  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  // Press left, then press right while left stays down -- two concurrently
  // active pointers, one per stick.
  await touch.press(101, lcx, lcy - 30);
  await touch.press(102, rcx + 30, rcy);
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  // Both still held: move each further and confirm both keep changing while
  // BOTH pointers remain concurrently down. This is the assertion that
  // actually needs true simultaneity -- press-left/release-left-then-press-
  // right/release-right would trivially satisfy "both changed since `before`"
  // too, without ever proving the two pointers coexist.
  await touch.move(101, lcx, lcy - 40);
  await touch.move(102, rcx + 40, rcy);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());

  await touch.release(101);
  await touch.release(102);

  // Spawn sets yaw = 0 (forest-engine.js:418); forward (stick pushed up) is -z.
  expect(mid?.z).toBeLessThan(before!.z);
  expect(mid?.yaw).not.toBeCloseTo(before!.yaw, 3);
  expect(after?.z).toBeLessThan(mid!.z);
  expect(after?.yaw).not.toBeCloseTo(mid!.yaw, 3);
});

test('holding the left stick while tapping Jump keeps movement going through the concurrent jump', async ({ page }) => {
  await enterMobile(page);

  const left = page.getByTestId('leftStick');
  const jumpBtn = page.getByTestId('touchJump');
  await expect(left).toBeVisible();
  await expect(jumpBtn).toBeVisible();
  const lb = await left.boundingBox();
  const jb = await jumpBtn.boundingBox();
  if (!lb || !jb) throw new Error('leftStick and touchJump both need a bounding box');
  const lcx = lb.x + lb.width / 2;
  const lcy = lb.y + lb.height / 2;
  const jcx = jb.x + jb.width / 2;
  const jcy = jb.y + jb.height / 2;

  const touch = await CdpTouch.create(page);
  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.jumping).toBe(false);

  await touch.press(111, lcx, lcy - 30); // start walking forward
  await page.waitForTimeout(300);
  const walking = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(walking?.z).toBeLessThan(before!.z);

  // Tap Jump while the stick pointer is still down -- second concurrently
  // active pointer, on a different control.
  await touch.press(112, jcx, jcy);
  await page.waitForTimeout(50);
  const jumped = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await touch.release(112);

  await page.waitForTimeout(200);
  const afterJumpTap = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  await touch.release(111);

  expect(jumped?.jumping).toBe(true);
  // The stick's own pointer (111) was never reset by Jump's pointer (112)
  // coming down concurrently -- movement kept advancing across the tap.
  expect(afterJumpTap?.z).toBeLessThan(walking!.z);
});
