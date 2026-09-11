// LUL-2328: engine boot-path QA hooks (child 1/2 of epic LUL-2324 -- full-map
// e2e boots under software GL were measured at 3.5-9 GB and repeatedly
// OOM-killed the nightly QA host). Specs here are what child 2/2 (the e2e
// suite migration) builds on -- see docs/specs/lul-2328-qa-world-micro-hooks.md.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

test.describe('qaWorld=micro boot preset', () => {
  test('boots a small, cheap world', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.waitForTimeout(300); // let a couple of real frames render, same settle as e2e/qa-probe-perf.spec.ts

    const mapSeed = await qaHook(page, 'qaProbeMapSeed');
    // Target is 40 trees (applyQaWorldMicroPreset(), engine/tuning.js) -- 60
    // gives margin above that for the generator's own try-budget rejection,
    // without accepting anything close to the full-map 5200.
    expect(mapSeed.trees.length).toBeGreaterThan(0);
    expect(mapSeed.trees.length).toBeLessThanOrEqual(60);

    const mem = await qaHook(page, 'qaProbeMemory');
    expect(mem.renderer.geometries).toBeGreaterThan(0);
    expect(mem.renderer.textures).toBeGreaterThan(0);
    // Chromium-only (performance.memory) -- see the hook's own doc comment.
    if (mem.heap) {
      expect(mem.heap.usedJSHeapSize).toBeLessThan(400 * 1024 * 1024); // LUL-2324 micro-world budget
    }
  });
});

test.describe('qaNoRender=1', () => {
  test('skips mesh construction, keeps the HUD alive', async ({ page }) => {
    await boot(page, { qaHooks: true, qaNoRender: true });
    await page.waitForTimeout(300);

    // boot() already asserted both canvases exist; qaProbePlayer() proves the
    // engine tick/state loop is genuinely alive, not just mounted.
    const playerState = await qaHook(page, 'qaProbePlayer');
    expect(playerState).toMatchObject({ x: expect.any(Number), z: expect.any(Number) });

    const mapSeed = await qaHook(page, 'qaProbeMapSeed');
    expect(mapSeed.trees.length).toBeGreaterThan(0); // generateMap() ran...

    // qaProbeTreeChunks is untyped in forest-engine.d.ts (same as qaProbePerf,
    // see e2e/qa-probe-perf.spec.ts), hence the direct evaluate + `as any`.
    const chunks = await page.evaluate(() => (window as any).ForestEngine.qaProbeTreeChunks());
    expect(chunks.totalInstances).toBe(0); // ...but layoutTreeChunks() never built any mesh instances
  });
});

test.describe('detectScaleMul', () => {
  // LUL-2407: applyQaWorldMicroPreset() shrinks the map 480 -> 96 but left predator detect
  // radii (PSPEC.wolf.detect=42 etc, engine/tuning.js) at full-map absolute values, so a
  // predator placed at a full-map-safe spawn distance could already see the player on the
  // micro map. The fix scales detect radii by the same 0.2 ratio the map itself shrinks by
  // (engine/tuning.js applyQaWorldMicroPreset(), engine/forest-engine.js effectiveDetect/
  // canSee) -- exercise it via the exact function it changed, canSee(p, dist), through the
  // existing qaPredatorState(idx).canSee live value.
  test('scales predator detect radius with the micro map', async ({ page }) => {
    await boot(page, { qaHooks: true });

    // Unscaled wolf detect is 42 -- well within line of sight at 20 units on an empty scene.
    // Scaled (x0.2 = 8.4) it must not see the player at that range.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 20, z: 0, state: 'roam' }] });
    const far = await qaHook(page, 'qaPredatorState', 0);
    expect(far).toMatchObject({ kind: 'wolf', dist: 20 });
    expect(far.canSee).toBe(false);

    // Sanity check the scaling doesn't disable detection outright -- well inside the scaled
    // 8.4 radius, on the same clear line of sight, it must still see the player.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 5, z: 0, state: 'roam' }] });
    const near = await qaHook(page, 'qaPredatorState', 0);
    expect(near).toMatchObject({ kind: 'wolf', dist: 5 });
    expect(near.canSee).toBe(true);
  });
});

