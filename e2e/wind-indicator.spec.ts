// LUL-2189/LUL-2207: backfills the missing e2e coverage for #windIndicator's
// rotation and lifecycle -- the wind-direction-awareness feature (LUL-1724)
// shipped with zero coverage of the arrow itself (only the always-visible
// #windIndicatorHint text is covered, e2e/wind-hint.spec.ts). See
// docs/specs/lul-1724-wind-direction-awareness.md's ## e2e section.
//
// LUL-3009 (Threat Beacon): extends this file rather than adding a new one --
// the pulse is a modification of this same #windIndicator element, not a new
// one (Q7/Q8 duplicate-proof, docs/ELEMENTS.md). windIndicatorActive is forced
// via qaSetWindDirection + real WASD movement, not faked state.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

/** Same wrapping-label click workaround as e2e/cover-rustle.spec.ts's enableCaptions. */
async function enableReducedMotion(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Reduced motion (head bob, pickup camera swing, dust)').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

test('#windIndicator\'s rotation matches the engine\'s windX/windZ at the pinned seed', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const { windX, windZ } = await qaHook(page, 'qaProbeWind');
  const expectedAngle = Math.atan2(windZ, windX);

  // The browser round-trips the inline style through its CSS serializer,
  // which truncates the float's precision (e.g. 2.3201379058680227 ->
  // "2.32014") -- compare the parsed number, not the exact string.
  const transform = await page.locator('#windIndicator').evaluate((el) => (el as HTMLElement).style.transform);
  const match = transform.match(/^rotate\(([-\d.]+)rad\)$/);
  expect(match, `#windIndicator transform "${transform}" must be a rotate(...rad) value`).not.toBeNull();
  expect(Number(match![1])).toBeCloseTo(expectedAngle, 4);
});

test('#windIndicator and #windIndicatorHint are absent before entering and after win/death', async ({ page }) => {
  await boot(page, { qaHooks: true });

  // Gate screen -- state.entered is false, neither element mounts.
  await expect(page.locator('#windIndicator')).toHaveCount(0);
  await expect(page.locator('#windIndicatorHint')).toHaveCount(0);

  await enter(page);
  await expect(page.locator('#windIndicator')).toBeVisible();
  await expect(page.locator('#windIndicatorHint')).toBeVisible();

  // Real death path (routes through triggerDeath(), same as death-persist.spec.ts).
  await qaHook(page, 'qaTriggerDeath', 'wolf', 'chase');
  await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#windIndicator')).toHaveCount(0);
  await expect(page.locator('#windIndicatorHint')).toHaveCount(0);
});

// LUL-3009: player.yaw is 0 at spawn (generateMap(), engine/forest-engine.js), so held
// KeyW's real per-frame heading is the fixed unit vector (0, -1) -- qaSetWindDirection
// picks a wind vector that's provably dot-negative (or dot-positive) against that known
// heading instead of depending on which way the seed's own generateWind() roll landed.
test('#windIndicator gains windIndicatorActive while moving against the wind, and loses it the instant movement stops', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));

  expect((await qaHook(page, 'qaProbeWind')).movingAgainstWind).toBe(true);
  await expect(page.locator('#windIndicator')).toHaveClass(/windIndicatorActive/);

  await page.keyboard.up('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));

  expect((await qaHook(page, 'qaProbeWind')).movingAgainstWind).toBe(false);
  await expect(page.locator('#windIndicator')).not.toHaveClass(/windIndicatorActive/);
});

test('#windIndicator has no windIndicatorActive class while moving with the wind', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetWindDirection', 0, -1);   // wind blows -Z, same direction as forward (0,-1)
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));
  await page.keyboard.up('KeyW');

  expect((await qaHook(page, 'qaProbeWind')).movingAgainstWind).toBe(false);
  await expect(page.locator('#windIndicator')).not.toHaveClass(/windIndicatorActive/);
});

test('windIndicatorActive is never applied under reducedMotion, even while genuinely moving against the wind', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await enableReducedMotion(page);
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));

  expect((await qaHook(page, 'qaProbeWind')).movingAgainstWind).toBe(true);   // the engine flag itself is unaffected
  await expect(page.locator('#windIndicator')).not.toHaveClass(/windIndicatorActive/);   // Hud.tsx withholds the class

  await page.keyboard.up('KeyW');
});
