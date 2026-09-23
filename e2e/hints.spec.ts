// LUL-2307: the generic first-encounter hint registry (engine/forest-engine.js's
// HINT_PRIORITY/HINT_TEXT) that generalizes LUL-2230's scent-only caption. See
// docs/specs/lul-2307-first-encounter-hints.md.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-clock.md),
// same as e2e/scent-trail.spec.ts, so every wait below is a game-time budget, not a
// wall-clock one.
//
// 'landmark' (fires unconditionally the instant entered() is true, no anchor needed)
// and whichever mission kind was drawn this run (LUL-3010: 'deepwater' or 'oakHollow',
// active as soon as a run starts -- a fresh boot's progression has no wins yet, so the
// eligibility gate means a plain `boot()` always draws 'oakHollow'; tests below that need
// 'deepwater' specifically pass `qaMissionKind: 'deepwater'`) are both eligible from frame
// one regardless of where the player stands, and both sit ahead of most other keys in
// HINT_PRIORITY -- so on a fresh boot they win the "become active" race before a scenario
// further down the list (bog/wolf/...) ever gets a turn. clearPreemptiveHints() drains
// whichever of those is currently active, repeatedly, until nothing is -- so a test
// staging a specific key isn't just watching an unrelated hint play out first.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function openSettings(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
}
const closeSettings = (page: Page) =>
  page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

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
    // LUL-2422: this test idles at spawn through two back-to-back 8s+ windows with no
    // player action -- on the 96u micro world (LUL-2377 default) a seeded predator can
    // already be within its (post-LUL-2407-scaled) detect/travel range of spawn and kill
    // the idle player before either window elapses, which reads as "the hint just never
    // showed" (activeKey stuck null, seen never set) since triggerDeath() drops
    // baseHintEligible via hudState.deathVisible. This test is about hint timing, not
    // survival, so park every predator first -- same tool qaTeleportToHideSpot's own
    // comment (`:4638`) documents for exactly this "can't be seen or scented" need.
    await qaHook(page, 'qaBuildScene', { predators: [] });

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

  test('the deepwater hint appears once the mission is active', async ({ page }) => {
    // LUL-3010: this test asserts deepwater-specific behaviour; force it past the new
    // eligibility gate (fresh progression would otherwise only draw oakHollow).
    await boot(page, { qaHooks: true, qaMissionKind: 'deepwater' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    // LUL-2422: see the landmark test's comment above -- this test idles at spawn
    // through the same landmark-drain window before deepwater can take the slot.
    await qaHook(page, 'qaBuildScene', { predators: [] });

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
    await expect(caption).toContainText('the drowned car — a bonus payout, but only if you reach it within the time limit');
  });

  test('a first-sighted wolf shows its caption once', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await clearPreemptiveHints(page);

    const map = await qaHook(page, 'qaProbeMapSeed');
    const wolf = (map.predators as { kind: string; x: number; z: number }[]).find((p) => p.kind === 'wolf');
    expect(wolf, 'the pinned seed must spawn a wolf').toBeTruthy();

    // LUL-2878: a fixed 10-unit offset assumed tuning.js's unscaled wolf.detect=42,
    // but effectiveDetect() scales that down (veil/fog/time-of-run/difficulty/
    // CONFIG.detectScaleMul) and can land under 10u on the micro QA world --
    // read the real scaled gate and stand well inside it instead.
    const detect = await qaHook(page, 'qaProbeEffectiveDetect', 'wolf');
    expect(detect, 'wolf must be spawned for its effectiveDetect() to resolve').not.toBeNull();
    const standoff = Math.min(10, detect! * 0.5);

    // Stand `standoff` units south of the wolf, well inside its scaled detect
    // radius, facing due north (yaw=0 -> fx=0,fz=-1, engine/forest-engine.js's
    // playerCanSee()) so it's dead-center in the camera frustum, not just in range.
    await qaHook(page, 'qaTeleportTo', wolf!.x, wolf!.z + standoff);
    await qaHook(page, 'qaSetLookYaw', 0);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    const probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('wolf');
    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("a wolf — faster than you. hide (H) or veil (F), don't outrun");

    // LUL-2891: standoff is deliberately inside the wolf's real effectiveDetect()
    // radius, so a wolf already hunting (from before this test even teleported the
    // player in) can close that gap and kill the player well before the hint's own
    // 8s timeout -- a real chase/death, not a hint-system bug, but it reads as one
    // (eligibility loss from hudState.deathVisible clears the hint without ever
    // reaching the elapsed>=8 branch, so seen.wolf never gets marked). Re-pin the
    // wolf to the same standoff every 0.2s (well under the ~1s it took to close
    // and kill in a live repro) so it never reaches contact range while we wait
    // out the real 8s timeout -- qaStagePredatorNearPlayer also resets hunt/alert,
    // which is fine here since hintCandidate('wolf') only reads live distance,
    // never predator state.
    for (let waited = 0; waited < 8.1; waited += 0.2) {
      await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 0, -standoff);
      await qaHook(page, 'qaAdvance', stepsFor(Math.min(0.2, 8.1 - waited)));
    }
    const after = await qaHook(page, 'qaProbeHints');
    expect(after.activeKey).not.toBe('wolf');
    expect(after.seen.wolf).toBe(true);
  });

  // LUL-2307 review fix: the eligibility-loss check used to run before the
  // event dismiss check, so for wolf/bear/lion/cover/throwable/stamina the
  // dismissing interaction itself (hide, grab, stamina regen) flipped
  // eligibility false in the same frame, and markHintSeen() was never reached
  // -- the hint reshowed on every subsequent encounter instead of once.
  test('hiding from a first-sighted wolf marks its hint seen instead of leaving it to reshow', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await clearPreemptiveHints(page);

    const staged = await qaHook(page, 'qaHideBehindCoverKind', 'wolf');
    expect(staged, 'qaHideBehindCoverKind returned null -- no wolf-clearable cover at this seed').not.toBeNull();

    // qaHideBehindCoverKind places the player on the +side of a cover prop and
    // the wolf further out on the -side, both along the same axis -- face -x
    // (yaw=PI/2, forward = (-sin(yaw),-cos(yaw))) so the wolf's anchor is in
    // the camera frustum once the turn settles. LUL-2878: unlike the sibling
    // "shows its caption once" test (which sets yaw to 0, its already-default
    // value -- no real turn, no lag), this is a real yaw change from the
    // default heading, and the camera's own facing lags player.yaw by about
    // one 0.1s batch before projectToScreen() puts the wolf back in frustum.
    // LUL-2957: a fixed two-batch wait still went unlucky on the nightly rig
    // (activeKey read back null -- neither 'wolf' nor 'cover' had settled into
    // frustum yet), so poll a few more fixed-step batches instead of trusting
    // a hardcoded count -- same "advance until it settles" idiom as the
    // re-pin loop below, still driven entirely by qaAdvance's deterministic
    // clock, never a wall-clock wait.
    await qaHook(page, 'qaSetLookYaw', Math.PI / 2);
    let probe = await qaHook(page, 'qaProbeHints');
    for (let attempt = 0; attempt < 5 && probe.activeKey !== 'wolf'; attempt++) {
      await qaHook(page, 'qaAdvance', stepsFor(0.1));
      probe = await qaHook(page, 'qaProbeHints');
    }
    expect(probe.activeKey, "'wolf' should win the priority race over 'cover', also eligible here").toBe('wolf');

    await page.keyboard.press('KeyH');
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey, 'hiding should dismiss the active wolf hint').not.toBe('wolf');
    expect(probe.seen.wolf, 'hiding is the documented dismiss event -- it must mark the hint seen, not just clear it').toBe(true);

    // Re-sighting the same species after hiding must not show the caption again.
    await qaHook(page, 'qaAdvance', stepsFor(0.5));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).not.toBe('wolf');
  });

  test('grabbing a throwable marks its hint seen instead of leaving it to reshow', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await clearPreemptiveHints(page);
    // wolf/bear/lion sit ahead of 'throwable' in HINT_PRIORITY, and the micro
    // world routinely spawns a wolf already in 'investigate' a few units from
    // where qaTeleportNearThrowable lands the player -- whether it's within
    // effectiveDetect() at the exact probe frame is a coin flip (observed:
    // 'wolf' wins the slot instead of 'throwable' on about 1 in 4 runs at this
    // seed). This test isolates the throwable/hint path, not predator
    // proximity, so park every predator first (qaClearAllPredators precedent:
    // e2e/day-night-cycle.spec.ts) to remove the race entirely.
    await qaHook(page, 'qaClearAllPredators');

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    // qaTeleportNearThrowable places the player +2 along x from the stone --
    // face -x (yaw=PI/2) so the stone's anchor is in the camera frustum. Real
    // yaw change from the default heading, so the camera's own facing lags
    // player.yaw by about one 0.1s batch before projectToScreen() puts the
    // stone back in frustum -- same LUL-2878 lag as the wolf hint test above,
    // advance twice so the scan runs after it settles.
    await qaHook(page, 'qaSetLookYaw', Math.PI / 2);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    let probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).toBe('throwable');

    await qaHook(page, 'qaGrabThrowable');
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey, 'grabbing should dismiss the active throwable hint').not.toBe('throwable');
    expect(probe.seen.throwable, 'grabbing is the documented dismiss event -- it must mark the hint seen, not just clear it').toBe(true);
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

  // LUL-4677: winVisible only flips true in finishPickup() at e>=11.3, but fireBoom()
  // (the win-burst #flash) fires earlier at e>=9.3 -- so the e=9.3..11.3 window has
  // pickingUp=true, carrying=false, winVisible=false, and an eligible hint (oakHollow,
  // gated only on mission active && !carrying) rendered right over the burst.
  test('does not show over the pickup cinematic burst (LUL-4677)', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'oakHollow' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', { predators: [] });

    // Only 'landmark' precedes 'oakHollow' among the keys eligible at spawn with no
    // player action (same race as the deepwater test above) -- drain it first.
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');
    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('oakHollow');

    await qaHook(page, 'qaTeleportNearBaby');
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    await page.keyboard.press('KeyE');
    const probe = await qaHook(page, 'qaProbeBabyLight');
    expect(probe.pickingUp, 'KeyE did not start the pickingUp cinematic').toBe(true);

    // Cleared the instant pickingUp goes true, well before fireBoom() at e>=9.3.
    await qaHook(page, 'qaAdvance', stepsFor(0.02));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBeNull();
    await expect(page.locator('#hintCaption')).toHaveCount(0);

    // Still clear through the burst itself and up to winVisible flipping at e>=11.3.
    await qaHook(page, 'qaAdvance', stepsFor(9.32));
    expect((await qaHook(page, 'qaProbeHints')).activeKey).toBeNull();
    await expect(page.locator('#hintCaption')).toHaveCount(0);
  });
});
