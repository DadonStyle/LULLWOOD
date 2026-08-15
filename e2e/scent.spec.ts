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

    // LUL-99: poll on *game* time, not wall time. The dt clamp at engine line ~1201
    // means game time runs slower than wall time under software rendering -- a
    // wall-clock wait measures the runner, not the hunt logic (wiki: systems/dt-clamp-vs-walltime).
    // 3 game-seconds is comfortably inside the 8s scentLock leash exemption and
    // generous either side of the ~6.8u/s top speed vs. the pre-fix 0.7u/s stutter.
    const GAME_SECONDS = 3;
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
          return s ? s.t - first!.t : 0;
        },
        { message: 'game clock did not advance far enough to sample distance closed', timeout: 45_000 },
      )
      .toBeGreaterThanOrEqual(GAME_SECONDS);

    const second = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('bear') ?? null);
    expect(second).not.toBeNull();

    // The headline assertion: it actually tracks. Pre-fix this closed ~0.7 units/s
    // (the leash-vs-scent-range fight); post-fix it should close close to its real
    // speed. 8 units over 3 *game* seconds is a wide margin either side of that
    // stutter and comfortably below what an unthrottled chase actually covers.
    expect(second!.dist, 'the bear must close distance, not stutter in place').toBeLessThan(first!.dist - 8);

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
