// LUL-2205 (backfill for LUL-1709, per docs/specs/day-night-cycle.md's '## e2e'
// section, LUL-2190): timeOfRun is the engine's live pacing clock, 0 (dawn) to
// 1 (full night) over TIME_OF_RUN_DURATION_S (120s) of actual play. It feeds
// fog density, ambient (hemisphere) light, predator detect radius, and a
// plain-text HUD clock. Uses qaSetFixedStep/qaAdvance (LUL-2071, exercised in
// e2e/qa-fixed-clock.spec.ts) to fast-forward the full 120s deterministically
// -- never page.waitForTimeout(120_000) or real wall time. Asserts through
// qaProbeTimeOfRun() (the engine-visible effect: timeOfRun, fogDensity,
// hemiIntensity, detectMul, clock) rather than only the #timeOfRunClock DOM
// text, per e2e/README.md's "assert the effect, not the DOM node" rule.
//
// LUL-4889 (Dusk Stealth, lion-only): duskLionDetectMul(runElapsed) is a
// second, separate curve on the same live clock, kept in this file (not a
// new dusk.spec.ts) per the ticket's own instruction -- one clock, one
// coverage file. lionDetectMul is asserted the same way as detectMul above:
// through qaProbeTimeOfRun(), the engine-visible effect, not a live
// predator race (predators are cleared here exactly like the other two
// tests -- see their LUL-2457 comment on why a mid-poll kill would silently
// stop runElapsed and read as a dusk-stealth bug it isn't).
import { test, expect } from './fixtures';
import { boot, enter, qaHook, advanceChunked, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('day/night cycle (timeOfRun)', () => {
  test('timeOfRun ramps 0 -> 1 over TIME_OF_RUN_DURATION_S and resets to 0 on restart', async ({ page }) => {
    // LUL-2802: 75s, not 45s -- see advanceChunked's comment in helpers.ts.
    // Worst case is one 120-step advanceChunked call (5 chunks * 6s = 30s)
    // plus boot/enter/death-restart overhead; 45s left no margin and this
    // test showed the bare-timeout signature in CI (shard 1, run 35086869286).
    test.setTimeout(75_000);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park the RAF loop before entering: enter()'s gate-fade/pointer-lock
    // settle wait (helpers.ts) is ~1.2s of real time during which `playing`
    // is already true, so real frames would otherwise advance runElapsed
    // before the test ever gets a fixed-step handle on it.
    await qaHook(page, 'qaSetFixedStep', 1); // 1 game-second per step
    await enter(page);
    // LUL-2457: 130s of game time is easily enough for an unrelated ambient
    // predator to reach the stationary player even at the QA-map-scaled
    // detect/speed -- a mid-poll kill silently stops runElapsed, reading as
    // a timeOfRun bug instead of the ambient kill it actually is.
    await qaHook(page, 'qaClearAllPredators');

    // Made to fail once on purpose: a fresh run must start at dawn, not mid-ramp.
    const atStart = await qaHook(page, 'qaProbeTimeOfRun');
    expect(atStart.timeOfRun).toBe(0);

    await advanceChunked(page, 120); // 120 x 1s == TIME_OF_RUN_DURATION_S

    const atFullNight = await qaHook(page, 'qaProbeTimeOfRun');
    expect(atFullNight.timeOfRun).toBeCloseTo(1, 5);

    // clamps at 1, doesn't run past full night
    await qaHook(page, 'qaAdvance', 10);
    const afterOvershoot = await qaHook(page, 'qaProbeTimeOfRun');
    expect(afterOvershoot.timeOfRun).toBe(1);

    // restart() -> enter() resets runElapsed to 0; a run after the first must
    // not start already partway into the night ramp.
    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());

    // timeOfRun is only recomputed inside stepFrame(), so one more fixed step
    // is needed to observe the post-restart value -- qaFixedDt survives
    // restart() (it isn't part of freshRunState()), so qaSetFixedStep need
    // not be called again.
    await qaHook(page, 'qaAdvance', 1);
    const afterRestart = await qaHook(page, 'qaProbeTimeOfRun');
    expect(afterRestart.timeOfRun).toBeLessThan(0.01);

    expectNoConsoleErrors(errs);
  });

  test('fog density, ambient light, and predator detect radius all ramp with timeOfRun', async ({ page }) => {
    test.setTimeout(75_000); // LUL-2802: see the first test's comment
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park before entering -- see the previous test's comment: enter()'s
    // ~1.2s settle wait otherwise runs real frames while already `playing`.
    await qaHook(page, 'qaSetFixedStep', 1);
    await enter(page);
    await qaHook(page, 'qaClearAllPredators'); // LUL-2457: see the ramp test's comment

    const dawn = await qaHook(page, 'qaProbeTimeOfRun');
    // Made to fail once on purpose: at dawn the detect multiplier must be a no-op (1x).
    expect(dawn.detectMul).toBe(1);

    await advanceChunked(page, 120);

    const night = await qaHook(page, 'qaProbeTimeOfRun');
    expect(night.timeOfRun).toBeCloseTo(1, 5);
    // Fog thickens toward full night (TIME_OF_RUN_FOG_DELTA is additive and positive).
    expect(night.fogDensity).toBeGreaterThan(dawn.fogDensity);
    // Ambient light dims toward full night (hemiLight.intensity ramps to 0.3x).
    expect(night.hemiIntensity).toBeLessThan(dawn.hemiIntensity);
    // Predators see further at full night (TIME_OF_RUN_DETECT_MUL == 1.3).
    expect(night.detectMul).toBeCloseTo(1.3, 5);
    expect(night.detectMul).toBeGreaterThan(dawn.detectMul);

    expectNoConsoleErrors(errs);
  });

  test('HUD clock reads 6:00 AM at dawn and 9:00 PM at full night', async ({ page }) => {
    test.setTimeout(75_000); // LUL-2802: see the first test's comment
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park before entering -- see the ramp test's comment: enter()'s ~1.2s
    // settle wait otherwise runs real frames while already `playing`.
    await qaHook(page, 'qaSetFixedStep', 1);
    await enter(page);
    await qaHook(page, 'qaClearAllPredators'); // LUL-2457: see the ramp test's comment

    const dawn = await qaHook(page, 'qaProbeTimeOfRun');
    expect(dawn.clock).toBe('6:00 AM');
    // Made to fail once on purpose: the DOM readout must actually reflect the
    // engine value, not just render some placeholder text.
    await expect(page.locator('#timeOfRunClock')).toContainText('6:00 AM');

    await advanceChunked(page, 120);

    const night = await qaHook(page, 'qaProbeTimeOfRun');
    expect(night.clock).toBe('9:00 PM');
    await expect(page.locator('#timeOfRunClock')).toContainText('9:00 PM');

    expectNoConsoleErrors(errs);
  });

  test('lion-only dusk sight decay: lionDetectMul ramps 1.0 -> 0.5 from 90s to 150s runElapsed, ambient detectMul (wolf/bear) unaffected, duskLion hint fires once', async ({ page }) => {
    // LUL-2802: see the first test's comment on the 45s->75s bump -- this test
    // advances 160 fixed-dt steps total (7 ADVANCE_CHUNK(25) chunks) vs. the
    // other tests' single 120-step (5-chunk) call, so it gets proportionally
    // more worst-case budget: 90s.
    test.setTimeout(90_000);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await qaHook(page, 'qaSetFixedStep', 1);
    await enter(page);
    await qaHook(page, 'qaClearAllPredators'); // LUL-2457: see the ramp test's comment

    const before = await qaHook(page, 'qaProbeTimeOfRun');
    expect(before.lionDetectMul).toBe(1); // below DUSK_LION_SIGHT_START_S (90s)

    await advanceChunked(page, 80);
    const at80 = await qaHook(page, 'qaProbeTimeOfRun');
    expect(at80.lionDetectMul).toBe(1); // still below 90s

    await advanceChunked(page, 40); // runElapsed == 120s, the 90-150s ramp's midpoint
    const at120 = await qaHook(page, 'qaProbeTimeOfRun');
    expect(at120.lionDetectMul).toBeCloseTo(0.75, 5); // 1 + 0.5 * (0.5 - 1)
    // Regression guard for the p.kind === 'lion' branch in timeOfRunDetectMulFor():
    // detectMul (what wolf/bear still call) keeps following the unrelated ambient
    // ramp -- it must not have been cut by the lion-only curve above.
    expect(at120.detectMul).toBeCloseTo(1 + (120 / 120) * 0.3, 5);

    await advanceChunked(page, 40); // runElapsed == 160s, past the 150s floor
    const at160 = await qaHook(page, 'qaProbeTimeOfRun');
    expect(at160.lionDetectMul).toBe(0.5); // clamped at DUSK_LION_SIGHT_MUL, not still falling

    // Cue (Q15): the duskLion hint fires once, naming the lion specifically (not
    // "predators'" -- wolf/bear are unaffected, see wiki/game/mechanics/dusk-stealth.md's
    // Engineering Resolution). By 160s of an otherwise-empty micro world every
    // earlier-priority self/panel-anchored hint (landmark, the drawn mission kind)
    // has already had its 8s turn and been marked seen, so duskLion has reliably
    // had a chance to claim the slot.
    const hints = await qaHook(page, 'qaProbeHints');
    expect(hints.seen.duskLion).toBe(true);

    expectNoConsoleErrors(errs);
  });
});