test.describe('speedScaleMul', () => {
  // LUL-2469: CONFIG.speedScaleMul (LUL-2422) was folded into pLakeMul and applied to every
  // `*pLakeMul` speed site in updatePredators() except one -- the roam state's waypoint-travel
  // leg, which was left as a bare `speed=2.3` literal. That's exactly the case the fix's own
  // motivating comment names ("a full-speed predator can still wander/chase into a scripted QA
  // teleport target"), so a roaming (never-alerted) predator kept crossing the shrunk micro map
  // at the full-map speed. Exercise the actual crossing speed via qaPredatorState(idx).x/z deltas
  // across fixed-step ticks, not just that the hint specs pass with predators emptied out.
  test('scales roam-state wander speed with the micro map', async ({ page }) => {
    await boot(page, { qaHooks: true });
    // updatePredators() only runs `if(playing)` (forest-engine.js) -- without entering the
    // game (past the click-to-start gate) qaAdvance() ticks the clock but predators never move.
    await enter(page);

    const FIXED_DT = 0.05;
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    // Spawned well clear of CONFIG.lake (x:34,z:-28,r:15) so pLakeMul's lake component stays 1 --
    // isolates speedScaleMul as the only multiplier in play. Child relocated to CRY_NOISE_RADIUS
    // (32, lib/game/noise.ts) clear of the predator too -- otherwise the unconditional per-tick
    // cry-noise roll (Math.random(), not the seeded rng) can flip roam->investigate mid-measurement
    // and this would flakily measure the investigate/approach leg's `p.spec.speed*pLakeMul` instead.
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: -30, z: 0, state: 'roam' }],
      child: { x: 40, z: 40 },
    });
    // qaBuildScene() seeds wpx/wpz == spawn (x,z), so wd==0 < 2.5 on the very first tick and the
    // roam branch immediately calls pickRoamWaypoint() for a real (far) target -- one step to get
    // past that pick, then a warm-up run so the velocity-smoothing accel (`dt*3.6` per tick) has
    // converged on the target speed before measuring, so the ramp-up transient doesn't bias it low.
    await qaHook(page, 'qaAdvance', 1);
    await qaHook(page, 'qaAdvance', 40); // 2s game time, ~99.98% converged (0.82^40)

    const before = await qaHook(page, 'qaPredatorState', 0);
    const MEASURE_STEPS = 20; // 1s game time
    await qaHook(page, 'qaAdvance', MEASURE_STEPS);
    const after = await qaHook(page, 'qaPredatorState', 0);

    const dist = Math.hypot(after.x - before.x, after.z - before.z);
    const actualSpeed = dist / (MEASURE_STEPS * FIXED_DT);
    // applyQaWorldMicroPreset() sets speedScaleMul=0.2 -- the roam literal's un-scaled speed is
    // 2.3, so the fixed crossing speed here must be ~0.46 units/s, not the bug's full 2.3.
    expect(actualSpeed).toBeCloseTo(2.3 * 0.2, 1);
  });
});

test.describe('qaBuildScene', () => {
  test('places exactly one bramble, one predator, and the player', async ({ page }) => {
    await boot(page, { qaHooks: true });

    const result = await qaHook(page, 'qaBuildScene', {
      props: [{ kind: 'bramble', x: 10, z: 0 }],
      predators: [{ kind: 'wolf', x: 15, z: 0, state: 'roam' }],
    });
    expect(result).toEqual({ trees: 0, props: 1, predators: 1 });

    // Real-collision cross-check, not just the return-value count: the
    // bramble must be genuinely reachable through coverData/coverGrid, the
    // same structures blockedR()/findHideSpot() read.
    const stage = await qaHook(page, 'qaStageWalkIntoCover', 'bramble');
    expect(stage).not.toBeNull();
    expect(stage.prop.kind).toBe('bramble');

    // The single placed wolf is speciesIdx 0 within its species, and the
    // `predators` pool is built wolf-first (forest-engine.js's `for(const k
    // of ['wolf','bear','lion'])` loop) -- so its global `predators` index is
    // deterministically 0 whenever exactly one wolf is placed and no bear/lion.
    const wolfState = await qaHook(page, 'qaPredatorState', 0);
    expect(wolfState).toMatchObject({ kind: 'wolf', state: 'roam', x: 15, z: 0 });
  });
});
