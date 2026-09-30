// LUL-5402 (LUL-5401 accepted proposal, downwind investigation bias). Covers
// biasTowardWind() (lib/game/predator.ts) blending a scent-locked 'investigate'/
// 'approach' predator's heading toward the wind vector, and the cue triple that
// tracks the same gate: #windIndicator's windIndicatorInvestigationActive class
// (components/Hud.tsx), the 'downwindInvestigation' hint caption
// (engine/forest-engine.js HINT_PRIORITY), gated on p.scentLock > 0 (not on
// state/inv alone -- a noise/sight-originated approach must not bias).
//
// Staged via qaBuildScene's LUL-5402 inv/scentLock passthrough, not
// scentOnto() -- that keeps the scenario deterministic instead of racing the
// real scent-detection roll. Micro world only, no @fullmap needed.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

/** Same wrapping-label click workaround as e2e/wind-indicator.spec.ts's enableReducedMotion. */
async function enableReducedMotion(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Reduced motion (head bob, pickup camera swing, dust)').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

test('a scent-locked investigating wolf drifts toward downwind instead of straight-line at the player', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await boot(page, { qaHooks: true });
  await enter(page);

  // Wolf due east of the player (50, 0) heading straight at the player (0, 10)
  // would move -x, +z. Wind blows +z (north) -- perpendicular to that straight
  // line -- so a real downwind bias shows up as extra +z drift over the
  // straight-line path, not just "the wolf got closer".
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 50, z: 0, state: 'investigate', inv: 'approach', scentLock: 5 }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(before.inv).toBe('approach');
  expect(before.scentLock).toBeGreaterThan(0);

  await qaHook(page, 'qaAdvance', stepsFor(1));

  const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(after.x).toBeLessThan(before.x);   // still closing on the player overall
  expect(after.z).toBeGreaterThan(0.1);     // but pulled north, off the straight line to (0,10)

  expectNoConsoleErrors(errors);
});

test('the bias is withheld when scentLock is 0, even in the same investigate/approach sub-phase', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 50, z: 0, state: 'investigate', inv: 'approach', scentLock: 0 }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await qaHook(page, 'qaAdvance', stepsFor(1));

  const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(after.scentLock).toBe(0);
  // No scent lock -> pure straight line at the player (0,10): z should track
  // the geometric approach, not the wind-biased overshoot above ~0.1 from the
  // first test's z-only threshold at the same elapsed time/distance.
  expect(after.z).toBeLessThan(0.5);
});

test('#windIndicator gains windIndicatorInvestigationActive while a scent-locked approach is live, and loses it when scentLock expires', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 50, z: 0, state: 'investigate', inv: 'approach', scentLock: 0.5 }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await qaHook(page, 'qaAdvance', 1);
  await expect(page.locator('#windIndicator')).toHaveClass(/windIndicatorInvestigationActive/);

  // scentLock decays unconditionally every tick (lib/game/predator.ts) -- run
  // past its expiry and the class must drop with it.
  await qaHook(page, 'qaAdvance', stepsFor(1));
  const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(after.scentLock).toBe(0);
  await expect(page.locator('#windIndicator')).not.toHaveClass(/windIndicatorInvestigationActive/);
});

test('windIndicatorInvestigationActive is withheld under reducedMotion, even with a live scent-locked approach', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await enableReducedMotion(page);

  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 50, z: 0, state: 'investigate', inv: 'approach', scentLock: 5 }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaAdvance', 1);

  const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(after.scentLock).toBeGreaterThan(0);   // the engine-side gate is unaffected
  await expect(page.locator('#windIndicator')).not.toHaveClass(/windIndicatorInvestigationActive/);   // Hud.tsx withholds the class
});

test('the downwindInvestigation hint caption fires once with the spec\'s exact copy while the gate is active', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaResetHints');

  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 50, z: 0, state: 'investigate', inv: 'approach', scentLock: 5 }] });
  await qaHook(page, 'qaSetWindDirection', 0, 1);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaAdvance', 1);

  const hints = await qaHook(page, 'qaProbeHints');
  expect(hints.activeKey).toBe('downwindInvestigation');
  await expect(page.locator('#hintCaption')).toBeVisible();
  await expect(page.locator('#hintCaption')).toContainText('predators hunt downwind of your scent — position yourself upwind to escape');
});
