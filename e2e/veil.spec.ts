// LUL-2664: e2e/mobile/veil.spec.ts only asserts qaPlayerState().veilHeld flips
// on touchVeil pointerdown/up -- that the input is wired, not the veil's actual
// gameplay purpose. That purpose is entirely veilDetectMul(veilAmount)
// (lib/game/veil.ts:77) feeding canSee()'s detect multiplier
// (engine/forest-engine.js:2438), which had zero e2e coverage before this file
// -- a regression here would pass every existing test, the same shape as the
// hiding-test gap LUL-2613 audited (e2e/hide.spec.ts:25's own "no predator is
// used anywhere in this file"). See docs/specs/lul-2664-veil-detection-e2e.md
// for the distance/threshold derivation.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-
// clock.md) instead of a wall-clock wait for the ramp to climb -- LUL-2471
// measured VEIL_RAMP=1.6s exponential (engine/tuning.js:152), ~3.68s
// continuous hold to cross veilAmount=0.9; a real-time wait races swiftshader
// frame-time variance for no reason once F is held and dt is fixed.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const POLL_STEPS = 10;       // 0.2s game-time per poll
const MAX_STEPS = 250;       // 5s ceiling -- ramp should cross 0.9 by ~3.68s (184 steps)
const VEIL_THRESHOLD = 0.9;  // matches LUL-2471's measured point; see spec doc for margin math

test('holding the veil (KeyF) cuts a lion\'s sight range enough to lose the player, with no cover, stillness or chase drift involved', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilTarget', 'lion');
  expect(idx, 'qaOpenVeilTarget("lion") must find a spawned lion').not.toBeNull();

  const before = await qaHook(page, 'qaPredatorState', idx);
  expect(before?.canSee, 'lion must see the player before the veil is held').toBe(true);
  expect(before?.dist, 'test distance must be the fixed 6 units the spec derives its margins from').toBeCloseTo(6, 1);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.down('KeyF');

  let veilAmount = 0;
  let steps = 0;
  while (veilAmount < VEIL_THRESHOLD && steps < MAX_STEPS) {
    await qaHook(page, 'qaAdvance', POLL_STEPS);
    steps += POLL_STEPS;
    const trail = await qaHook(page, 'qaProbeScentTrail');
    veilAmount = trail?.veilAmount ?? 0;
  }
  expect(veilAmount, `veilAmount must cross ${VEIL_THRESHOLD} within ${MAX_STEPS * FIXED_DT}s of holding F`).toBeGreaterThanOrEqual(VEIL_THRESHOLD);

  const after = await qaHook(page, 'qaPredatorState', idx);
  expect(after?.dist, 'the pinned predator must not have drifted during the hold').toBeCloseTo(6, 1);
  expect(after?.canSee, 'a ramped veil must cut the lion\'s sight range enough to lose a player it could see a moment ago, purely off the veil multiplier').toBe(false);

  await page.keyboard.up('KeyF');
});
