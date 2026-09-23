// LUL-2856: cover-degradation cheap slice -- a roaming predator within
// HIDE_ALERT_RADIUS gets a fresh chance to be alerted every COVER_RUSTLE_INTERVAL_S
// once hideTime clears COVER_RUSTLE_THRESHOLD_S (engine/forest-engine.js's
// rollCoverRustle(), driven by the tick-loop check next to the existing hideTime
// line). See docs/specs/lul-2856-cover-degradation-cheap-slice.md.
//
// Deliberately its own file: e2e/hide.spec.ts is explicitly predator-free per its
// own header comment, and e2e/cover-feedback.spec.ts covers the unrelated
// LOS-covered signal, not this noise broadcast.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, advanceChunked } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// COVER_RUSTLE_THRESHOLD_S=12 + COVER_RUSTLE_INTERVAL_S=5 (lib/game/noise.ts) = 17s
// to the first roll. 17.4s clears it with margin while staying well short of the
// next roll at 22s.
const PAST_FIRST_ROLL_S = 17.4;
const BEFORE_THRESHOLD_S = 11.4;
// A `roam`-state predator wanders (updatePredators()'s own steering), so a wolf staged
// dx/dz from the player at t=0 has drifted well off that offset by the time hideTime
// clears 17s -- outside HIDE_ALERT_RADIUS even though it started inside it. Stage it
// late instead: advance most of the way with the wolf still parked far off (no entry
// alert risk either), then reposition it dx/dz from the player's *current* spot right
// before the roll, leaving only LATE_STAGE_TAIL_S of wander to land on the exact offset.
const LATE_STAGE_LEAD_S = 16.0;
const LATE_STAGE_TAIL_S = 1.4;

// LUL-4790: blackout's scaled threshold+interval (8s+4s=12s) vs night's unscaled 17s
// first roll -- 13s clears blackout's first roll with margin while staying well short
// of night's.
const BLACKOUT_PAST_FIRST_ROLL_S = 13;
// lantern's scaled threshold+interval (16s+6s=22s) -- PAST_FIRST_ROLL_S (17.4s, night's
// baseline first-roll time) clears night's own first roll but stays short of lantern's.

const RUSTLE_SCENE = {
  props: [{ kind: 'bramble' as const, x: 10, z: 0 }],
  // Parked far away (same 9999,9999/roam shape as hide-alert.spec.ts's HIDE_SCENE) so
  // entering hide never fires enterHide()'s own one-shot entry alert -- that alert and
  // this cover-rustle roll share the same roam-only gate, so if the wolf were staged
  // within HIDE_ALERT_RADIUS before KeyH, the entry alert would flip it to
  // 'investigate' before the rustle check ever got a turn.
  predators: [{ kind: 'wolf' as const, x: 9999, z: 9999, state: 'roam' }],
};

// Enters hide while the wolf is still parked out of range (no entry alert) -- isolating
// the cover-rustle roll from enterHide()'s own alert broadcast.
async function stageHidden(page: Page) {
  // LUL-2804/LUL-2283 ordering: qaSetFixedStep() before any staging hook.
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await qaHook(page, 'qaBuildScene', RUSTLE_SCENE);
  const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
  if (spot === null) {
    throw new Error('qaTeleportToHideSpot returned null -- no bramble hiding spot was found for this seed');
  }
  await page.keyboard.press('KeyH');
}

// stageHidden(), then repositions the wolf dx/dz from the player via
// qaStagePredatorNearPlayer for the in/out-of-radius variants.
async function stageHiddenThenPredator(page: Page, dx: number, dz: number) {
  await stageHidden(page);
  const staged = await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', dx, dz);
  expect(staged, 'wolf must have spawned this seed').not.toBeNull();
  return staged;
}

// Same as stageHiddenThenPredator, but repositions the wolf right before the first roll
// instead of at t=0, so the roam-state wander between staging and the roll can't carry it
// off the intended dx/dz offset (see LATE_STAGE_LEAD_S/TAIL_S above). Leaves the sim
// exactly LATE_STAGE_TAIL_S short of the caller's own final advance to the roll.
async function stageHiddenThenLateStagePredator(page: Page, dx: number, dz: number) {
  await stageHidden(page);
  await advanceChunked(page, stepsFor(LATE_STAGE_LEAD_S));
  const staged = await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', dx, dz);
  expect(staged, 'wolf must have spawned this seed').not.toBeNull();
  await advanceChunked(page, stepsFor(LATE_STAGE_TAIL_S));
  return staged;
}

