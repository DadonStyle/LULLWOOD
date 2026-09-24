// LUL-5004 (LUL-4895 accepted, retargeted -- see decisions/scent-veil-accepted-
// retargeted-2026-09-24 and decisions/scent-veil-key-collision-retarget-2026-09-24):
// KeyG breaks a real, live scentLock while the player moves against the wind.
// Stages the chase the same way e2e/scent.spec.ts does -- `qaSeedScentPoint` +
// `qaProbeScentOnOldest`, no `carrying` precondition (that gate was already dead
// in real play, decisions/lul-2281-pickup-is-the-win-2026-09-09, and was dropped
// entirely per this ticket's retarget rather than shipped dead). Driven via
// qaSetFixedStep/qaAdvance, same reasoning as e2e/scent.spec.ts -- a real-GPU
// RAF poll can't be trusted to land inside a single fixed-dt frame the way the
// keydown handlers here need (scentVeilPromptActive is read at the instant of
// the KeyG keydown event, not re-evaluated by the event itself).
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

const FIXED_DT = 0.05;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('Scent Veil (KeyG)', () => {
  test('breaks a live scent lock, clearing the real predator fields, on a successful press', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    // Same seed/placement as e2e/scent.spec.ts: 60 units out, 4s old -- comfortably
    // beyond the bear's leash, so it starts a real blind chase far from the player.
    const seeded = await page.evaluate(() => {
      window.ForestEngine?.qaSeedScentPoint?.(-60, 0, 4);
      return window.ForestEngine?.qaProbeScentOnOldest?.('bear') ?? null;
    });
    expect(seeded, 'qaSeedScentPoint + qaProbeScentOnOldest should find the seeded point').not.toBeNull();

    await qaHook(page, 'qaAdvance', 2);
    const locked = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(locked?.state, 'bear should have entered a blind scent chase').toBe('chase');
    expect(locked?.scentLock, 'scentLock should be armed').toBeGreaterThan(0);
    expect(locked?.scentVeilReady, 'a fresh lock cycle should re-arm the one-time break').toBe(true);

    // Default yaw faces -z; wind (0,1) blows toward +z, so walking forward (KeyW,
    // no turning) is directly against it -- same setup e2e/wind-indicator.spec.ts uses.
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'veilPrompt');
    await expect(page.locator('#veilPrompt')).toHaveAttribute('data-tone', 'urgent');

    await page.keyboard.press('KeyG');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyW');

    const broken = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(broken?.scentLock, 'a successful break clears the leash outright, not a pause').toBe(0);
    expect(broken?.scentVeilReady, 'consumed for this lock cycle').toBe(false);
    await expectRowHidden(page, 'veilPrompt');

    const scentVeil = await page.evaluate(() => window.ForestEngine?.qaProbeScentVeil?.() ?? null);
    expect(scentVeil?.deniedCueCount, 'a successful break must not also fire the refusal cue').toBe(0);
    expect(scentVeil?.staminaCharge, 'stamina should have been spent').toBeLessThan(1);
  });

  test('insufficient stamina renders the disabled tone, plays the blocked cue, and leaves the lock intact', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    // Drain stamina first, before any predator is staged, so there is no chase
    // clock running yet -- same "sprint alone, no movement key" shape as
    // e2e/stamina.spec.ts, isolated from the scent-lock setup that follows.
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', stepsFor(5)); // 5s of a 6s full drain
    await page.keyboard.up('ShiftLeft');
    const drained = await page.evaluate(() => window.ForestEngine?.qaProbeScentVeil?.() ?? null);
    expect(drained?.staminaCharge, 'stamina must be below SCENT_VEIL_STAMINA_COST (0.3) for this case').toBeLessThan(0.3);

    const seeded = await page.evaluate(() => {
      window.ForestEngine?.qaSeedScentPoint?.(-60, 0, 4);
      return window.ForestEngine?.qaProbeScentOnOldest?.('bear') ?? null;
    });
    expect(seeded).not.toBeNull();
    await qaHook(page, 'qaAdvance', 2);

    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'veilPrompt');
    await expect(page.locator('#veilPrompt')).toHaveAttribute('data-tone', 'disabled');

    await page.keyboard.press('KeyG');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyW');

    const stillLocked = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(stillLocked?.scentLock, 'a refused press must not clear the lock').toBeGreaterThan(0);
    expect(stillLocked?.scentVeilReady, 'a refused press must not consume the one-time break').toBe(true);

    const scentVeil = await page.evaluate(() => window.ForestEngine?.qaProbeScentVeil?.() ?? null);
    expect(scentVeil?.deniedCueCount, 'the blocked-tone refusal cue must fire').toBe(1);
  });

  test('the mist-veil (F) and scent-veil (G) prompts coexist without either misfiring', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    // Bear: blind scent chase (scentLock armed, out of sight) -- G's trigger.
    const seeded = await page.evaluate(() => {
      window.ForestEngine?.qaSeedScentPoint?.(-60, 0, 4);
      return window.ForestEngine?.qaProbeScentOnOldest?.('bear') ?? null;
    });
    expect(seeded).not.toBeNull();
    await qaHook(page, 'qaAdvance', 2);

    // Wolf: sight chase, 6 units out in the open -- F's trigger. qaOpenVeilTarget
    // only clears `hunt`/`charge` on non-target predators (engine/forest-engine.js),
    // never scentLock, so this cannot clear the bear's lock armed just above.
    const wolfIdx = await page.evaluate(() => window.ForestEngine?.qaOpenVeilTarget?.('wolf') ?? null);
    expect(wolfIdx, 'wolf should be present in the micro world').not.toBeNull();

    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 1);

    // Both rows visible the same frame -- separate #actionSlot DOM nodes
    // (components/Hud.tsx), never competing for one.
    await expectRowVisible(page, 'actionPrompt'); // mist-veil/hide combined row (F)
    await expectRowVisible(page, 'veilPrompt'); // scent-veil row (G)

    const beforeF = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    await page.keyboard.down('KeyF');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyF');
    const afterF = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    // scentLock ticks down by real dt every frame regardless (tickTimers(), engine/
    // forest-engine.js) -- the property under test is that holding F doesn't zero or
    // otherwise jump it, not that it's frozen; one FIXED_DT tick's worth of natural
    // decay is the only expected delta.
    expect(afterF?.scentLock, 'holding F (mist veil) must not zero/jump scentLock, only its own natural per-tick decay').toBeCloseTo((beforeF?.scentLock ?? 0) - FIXED_DT, 5);
    expect(afterF?.scentVeilReady, 'holding F (mist veil) must not touch scentVeilReady').toBe(beforeF?.scentVeilReady);

    const beforeG = await page.evaluate(() => window.ForestEngine?.qaProbeVeil?.() ?? null);
    await page.keyboard.press('KeyG');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.up('KeyW');
    const afterG = await page.evaluate(() => window.ForestEngine?.qaProbeVeil?.() ?? null);
    // veilCharge regenerates a little every frame it's not held (stepVeilCharge(),
    // lib/game/veil.ts) regardless of anything else this tick -- the property under
    // test is that breakScentVeil() never *drains* it (only its own hold-to-drain
    // path, KeyF, does that), so a same-or-higher charge is the correct assertion,
    // not an exact freeze.
    expect(afterG?.charge, 'pressing G (scent veil) must not drain veilCharge').toBeGreaterThanOrEqual(beforeG?.charge ?? 0);
    expect(afterG?.locked, 'pressing G (scent veil) must not touch veilLocked').toBe(beforeG?.locked);
  });
});
