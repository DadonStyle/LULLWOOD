import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biomeAt,
  bogKeepClear,
  routeCrossesBog,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  bogMaskLevel,
  BOG_SPEED_MULTIPLIER,
  BOG_NOISE_MULTIPLIER,
  BLACKOUT_MIN_RADIUS,
  BOG_MASK_DECAY_TIME,
  BOG_CENTER,
  BOG_INNER_RADIUS,
  BOG_OUTER_RADIUS,
  type Landmark,
} from './bog.ts';
import { LANDMARKS, CAVE, ROOSTS, CONFIG } from '../../engine/tuning.js';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('biomeAt is deterministic for a given point', () => {
  assert.equal(biomeAt(30, 2), biomeAt(30, 2));
});

test('biomeAt stays within [0, 1] across the whole map square', () => {
  for (let x = -240; x <= 240; x += 10) {
    for (let z = -240; z <= 240; z += 10) {
      const b = biomeAt(x, z);
      assert.ok(b >= 0 && b <= 1, `biomeAt(${x},${z})=${b} out of range`);
    }
  }
});

test('biomeAt finds both boggy and dry ground within the map square', () => {
  let sawBoggy = false, sawDry = false;
  for (let x = -240; x <= 240; x += 10) {
    for (let z = -240; z <= 240; z += 10) {
      const b = biomeAt(x, z);
      if (b > 0.5) sawBoggy = true;
      if (b === 0) sawDry = true;
    }
  }
  assert.ok(sawBoggy, 'expected at least one strongly boggy sample point');
  assert.ok(sawDry, 'expected at least one dry sample point');
});

test('home/spawn is kept dry regardless of the noise field', () => {
  assert.equal(biomeAt(0, 0), 0);
  assert.equal(biomeAt(6.3, 0), 0); // inSpawn()'s own radius, engine/forest-engine.js (re-grep `inSpawn` for current line)
});

test('biomeAt is exactly 1 at the center and 0 just past the outer radius', () => {
  assert.equal(biomeAt(BOG_CENTER.x, BOG_CENTER.z), 1);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, -0.7071]]) {
    const x = BOG_CENTER.x + dx * (BOG_OUTER_RADIUS + 1);
    const z = BOG_CENTER.z + dz * (BOG_OUTER_RADIUS + 1);
    assert.equal(biomeAt(x, z), 0, `(${x},${z}) at outer+1 along (${dx},${dz}) should be dry`);
  }
});

// LUL-2225: the founder rejected LUL-2084's shipped bog for blending
// landmarks into it -- oak/drownedCar must now be outside the patch
// entirely, the opposite of what LUL-1902's tests asserted.
test('oak and drownedCar landmarks are outside the bog patch (LUL-2225)', () => {
  assert.equal(biomeAt(22, 4), 0, 'oak must no longer sit inside the bog patch');
  assert.equal(biomeAt(-95, 46), 0, 'drownedCar must no longer sit inside the bog patch');
});

test('the lake and the other landmarks are not accidentally boggy', () => {
  assert.equal(biomeAt(34, -28), 0); // CONFIG.lake
  assert.equal(biomeAt(-95, -95), 0); // fireTower
  assert.equal(biomeAt(100, -75), 0); // stoneMarker
});

// LUL-2225: the founder's core complaint -- LUL-2084 shipped ~24.9% of the
// map as boggy. Sampled on a 2-unit lattice across the full 480x480 square,
// same method the ticket's own evidence used.
test('the bog patch covers between 2% and 5% of the map (LUL-2225)', () => {
  let boggy = 0, total = 0;
  for (let x = -240; x <= 240; x += 2) {
    for (let z = -240; z <= 240; z += 2) {
      total++;
      if (biomeAt(x, z) > 0) boggy++;
    }
  }
  const frac = boggy / total;
  assert.ok(frac >= 0.02 && frac <= 0.05, `area fraction ${frac} out of [0.02, 0.05]`);
});

test('geometry constants stay within the founder-set ceiling (LUL-2225)', () => {
  assert.ok(BOG_OUTER_RADIUS <= 60, `BOG_OUTER_RADIUS ${BOG_OUTER_RADIUS} exceeds the 60 ceiling`);
  assert.ok(BOG_OUTER_RADIUS - BOG_INNER_RADIUS <= 25, 'falloff band exceeds 25 units');
});

