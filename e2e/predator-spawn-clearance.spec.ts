// LUL-2725/LUL-2732: placePredators()'s spawn-clearance retry loop used the
// same fixed 50u-from-origin / 34u-from-baby constants at every CONFIG.mapSize.
// At qaWorld=micro's half=48 (engine/tuning.js applyQaWorldMicroPreset()) the
// 50u exclusion radius covers nearly the entire usable square, so the loop's
// 60-try budget occasionally exhausted and fell through with a candidate close
// to the origin -- observed live at 5.0u in 1/40 trials. lib/game/spawnClearance.ts
// scales both constants by the same 96/480 ratio the micro preset already uses
// for detectScaleMul/speedScaleMul/missionScaleMul. This regenerates the micro
// map 100 times (the ticket's own live-evidence method, scaled up for margin)
// and asserts every predator lands outside the scaled clearance radius on
// every trial. See docs/specs/lul-2725-spawn-clearance-micro-world-scale.md.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

test.describe('placePredators() spawn clearance (qaWorld=micro)', () => {
  test('every predator spawns outside the scaled clearance radius across 100 map regenerations', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });

    // qaWorld=micro's half=48 scales the clearance constants by
    // spawnClearanceScale(48) === 0.2 (same ratio applyQaWorldMicroPreset()
    // uses elsewhere): 50*0.2=10 from the origin, 34*0.2=6.8 from the baby.
    const EPS = 0.01; // float slack, same margin the ticket's own analysis used
    const ORIGIN_MIN = 50 * 0.2 - EPS;
    const BABY_MIN = 34 * 0.2 - EPS;

    for (let seed = 1; seed <= 100; seed++) {
      await qaHook(page, 'qaRegenerateMap', seed);
      const mapSeed = await qaHook(page, 'qaProbeMapSeed');

      for (const p of mapSeed.predators) {
        const distFromOrigin = Math.hypot(p.x, p.z);
        expect(distFromOrigin, `seed ${seed}, ${p.kind} at (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(ORIGIN_MIN);

        const distFromBaby = Math.hypot(p.x - mapSeed.baby.x, p.z - mapSeed.baby.z);
        expect(distFromBaby, `seed ${seed}, ${p.kind} at (${p.x}, ${p.z}) vs baby`).toBeGreaterThanOrEqual(BABY_MIN);
      }
    }
  });
});
