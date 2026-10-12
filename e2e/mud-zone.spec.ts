// LUL-5565 (split 2/2 of LUL-5558, LUL-5564 landed the engine core): HUD prompt + e2e
// coverage for the Mud Zone terrain hazard. mudSpeedMultiplier/mudNoiseMultiplier
// (lib/game/mud.ts) slow the player 40% and multiply footstep noise 1.5x while
// isInMudZone(player.x, player.z, mudZones) is true; the engine already does the full
// first-encounter caption + hint-seen gating on its own (stepFrame(), engine/forest-
// engine.js's mudEnterCue()/hintSeen('mudZone')) -- this file drives real engine state,
// not a qa*-only shortcut, matching Q11/Q12 of the feature checklist.
//
// Detection case: NOISE_RADIUS_WALK (14) < 17.5 < NOISE_RADIUS_WALK * MUD_NOISE_MUL (21),
// so a plain walk at 17.5u is inaudible on dry ground but in range once mud's 1.5x applies.
// isNoiseHeard() rolls Math.random() < HEAR_CHANCE_PER_SEC*dt every in-range tick (same
// probabilistic shape e2e/wind-deafness-mud.spec.ts documents for the sprint/wind-assist
// case) -- over 8 sim-seconds at FIXED_DT=0.02 the cumulative miss chance is the same
// accepted ~1.8% flake budget that file's own 20u test uses, not a hook gap.
//
// The player is re-pinned to the mud zone's center every tick (qaTeleportTo) so its walk
// input (needed for noiseRadius to be computed at all -- the engine only sets it inside
// the `mag > 0` movement branch) never carries it out of the zone, while the wolf is
// re-pinned to a fixed offset from the player (qaStagePredatorNearPlayer, same technique
// e2e/wind-deafness-mud.spec.ts uses) so the two stay at a constant 17.5u apart.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const MUD_CENTER = { x: 0, z: 0 };
const MUD_RADIUS = 10;
const WOLF_OFFSET = { dx: 17.5, dz: 0 };

async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  // el.click(), not .check() -- the wrapping <label> intercepts real actionability
  // polling in this rig even though it's genuinely clickable (e2e/hide-alert.spec.ts
  // precedent, wiki:systems/lul44-diagnosis-and-fix).
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

/** Walks the player in place at MUD_CENTER (KeyW held, teleported back to center every
 * tick so the `mag > 0` movement branch runs -- and noiseRadius gets computed -- without
 * the player ever drifting out of the zone) while re-pinning the wolf to a fixed offset,
 * probing after each tick and returning the first non-'roam' state reached, or null. */
async function walkInPlaceUntilHeard(page: Page, ticks: number) {
  return page.evaluate(
    ({ ticks, center, offset }) => {
      const fe = window.ForestEngine!;
      fe.qaTeleportTo!(center.x, center.z);
      for (let i = 0; i < ticks; i++) {
        fe.qaStagePredatorNearPlayer!('wolf', offset.dx, offset.dz);
        fe.qaAdvance!(1, true);
        fe.qaTeleportTo!(center.x, center.z);
        const st = fe.qaProbePredatorState!('wolf');
        if (st && st.state !== 'roam') return st.state;
      }
      return null;
    },
    { ticks, center: MUD_CENTER, offset: WOLF_OFFSET },
  );
}

test.describe('Mud Zone hazard (LUL-5558/LUL-5564/LUL-5565)', () => {
  test('inMudZone flips true inside the zone, false outside', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaBuildScene', { mudZones: [{ x: MUD_CENTER.x, z: MUD_CENTER.z, r: MUD_RADIUS }] });

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x, MUD_CENTER.z);
    expect((await qaHook(page, 'qaPlayerState')).inMudZone).toBe(true);

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x + MUD_RADIUS + 5, MUD_CENTER.z);
    expect((await qaHook(page, 'qaPlayerState')).inMudZone).toBe(false);
  });

  test('#mudPrompt shows while inMudZone, hidden outside -- adminMode off', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { mudZones: [{ x: MUD_CENTER.x, z: MUD_CENTER.z, r: MUD_RADIUS }] });
    expect(await page.evaluate(() => document.body.getAttribute('data-admin-mode')), 'adminMode must be off by default for this assertion').toBe('0');

    // Don't assume the default spawn is outside the zone -- place the player
    // explicitly before asserting either state.
    const prompt = page.locator('#mudPrompt');
    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x + MUD_RADIUS + 5, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await expect(prompt).toHaveAttribute('data-visible', '0');

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await expect(prompt).toHaveAttribute('data-visible', '1');
    await expect(prompt).toContainText('In mud');

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x + MUD_RADIUS + 5, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await expect(prompt).toHaveAttribute('data-visible', '0');
  });

  test('the first-mud-entry caption shows once and does not repeat', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await enableCaptions(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { mudZones: [{ x: MUD_CENTER.x, z: MUD_CENTER.z, r: MUD_RADIUS }] });
    await qaHook(page, 'qaResetHints');

    const caption = page.locator('#captionToast');

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x + MUD_RADIUS + 5, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('Mud');

    // Let the toast's own auto-hide timer (CAPTION_DISPLAY_MS, components/Hud.tsx) clear
    // before leaving/re-entering, so the second entry's (lack of) caption isn't masked
    // by the first's still-visible toast -- same auto-retrying wait e2e/hide-alert.spec.ts
    // uses for the analogous hide-caption case.
    await expect(caption).toHaveCount(0, { timeout: 10000 });

    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x + MUD_RADIUS + 5, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await qaHook(page, 'qaTeleportTo', MUD_CENTER.x, MUD_CENTER.z);
    await qaHook(page, 'qaAdvance', 1, true);
    await page.waitForTimeout(300);
    await expect(caption).toHaveCount(0);
  });

  test('a roaming wolf hears a walking player in mud at 17.5u, where the same walk outside mud does not', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: WOLF_OFFSET.dx, z: WOLF_OFFSET.dz, state: 'roam' }],
      mudZones: [{ x: MUD_CENTER.x, z: MUD_CENTER.z, r: MUD_RADIUS }],
    });

    await page.keyboard.down('KeyW');
    const mudState = await walkInPlaceUntilHeard(page, stepsFor(8));
    await page.keyboard.up('KeyW');
    expect(mudState, 'a roaming wolf must hear a walking player in mud at 17.5u (< 21, NOISE_RADIUS_WALK * MUD_NOISE_MUL)').toBe('investigate');

    // Companion negative case: identical staging, same 17.5u offset, no mud zone --
    // proves the extra range is mud-gated, not an unconditional loosening of the
    // walking noise radius.
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: WOLF_OFFSET.dx, z: WOLF_OFFSET.dz, state: 'roam' }],
    });

    await page.keyboard.down('KeyW');
    const dryState = await walkInPlaceUntilHeard(page, stepsFor(8));
    await page.keyboard.up('KeyW');
    expect(dryState, 'the same walk at 17.5u must never be heard outside mud (14 < 17.5)').toBeNull();
  });
});
