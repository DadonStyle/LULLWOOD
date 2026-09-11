// LUL-2392: feeds LUL-1449 (Economist, Deeper Lungs veil-tree re-pricing).
// scentOnto() (engine/forest-engine.js) now fires a `chase_gap` analytics event
// (lib/analytics.ts) carrying the game-time gap between a chase->roam give-up
// and the next scentOnto() re-acquisition, tagged with the live difficulty
// tier. See wiki game/m4-analytics-plan's 2026-09-12 addendum for the schema
// decision and why only the scent channel closes the timer.
//
// Deterministic clock (qaSetFixedStep/qaAdvance, LUL-2071) throughout -- a
// wall-clock poll here would race the SNIFF_IMMUNITY_TIME window this test
// deliberately clears. Player must be hidden before qaStagePredatorGiveUp
// (same requirement e2e/predator-memory.spec.ts documents): investigate/
// sniff's shouldRevertInvestigateToChase reverts to `chase` on the very next
// tick otherwise. isSniffImmune (lib/game/predator.ts) is `hidden &&
// sniffImmuneT > 0` -- staying hidden past SNIFF_IMMUNITY_TIME (1.5s) is what
// lets checkScent() run again.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, expectRowVisible } from './helpers';

// Matches the fixed-step convention e2e/action-prompt.spec.ts and
// e2e/force-hunt-closes.spec.ts already use.
const FIXED_DT = 0.02;
// SNIFF_IMMUNITY_TIME (lib/game/predator.ts) is 1.5s -- 80 ticks at 0.02s/tick
// is 1.6s, comfortably past it.
const IMMUNITY_CLEAR_TICKS = 80;

test.describe('chase_gap instrumentation (LUL-2392)', () => {
  test('scentOnto() re-acquisition after a give-up reports duration_ms + difficulty', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    expect(await qaHook(page, 'qaProbeChaseGap')).toBeNull();

    await qaHook(page, 'qaBuildScene', {
      props: [{ kind: 'bramble', x: 10, z: 0 }],
      predators: [{ kind: 'wolf', x: 15, z: 0, state: 'roam' }],
    });

    const spot = await qaHook(page, 'qaTeleportToHideSpot');
    expect(spot, 'qaTeleportToHideSpot must find the bramble placed above').not.toBeNull();
    await page.keyboard.press('KeyH');
    await expectRowVisible(page, 'status');

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    const staged = await qaHook(page, 'qaStagePredatorGiveUp', 'wolf', 5, 0);
    expect(staged, 'qaStagePredatorGiveUp must find the wolf placed above').not.toBeNull();

    // One tick past the armed sniffTimer=0.001 runs the real investigate/sniff
    // give-up transition (p.gaveUpAt = clock.elapsedTime, alongside the
    // pre-existing logChronicle('predator_gave_up', ...) every give-up site
    // already called).
    await qaHook(page, 'qaAdvance', 1);
    expect((await qaHook(page, 'qaPredatorState', 0)).state).toBe('roam');

    // isSniffImmune gates checkScent() until SNIFF_IMMUNITY_TIME clears --
    // nothing would detect a scent point laid before this.
    await qaHook(page, 'qaAdvance', IMMUNITY_CLEAR_TICKS);

    // Seed a fresh scent point exactly at the wolf's live position (it may
    // have wandered during the immune window) so the very next tick's
    // checkScent() finds it.
    const player = await qaHook(page, 'qaProbePlayer');
    const wolf = await qaHook(page, 'qaPredatorState', 0);
    expect(wolf.state, 'wolf must still be roaming, not already re-caught by another channel').toBe('roam');
    await qaHook(page, 'qaSeedScentPoint', wolf.x - player.x, wolf.z - player.z, 0);

    await qaHook(page, 'qaAdvance', 1);
    expect((await qaHook(page, 'qaPredatorState', 0)).state, 'scentOnto() should have re-triggered chase').toBe('chase');

    const gap = await qaHook(page, 'qaProbeChaseGap');
    expect(gap).not.toBeNull();
    expect(gap.kind).toBe('wolf');
    expect(gap.difficulty).toBe('night'); // engine default (`let difficulty = 'night'`)
    // (IMMUNITY_CLEAR_TICKS + 1) ticks * FIXED_DT since the give-up tick, +/- float-accumulation slop.
    const expectedMs = (IMMUNITY_CLEAR_TICKS + 1) * FIXED_DT * 1000;
    expect(gap.durationMs).toBeGreaterThan(expectedMs - 50);
    expect(gap.durationMs).toBeLessThan(expectedMs + 50);
  });
});
