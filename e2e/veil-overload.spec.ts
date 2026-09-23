// LUL-3150/LUL-4663: Veil Overload -- a real-danger panic button that burns all veil
// charge for a full sight+scent detection-immunity window. LUL-4663 retargeted the
// trigger off `carrying` (permanently false in real play since LUL-2281 -- completePickup()
// wins directly, no carry-home leg -- decisions/lul-2281-pickup-is-the-win-2026-09-09) to
// any live predator in `state === 'chase'` (decisions/veil-overload-retarget-2026-09-23).
// The mechanic under test (KeyQ activation / mobile tap) goes through the real input path,
// not a hook -- only the predator's chase state is staged. See
// docs/specs/lul-3150-veil-overload.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible } from './helpers';

test('burning veil overload suppresses a lion\'s detection for the cooldown window, then it returns', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx, 'qaOpenVeilOverloadTarget("lion") must find a spawned lion').not.toBeNull();
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'lion must see the player before activation').toBe(true);

  await page.keyboard.press('KeyQ');

  const mid = await qaHook(page, 'qaProbeVeilOverload');
  expect(mid.chargeT).toBeGreaterThan(0);
  expect(mid.usedThisRound).toBe(true);
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'activation must suppress the lion\'s sight immediately').toBe(false);

  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaAdvance', 400);   // 8s game-time, clears the 7s window with margin

  const after = await qaHook(page, 'qaProbeVeilOverload');
  expect(after.chargeT).toBe(0);
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'detection must return once the window lapses').toBe(true);
});

// LUL-4663: falsification coverage for the retarget itself. qaOpenVeilOverloadTarget above
// is a purpose-built staging hook (it also pins the predator via `reroute` and forces full
// veil charge); this stages a chase through the generic, feature-unrelated
// qaStageChaseAtContact hook instead -- the same class of hook e2e/hide.spec.ts and others
// use for ordinary chase scenarios. Before the retarget this would have failed (the trigger
// required `carrying`, which nothing here ever sets) -- it is exactly the non-vacuous
// coverage the original bug (LUL-4662) needed and never had.
test('a real chase staged through the generic qaStageChaseAtContact hook makes the KeyQ prompt live and activation work', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const staged = await qaHook(page, 'qaStageChaseAtContact', 'lion', 6, 0);
  expect(staged, 'qaStageChaseAtContact("lion", 6, 0) must find a spawned lion').not.toBeNull();

  await expectRowVisible(page, 'veilOverloadPrompt');

  await page.keyboard.press('KeyQ');

  const after = await qaHook(page, 'qaProbeVeilOverload');
  expect(after.chargeT, 'a real chase state alone (no carrying, no veil-overload-specific hook) must arm and fire the panic button').toBeGreaterThan(0);
  expect(after.usedThisRound).toBe(true);
});

test('pressing Q while nothing is chasing you is a silent no-op -- no activation, no denied cue', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaClearAllPredators');

  await page.keyboard.press('KeyQ');

  const after = await qaHook(page, 'qaProbeVeilOverload');
  expect(after.chargeT).toBe(0);
  expect(after.usedThisRound).toBe(false);
  expect(after.deniedCueCount, 'Q outside a real danger window must stay silent, not fire the denied cue').toBe(0);
});

test('pressing Q while chased with insufficient veil charge fires the denied cue, not activation', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx).not.toBeNull();
  // Isolate the staged (pinned, reroute-locked) lion from every other spawned
  // predator so the long drain-hold below can't end in an unrelated real kill --
  // qaIsolatePredator, not qaClearAllPredators: the latter would mark the staged
  // lion itself inert too, which (LUL-4663) silently turns this into the "not
  // chased" no-op case above instead of the denied-cue case this test wants.
  await qaHook(page, 'qaIsolatePredator', idx);

  // Drain veil charge below the activation threshold via a real hold-to-drain,
  // same mechanism e2e/veil.spec.ts uses for the opposite (ramping up) direction.
  // stepVeilCharge() (lib/game/veil.ts) starts regenerating the instant `locked`
  // flips true, even while the key is still held (`active` requires `!locked`) --
  // so this polls one fixed step at a time and stops the moment it locks, rather
  // than a single large qaAdvance that would overshoot back past the threshold.
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await page.keyboard.down('KeyF');
  let locked = false;
  for (let i = 0; i < 300 && !locked; i++) {
    await qaHook(page, 'qaAdvance', 1);
    locked = !!(await qaHook(page, 'qaProbeVeil'))?.locked;
  }
  expect(locked, 'veil must fully drain and lock within the polling ceiling').toBe(true);
  await page.keyboard.up('KeyF');

  const before = await qaHook(page, 'qaProbeVeilOverload');
  expect(before.deniedCueCount).toBe(0);

  await page.keyboard.press('KeyQ');

  const after = await qaHook(page, 'qaProbeVeilOverload');
  expect(after.deniedCueCount, 'an ineligible KeyQ press during a real chase must fire the denied cue').toBe(1);
  expect(after.chargeT, 'activation must not have happened').toBe(0);
  expect(after.usedThisRound).toBe(false);
});

// LUL-4663: the one-shot's reset site moved from setDown() (unreachable in real play,
// same reason `carrying` itself is -- decisions/lul-2281-pickup-is-the-win-2026-09-09) to
// placeCave(), the engine's existing per-round reset site for detection-state timers
// (windAssistActive/caveImmuneT). This proves the new site, via the real restart() path
// (death -> .restartBtn), not the old set-down path.
test('veilOverloadUsedThisRound resets on a fresh round (restart), not mid-round', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx).not.toBeNull();
  // veilOverloadTriggerActive is written once per real frame inside stepFrame() -- wait
  // for the prompt row to actually reflect the just-staged chase (same fix as test 2
  // above) rather than racing KeyQ against the next RAF tick.
  await expectRowVisible(page, 'veilOverloadPrompt');

  await page.keyboard.press('KeyQ');
  expect((await qaHook(page, 'qaProbeVeilOverload')).usedThisRound).toBe(true);

  expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
  await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());

  // Unlike LUL-2205's timeOfRun (recomputed only inside stepFrame()), placeCave()
  // sets veilOverloadUsedThisRound directly and synchronously as part of restart()'s
  // own generateMap() call -- qaProbeVeilOverload() reads the raw module var, not a
  // pushState-derived HUD field, so no frame tick is needed to observe it.
  expect((await qaHook(page, 'qaProbeVeilOverload')).usedThisRound, 'a fresh round must re-arm the one-shot').toBe(false);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 727, height: 393 } });

  test('tapping the veilOverloadPrompt row activates Veil Overload on a touch device', async ({ page }) => {
    await boot(page, { qaHooks: true });

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('mobile project must have a viewport size');
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

    const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
    expect(idx).not.toBeNull();

    await expectRowVisible(page, 'veilOverloadPrompt', 5_000);
    const prompt = page.locator('#veilOverloadPrompt');
    // Same synthetic-PointerEvent dispatch as charge-prompt-tap.spec.ts / jump.spec.ts
    // (page.mouse-synthesized events report clientX/clientY as 0 under mobile emulation).
    const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
    await prompt.dispatchEvent('pointerdown', pointerOpts);

    const mid = await qaHook(page, 'qaProbeVeilOverload');
    expect(mid.chargeT).toBeGreaterThan(0);
    expect(mid.usedThisRound).toBe(true);
    expect((await qaHook(page, 'qaPredatorState', idx))?.canSee).toBe(false);
  });
});
