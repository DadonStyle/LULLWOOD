// LUL-1620: predator last-known-position return sweeps + the audio tell.
// See docs/specs/lul-1620-predator-memory-sweeps.md for the design; this spec
// pins the QA hooks and assertions it calls for. Mirrors e2e/scent.spec.ts's
// polling-via-page.evaluate shape (dt-clamp-vs-walltime, wiki:
// systems/dt-clamp-vs-walltime -- game time, not wall time, is what advances
// the sniff/roam timers here).
//
// The player must be `hidden` before staging the give-up transition:
// investigate/sniff's own re-escalation gate (shouldRevertInvestigateToChase,
// lib/game/predator.ts, LUL-562) instantly reverts 'sniff' back to 'chase' on
// the very next tick if the player is not hidden -- by design, this is how a
// real chase would behave too (see engine/forest-engine.js's comment on the
// `investigate` branch). So every test here hides first via
// qaTeleportToHideSpot + KeyH, same as e2e/hide.spec.ts, before staging.
//
// New QA hooks (engine/forest-engine.js), none of which move the player or
// disturb prior staging:
// - qaStagePredatorGiveUp(kind, dx, dz): places the named species dx/dz from
//   the player's current position and arms it one tick from the
//   investigate/sniff give-up transition -- avoids waiting out the real
//   sniffsLeft/sniffTimer countdown (qaSetPredatorRoam's own comment warns
//   off driving that for real, since it isn't needed for what these tests
//   check).
// - qaGetPredatorLkp(idx): reads p.lkpX/lkpZ/lkpSweeps.
// - qaIsApproachPianoActive(): mirrors the piano gate at
//   engine/forest-engine.js:~3479 without exposing raw Web Audio internals.
// - qaFastForwardPredatorToWaypoint(idx): teleports a predator onto its own
//   current roam waypoint so the next tick's arrival/repick runs
//   immediately, instead of waiting out the real ~10-20s travel per sweep leg.
import { test, expect } from '@playwright/test';
import { boot, enter, expectRowVisible } from './helpers';

// Bounded loop margin: LKP_MAX_SWEEPS (3) repicks are needed to exhaust the
// count, plus headroom for the one repick each arrival triggers.
const LKP_MAX_SWEEPS_PLUS_MARGIN = 6;

// LUL-2329: left on the full map -- qaTeleportToHideSpot needs a real,
// naturally-generated hide-spot prop, and the tests below that follow it with
// qaStagePredatorGiveUp have no isolation against the other 8 predators over
// their multi-second poll windows (qaBuildScene would guarantee isolation but
// also wipes the natural cover this hook depends on). See
// docs/specs/lul-2329-e2e-migrate-qaworld-micro.md.
//
// Hides the player at a deterministic spot (qaTeleportToHideSpot, same hook
// e2e/hide.spec.ts uses) and confirms `hidden` actually took via the #status
// HUD, so callers don't silently proceed with a not-actually-hidden player.
async function hidePlayer(page: import('@playwright/test').Page) {
  const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
  expect(spot, 'qaTeleportToHideSpot must find a bramble spot for this seed').not.toBeNull();
  await page.keyboard.press('KeyH');
  await expectRowVisible(page, 'status');
}

