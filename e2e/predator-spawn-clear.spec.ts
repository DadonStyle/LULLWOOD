// Predators must never start inside a collider. placePredators() runs while only
// the trees exist, so before clearPredatorSpawns() a predator could spawn inside
// a rock, bramble, landmark or the cave and stay wedged from the first frame.
// Drives the real generateMap() (qaRegenerateMap) over many seeds on the micro
// world and checks every active predator against predatorBlocked() -- the same
// check its movement uses. A guarantee, so one blocked predator on one seed fails.
// Micro-world only (LUL-2377): clearPredatorSpawns()/findClearSpot() are map-size
// agnostic -- spawnClearanceScale already normalizes the clearance constants --
// so the micro world proves the mechanism without a @fullmap exception.
import { test, expect } from './fixtures';
import { boot, enter } from './helpers';

const SEEDS = [1, 2, 3, 17, 101, 4242, 31337, 999999, 2026100100, 123456789];

test('no predator spawns inside a collider (micro map)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);

  let nudged = 0;
  for (const seed of SEEDS) {
    // Generate and probe in one synchronous evaluate: once the game ticks,
    // predators walk and may legally brush closer to a rock than the spawn
    // margin this checks.
    const probe = await page.evaluate((s) => {
      const engine = window.ForestEngine!;
      engine.qaRegenerateMap!(s);
      return engine.qaProbePredatorSpawns!();
    }, seed);
    expect(probe.active, `seed ${seed}: no active predators`).toBeGreaterThan(0);
    expect(probe.blocked, `seed ${seed}: ${probe.blocked} predator(s) start inside a collider`).toBe(0);
    nudged += probe.nudged;
  }
  test.info().annotations.push({ type: 'nudged', description: `${nudged} predator(s) moved clear across ${SEEDS.length} seeds` });
});
