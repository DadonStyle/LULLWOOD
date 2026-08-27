// LUL-65: regression coverage for a review finding on LUL-23 (wiki:
// game/lul23-scent-review). The e2e suite passed on that branch precisely
// because nothing exercised scent -- a scent cue is by definition stale and
// distant (it marks where the player *was*, up to SCENT_LIFETIME ago), which
// put every real pickup beyond the `chase` leash (`detect*1.5`). The predator
// re-entered `roam`, immediately re-triggered scentOnto() next tick, and
// stutter-stepped at ~10% of its real speed while re-roaring on every entry.
//
// Reproducing "old, distant trail" through real walking is a navigation-
// reliability problem, same class as e2e/smoke.spec.ts's `qaTeleportNearBaby`
// rationale: procedural terrain can snag a straight line on a tree for
// reasons that have nothing to do with the mechanic under test. So this uses
// `qaSeedScentPoint` to fabricate one point deterministically (60 units back,
// 4s old -- comfortably past the bear's leash of `30 * 1.5 = 45`, matching
// the shape of the measured repro) and `qaProbeScentOnOldest` /
// `qaProbePredatorState` to place the bear on it and sample. The mechanics
// under test -- checkScent(), scentOnto(), the chase leash, movement,
// predatorCall() -- all run for real; only the setup is synthetic.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('scent-triggered chase (LUL-23 / LUL-65)', () => {
  test('a predator placed on a stale, distant trail point tracks the player and does not re-roar', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const seeded = await page.evaluate(() => {
      window.ForestEngine?.qaSeedScentPoint?.(-60, 0, 4);
      return window.ForestEngine?.qaProbeScentOnOldest?.('bear') ?? null;
    });
    expect(seeded, 'qaSeedScentPoint + qaProbeScentOnOldest should find the seeded point').not.toBeNull();
    expect(seeded!.dist, 'seeded point must sit beyond the bear leash (30 * 1.5 = 45) to reproduce the bug').toBeGreaterThan(45);

    // One tick is enough for `roam` to run checkScent() -> scentOnto() and flip to `chase`.
    await expect
      .poll(async () => (await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null))?.state, {
        message: 'bear did not enter chase off the seeded scent point',
        timeout: 5_000,
      })
      .toBe('chase');

    const first = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(first).not.toBeNull();
    expect(first!.scentCalls, 'scentOnto() should fire exactly once on pickup').toBe(1);

    // LUL-99: wait for the *game* clock to advance, not the wall clock. Game time
    // runs slower than wall time under this rig's software rendering -- dt is
    // clamped at engine/forest-engine.js:~1220, so below 20fps it never catches up
    // to real time (wiki: systems/dt-clamp-vs-walltime). A wall-clock wait here
    // measures the runner's frame rate, not the hunt logic. `t` on the probe is the
    // same clock the engine's own timers accumulate against, so diffing it gives the
    // actual in-sim window the movement below ran for. 3 game-seconds stays
    // comfortably inside the 8s scentLock leash exemption (SCENT_TRACK_TIME) so the
    // chase can't lapse mid-sample, and is generous either side of the ~6.8u/s top
    // speed vs. the pre-fix 0.7u/s stutter this assertion exists to catch.
    const GAME_SECONDS = 3;
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
          return s ? s.t - first!.t : 0;
        },
        {
          message: 'game clock did not advance far enough to sample distance closed',
          timeout: 45_000,
        },
      )
      .toBeGreaterThanOrEqual(GAME_SECONDS);

    const second = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(second).not.toBeNull();

    // The headline assertion: it actually tracks. Pre-fix this closed ~0.7 units/s
    // (the leash-vs-scent-range fight); post-fix it should close close to its real
    // speed. The bar was originally 8, derived from a ~6.8u/s top-speed budget that
    // predates LUL-22 (positional hiding), which put cover volumes and
    // line-of-sight pathing between predator and player -- approach velocity is no
    // longer raw movement speed, and 8 has not been met on any commit since LUL-22
    // merged (observed 5.3-6.6 units across CI runs at cd227edc/ff217a6c). Per the
    // LUL-115 ruling, recalibrated to 4: ~25% headroom below the worst observed
    // sample (so it doesn't itself flake), while still failing the pre-fix 0.7u/s
    // stutter and the LUL-119 0.0u/s freeze by a wide margin.
    expect(second!.dist, 'the bear must close distance, not stutter in place').toBeLessThan(first!.dist - 4);

    // The leash-vs-scent flip-flop this ticket fixes would have bounced the state
    // back to `roam` (and, via checkScent() re-firing, straight back to `chase`)
    // several times a second -- it stays `chase` continuously while scentLock holds.
    expect(second!.state, 'must not have flip-flopped back through roam').toBe('chase');

    // The unthrottled re-roar this ticket fixes would have fired scentOnto() (and
    // therefore predatorCall()) again on every roam->chase re-entry -- several
    // times over this window. It must still be exactly one.
    expect(second!.scentCalls, 'scentOnto() must not re-trigger while already tracking').toBe(1);
  });
});