test.describe('predator memory return sweeps + audio tell (LUL-1620)', () => {
  test('giving up an investigate/sniff loop arms the bounded return-sweep memory', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await hidePlayer(page);

    const staged = await page.evaluate(() => window.ForestEngine?.qaStagePredatorGiveUp?.('bear', 5, 0) ?? null);
    expect(staged, 'qaStagePredatorGiveUp must find the bear and stage it').not.toBeNull();
    const { idx } = staged!;

    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not arm to LKP_MAX_SWEEPS after the investigate/sniff give-up transition',
        timeout: 5_000,
      })
      .toBe(3);

    const post = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(post?.state, 'predator must have transitioned to roam on give-up').toBe('roam');
  });

  test('the approach piano is audible while the player is hidden during a return sweep', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await hidePlayer(page);

    // Place the bear 20 units out -- inside the piano's 46u radius, matching
    // the LKP_RING_RADIUS/LKP_RING_JITTER band (18-28u) the ring-biased sweep
    // itself uses, so the very first repick keeps it in range too.
    const staged = await page.evaluate(() => window.ForestEngine?.qaStagePredatorGiveUp?.('bear', 20, 0) ?? null);
    expect(staged).not.toBeNull();
    const { idx } = staged!;

    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not arm after give-up',
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    // Clause 2's fix is precisely that the piano no longer checks `!hidden` --
    // pre-fix this would read false the entire time the player stayed hidden.
    await expect
      .poll(async () => page.evaluate(() => window.ForestEngine?.qaIsApproachPianoActive?.() ?? false), {
        message: 'approach piano should be audible while hidden during a return sweep (clause 2: !hidden dropped from the gate)',
        timeout: 5_000,
      })
      .toBe(true);

    // Bullet 4: this new coverage must not weaken scent.spec.ts's existing
    // guarantee -- a return sweep alone (no real canSee/checkScent
    // reacquisition) must not fire scentOnto().
    const state = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(state?.scentCalls, 'a return sweep alone must not trigger scentOnto()').toBe(0);
  });

  test('the piano stops once the bounded sweep count is exhausted', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await hidePlayer(page);

    const staged = await page.evaluate(() => window.ForestEngine?.qaStagePredatorGiveUp?.('bear', 20, 0) ?? null);
    expect(staged).not.toBeNull();
    const { idx } = staged!;

    // LUL-2505: the piano gate reads `approaching`/`nearDist` across *every*
    // spawned predator, not just this one -- on the full map (this file's own
    // documented no-isolation tradeoff, docs/specs/lul-2329-e2e-migrate-
    // qaworld-micro.md), the multi-second polling below can otherwise catch
    // an unrelated predator mid-investigate/chase, or an unrelated predator's
    // mere proximity gating a *different* predator's approach, and the piano
    // would never go quiet for reasons that have nothing to do with this
    // predator's own bounded sweep count reaching 0.
    await page.evaluate((i) => window.ForestEngine?.qaIsolatePredator?.(i), idx);

    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not arm after give-up',
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    await expect
      .poll(async () => page.evaluate(() => window.ForestEngine?.qaIsApproachPianoActive?.() ?? false), {
        message: 'approach piano should be audible while a sweep is live',
        timeout: 5_000,
      })
      .toBe(true);

    // Fast-forward arrival at the current waypoint repeatedly -- each arrival
    // runs the real pickRoamWaypoint() repick, decrementing lkpSweeps by one
    // (the player never moves, so the LKP_REPEAT_RADIUS check keeps passing
    // and the only thing that clears the count is exhaustion). Poll for the
    // count to actually change after each fast-forward rather than a fixed
    // wall-clock sleep -- game time can run slower than wall time under
    // software rendering (wiki: systems/dt-clamp-vs-walltime).
    for (let i = 0; i < LKP_MAX_SWEEPS_PLUS_MARGIN; i++) {
      const before = (await page.evaluate((i2) => window.ForestEngine?.qaGetPredatorLkp?.(i2) ?? null, idx))?.lkpSweeps;
      if (before === 0) break;
      await page.evaluate((i2) => window.ForestEngine?.qaFastForwardPredatorToWaypoint?.(i2), idx);
      await expect
        .poll(async () => (await page.evaluate((i2) => window.ForestEngine?.qaGetPredatorLkp?.(i2) ?? null, idx))?.lkpSweeps, {
          message: `lkpSweeps did not change from ${before} after fast-forwarding to the waypoint`,
          timeout: 5_000,
        })
        .not.toBe(before);
    }

    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not reach 0 after fast-forwarding through the bounded sweep count',
        timeout: 10_000,
      })
      .toBe(0);

    // Clause 2's "inbound-only": the moment lkpSweeps hits 0, `approaching`
    // stops being true for this predator's contribution, so the piano gate
    // must go false within the next tick.
    await expect
      .poll(async () => page.evaluate(() => window.ForestEngine?.qaIsApproachPianoActive?.() ?? true), {
        message: 'approach piano should stop once the bounded sweep count is exhausted',
        timeout: 5_000,
      })
      .toBe(false);
  });

  test('a predator re-alerted mid-sweep does not have its return-sweep count refilled (LUL-2505)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await hidePlayer(page);

    const staged = await page.evaluate(() => window.ForestEngine?.qaStagePredatorGiveUp?.('bear', 20, 0) ?? null);
    expect(staged).not.toBeNull();
    const { idx } = staged!;

    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not arm after give-up',
        timeout: 5_000,
      })
      .toBe(3);

    // One arrival: player hasn't moved, so playerDistFromLkp stays 0 (inside
    // LKP_REPEAT_RADIUS) -- deterministically 3 -> 2, matching
    // pickRoamWaypoint's own unit-tested decrement.
    await page.evaluate((i) => window.ForestEngine?.qaFastForwardPredatorToWaypoint?.(i), idx);
    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx))?.lkpSweeps, {
        message: 'lkpSweeps did not decrement to 2 after the first arrival',
        timeout: 5_000,
      })
      .toBe(2);

    // Re-stage the same predator through the give-up pipeline again --
    // qaStagePredatorGiveUp only touches state/inv/sniffsLeft/sniffTimer, not
    // lkpX/lkpZ/lkpSweeps, so this stands in for a real mid-sweep re-alert
    // (scent/noise/cry, none of which check `hidden`) without waiting out an
    // actual re-detection roll.
    await page.evaluate(() => window.ForestEngine?.qaStagePredatorGiveUp?.('bear', 20, 0));
    await expect
      .poll(async () => (await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx))?.state, {
        message: 'predator did not return to roam after the second give-up',
        timeout: 5_000,
      })
      .toBe('roam');

    // LUL-2505: pre-fix this reads 3 (refilled to LKP_MAX_SWEEPS on every
    // give-up, regardless of the live count) -- post-fix it stays 2
    // (armReturnSweep preserves a live mid-sweep count near the same spot).
    const lkp = await page.evaluate((i) => window.ForestEngine?.qaGetPredatorLkp?.(i) ?? null, idx);
    expect(lkp?.lkpSweeps, 'a mid-sweep re-alert must not refill lkpSweeps back to LKP_MAX_SWEEPS').toBe(2);
  });
});
