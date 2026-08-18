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
// Measuring overshoot duration without a new engine hook: qaPredatorState()
// only exposes kind/state/inv/sniffsLeft/scentCalls, not position or charge
// phase, and this spec deliberately doesn't add one (that's its own PR/
// review, out of scope for a verification pass). Instead it reads
// #chargePrompt (LUL-213's HUD, shown for the whole telegraph->charging->
// overshoot span, hidden the instant the charge resolves either way --
// engine/forest-engine.js's beginChargeHud()/endChargeHud() call sites) and
// #deathScreen at that exact moment. The wall-clock gap between the dodge
// (Space) landing and #chargePrompt clearing is a direct, unmodified proxy
// for how long resolution took -- which is exactly overshootDuration plus a
// fixed few-frame constant, since stepCharge's 'overshoot' phase is the only
// thing still running between the jump and the HUD clearing.
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

      // --- Case 1: dodge as early as possible (telegraph phase). -----------
      // chargingElapsed is defined as clamp(t - CHARGE_TELL_TIME, 0, RUN_TIME);
      // any jump landing before the telegraph ends clamps to exactly 0, so
      // "as early as possible" and "any time during telegraph" are the same
      // case -- no fine timing needed to land inside it.
      const idx = await triggerAndGetIdx();
      await page.keyboard.press('Space');
      const earlyJumpAt = Date.now();
      await expect(
        chargePrompt,
        `${kind}: an immediate/telegraph-phase dodge never cleared the charge HUD -- resolution stalled`,
      ).toBeHidden({ timeout: 3_000 });
      const earlyResolveMs = Date.now() - earlyJumpAt;
      const earlyDied = await deathScreen.isVisible();
      expect(
        earlyDied,
        `${kind}: the player was already dead the instant an immediate dodge resolved -- the predator landed ` +
          `on/near the player right at resolution (the exact LUL-213/LUL-323 overshoot-distance bug shape: an ` +
          `early dodge still overshooting the full trigger distance and re-landing on the player)`,
      ).toBe(false);

      // --- Case 2: dodge mid-charge (well into the 'charging' sub-phase). --
      // Re-triggering resets the same predator's charge state fresh
      // (qaTriggerCharge always zeroes chargeCooldown and re-places both
      // player and predator at their fixed setup positions), so this reuses
      // the same page/session deliberately -- comparing both cases in one
      // run controls for per-run rig speed variance instead of comparing
      // across two separately-timed tests.
      //
      // 1100ms wall-clock wait before the jump: empirically measured (see
      // the diagnostic run in the file header) to land solidly inside the
      // 'charging' sub-phase on this rig -- comfortably past the ~0.3-0.7s
      // wall-clock telegraph and comfortably short of the ~1.8-2.0s wall-
      // clock point where a miss gets caught (measured separately in Case 3
      // below). Not derived from the game-time constants directly because
      // this rig's actual game-time/wall-time ratio varies run to run (see
      // wiki: systems/dt-clamp-vs-walltime) -- the empirical measurement is
      // the more reliable anchor.
      await triggerAndGetIdx();
      await page.waitForTimeout(1_100);
      await page.keyboard.press('Space');
      const lateJumpAt = Date.now();
      await expect(
        chargePrompt,
        `${kind}: a mid-charge dodge never cleared the charge HUD -- resolution stalled, or the 1100ms wait ` +
          `landed past the window and the predator caught the player outright (check #deathScreen/test output)`,
      ).toBeHidden({ timeout: 3_000 });
      const lateResolveMs = Date.now() - lateJumpAt;
      const lateDied = await deathScreen.isVisible();
      expect(
        lateDied,
        `${kind}: the player was already dead the instant a mid-charge dodge resolved -- either the 1100ms wait ` +
          `landed past the window (a spec-timing issue, not a dodge-logic finding -- lower the wait), or the ` +
          `predator caught the player right at resolution`,
      ).toBe(false);

      // Core LUL-323 regression check: pre-fix, overshootDuration was always
      // the flat CHARGE_RUN_TIME regardless of when the jump landed, so an
      // early and a mid-charge dodge would resolve in statistically the same
      // time. Post-fix they must differ, and in the right direction -- early
      // (chargingElapsed = 0) resolves in a couple of engine ticks,
      // mid-charge (chargingElapsed > 0) measurably later.
      expect(
        earlyResolveMs,
        `${kind}: an immediate/telegraph-phase dodge took ${earlyResolveMs}ms to resolve -- expected near-instant`,
      ).toBeLessThan(700);
      expect(
        lateResolveMs,
        `${kind}: mid-charge dodge (${lateResolveMs}ms) did not resolve measurably slower than the immediate ` +
          `dodge (${earlyResolveMs}ms) -- overshoot duration is not tracking dodge timing (this is the exact ` +
          `LUL-213/LUL-323 bug shape: a flat overshoot time regardless of when the jump landed)`,
      ).toBeGreaterThan(earlyResolveMs + 300);

      // --- Case 3: don't dodge at all -- confirm missing the window still --
      // kills you (the LUL-323 fix only changed the *survived* path; this
      // guards against a regression that accidentally made every charge
      // survivable). No Space press at all this time.
      await triggerAndGetIdx();
      await expect(deathScreen, `${kind}: failing to dodge did not kill the player`).toBeVisible({
        timeout: 8_000,
      });
      await expect(page.locator('#deathKind')).toHaveText(kind);

      expectNoConsoleErrors(errors);
    });
  }
});