// LUL-4790: real Settings UI path (not a QA hook), matching
// e2e/minimap-setting.spec.ts's exact click sequence -- DIFFICULTY_PRESETS[difficulty]
// is read live every tick the same way detectMul already is, so no qaRegenerateMap
// is needed here.
async function selectDifficulty(page: Page, label: RegExp) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel(label).evaluate((el) => (el as HTMLInputElement).click());
}

async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  // el.click(), not a real Playwright .check() -- same wrapping-label
  // actionability workaround as e2e/hide-alert.spec.ts's identical helper.
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
  await page.locator('#sound').evaluate((el) => (el as HTMLElement).click());
}

test.describe('cover-rustle degradation (LUL-2856)', () => {
  test('a roaming predator within HIDE_ALERT_RADIUS is alerted by a rustle roll past the hideTime threshold', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    const staged = await stageHiddenThenLateStagePredator(page, 15, 0);

    const state = await qaHook(page, 'qaPredatorState', staged.idx);
    expect(state?.state).toBe('investigate');

    const chronicle = await qaHook(page, 'qaGetChronicle');
    expect(chronicle.some((e: any) => e.code === 'cover_rustle' && e.args?.alerted === 1)).toBe(true);
  });

  test('stays unaware outside the radius', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    const staged = await stageHiddenThenPredator(page, 25, 0);

    await advanceChunked(page, stepsFor(PAST_FIRST_ROLL_S));

    const state = await qaHook(page, 'qaPredatorState', staged.idx);
    expect(state?.state).toBe('roam');

    const chronicle = await qaHook(page, 'qaGetChronicle');
    const rustles = chronicle.filter((e: any) => e.code === 'cover_rustle');
    expect(rustles.length).toBeGreaterThan(0);
    expect(rustles[rustles.length - 1].args?.alerted).toBe(0);
  });

  test('does not roll before the threshold', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    // Staged within radius -- the antagonist proof: if the roll fired early (or the
    // threshold gate were missing), this wolf would flip to 'investigate' the instant
    // it fires, which is exactly what this assertion would catch.
    const staged = await stageHiddenThenPredator(page, 15, 0);

    await advanceChunked(page, stepsFor(BEFORE_THRESHOLD_S));

    const state = await qaHook(page, 'qaPredatorState', staged.idx);
    expect(state?.state).toBe('roam');

    const chronicle = await qaHook(page, 'qaGetChronicle');
    expect(chronicle.some((e: any) => e.code === 'cover_rustle')).toBe(false);
  });

  test('fires the one-time hint caption with captions enabled', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await enableCaptions(page);
    await qaHook(page, 'qaResetHints');
    // rollCoverRustle()'s hint caption fires unconditionally, regardless of whether any
    // predator was actually alerted -- the wolf stays parked at its default (9999,9999).
    await stageHidden(page);

    const caption = page.locator('#captionToast');
    await advanceChunked(page, stepsFor(PAST_FIRST_ROLL_S));

    await expect(caption).toContainText('Sitting still too long stirs the brush');
  });

  test('still flashes under reduced motion, at the fixed-opacity clamp', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    // rollCoverRustle() sets rustleFlash unconditionally, independent of whether any
    // predator is actually in range -- the wolf stays parked at its default (9999,9999).
    await stageHidden(page);

    await advanceChunked(page, stepsFor(PAST_FIRST_ROLL_S));

    const opacity = await page.locator('#rustleFlash').evaluate((el) => (el as HTMLElement).style.opacity);
    expect(opacity).toBe('0.15');
  });

  test('blackout\'s shorter grace window fires a rustle before night\'s baseline threshold at the same elapsed hide time', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await selectDifficulty(page, /blackout/i);
    // rollCoverRustle() fires unconditionally on the roll -- the wolf stays parked at
    // its default (9999,9999), this is purely about whether the roll fired at all.
    await stageHidden(page);

    await advanceChunked(page, stepsFor(BLACKOUT_PAST_FIRST_ROLL_S));

    const chronicle = await qaHook(page, 'qaGetChronicle');
    expect(chronicle.some((e: any) => e.code === 'cover_rustle')).toBe(true);
  });

  test('lantern\'s longer grace window has not yet fired at night\'s baseline first-roll time', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await selectDifficulty(page, /lantern/i);
    await stageHidden(page);

    await advanceChunked(page, stepsFor(PAST_FIRST_ROLL_S));

    const chronicle = await qaHook(page, 'qaGetChronicle');
    expect(chronicle.some((e: any) => e.code === 'cover_rustle')).toBe(false);
  });
});
