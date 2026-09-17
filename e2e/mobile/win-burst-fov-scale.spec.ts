// LUL-2953: the local QA tester's vision check found the sky-burst reading
// as a faint wash on mobile at the end of the pickup cinematic, instead of
// desktop's sharp ring+sparkles, even though the DOM #flash overlay (see
// e2e/win-burst-flash-decay.spec.ts) is identical on both. Root cause
// (confirmed by live screenshot comparison, both viewports at the same
// simulated game-time): CAMERA_FOV is deliberately wider on mobile
// (e2e/mobile/orientation-gate.spec.ts's "mobile FOV is wider than desktop
// default"), so the burst's fixed world-space size subtends a smaller
// fraction of the wider frame. The fix scales boomFlash/boomRing/bspPts by
// BOOM_FOV_SCALE (engine/forest-engine.js) so the burst reads at the same
// apparent size regardless of platform. This spec pins that the mobile
// project actually gets a >1 compensation factor and that it reaches the
// live mesh scale, not just an unused constant.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 851, height: 393 } });

const FIXED_DT = 0.02;

// Viewport-relative click, not ../helpers `enter()` (hardcoded to the
// 1280x720 desktop centre) -- same pattern as e2e/mobile/interact.spec.ts
// and jump.spec.ts, since this viewport is overridden to mobile landscape.
async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200);
}

test('sky burst mesh scale is compensated for mobile\'s wider camera FOV', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true });
  await enterMobile(page);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.press('KeyE');

  const probe = await qaHook(page, 'qaProbeBabyLight');
  expect(probe.pickingUp, 'KeyE did not start the pickingUp cinematic').toBe(true);

  const fov = await qaHook(page, 'qaCameraFov');
  expect(fov, 'mobile project must report a wider-than-desktop FOV').toBeGreaterThan(70);

  // Padded past the LUL-2281 e>=9.3 fireBoom trigger keyframe, same as
  // e2e/win-burst-flash-decay.spec.ts's desktop coverage.
  const steps = Math.round(9.4 / FIXED_DT);
  await qaHook(page, 'qaAdvance', steps);

  const boom = await qaHook(page, 'qaProbeBoom');
  expect(boom.visible, 'boomGroup did not fire by e=9.4').toBe(true);

  // fovScale must actually be > 1 on mobile (not a no-op constant) and match
  // the tan(fov/2) ratio the fix uses to compensate for the wider frame.
  const expectedFovScale = Math.tan((fov * Math.PI) / 360) / Math.tan((70 * Math.PI) / 360);
  expect(boom.fovScale).toBeGreaterThan(1);
  expect(boom.fovScale).toBeCloseTo(expectedFovScale, 5);

  // The live mesh scale must actually carry the compensation, not just the
  // closure constant -- this is what would have caught a fix that computed
  // BOOM_FOV_SCALE but never multiplied it into updateBoom()'s scale calls.
  const expectedRingScale = (1 + boom.elapsed * 42) * boom.fovScale;
  const expectedFlashScale = (1 + boom.elapsed * 11) * boom.fovScale;
  expect(boom.ringScale).toBeCloseTo(expectedRingScale, 3);
  expect(boom.flashScale).toBeCloseTo(expectedFlashScale, 3);
});
