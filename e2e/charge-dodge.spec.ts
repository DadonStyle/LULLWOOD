// LUL-363: independent playability re-verification of the LUL-323 charge-
// overshoot fix (PR #54, engine/forest-engine.js + lib/game/charge.ts).
// Deliberately a fresh spec, not a copy of anything shipped with that PR --
// the Game Tester wrote the fix, so per this studio's role-boundary rules
// (wiki: systems/headless-qa-rig) it can assert code correctness on its own
// change but not the gameplay claim; this file is that independent check.
//
// The LUL-213 bug LUL-323 fixed: stepCharge()'s 'overshoot' phase always ran
// for a flat CHARGE_RUN_TIME (0.65s) regardless of when the player's jump
// landed, so an early, correctly-timed dodge still overshot the *full*
// original trigger distance and the predator re-landed on the player. The
// fix threads `chargingElapsed` (how long the predator was actually moving
// before the jump landed, 0 during the stationary telegraph, up to
// CHARGE_RUN_TIME at the window's edge) through to the overshoot phase, so
// overshoot duration should track when you dodged, not the raw distance the
// charge started from.
//
// Measuring overshoot duration: qaPredatorState() only exposes kind/state/
// inv/sniffsLeft/scentCalls, not position or charge phase, so this spec adds
// a narrow read-only hook, qaChargePhase(idx) (LUL-373), returning the
// predator's live ChargeState.phase/t/overshootDuration. It's used to time
// *when* to press Space (so Case 2 below reliably lands mid-charge at any
// rig speed, see MID_CHARGE_T above) and, since LUL-421, it *is* the
// pass/fail signal too: the core regression check reads overshootDuration
// straight off engine state (qaChargePhase falls back to the last-resolved
// charge once p.charge itself goes null, see engine/forest-engine.js) rather
// than timing the wall-clock gap around #chargePrompt clearing. The earlier
// version measured that gap with Date.now() and asserted fixed millisecond
// thresholds (<700ms / >+300ms) against it; those flaked under CI load
// (wiki: systems/dt-clamp-vs-walltime, "Second real occurrence") because the
// overshoot phase's own duration is a hand-accumulated `+= dt` timer
// (lib/game/charge.ts) that runs slower than wall time on a loaded runner --
// a wall-clock deadline around it inherits that dilation no matter how the
// wait to *trigger* the dodge is timed. overshootDuration is a plain
// engine-computed number with no wall-clock component at all, so asserting
// on it directly removes the dependency on rig speed instead of tuning
// around it. #chargePrompt/#deathScreen are still used as *generous*,
// non-precise backstops for "did resolution happen at all" (see the
// toBeHidden waits below) -- just no longer the timing source.
//
// A prior version of this spec instead polled qaPredatorState().state for
// 'chase' -> 'investigate' with a long (10s) timeout and got a false FAIL on
// every run: the QA hook places the player in the open with no cover and
// never moves them, and 'investigate' is transient there -- the predator
// re-spots an unmoving, uncovered player almost immediately and is caught
// again by the ordinary chase-catch check (engine/forest-engine.js:1007,
// unrelated to the charge system) within a couple of seconds regardless of
// whether the dodge itself worked. A long poll for 'investigate' just waited
// long enough to observe that unrelated second catch and misreported it as
// "the dodge never resolved." Root-caused with e2e/_debug-charge.spec.ts (a
// throwaway diagnostic, not committed) polling #chargePrompt/#deathScreen at
// 40ms resolution, which showed the charge resolving in a few hundred ms
// with no death, then a *separate*, later death once the predator re-closed
// on the stationary player. This version checks only the narrow window
// around the charge's own resolution, which is what LUL-323 actually
// touches -- not how long an idle player survives afterward.
//
// Known, load-bearing gap on `main` at the time this spec was written
// (a70202a5): PR #50 (LUL-302, qaTriggerCharge's `player.yaw` sign) has not
// landed yet -- the hook still faces the player away from the predator it
// places. Reading engine/forest-engine.js confirms this cannot leak into the
// assertions below: qaTriggerCharge() sets `p.charge` directly, bypassing
// playerCanSee()/canSee()/shouldTriggerCharge() entirely (the only places
// player.yaw feeds into the charge system), and stepCharge()'s resolution
// (lib/game/charge.ts) is purely time+input gated -- distance/facing never
// enter it. So the yaw bug is real (tracked, unfixed) but inert for this
// mechanic; it is a rendering/telegraph-reading concern, not a dodge-outcome
// one. Not asserted on here for that reason -- see LUL-302 for its own fix.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
import { CHARGE_TELL_TIME, CHARGE_RUN_TIME } from '../lib/game/charge';