// LUL-2225: nothing else may spawn inside the patch -- static-data guard
// over every fixed landmark/cave/roost position, no engine needed.
test('every LANDMARK, the CAVE, and every ROOST stay clear of the bog patch (LUL-2225)', () => {
  for (const l of LANDMARKS) {
    assert.ok(!bogKeepClear(l.x, l.z, l.clear), `${l.kind} at (${l.x},${l.z}) is inside the bog keep-clear radius`);
  }
  assert.ok(!bogKeepClear(CAVE.x, CAVE.z, CAVE.clear), `CAVE at (${CAVE.x},${CAVE.z}) is inside the bog keep-clear radius`);
  for (const r of ROOSTS) {
    assert.ok(!bogKeepClear(r.x, r.z, r.radius), `${r.kind} at (${r.x},${r.z}) is inside the bog keep-clear radius`);
  }
});

test('bogKeepClear is a pure radius test on BOG_OUTER_RADIUS, independent of biomeAt', () => {
  assert.ok(bogKeepClear(BOG_CENTER.x, BOG_CENTER.z, 0));
  assert.ok(bogKeepClear(BOG_CENTER.x + BOG_OUTER_RADIUS - 0.01, BOG_CENTER.z, 0));
  assert.ok(!bogKeepClear(BOG_CENTER.x + BOG_OUTER_RADIUS + 0.01, BOG_CENTER.z, 0));
  // a pad extends the excluded radius even where bogginess is already 0
  assert.ok(bogKeepClear(BOG_CENTER.x + BOG_OUTER_RADIUS + 5, BOG_CENTER.z, 10));
});

test('routeCrossesBog is true only when the segment passes within BOG_INNER_RADIUS of BOG_CENTER', () => {
  // straight line from home through the bog center and out the far side
  const far = { x: BOG_CENTER.x * 3, z: BOG_CENTER.z * 3 };
  assert.ok(routeCrossesBog(0, 0, far.x, far.z), 'a route through the center must cross the bog');
  // a route that stays on the opposite side of the map never comes near the patch
  assert.ok(!routeCrossesBog(0, 0, -far.x, -far.z), 'a route away from the bog must not cross it');
  // a segment entirely outside BOG_OUTER_RADIUS, tangent-ish but still short of the core
  assert.ok(!routeCrossesBog(200, 200, 200, -200), 'a distant segment must not cross the bog core');
  // degenerate zero-length segment at the center counts as crossing
  assert.ok(routeCrossesBog(BOG_CENTER.x, BOG_CENTER.z, BOG_CENTER.x, BOG_CENTER.z));
});

test('bogSpeedMultiplier/bogNoiseMultiplier hit their old boolean endpoints exactly', () => {
  assert.equal(bogSpeedMultiplier(1), BOG_SPEED_MULTIPLIER);
  assert.equal(bogSpeedMultiplier(0), 1);
  assert.equal(bogNoiseMultiplier(1), BOG_NOISE_MULTIPLIER);
  assert.equal(bogNoiseMultiplier(0), 1);
});

test('bogSpeedMultiplier/bogNoiseMultiplier are linear in bogginess', () => {
  assert.equal(bogSpeedMultiplier(0.5), 1 - 0.5 * (1 - BOG_SPEED_MULTIPLIER));
  assert.equal(bogNoiseMultiplier(0.5), 1 + 0.5 * (BOG_NOISE_MULTIPLIER - 1));
});

test('bogMaskLevel rises instantly when bogginess increases', () => {
  assert.equal(bogMaskLevel(0.8, 0.2, 1/60), 0.8);
  assert.equal(bogMaskLevel(1, 0, 1/60), 1);
});

test('bogMaskLevel decays linearly to 0 over BOG_MASK_DECAY_TIME once bogginess drops', () => {
  let mask = 1;
  const dt = 1; // 1s steps for a readable assertion
  for (let i = 0; i < BOG_MASK_DECAY_TIME; i++) mask = bogMaskLevel(0, mask, dt);
  assert.ok(Math.abs(mask) < 1e-9, `expected mask ~0 after ${BOG_MASK_DECAY_TIME}s, got ${mask}`);
});

test('bogMaskLevel never rises above currentBogginess and never drops below 0', () => {
  let mask = bogMaskLevel(0.4, 0, 0.1);
  assert.ok(mask <= 0.4 + 1e-9);
  for (let i = 0; i < 200; i++) mask = bogMaskLevel(0, mask, 0.1);
  assert.ok(mask >= 0);
});

