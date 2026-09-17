// LUL-2971: regression coverage for the win-burst / #flash color-contrast fix.
// CTO root-caused the "no bright burst visible" vision-QA finding as a
// compositing problem, not a scale problem (LUL-2953's BOOM_FOV_SCALE mesh-
// *size* fix, still covered by e2e/mobile/win-burst-fov-scale.spec.ts, did not
// fix this): #flash (components/GameCanvas.tsx:734) is a full-viewport
// background:#fff DOM overlay composited on TOP of the WebGL canvas via plain
// CSS opacity, so the visible pixel is `flashOpacity*white + (1-flashOpacity)
// *meshColor` -- at the old 0.9 peak, any mesh hue only gets 10% weight and
// reads as a white wash regardless of the mesh's on-screen size. The fix
// (engine/forest-engine.js) recolors boomFlash/boomRing/bspPts to a saturated
// gold/orange and lowers the peak to FLASH_PEAK_OPACITY=0.65 (35% scene
// weight). qaProbeBoom (see win-burst-fov-scale.spec.ts) only ever checked
// mesh scale math and already missed this bug once -- this file is the actual
// pixel/luminance-contrast regression gate CTO's comment asked for.
//
// docs/specs/lul-2971-win-burst-color-contrast.md lists one new file,
// e2e/win-burst-contrast.spec.ts, covering both "chromium (desktop)" and
// "mobile". A real e2e/mobile/** file can only run under the dedicated
// `mobile` Playwright project (playwright.config.ts testDir restricts that
// project to e2e/mobile/**, and `chromium`'s testIgnore excludes that
// subtree right back) -- there's no way for one physical file in either
// location to be picked up by both. e2e/input-mode.spec.ts already solved
// this for FACT 1/FACT 2 coverage: `test.use({ hasTouch: true })` inside the
// `chromium` project reproduces a real touch-only device (coarse pointer, no
// hover) without needing the separate `mobile` project, and
// lib/input-mode.ts's isMobile() genuinely flips to true under it (confirmed
// by that file's own `mode` assertion). This file reuses that pattern, plus
// the explicit 851x393 landscape viewport and viewport-relative entry click
// e2e/mobile/win-burst-fov-scale.spec.ts uses, so the "mobile" describe block
// below exercises the real mobile classification (wider CAMERA_FOV included)
// the color-contrast fix has to survive, inside the one file the spec names.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

async function advance(page: Page, seconds: number) {
  const steps = Math.round(seconds / FIXED_DT);
  await qaHook(page, 'qaAdvance', steps);
}

async function flashOpacity(page: Page) {
  return parseFloat(await page.locator('#flash').evaluate((el: HTMLElement) => el.style.opacity));
}

// #flash's peak-opacity blend is plain browser CSS compositing, invisible to
// qaProbeBoomPixel's GL readback (that only sees the WebGL canvas, one layer
// below #flash in the DOM). Reproduce the browser's own blend analytically:
// composited channel = flashOpacity*255 + (1-flashOpacity)*meshChannel, using
// #fff as #flash's own color per components/GameCanvas.tsx:734.
function compositeWithFlash(
  mesh: { r: number; g: number; b: number },
  flashOp: number,
): { r: number; g: number; b: number } {
  const mix = (channel: number) => flashOp * 255 + (1 - flashOp) * channel;
  return { r: mix(mesh.r), g: mix(mesh.g), b: mix(mesh.b) };
}

// A warm gold/orange tint composited under a white overlay shows up as the
// green/blue channels falling short of white while red stays near it -- the
// same deficit a same-hue-as-white wash (the pre-fix bug) cannot produce.
function assertVisibleTint(composited: { r: number; g: number; b: number }, label: string) {
  const deficit = Math.max(255 - composited.g, 255 - composited.b);
  expect(
    deficit,
    `${label}: composited color ${JSON.stringify(composited)} reads as a white wash, not a visible warm tint`,
  ).toBeGreaterThan(20);
}

// Three points in the burst's lifetime, in cinematic-elapsed game-seconds
// since fireBoom()'s e>=9.3 trigger keyframe (engine/forest-engine.js:6454):
// ~0.43s is this ticket's own measured vision-QA capture offset
// (gameSinceE=9.73 in the LUL-2971 evidence block minus the 9.3 keyframe),
// ~0.9s is mid-plateau, and ~1.36s is LUL-2605's worst-case measured capture
// delay (e2e/win-burst-flash-decay.spec.ts pins the same two delays for
// #flash's own opacity curve).
const CAPTURES: { totalElapsed: number; label: string }[] = [
  { totalElapsed: 9.3 + 0.43, label: 'e~0.43s (measured LUL-2971 capture offset)' },
  { totalElapsed: 9.3 + 0.9, label: 'e~0.9s (mid-plateau)' },
  { totalElapsed: 9.3 + 1.36, label: 'e~1.36s (LUL-2605 worst-case capture delay)' },
];

async function assertBurstContrastAcrossLifetime(page: Page) {
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.press('KeyE');

  const probe = await qaHook(page, 'qaProbeBabyLight');
  expect(probe.pickingUp, 'KeyE did not start the pickingUp cinematic').toBe(true);

  let elapsedSoFar = 0;
  for (const { totalElapsed, label } of CAPTURES) {
    await advance(page, totalElapsed - elapsedSoFar);
    elapsedSoFar = totalElapsed;

    const mesh = await qaHook(page, 'qaProbeBoomPixel');
    const flashOp = await flashOpacity(page);
    assertVisibleTint(compositeWithFlash(mesh, flashOp), label);
  }
}

test.describe('chromium (desktop)', () => {
  test('sky burst composites with visible color contrast against the #flash overlay at every point in its lifetime, not just a white wash', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await assertBurstContrastAcrossLifetime(page);
  });
});

test.describe('mobile (touch-emulated landscape, same hasTouch pattern as e2e/input-mode.spec.ts)', () => {
  test.use({ hasTouch: true, viewport: { width: 851, height: 393 } });

  test('sky burst composites with visible color contrast against the #flash overlay at every point in its lifetime, not just a white wash (mobile)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });

    // Viewport-relative click, not helpers' enter() (hardcoded to the 1280x720
    // desktop centre) -- same pattern as e2e/mobile/win-burst-fov-scale.spec.ts.
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('mobile test must have a viewport size');
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    await page.waitForTimeout(1200);

    const fov = await qaHook(page, 'qaCameraFov');
    expect(
      fov,
      'hasTouch-emulated context must report a wider-than-desktop FOV (real mobile classification, not just a resized desktop viewport)',
    ).toBeGreaterThan(70);

    await assertBurstContrastAcrossLifetime(page);
  });
});
