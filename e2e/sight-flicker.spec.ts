// LUL-2712: e2e coverage for the chase LOS-flicker grace added in LUL-2611
// (commit 0cf6799, lib/game/predator.ts SIGHT_FLICKER_TIME/shouldDowngradeChase,
// wired at the `chase` state's canSee() gate in engine/forest-engine.js). This
// was a real, always-on production gameplay change shipped without its own
// coverage -- lib/game/predator.test.ts's unit tests only prove
// shouldDowngradeChase() correct as a pure function; nothing before this proved
// `p.sightFlicker` is actually set/decremented and consulted at the live
// canSee(p,dist) call site (LUL-2377).
//
// qaSetFixedStep() is called immediately after enter(), before qaBuildScene --
// the default render loop is still real-time (rAF-driven) until that call
// cancels it, so any staging done first (teleports, scene build) burns real
// wall-clock ticks against the very state this spec is about to pin to a
// deterministic clock (found live: staging first left the chase already
// downgraded to `investigate` before qaAdvance was ever called once).
//
// Geometry: a *solid* rock at the origin (log/bramble are deliberately not
// used here -- both are the walkable cover kind, and a blind-chasing predator
// closing straight at a stationary player through one enters its own
// footprint well inside 0.4s, which hasLOS() treats as an unconditional clear
// sightline (LUL-2320(A), the exact bramble-hiding exemption) for reasons that
// have nothing to do with this grace -- confirmed live, see PR discussion).
// rock physically blocks predator movement (predatorBlocked()), so the wolf
// stalls at it instead of walking through, holding the LOS-blocked geometry
// for the whole scenario. A wolf in `chase` (scentLock=0, sightFlicker=0 --
// qaBuildScene()'s own defaults, matching a sight-triggered spotOnto() chase,
// not a scent-triggered scentOnto() one) sits 3 units to the rock's -x:
//   - (0, 4): the segment's rock-x-range crossing (x in [-1.35, 1.35]) lands
//     at z in [2.2, 4] on this line, clear of the rock's z half-extent (1.28)
//     -- canSee() reads true. dist ~5, inside the micro world's wolf detect
//     radius (42 * CONFIG.detectScaleMul(0.2) = 8.4).
//   - (3, 0): dead-on the predator's own z, the segment runs straight through
//     the rock's box -- canSee() reads false (blocked). dist ~6, still inside
//     detect radius, so distance never gates the read -- only the LOS toggle
//     does.
// Live-verified tick-by-tick (dev server, fixed dt=0.02): sightFlicker decays
// 0.4 -> 0.02 over the first 19 blocked ticks (chase holds, canSee false
// throughout -- the rock keeps the wolf from closing distance at all), then
// hits <=0 and downgrades to investigate/approach on tick 20 (0.4s blind),
// exactly SIGHT_FLICKER_TIME.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const ROCK = { kind: 'rock' as const, x: 0, z: 0 };
const WOLF_START = { x: -3, z: 0 };
const CLEAR_POS = { x: 0, z: 4 };
const BLOCKED_POS = { x: 3, z: 0 };

test.describe('chase LOS-flicker tolerance (LUL-2611/LUL-2712)', () => {
  test('a sight-triggered chase tolerates a sub-0.4s LOS break, then downgrades past it', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await qaHook(page, 'qaBuildScene', {
      props: [ROCK],
      predators: [{ kind: 'wolf', x: WOLF_START.x, z: WOLF_START.z, state: 'chase' }],
    });

    // Establish a live sighting first (mirrors spotOnto(): the chase branch
    // only refreshes sightFlicker while canSee() is actually true).
    await qaHook(page, 'qaTeleportTo', CLEAR_POS.x, CLEAR_POS.z);
    await qaHook(page, 'qaAdvance', 1);

    let wolf = await qaHook(page, 'qaPredatorState', 0);
    expect(wolf.canSee, 'staged scenario must start with a clear sightline').toBe(true);
    expect(wolf.state).toBe('chase');
    expect(wolf.sightFlicker).toBeCloseTo(0.4, 5);

    // Break LOS for 15 ticks (0.3s) -- under SIGHT_FLICKER_TIME (0.4s).
    await qaHook(page, 'qaTeleportTo', BLOCKED_POS.x, BLOCKED_POS.z);
    await qaHook(page, 'qaAdvance', 15);

    wolf = await qaHook(page, 'qaPredatorState', 0);
    expect(wolf.canSee, 'blocked position must actually read canSee=false').toBe(false);
    expect(
      wolf.state,
      `chase downgraded to '${wolf.state}' after only 0.3s blind -- the LOS-flicker grace did not hold`,
    ).toBe('chase');
    expect(wolf.sightFlicker).toBeGreaterThan(0.05);

    // Keep LOS broken past the 0.4s cumulative threshold (5 more ticks = 0.4s total blind).
    await qaHook(page, 'qaAdvance', 5);

    wolf = await qaHook(page, 'qaPredatorState', 0);
    expect(wolf.canSee).toBe(false);
    expect(
      wolf.state,
      `still '${wolf.state}' after 0.4s fully blind -- shouldDowngradeChase never fired`,
    ).toBe('investigate');
    expect(wolf.inv).toBe('approach');
    expect(wolf.sightFlicker).toBeLessThanOrEqual(0);
  });
});
