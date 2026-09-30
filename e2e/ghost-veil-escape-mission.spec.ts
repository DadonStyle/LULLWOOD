// LUL-5497/LUL-5495: M4 Ghost (veil-escape) -- completes when a chase's shouldGiveUpChase()
// transition fires (engine/forest-engine.js's chase-state predator loop) while Veil Overload's
// detection-immunity window (LUL-2281) is active. canCompleteGhost() (lib/game/mission.ts)
// mirrors canCompleteSlackWater()'s shape exactly. No world target (`spatial: false`, same
// non-spatial shape as slackWater/flush), so this spec never needs @fullmap.
//
// Real-play staging, not a force-set shortcut: qaBuildScene() places a genuine chasing wolf
// (state: 'chase', scentLock: SCENT_TRACK_TIME) beyond its give-up leash (dist > detect*1.5),
// simulated time is advanced until scentLock decays to ~0 (mirroring the real 8s a scent-locked
// chase tracks before shouldGiveUpChase() can fire), and Veil Overload is activated with a real
// KeyQ press -- exactly the panic-button input a player would use to convert an about-to-expire
// chase into a Ghost completion. See docs/specs/lul-5497-ghost-veil-escape.md's `## e2e` section.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const FIXED_DT = 0.02;
// SCENT_TRACK_TIME (lib/game/scent.ts) is 8s -- 400 ticks at 0.02s/tick crosses it exactly.
const SCENT_TRACK_TICKS = 400;

test('a chase give-up while Veil Overload is active completes Ghost', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'ghost' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('ghost');
  expect(mission?.status).toBe('active');

  // LUL-5056: the generic #missionPanel is not gated by mission kind, so ghost renders in it
  // exactly like deepwater/oakHollow/slackWater -- prove the actual pixel a player sees.
  await expect(page.locator('#missionPanel')).toContainText('Ghost');
  await expect(page.locator('#missionGlyph')).toHaveText('○');

  // Real chase, staged far enough out that shouldGiveUpChase()'s dist > detect*1.5 leash is
  // already clear -- scentLock: SCENT_TRACK_TIME mirrors a real scentOnto()/spotOnto() chase
  // entry, not a synthetic zero (a zero scentLock would give up on the very first tick, before
  // Veil Overload could ever be activated).
  await qaHook(page, 'qaBuildScene', {
    predators: [{ kind: 'wolf', x: 40, z: 0, state: 'chase', scentLock: 8 }],
  });

  const staged = await qaHook(page, 'qaPredatorState', 0);
  expect(staged.kind).toBe('wolf');
  expect(staged.state).toBe('chase');
  expect(staged.dist, 'the wolf must start beyond its give-up leash or shouldGiveUpChase() never has a chance to fire').toBeGreaterThan(staged.detectRange * 1.5);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  // 390 of the 400 scentLock-decay ticks -- leaves ~0.2s on the clock so the chase is still
  // live right up until Veil Overload activates, proving the completion window (not a give-up
  // that already happened before the key press).
  await qaHook(page, 'qaAdvance', SCENT_TRACK_TICKS - 10, true);
  const beforeOverload = await qaHook(page, 'qaPredatorState', 0);
  expect(beforeOverload.state, 'must still be mid-chase right before Veil Overload activates').toBe('chase');
  expect(beforeOverload.dist, 'the chase must still be outside the leash right before give-up, or this proves nothing about overload timing').toBeGreaterThan(beforeOverload.detectRange * 1.5);

  // Real KeyQ press -- the panic-button input, gated on veilOverloadTriggerActive (a live
  // `state === 'chase'` predator, recomputed every frame), matches the real-play path a
  // player uses, per the Feature Checklist's Q1.5 (no qa-hook force-activation exists for this).
  await page.keyboard.press('KeyQ');
  const overload = await qaHook(page, 'qaProbeVeilOverload');
  expect(overload.chargeT, 'KeyQ must have actually activated Veil Overload').toBeGreaterThan(0);

  // Cross the remaining ~0.2s of scentLock decay -- shouldGiveUpChase() fires this tick.
  await qaHook(page, 'qaAdvance', 20, true);
  const after = await qaHook(page, 'qaPredatorState', 0);
  expect(after.state, 'the chase must have actually given up for this to prove anything').toBe('roam');

  const completed = await qaHook(page, 'qaProbeMission');
  expect(completed?.status).toBe('complete');

  expectNoConsoleErrors(errs);
});

test('a chase give-up with Veil Overload never activated does not complete Ghost', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'ghost' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('ghost');

  await qaHook(page, 'qaBuildScene', {
    predators: [{ kind: 'wolf', x: 40, z: 0, state: 'chase', scentLock: 8 }],
  });
  const staged = await qaHook(page, 'qaPredatorState', 0);
  expect(staged.dist).toBeGreaterThan(staged.detectRange * 1.5);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  // Full decay plus margin, no KeyQ press anywhere in this test.
  await qaHook(page, 'qaAdvance', SCENT_TRACK_TICKS + 20, true);

  const gaveUp = await qaHook(page, 'qaPredatorState', 0);
  expect(gaveUp.state, 'the chase must have actually given up for this to prove anything').toBe('roam');

  const overload = await qaHook(page, 'qaProbeVeilOverload');
  expect(overload.chargeT).toBe(0);

  const stillActive = await qaHook(page, 'qaProbeMission');
  expect(stillActive?.status, 'a give-up with no Veil Overload window must not complete Ghost').toBe('active');

  expectNoConsoleErrors(errs);
});
