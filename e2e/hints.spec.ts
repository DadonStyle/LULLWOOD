// LUL-2307: the generic first-encounter hint registry (engine/forest-engine.js's
// HINT_PRIORITY/HINT_TEXT) that generalizes LUL-2230's scent-only caption. See
// docs/specs/lul-2307-first-encounter-hints.md.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-clock.md),
// same as e2e/scent-trail.spec.ts, so every wait below is a game-time budget, not a
// wall-clock one.
//
// 'landmark' (fires unconditionally the instant entered() is true, no anchor needed)
// and 'deepwater' (the only mission kind that exists today, active as soon as a run
// starts) are both eligible from frame one regardless of where the player stands, and
// both sit ahead of most other keys in HINT_PRIORITY -- so on a fresh boot they win the
// "become active" race before a scenario further down the list (lake/wolf/...) ever
// gets a turn. clearPreemptiveHints() drains whichever of those is currently active,
// repeatedly, until nothing is -- so a test staging a specific key isn't just watching
// an unrelated hint play out first.
import { test, expect, type Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';
import { CONFIG } from '../engine/tuning';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function openSettings(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
}
const closeSettings = (page: Page) =>
  page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

async function assertNoOverlap(page: Page, selA: string, selB: string) {
  const locA = page.locator(selA), locB = page.locator(selB);
  if ((await locA.count()) === 0 || (await locB.count()) === 0) return;
  const a = await locA.boundingBox();
  const b = await locB.boundingBox();
  if (!a || !b || a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return;
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps, `${selA} (${JSON.stringify(a)}) must not overlap ${selB} (${JSON.stringify(b)})`).toBe(false);
}

/** Drains whichever hint is currently active (or about to become active) by waiting out
 * its 8s timeout, repeatedly, until a round produces no active hint at all. Requires
 * qaSetFixedStep to already be set. Bounded so a real regression (a key that never
 * clears) fails the test instead of hanging it. */
async function clearPreemptiveHints(page: Page, maxRounds = 4) {
  for (let i = 0; i < maxRounds; i++) {
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    if (!(await qaHook(page, 'qaProbeHints')).activeKey) return;
    await qaHook(page, 'qaAdvance', stepsFor(8.2));
  }
  throw new Error(`clearPreemptiveHints: a hint was still active after ${maxRounds} rounds`);
}

test.describe('first-encounter hints (LUL-2307)', () => {
  test('the landmark hint fires once on entry and never again, even across restarts', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    let probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey, "'landmark' must win the first eligible frame").toBe('landmark');
    const caption = page.locator('#hintCaption');
    await expect(caption).toContainText('landmarks in the fog are safe to navigate by');

    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).not.toBe('landmark');
    expect(probe.seen.landmark).toBe(true);
    // Not toHaveCount(0): 'deepwater' (HINT_PRIORITY's next always-eligible-at-spawn
    // key, see the 'the deepwater hint appears once the mission is active' test below)
    // legitimately takes the slot the instant landmark's own 8s window ends -- #hintCaption
    // stays mounted, just with different content. The behaviour this test actually cares
    // about -- landmark specifically is gone for good -- is already covered by activeKey/
    // seen.landmark above.
    await expect(caption).not.toContainText('landmarks in the fog are safe to navigate by');

    // The old bespoke behaviour fired this as a toast on every enter(), including
    // restarts -- the registry version must not: only the persisted "seen" flag decides.
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).not.toBe('landmark');
  });

  test('the lake hint appears on first entry into the water, not on a second visit', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await clearPreemptiveHints(page);

    await qaHook(page, 'qaTeleportTo', CONFIG.lake.x, CONFIG.lake.z);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    let probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('lake');
    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('chest-deep water — half pace. predators wade too');
    await assertNoOverlap(page, '#hintCaption', '#objective');
    await assertNoOverlap(page, '#hintCaption', '#missionPanel');
    await assertNoOverlap(page, '#hintCaption', '#windIndicatorHint');

    // Gone within 8s, marked seen.
    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).not.toBe('lake');
    expect(probe.seen.lake).toBe(true);
    await expect(caption).toHaveCount(0);

    // Leave, come back -- must not reappear.
    await qaHook(page, 'qaTeleportTo', 0, 0);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    await qaHook(page, 'qaTeleportTo', CONFIG.lake.x, CONFIG.lake.z);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey, 'an already-seen hint must not retrigger').not.toBe('lake');
  });

  test('the deepwater hint appears once the mission is active', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('deepwater');
    expect(mission?.status).toBe('active');

    // Only 'landmark' precedes 'deepwater' among the keys eligible at spawn with no
    // player action -- drain it, then deepwater must be next up.
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');
    await qaHook(page, 'qaAdvance', stepsFor(8.1));

    const probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('deepwater');
    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('deepwater — reach the drowned car for a bonus payout on a run you survive');
  });

  test('a first-sighted wolf shows its caption once', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await clearPreemptiveHints(page);

    const map = await qaHook(page, 'qaProbeMapSeed');
    const wolf = (map.predators as { kind: string; x: number; z: number }[]).find((p) => p.kind === 'wolf');
    expect(wolf, 'the pinned seed must spawn a wolf').toBeTruthy();

    // Stand 10 units south of the wolf (well inside its detect radius, tuning.js
    // wolf.detect=42) facing due north (yaw=0 -> fx=0,fz=-1, engine/forest-engine.js's
    // playerCanSee()) so it's dead-center in the camera frustum, not just in range.
    await qaHook(page, 'qaTeleportTo', wolf!.x, wolf!.z + 10);
    await qaHook(page, 'qaSetLookYaw', 0);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    const probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('wolf');
    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("a wolf — faster than you. hide (H) or veil (F), don't outrun");

    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    const after = await qaHook(page, 'qaProbeHints');
    expect(after.activeKey).not.toBe('wolf');
    expect(after.seen.wolf).toBe(true);
  });

  test('turning Show hints off suppresses every hint', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await openSettings(page);
    const toggle = page.getByLabel(/show hints/i);
    await expect(toggle).toBeChecked();
    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).not.toBeChecked();
    await closeSettings(page);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBeNull();
    await expect(page.locator('#hintCaption')).toHaveCount(0);
    await expect(page.locator('#scentTrailCaption')).toHaveCount(0);
  });

  test('Reset hints re-arms an already-seen key', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');
    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    expect((await qaHook(page, 'qaProbeHints')).seen.landmark).toBe(true);

    await qaHook(page, 'qaResetHints');
    const afterReset = await qaHook(page, 'qaProbeHints');
    expect(afterReset.seen.landmark).toBe(false);
    expect(afterReset.activeKey).toBeNull();

    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey, 're-armed key must be able to fire again').toBe('landmark');
  });

  test('the Reset hints button clears the persisted seen-map from the Settings panel', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');
    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    expect((await qaHook(page, 'qaProbeHints')).seen.landmark).toBe(true);

    await openSettings(page);
    await page.getByRole('button', { name: 'Reset hints' }).evaluate((el) => (el as HTMLElement).click());
    await closeSettings(page);

    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    const probe = await qaHook(page, 'qaProbeHints');
    expect(probe.seen.landmark).toBe(false);
    expect(probe.activeKey).toBe('landmark');
  });

  test('never shows over the win or death screen', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');

    await qaHook(page, 'qaForceDeath', 'wolf', 'chase');
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    await expect(page.locator('#hintCaption')).toHaveCount(0);
    await expect(page.locator('#scentTrailCaption')).toHaveCount(0);
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBeNull();
  });
});
