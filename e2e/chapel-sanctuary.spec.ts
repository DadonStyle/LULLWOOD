// LUL-5005: Chapel Sanctuary -- a free, one-shot-per-run route to veilReserve=true,
// retargeted 2026-09-24 (CEO ruling) from an earlier veilCharge premise that was false
// (veilCharge free-regenerates unconditionally in ~10s, lib/game/veil.ts:47-71). See
// wiki decisions/chapel-sanctuary-retarget-veilreserve-2026-09-24 and
// game/mechanics/chapel-sanctuary.md, and docs/ELEMENTS.md's "Chapel Sanctuary" entry.
//
// Drives the 15s dwell via qaSetFixedStep/qaAdvance (fixed sim-time ticks), not
// page.waitForTimeout() -- the same dt-clamp-vs-walltime lesson LUL-5046 already fixed
// elsewhere in this file (qaStageAndTraceBehindTree's traceApproach()): a wall-clock
// wait measured against real elapsed ms drifts under CI's sustained render load, since
// DT_CLAMP_CEILING caps how much sim-time a slow frame actually accrues.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, advanceChunked, expectRowVisible } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const DWELL = 15;   // CHAPEL_SANCTUARY_DURATION, engine/tuning.js

async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
  await page.locator('#sound').evaluate((el) => (el as HTMLElement).click());
}

