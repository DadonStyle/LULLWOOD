// LUL-5627 (Mudbound Decoy Amplification): proves generateMudZones()'s reserved first draw
// (engine/forest-engine.js) actually holds across the real generateMap() path, not just the
// forced qaBuildScene geometry e2e/mudbound-decoy-trap.spec.ts stages -- that file's own gap
// would be exactly the LUL-5630 problem (a green suite via a forced override while live
// generation only composes the two primitives ~2% of the time) if this file didn't exist.
//
// Drives qaRegenerateMap(seed) (the real rng()-seeded generateMap(), LUL-83) over several
// distinct seeds and reads the live mudZones back via qaProbeMudZones() -- no `mudZones`
// override anywhere in this file. Runs under the default micro world (LUL-2377): the mud
// zone reservation in generateMudZones() reads `half`/`margin` and
// scaledDecoyScentSites()'s own CONFIG.decoyScaleMul live, both already scaled correctly for
// the micro preset (see that function's comment), so no `@fullmap` tag is needed here.
//
// This checks every seed, not a sampled subset -- the reservation is supposed to be a
// guarantee, not a probability improvement, so a single counterexample seed is the defect.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const SEEDS = [1, 2, 3, 17, 101, 4242, 999999, 2026100100];

test.describe('Mudbound Decoy Amplification reachability (LUL-5627)', () => {
  test('a real (non-forced) generateMudZones() draw always lands a zone inside the Decoy Scent Site', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];

    for (const seed of SEEDS) {
      await qaHook(page, 'qaRegenerateMap', seed);
      const zones = await qaHook(page, 'qaProbeMudZones');
      expect(zones.length, `seed ${seed}: generateMudZones() must still place all 5 zones`).toBe(5);

      const overlapping = zones.filter((z: { x: number; z: number; r: number }) =>
        Math.hypot(site.x - z.x, site.z - z.z) < z.r,
      );
      expect(overlapping.length, `seed ${seed}: no mud zone landed inside the decoy site -- reservation failed for this seed`).toBeGreaterThanOrEqual(1);
    }
  });
});
