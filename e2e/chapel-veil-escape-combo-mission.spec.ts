// LUL-5529/LUL-5524: Chapel Refuge + Veil Escape Combo -- a two-stage mission chaining the
// LUL-5005 Chapel Sanctuary shrine's free one-shot dwell grant (stage 1) into an M4 Ghost-style
// veil-overload chase escape (stage 2, LUL-5497). Composes e2e/chapel-sanctuary.spec.ts's real
// dwell staging (qaTeleportNearChapel + KeyE + qaAdvance for the 15s) with
// e2e/ghost-veil-escape-mission.spec.ts's real chase staging (qaBuildScene + qaSetFixedStep/
// qaAdvance to decay scentLock + KeyQ) -- no new QA hooks, per the CTO-corrected plan's own
// Q13 answer (both real-play patterns already exist and cover this combo's two edges).
import { test, expect } from './fixtures';
import { boot, enter, qaHook, advanceChunked, expectRowVisible, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const DWELL = 15;   // CHAPEL_SANCTUARY_DURATION, engine/tuning.js
// SCENT_TRACK_TIME (lib/game/scent.ts) is 8s -- 400 ticks at 0.02s/tick crosses it exactly.
const SCENT_TRACK_TICKS = 400;

test('completing the chapel dwell then a veil-overload chase escape completes chapelVeilEscape', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'chapelVeilEscape' });
  await enter(page);

  let mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('chapelVeilEscape');
  expect(mission?.status).toBe('active');

  await qaHook(page, 'qaBuildScene', {});
  const chapel = await qaHook(page, 'qaTeleportNearChapel');
  await expectRowVisible(page, 'chapelSanctuaryPrompt');

  // Stage 1: the shrine's real full-dwell grant edge. Must not complete the mission by
  // itself -- only flip the engine's internal stage flag.
  await page.keyboard.press('KeyE');
  expect((await qaHook(page, 'qaProbeChapelSanctuary')).chapelSanctuaryActive).toBe(true);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await advanceChunked(page, stepsFor(DWELL + 0.5));

  expect((await qaHook(page, 'qaProbeVeil')).reserve, 'the free charm must still be granted').toBe(true);
  mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.status, 'stage 1 alone must not complete the two-stage mission').toBe('active');

  // Stage 2: a real chasing wolf, staged relative to the player's post-dwell position (still
  // at the chapel), beyond its give-up leash -- same shape as ghost-veil-escape-mission.spec.ts.
  await qaHook(page, 'qaBuildScene', {
    predators: [{ kind: 'wolf', x: chapel.x + 40, z: chapel.z, state: 'chase', scentLock: 8 }],
  });
  const staged = await qaHook(page, 'qaPredatorState', 0);
  expect(staged.state).toBe('chase');
  expect(staged.dist, 'the wolf must start beyond its give-up leash or shouldGiveUpChase() never has a chance to fire').toBeGreaterThan(staged.detectRange * 1.5);

  await qaHook(page, 'qaAdvance', SCENT_TRACK_TICKS - 10, true);
  const beforeOverload = await qaHook(page, 'qaPredatorState', 0);
  expect(beforeOverload.state, 'must still be mid-chase right before Veil Overload activates').toBe('chase');

  await page.keyboard.press('KeyQ');
  const overload = await qaHook(page, 'qaProbeVeilOverload');
  expect(overload.chargeT, 'KeyQ must have actually activated Veil Overload').toBeGreaterThan(0);

  await qaHook(page, 'qaAdvance', 20, true);
  const after = await qaHook(page, 'qaPredatorState', 0);
  expect(after.state, 'the chase must have actually given up for this to prove anything').toBe('roam');

  const completed = await qaHook(page, 'qaProbeMission');
  expect(completed?.status, 'both stages must have fired for the combo mission to complete').toBe('complete');

  expectNoConsoleErrors(errs);
});

test('a veil-overload chase escape before the chapel dwell completes does not complete chapelVeilEscape', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'chapelVeilEscape' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('chapelVeilEscape');

  // Stage 2 attempted first, with no chapel dwell ever started -- must not complete.
  await qaHook(page, 'qaBuildScene', {
    predators: [{ kind: 'wolf', x: 40, z: 0, state: 'chase', scentLock: 8 }],
  });
  const staged = await qaHook(page, 'qaPredatorState', 0);
  expect(staged.dist).toBeGreaterThan(staged.detectRange * 1.5);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaAdvance', SCENT_TRACK_TICKS - 10, true);

  await page.keyboard.press('KeyQ');
  const overload = await qaHook(page, 'qaProbeVeilOverload');
  expect(overload.chargeT).toBeGreaterThan(0);

  await qaHook(page, 'qaAdvance', 20, true);
  const gaveUp = await qaHook(page, 'qaPredatorState', 0);
  expect(gaveUp.state, 'the chase must have actually given up for this to prove anything').toBe('roam');

  const stillActive = await qaHook(page, 'qaProbeMission');
  expect(stillActive?.status, 'stage 2 without stage 1 first must not complete the combo mission').toBe('active');

  expectNoConsoleErrors(errs);
});