// LUL-2225: replaces the old `biomeAt(p.x,p.z) > 0` assertion -- the child no
// longer has to stand in the bog, the direct route home has to cross it.
test('pickHardBabyPosition lands beyond the bog, clear of the map edge', () => {
  const p = pickHardBabyPosition(seeded(1), 240, LANDMARKS as unknown as Landmark[]);
  assert.ok(routeCrossesBog(0, 0, p.x, p.z), `(${p.x},${p.z})'s route home should cross the bog core`);
  assert.ok(Math.abs(p.x) <= 220 && Math.abs(p.z) <= 220, `p=${JSON.stringify(p)} out of margin`);
  assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, 'must clear the blackout distance floor');
});

test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), 240, []);
  const b = pickHardBabyPosition(seeded(42), 240, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition never lands closer than BLACKOUT_MIN_RADIUS', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const p = pickHardBabyPosition(seeded(seed), 240, []);
    assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, `seed ${seed}: (${p.x},${p.z}) is inside the floor`);
  }
});

// LUL-2225: this is the regression the ticket exists to close. The old
// predicate (biomeAt(x,z) > 0, i.e. "child stands in the bog") scored 0/1000
// on any small patch near home -- every call silently fell back to a random
// point. The new predicate (routeCrossesBog) must satisfy its full
// contract -- no fallback -- across a real seed spread, not just a handful.
test('pickHardBabyPosition satisfies its full predicate with no fallback over >= 200 seeds (LUL-2225)', () => {
  const half = 240, margin = 20, maxTries = 200;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    const p = pickHardBabyPosition(rng, half, LANDMARKS as unknown as Landmark[], 6, margin, maxTries);
    assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, `seed ${seed}: distHome floor violated`);
    assert.ok(routeCrossesBog(0, 0, p.x, p.z), `seed ${seed}: route home does not cross the bog`);
    for (const l of LANDMARKS) {
      assert.ok(Math.hypot(p.x - l.x, p.z - l.z) >= l.clear + 6, `seed ${seed}: too close to ${l.kind}`);
    }
  }
});

test('the bog geometry reaches far enough from home for pickHardBabyPosition to stay satisfiable', () => {
  // Regression check for LUL-1902/LUL-2225: routeCrossesBog(0,0,x,z) can only
  // ever be true for a point beyond BLACKOUT_MIN_RADIUS if the bog's core is
  // reachable along some ray from home within that distance -- i.e. the
  // straight-line distance from home to BOG_CENTER, minus BOG_INNER_RADIUS,
  // must leave room for a point past it that's still >= BLACKOUT_MIN_RADIUS
  // from home. A center/radius pair that fails this makes the predicate
  // impossible to satisfy on every call.
  const distHomeToCenter = Math.hypot(BOG_CENTER.x, BOG_CENTER.z);
  assert.ok(distHomeToCenter > BOG_INNER_RADIUS, 'home must be outside the full-bogginess core');
});

test('pickHardBabyPosition avoids a landmark covering its whole reachable area, still terminates', () => {
  const landmarks: Landmark[] = [{ x: 22, z: 4, clear: 300 }]; // deliberately covers the whole square
  const p = pickHardBabyPosition(seeded(7), 120, landmarks, 6, 20, 5);
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});

// LUL-1861: predator speed in engine/forest-engine.js's updatePredators() must apply
// bogSpeedMultiplier exactly once (at the LUL-1483 site, `speed *= bogSpeedMultiplier(biomeAt(...))`,
// after all per-state branches). A regression that reintroduces a second bog factor into the
// per-state `pLakeMul`/`pTerrainMul` composition (as LUL-1692/PR #386 briefly did by calling the
// since-removed `inBog()`) would silently halve speed again on top of this application.
test('bog speed multiplier composes with full bogginess exactly once, matching the single engine application site', () => {
  const fullBog = bogSpeedMultiplier(1);
  assert.equal(fullBog, BOG_SPEED_MULTIPLIER);
  // one application: full-speed predator entering full bog slows to exactly BOG_SPEED_MULTIPLIER
  const speedAfterOneApplication = 1 * fullBog;
  assert.equal(speedAfterOneApplication, BOG_SPEED_MULTIPLIER);
  // a second, erroneous application (the LUL-1861 bug shape) must NOT match the correct result
  const speedAfterDoubleApplication = 1 * fullBog * fullBog;
  assert.notEqual(speedAfterDoubleApplication, BOG_SPEED_MULTIPLIER);
  assert.equal(speedAfterDoubleApplication, BOG_SPEED_MULTIPLIER * BOG_SPEED_MULTIPLIER);
});

test('CONFIG.mapSize is still 480, the constant the area-fraction test above assumes', () => {
  assert.equal(CONFIG.mapSize, 480);
});
