// LUL-3150: Veil Overload -- a carry-leg panic button that burns all veil charge for a
// full sight+scent detection-immunity window. Staged via qaOpenVeilOverloadTarget (predator
// + carrying/full-charge state), the mechanic under test (KeyQ activation / mobile tap)
// goes through the real input path, not a hook. See docs/specs/lul-3150-veil-overload.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible } from './helpers';

test('burning veil overload suppresses a lion\'s detection for the cooldown window, then it returns', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx, 'qaOpenVeilOverloadTarget("lion") must find a spawned lion').not.toBeNull();
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'lion must see the carrying player before activation').toBe(true);

  await page.keyboard.press('KeyQ');

  const mid = await qaHook(page, 'qaProbeVeilOverload');
  expect(mid.chargeT).toBeGreaterThan(0);
  expect(mid.usedThisCarry).toBe(true);
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'activation must suppress the lion\'s sight immediately').toBe(false);

  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaAdvance', 400);   // 8s game-time, clears the 7s window with margin

  const after = await qaHook(page, 'qaProbeVeilOverload');
  expect(after.chargeT).toBe(0);
  expect((await qaHook(page, 'qaPredatorState', idx))?.canSee, 'detection must return once the window lapses').toBe(true);
});

test('pressing Q while carrying with insufficient veil charge fires the denied cue, not activation', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx).not.toBeNull();
  // This scenario isolates the denied-cue path, not chase survival -- park every
  // predator (qaClearAllPredators precedent: e2e/day-night-cycle.spec.ts,
  // e2e/hints.spec.ts) so the 8s drain hold below doesn't end in a real kill.
  await qaHook(page, 'qaClearAllPredators');

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
  expect(after.deniedCueCount, 'an ineligible KeyQ press must fire the denied cue').toBe(1);
  expect(after.chargeT, 'activation must not have happened').toBe(0);
  expect(after.usedThisCarry).toBe(false);
});

test('veilOverloadUsedThisCarry resets on set-down, allowing a second use next carry leg', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
  expect(idx).not.toBeNull();

  await page.keyboard.press('KeyQ');
  expect((await qaHook(page, 'qaProbeVeilOverload')).usedThisCarry).toBe(true);

  await page.keyboard.press('KeyE');   // setDown() -- carrying is true from the staging hook

  expect((await qaHook(page, 'qaProbeVeilOverload')).usedThisCarry, 'set-down must reset the per-carry-leg use flag').toBe(false);
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
    expect(mid.usedThisCarry).toBe(true);
    expect((await qaHook(page, 'qaPredatorState', idx))?.canSee).toBe(false);
  });
});