// LUL-196: scent *acquisition* behind cover. The test above exercises the
// chase-hold path (scentLock, :725). This exercises the acquisition path:
// checkScent() / scentOnto() only run while the predator is in `roam`. The
// question: if the player is behind a cover prop (out of LOS), does a fresh
// scent trail still trigger acquisition?
//
// Setup: stage with qaHideBehindCoverKind (player behind prop, predator on
// far side, both in known positions), then call qaSetPredatorRoam to reset
// state to roam without moving the predator. Seed a fresh scent point at the
// predator's own position, then wait and observe whether scentCalls
// increments -- i.e. whether checkScent() fires and scentOnto() accepts the
// trail.
//
// LUL-242: seeding at the player's position (dx=0, dz=0) is what LUL-233/
// LUL-241 review found geometrically unwinnable -- qaHideBehindCoverKind
// always separates player and predator by >=6 units (2 * (max(hx,hz) + 3)
// for whichever cover prop it finds), but checkScent()'s max possible detect
// radius (bear, age 0, the freshest/most-sensitive case) is 3.08 units. No
// prop size or species lets a point seeded at the player ever fall inside
// that radius. Cover-clearance distance and scent-pickup distance are
// different quantities. qaHideBehindCoverKind now also returns the player's
// placed position (playerX/playerZ) so this test can compute an exact
// offset back to the predator's real position instead of guessing a
// constant -- reach varies per cover prop, so no fixed offset is safe.
// See wiki: game/lul196-scent-behind-cover-geometry.
//
// Note on the stall observed during LUL-196 investigation: the predator placed
// by qaHideBehindCoverKind sat at exactly placement-separation distance for
// 15 game-seconds while cycling investigate/approach->chase, with sniffsLeft
// ticking. That stall is NOT diagnosed here and may be expected behaviour,
// a staging artifact, or a real bug. Triage deferred; see issue LUL-196.
test.describe('scent acquisition behind cover (LUL-196)', () => {
  test('a fresh scent trail triggers acquisition even when player is behind cover (out of LOS)', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    // Stage: player behind cover, bear on far side.
    const staged = await page.evaluate(() =>
      window.ForestEngine?.qaHideBehindCoverKind?.('bear') ?? null,
    );
    expect(staged, 'qaHideBehindCoverKind must find a valid cover placement').not.toBeNull();
    const { idx, playerX, playerZ } = staged!;

    // Reset the predator to roam without relocating it. Verify state before
    // seeding scent so the check happens while no scent is active (predator
    // cannot have transitioned away via scentOnto yet).
    const pos = await page.evaluate(
      (i) => window.ForestEngine?.qaSetPredatorRoam?.(i) ?? null,
      idx,
    );
    expect(pos, 'qaSetPredatorRoam must succeed for the staged predator').not.toBeNull();

    const predAfterRoam = await page.evaluate(
      (i) => window.ForestEngine?.qaPredatorState?.(i) ?? null,
      idx,
    );
    expect(predAfterRoam?.state, 'predator must now be in roam').toBe('roam');

    // Seed a fresh scent point exactly at the predator's real position.
    // IMPORTANT: qaSetPredatorRoam and qaSeedScentPoint MUST run in a single
    // page.evaluate — a single JS turn — so no game frame executes between
    // reading the predator's current position and placing the scent there.
    // If they are separate evaluate calls, the predator wanders toward its
    // existing waypoint (up to 55 units away, at 2.3 u/s in roam) and the
    // seeded point becomes stale before checkScent runs, causing the
    // 15-second poll to time out with scentCalls=0. This was the root cause
    // of the LUL-645 flake, and this atomic-evaluate shape is still correct
    // — do not revert it.
    //
    // LUL-882: that fix closed the *inter-evaluate* race but not a second,
    // narrower one: SCENT_RADIUS_WALK (2.2u, lib/game/scent.ts) is smaller
    // than roam speed (2.3u/s, engine/forest-engine.js's roam movement
    // branch). Once seeded, the point does not move but the predator does —
    // so detection has well under one game-second to land before the
    // predator's own roam waypoint carries it permanently out of pickup
    // range (the point just sits there, undetectable, until it decays out
    // 14s later). Anything that eats that first window — a residual
    // sniffImmuneT left over from an earlier investigate/sniff cycle
    // (LUL-437's grace timer; qaSetPredatorRoam resets scentLock/scentCalls/
    // hunt/alert/sniffsLeft but not sniffImmuneT) or simply a frame not
    // landing before the roam step runs under loaded CI — fails the test
    // permanently, not just late. That is consistent with this exact
    // assertion recurring on three unrelated PRs (see wiki
    // game/lul196-scent-behind-cover-geometry) that touched nothing in the
    // scent path: a single seed attempt is a coin flip against a race the
    // single-evaluate fix does not close.
    //
    // Fix: re-seed at the predator's *current* position on a bounded retry
    // loop instead of a single attempt. Each attempt reads a fresh position
    // and gets its own short sub-timeout to be detected before the next
    // reseed — so whatever suppressed detection on one attempt (residual
    // immunity, a missed frame) cannot survive several independent ones
    // inside the same overall deadline. The headline assertion
    // (`scentCalls > 0`) and its 15s overall budget are unchanged; this only
    // gives the QA seeding step, not the mechanic under test, more than one
    // chance to land.
    const RESEED_INTERVAL_MS = 3_000;
    const OVERALL_TIMEOUT_MS = 15_000;
    const deadline = Date.now() + OVERALL_TIMEOUT_MS;
    let scentCalls = 0;
    do {
      await page.evaluate(
        ({ i, px, pz }) => {
          const fresh = window.ForestEngine?.qaSetPredatorRoam?.(i) ?? null;
          if (!fresh) return;
          window.ForestEngine?.qaSeedScentPoint?.(fresh.x - px, fresh.z - pz, 0);
        },
        { i: idx, px: playerX, pz: playerZ },
      );

      // Wait for the predator's scentCalls to increment: checkScent() ran
      // and scentOnto() accepted the trail despite the player being behind
      // cover. Poll by index (not by kind) to target the exact predator
      // staged above.
      try {
        await expect
          .poll(
            async () => {
              const s = await page.evaluate(
                (i) => window.ForestEngine?.qaPredatorState?.(i) ?? null,
                idx,
              );
              scentCalls = s?.scentCalls ?? 0;
              return scentCalls;
            },
            { timeout: Math.min(RESEED_INTERVAL_MS, Math.max(1, deadline - Date.now())) },
          )
          .toBeGreaterThan(0);
        break;
      } catch {
        // Sub-timeout expired without detection — loop condition below
        // re-seeds and tries again as long as the overall deadline hasn't
        // passed yet.
      }
    } while (scentCalls === 0 && Date.now() < deadline);

    expect(
      scentCalls,
      'scentCalls never incremented — checkScent/scentOnto did not fire while in roam, even after re-seeding the point at the predator\'s current position on a bounded retry loop (predator may genuinely not be reachable via scent while behind this cover)',
    ).toBeGreaterThan(0);
  });
});