async function enableReducedMotion(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Reduced motion (head bob, pickup camera swing, dust)').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

test.describe('Chapel Sanctuary (LUL-5005)', () => {
  test('a full 15s dwell grants veilReserve for free and closes the one-shot gate', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {});
    await qaHook(page, 'qaTeleportNearChapel');

    await expectRowVisible(page, 'chapelSanctuaryPrompt');
    expect((await qaHook(page, 'qaProbeVeil')).reserve, 'sanity: veilReserve starts false on a fresh run').toBe(false);

    await page.keyboard.press('KeyE');
    let sanctuary = await qaHook(page, 'qaProbeChapelSanctuary');
    expect(sanctuary.chapelSanctuaryActive).toBe(true);
    expect(sanctuary.chapelSanctuaryChargeT).toBeCloseTo(DWELL, 0);
    expect(sanctuary.startCueCount).toBe(1);
    // The panel takes over from the prompt the instant the dwell starts.
    await expect(page.locator('#chapelSanctuaryPrompt')).toHaveAttribute('data-visible', '0');
    await expect(page.locator('#chapelSanctuaryPanel')).toBeVisible();

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(DWELL + 0.5));   // past the full dwell, with margin

    sanctuary = await qaHook(page, 'qaProbeChapelSanctuary');
    expect(sanctuary.chapelSanctuaryActive, 'the dwell must end automatically on completion').toBe(false);
    expect(sanctuary.chapelSanctuaryUsedThisRun, 'a completed dwell must close the one-shot gate').toBe(true);

    const veil = await qaHook(page, 'qaProbeVeil');
    expect(veil.reserve, 'a completed dwell must grant veilReserve, free').toBe(true);

    // Gate closed -- the prompt must not come back even standing right there.
    expect((await qaHook(page, 'qaProbeChapelSanctuary')).promptVisible).toBe(false);
    await expect(page.locator('#chapelSanctuaryPrompt')).toHaveAttribute('data-visible', '0');
  });

  test('leaving the radius before the dwell completes grants nothing and leaves the gate open for a retry', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {});
    const chapel = await qaHook(page, 'qaTeleportNearChapel');
    await expectRowVisible(page, 'chapelSanctuaryPrompt');

    await page.keyboard.press('KeyE');
    expect((await qaHook(page, 'qaProbeChapelSanctuary')).chapelSanctuaryActive).toBe(true);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(3));   // well short of the 15s dwell

    // Step outside CHAPEL_SANCTUARY_INTERACT_RADIUS * 1.5 (4 * 1.5 = 6 units).
    await qaHook(page, 'qaTeleportTo', chapel.x + 20, chapel.z);
    await advanceChunked(page, stepsFor(0.5));   // one tick is enough for the early-exit branch to fire

    const sanctuary = await qaHook(page, 'qaProbeChapelSanctuary');
    expect(sanctuary.chapelSanctuaryActive, 'leaving early must cancel the dwell').toBe(false);
    expect(sanctuary.chapelSanctuaryChargeT).toBe(0);
    expect(sanctuary.chapelSanctuaryUsedThisRun, 'nothing must be consumed on an early exit').toBe(false);
    expect(sanctuary.earlyExitCueCount, 'leaving early must fire a distinct tell, not silence').toBe(1);
    expect(sanctuary.deniedCueCount, 'leaving early is a non-event, not a refusal -- must not fire the denied buzz').toBe(0);

    const veil = await qaHook(page, 'qaProbeVeil');
    expect(veil.reserve, 'an abandoned dwell must not grant the charm').toBe(false);

    // Walk back -- the gate must still be open for a retry. Still in fixed-step mode
    // (qaSetFixedStep cancels the rAF loop), so the teleport needs one more explicit
    // qaAdvance() before tick() recomputes chapelSanctuaryPromptVisible off the new position.
    await qaHook(page, 'qaTeleportNearChapel');
    await advanceChunked(page, stepsFor(0.5));
    await expectRowVisible(page, 'chapelSanctuaryPrompt');
  });

  test('pressing E again after the charm is already granted is refused with a denied-cue tell, not silence', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {});
    await qaHook(page, 'qaTeleportNearChapel');
    await expectRowVisible(page, 'chapelSanctuaryPrompt');

    await page.keyboard.press('KeyE');
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(DWELL + 0.5));
    expect((await qaHook(page, 'qaProbeVeil')).reserve).toBe(true);

    const before = await qaHook(page, 'qaProbeChapelSanctuary');
    expect(before.deniedCueCount).toBe(0);

    await page.keyboard.press('KeyE');
    const after = await qaHook(page, 'qaProbeChapelSanctuary');
    expect(after.chapelSanctuaryActive, 'a re-press after the gate is closed must not start a second dwell').toBe(false);
    expect(after.deniedCueCount, 'a refused re-entry must fire the denied cue, not silence').toBe(1);
  });

  test('displays the countdown on the HUD while the dwell is active', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {});
    await qaHook(page, 'qaTeleportNearChapel');
    await expectRowVisible(page, 'chapelSanctuaryPrompt');

    await page.keyboard.press('KeyE');
    const panel = page.locator('#chapelSanctuaryPanel');
    await expect(panel).toContainText('Sanctuary');
    await expect(panel).toContainText(String(DWELL));

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(5));
    // Ceil'd seconds must have visibly ticked down from the starting value.
    await expect(panel).not.toContainText(String(DWELL));
  });

  test('captionsOn=true: entering fires the named caption', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await enableCaptions(page);
    await qaHook(page, 'qaBuildScene', {});
    await qaHook(page, 'qaTeleportNearChapel');
    await expectRowVisible(page, 'chapelSanctuaryPrompt');

    const caption = page.locator('#captionToast');
    await page.keyboard.press('KeyE');
    await expect(caption).toContainText('shelter 15s for a free charm against the mist');
  });

  test('reducedMotion=true: the grant still fires its audio tell (engine cue, not withheld by reducedMotion)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await enableReducedMotion(page);
    await qaHook(page, 'qaBuildScene', {});
    await qaHook(page, 'qaTeleportNearChapel');
    await expectRowVisible(page, 'chapelSanctuaryPrompt');

    await page.keyboard.press('KeyE');
    const before = await qaHook(page, 'qaProbeEmbersPurchase');
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(DWELL + 0.5));

    expect((await qaHook(page, 'qaProbeVeil')).reserve, 'reducedMotion must not block the grant itself').toBe(true);
    const after = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(after.purchaseCueCount, 'reducedMotion only withholds visual pulses, never audio cues').toBeGreaterThan(before.purchaseCueCount);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 727, height: 393 } });

    test('tapping the shared touchInteract button starts the dwell and grants veilReserve on a touch device', async ({ page }) => {
      test.setTimeout(45_000);
      await boot(page, { qaHooks: true });

      const viewport = page.viewportSize();
      if (!viewport) throw new Error('mobile project must have a viewport size');
      await page.mouse.click(viewport.width / 2, viewport.height / 2);
      await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

      await qaHook(page, 'qaBuildScene', {});
      await qaHook(page, 'qaTeleportNearChapel');
      await expectRowVisible(page, 'chapelSanctuaryPrompt');

      const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
      const interactBtn = page.getByTestId('touchInteract');
      await expect(interactBtn).toBeVisible();
      await interactBtn.dispatchEvent('pointerdown', pointerOpts);

      expect((await qaHook(page, 'qaProbeChapelSanctuary')).chapelSanctuaryActive).toBe(true);

      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await advanceChunked(page, stepsFor(DWELL + 0.5));

      expect((await qaHook(page, 'qaProbeVeil')).reserve).toBe(true);
    });
  });
});