// "Well into" the charging sub-phase. ChargeState.t is cumulative since the
// charge started (spans telegraph *and* charging, not reset at the phase
// boundary -- see stepCharge in lib/game/charge.ts), so 'charging' covers
// t in [CHARGE_TELL_TIME, CHARGE_TELL_TIME + CHARGE_RUN_TIME). Target the
// midpoint of that range: comfortably past the transition (so we're not
// timing-racing the phase flip itself) and comfortably short of its end (so
// a slow poll tick can't overshoot into 'caught').
const MID_CHARGE_T = CHARGE_TELL_TIME + CHARGE_RUN_TIME * 0.5;

test.describe('LUL-323 charge-dodge overshoot (independent re-verification)', () => {
  for (const kind of ['wolf', 'lion'] as const) {
    test(`${kind}: dodge timing controls overshoot, missing still kills`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackConsoleErrors(page);
      await boot(page, { qaHooks: true });
      await enter(page);

      const chargePrompt = page.locator('#chargePrompt');
      const deathScreen = page.locator('#deathScreen');

      async function triggerAndGetIdx(): Promise<number> {
        const idxOrNull = await page.evaluate((k) => window.ForestEngine?.qaTriggerCharge?.(k) ?? null, kind);
        if (idxOrNull === null) {
          throw new Error(`qaTriggerCharge('${kind}') returned null -- that species isn't spawned`);
        }
        await expect(chargePrompt, 'telegraph HUD never appeared after qaTriggerCharge').toBeVisible({
          timeout: 5_000,
        });
        return idxOrNull;
      }

      // Polls the live ChargeState (qaChargePhase, LUL-373) for MID_CHARGE_T
      // game-time seconds into 'charging', instead of a fixed wall-clock wait.
      // A fixed ms wait only reliably lands at the same game-time point on the
      // rig it was tuned against -- game-time accrues slower per wall-clock ms
      // on a loaded/slower runner (dt clamp, see wiki systems/dt-clamp-vs-
      // walltime), which is exactly what made CI flake on the original 1100ms
      // version of this spec (LUL-373 review). Polling the engine's own clock
      // is correct at any rig speed.
      async function waitForMidCharge(idx: number): Promise<void> {
        await expect
          .poll(
            async () => {
              const cs = await page.evaluate((i) => window.ForestEngine?.qaChargePhase?.(i) ?? null, idx);
              return cs && cs.phase === 'charging' ? cs.t : -1;
            },
            {
              message: `${kind}: charge never reached ${MID_CHARGE_T.toFixed(2)}s into 'charging'`,
              // LUL-421 (review on PR #60): was 3_000. `cs.t` is
              // ChargeState's hand-accumulated `+= dt` timer (lib/game/
              // charge.ts), the exact dilated-timer category wiki
              // `systems/dt-clamp-vs-walltime` documents -- below 20fps,
              // game time accrues slower than wall time and never catches
              // up, so a wall-clock deadline this tight on a ~0.68s
              // game-time target flakes on a loaded/slower CI runner.
              // 20_000 matches this suite's own precedent for a comparable
              // game-time-dependent poll (e2e/positional-hiding.spec.ts).
              timeout: 20_000,
              intervals: [20, 50, 100],
            },
          )
          .toBeGreaterThanOrEqual(MID_CHARGE_T);
      }

      // Reads overshootDuration off the charge that just resolved for `idx`
      // (qaChargePhase's fallback to p.lastCharge, LUL-421) -- a plain
      // engine-computed game-time value, not a wall-clock measurement, so
      // it's the same number regardless of rig speed.
      async function readOvershootDuration(idx: number): Promise<number> {
        const cs = await page.evaluate((i) => window.ForestEngine?.qaChargePhase?.(i) ?? null, idx);
        if (!cs) throw new Error(`${kind}: qaChargePhase(${idx}) returned null right after the charge resolved`);
        return cs.overshootDuration;
      }

      // --- Case 1: dodge as early as possible (telegraph phase). -----------
      // chargingElapsed is defined as clamp(t - CHARGE_TELL_TIME, 0, RUN_TIME);
      // any jump landing before the telegraph ends clamps to exactly 0, so
      // "as early as possible" and "any time during telegraph" are the same
      // case -- no fine timing needed to land inside it.
      const idx = await triggerAndGetIdx();
      await page.keyboard.press('Space');
      await expect(
        chargePrompt,
        `${kind}: an immediate/telegraph-phase dodge never cleared the charge HUD -- resolution stalled`,
      ).toBeHidden({ timeout: 15_000 });
      const earlyDied = await deathScreen.isVisible();
      expect(
        earlyDied,
        `${kind}: the player was already dead the instant an immediate dodge resolved -- the predator landed ` +
          `on/near the player right at resolution (the exact LUL-213/LUL-323 overshoot-distance bug shape: an ` +
          `early dodge still overshooting the full trigger distance and re-landing on the player)`,
      ).toBe(false);
      const earlyOvershoot = await readOvershootDuration(idx);

      // --- Case 2: dodge mid-charge (well into the 'charging' sub-phase). --
      // Re-triggering resets the same predator's charge state fresh
      // (qaTriggerCharge always zeroes chargeCooldown and re-places both
      // player and predator at their fixed setup positions), so this reuses
      // the same page/session deliberately.
      //
      // Wait for the live charge state to actually reach MID_CHARGE_T seconds
      // into 'charging' (LUL-373) rather than guessing a wall-clock ms delay
      // -- see waitForMidCharge's comment above for why the original 1100ms
      // version of this line flaked on CI's slower rig.
      const idx2 = await triggerAndGetIdx();
      await waitForMidCharge(idx2);
      await page.keyboard.press('Space');
      await expect(
        chargePrompt,
        `${kind}: a mid-charge dodge never cleared the charge HUD -- resolution stalled, or the predator caught ` +
          `the player outright (check #deathScreen/test output)`,
      ).toBeHidden({ timeout: 15_000 });
      const lateDied = await deathScreen.isVisible();
      expect(
        lateDied,
        `${kind}: the player was already dead the instant a mid-charge dodge resolved -- the predator caught ` +
          `the player right at resolution`,
      ).toBe(false);
      const lateOvershoot = await readOvershootDuration(idx2);

      // Core LUL-323 regression check, LUL-421: read straight off engine
      // state instead of timing a wall-clock proxy for it (see file header).
      // Pre-fix, overshootDuration was always the flat CHARGE_RUN_TIME
      // regardless of when the jump landed -- an immediate dodge would show
      // the same non-zero value as a mid-charge one. Post-fix: an immediate/
      // telegraph-phase dodge clamps chargingElapsed to exactly 0 (t is
      // still < CHARGE_TELL_TIME when jumped is read, so
      // Math.max(0, t - CHARGE_TELL_TIME) is exactly 0, not an
      // approximation -- see lib/game/charge.ts), and a mid-charge dodge
      // (triggered once waitForMidCharge confirms t has reached
      // MID_CHARGE_T = CHARGE_TELL_TIME + CHARGE_RUN_TIME * 0.5) must be at
      // least CHARGE_RUN_TIME * 0.25 -- comfortably below the ~0.5 floor
      // waitForMidCharge guarantees, to absorb poll-interval slack, but
      // nowhere near 0, so a regression back to "flat and untracked" (which
      // would also make Case 1 fail its exact-0 check on its own) can't
      // pass both.
      // LUL-421 (CI fix): ideally 0 (jump landed in telegraph, chargingElapsed clamped
      // to 0), but on a loaded CI runner the Space press can register 1-2 frames after
      // the telegraph ends (dt = 0.05s/frame cap), giving a tiny positive value. The
      // regression (LUL-213 bug) returns earlyOvershoot ≈ CHARGE_RUN_TIME ≈ 0.65s;
      // anything below CHARGE_RUN_TIME * 0.25 = 0.16s is structurally an early dodge.
      // lateOvershoot is asserted > 0.25 below, so the gap still catches a regression.
      expect(
        earlyOvershoot,
        `${kind}: an immediate/telegraph-phase dodge recorded overshootDuration=${earlyOvershoot}s, expected ` +
          `< CHARGE_RUN_TIME * 0.25 (${CHARGE_RUN_TIME * 0.25}s) -- ` +
          `chargingElapsed should be near-zero for a jump in/near the telegraph phase`,
      ).toBeLessThan(CHARGE_RUN_TIME * 0.25);
      expect(
        lateOvershoot,
        `${kind}: a mid-charge dodge recorded overshootDuration=${lateOvershoot}s, not measurably greater than ` +
          `an immediate dodge's 0s -- overshoot duration is not tracking dodge timing (this is the exact ` +
          `LUL-213/LUL-323 bug shape: a flat overshoot time regardless of when the jump landed)`,
      ).toBeGreaterThan(CHARGE_RUN_TIME * 0.25);

      // --- Case 3: don't dodge at all -- confirm missing the window still --
      // kills you (the LUL-323 fix only changed the *survived* path; this
      // guards against a regression that accidentally made every charge
      // survivable). No Space press at all this time.
      await triggerAndGetIdx();
      // LUL-421 (CI fix): CHARGE_WINDOW = 1s game-time. On a loaded CI runner where
      // rAF is throttled and dt is capped at 0.05s, game time can run at ~1/20 of
      // wall time (1fps * 0.05s/frame). Budget 30s wall to cover that worst case.
      await expect(deathScreen, `${kind}: failing to dodge did not kill the player`).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('#deathKind')).toHaveText(kind);

      expectNoConsoleErrors(errors);
    });
  }
});
