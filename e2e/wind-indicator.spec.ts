// LUL-2189/LUL-2207: backfills the missing e2e coverage for #windIndicator's
// rotation and lifecycle -- the wind-direction-awareness feature (LUL-1724)
// shipped with zero coverage of the arrow itself (only the always-visible
// #windIndicatorHint text is covered, e2e/wind-hint.spec.ts). See
// docs/specs/lul-1724-wind-direction-awareness.md's ## e2e section.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

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
