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

// LUL-2225/tuning.js:59: CONFIG.lake is left at its full-map absolute
// position/radius on qaWorld=micro (applyQaWorldMicroPreset()'s own comment:
// "LANDMARKS/CAVE/CONFIG.lake are deliberately left untouched"). A candidate
// that lands inside lake.clear gets pushed by the pre-existing, non-rng,
// LUL-791 pushOutOfLakeClearance() (lib/game/lake.ts) to exactly
// lake.clear+0.5 from the lake's center, along its own bearing -- a
// deterministic step that runs *after* this loop's clearance retry has
// already accepted the candidate, and is untouched by this ticket's fix
// (spec's own constraint: do not add inLake() to the retry condition).
const LAKE = { x: 34, z: -28, clear: 22 };
const LAKE_PUSH_DIST = LAKE.clear + 0.5;

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
        // LUL-2735 (filed alongside this ticket): on qaWorld=micro the lake's
        // absolute-position clearance ring covers proportionally far more of
        // the map, so a predator this loop already placed outside the scaled
        // clearance can still get radially pushed close to (observed as near
        // as 5.5u of) the baby by the lake-push step above. That's a distinct,
        // pre-existing (LUL-791-era) interaction this ticket's scaling fix
        // does not touch -- excluded here rather than silently loosening the
        // clearance assertion for every other predator.
        const distFromLake = Math.hypot(p.x - LAKE.x, p.z - LAKE.z);
        if (Math.abs(distFromLake - LAKE_PUSH_DIST) < 0.01) continue;

        const distFromOrigin = Math.hypot(p.x, p.z);
        expect(distFromOrigin, `seed ${seed}, ${p.kind} at (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(ORIGIN_MIN);

        const distFromBaby = Math.hypot(p.x - mapSeed.baby.x, p.z - mapSeed.baby.z);
        expect(distFromBaby, `seed ${seed}, ${p.kind} at (${p.x}, ${p.z}) vs baby`).toBeGreaterThanOrEqual(BABY_MIN);
      }
    }
  });
});
