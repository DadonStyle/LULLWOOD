# SPEC: LUL-5945 Firefly motes: real PointLight -> additive Points batch

**Ticket:** LUL-5945 (child of LUL-5943 "slow game", founder-reported critical) · **Tier:**
B — rendering/tuning change in `engine/forest-engine.js`; does not touch movement, collision,
predator AI, scent, hiding, or win/lose simulation logic. Merge on green, review child issue
opens after merge.

**Written against:** `release/next` @ `4114bfa` (2026-10-11). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Root cause (CTO plan, posted on LUL-5945, not re-litigated here)

LUL-5707 "Firefly Swarms" (merged 2026-10-01) builds one real `THREE.PointLight` per firefly
mote — up to 36 live dynamic lights across 6 clusters on desktop. The renderer is a plain
forward `WebGLRenderer` (`engine/forest-engine.js:411-412`, no `EffectComposer`, no clustered
lighting) so every `MeshStandardMaterial` surface in the scene pays a per-fragment loop over
every real light. Going from a ~8-10 baseline to +36 roughly 4-5x's per-fragment lighting
cost scene-wide — this is the founder's "too much being rendered at the same time."
Tree-chunk culling, `throwableMesh`, and predator AI were profiled and ruled out (see the
PLAN comment on LUL-5945, 2026-10-10).

## Files

- `engine/forest-engine.js` — edited. Replace the per-mote `THREE.PointLight` construction
  with one additive-blended `THREE.Points` batch; replace the per-mote `light.intensity`/
  `light.position` tick writes with per-mote writes into that batch's buffer attributes;
  update `qaProbeFireflyClusters` to read the new `mote.brightness` field; add a new hook
  `qaSceneRealLightCount`.
- `engine/forest-engine.d.ts` — edited. Declare `qaSceneRealLightCount`.
- `e2e/firefly-render-cost.spec.ts` — new.

## The change

### 1. `engine/forest-engine.js:1577-1596` — mote construction

Replace:

```js
const FIREFLY_MOTE_COLOR = 0xcfe86a;
// One THREE.PointLight per mote, built once here and never rebuilt -- empty
// outside dusk/night so every loop below over fireflyClusterMotes is a cheap
// no-op for a daytime session. Mote scatter around each cluster center uses a
// deterministic sunflower-seed layout (index-derived angle/radius), not
// rng() -- consuming a shared seeded draw here would shift every later
// rng()-based system's sequence for the same seed (decoyScentSites.ts's own
// header comment: "no rng() draw contract, so seeds stay byte-identical per
// seed").
const fireflyClusterMotes = activeFireflyClusters.flatMap((cluster, ci) => {
  const motes = [];
  for (let i = 0; i < cluster.moteCount; i++) {
    const ang = i * 2.399963 + ci * 0.7;
    const rad = cluster.radius * 0.35 * Math.sqrt((i + 0.5) / cluster.moteCount);
    const baseX = cluster.x + Math.cos(ang) * rad;
    const baseZ = cluster.z + Math.sin(ang) * rad;
    const light = new THREE.PointLight(FIREFLY_MOTE_COLOR, 0, 6, 2);
    light.position.set(baseX, 1.2 + (i % 3) * 0.5, baseZ);
    scene.add(light);
    motes.push({ light, cluster, baseX, baseZ, phase: ang });
  }
  return motes;
});
```

with:

```js
const FIREFLY_MOTE_COLOR = 0xcfe86a;
// LUL-5945: additive THREE.Points batch, not one THREE.PointLight per mote --
// up to 36 real dynamic lights (6 clusters * max moteCount) was the profiled
// cost behind "the game is slow, too much being rendered" (LUL-5943): this
// engine has no clustered/deferred lighting, so every real light forces a
// per-fragment relight of every MeshStandardMaterial surface in the scene.
// Same position+color BufferAttribute shape as scentTrailPts (:1831-1839);
// brightness is baked into vertex color (vertexColors multiplies against
// material.color) rather than a scene-graph light -- additive blending means
// a near-zero color already reads as dark/invisible, same visual result as
// light.intensity approaching 0. Mote scatter around each cluster center
// keeps the deterministic sunflower-seed layout (index-derived angle/radius),
// not rng() -- consuming a shared seeded draw here would shift every later
// rng()-based system's sequence for the same seed (decoyScentSites.ts's own
// header comment: "no rng() draw contract, so seeds stay byte-identical per
// seed"). Disposed generically by the scene.traverse() teardown at :9171,
// same as every other mesh/points object -- no bespoke cleanup needed.
const fireflyMoteCount = activeFireflyClusters.reduce((n, c) => n + c.moteCount, 0);
const fireflyMoteGeo = new THREE.BufferGeometry();
const fireflyMotePos = new Float32Array(fireflyMoteCount * 3);
const fireflyMoteColor = new Float32Array(fireflyMoteCount * 3);
fireflyMoteGeo.setAttribute('position', new THREE.BufferAttribute(fireflyMotePos, 3));
fireflyMoteGeo.setAttribute('color', new THREE.BufferAttribute(fireflyMoteColor, 3));
const fireflyMotePts = new THREE.Points(fireflyMoteGeo, new THREE.PointsMaterial({
  color: FIREFLY_MOTE_COLOR, size: 0.5, vertexColors: true, transparent: true,
  opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
fireflyMotePts.frustumCulled = false; // motes drift past one static bounding sphere, same as scentTrailPts
scene.add(fireflyMotePts);
let fireflyMoteIdx = 0;
const fireflyClusterMotes = activeFireflyClusters.flatMap((cluster, ci) => {
  const motes = [];
  for (let i = 0; i < cluster.moteCount; i++) {
    const ang = i * 2.399963 + ci * 0.7;
    const rad = cluster.radius * 0.35 * Math.sqrt((i + 0.5) / cluster.moteCount);
    const baseX = cluster.x + Math.cos(ang) * rad;
    const baseZ = cluster.z + Math.sin(ang) * rad;
    const idx = fireflyMoteIdx++;
    fireflyMotePos[idx * 3 + 1] = 1.2 + (i % 3) * 0.5;
    motes.push({ idx, cluster, baseX, baseZ, phase: ang, brightness: 0 });
  }
  return motes;
});
```

### 2. `engine/forest-engine.js:8872-8878` — tick loop

Replace:

```js
  for (const mote of fireflyClusterMotes) {
    const w = decoyScentGlowWeight(player.x, player.z, mote.cluster, WRAP_SPAN, WRAP_SPAN);
    mote.light.intensity = 0.6 * w * alarmScalar * (1 - rainfallAmount * CONFIG.FIREFLY_RAIN_DIM);
    if (!motionReduced()) {
      mote.light.position.x = mote.baseX + Math.sin(t*0.3 + mote.phase) * 1.5;
      mote.light.position.z = mote.baseZ + Math.cos(t*0.23 + mote.phase) * 1.5;
      mote.light.position.y = 1.2 + Math.sin(t*0.5 + mote.phase) * 0.6;
    }
  }
```

with:

```js
  for (const mote of fireflyClusterMotes) {
    const w = decoyScentGlowWeight(player.x, player.z, mote.cluster, WRAP_SPAN, WRAP_SPAN);
    mote.brightness = 0.6 * w * alarmScalar * (1 - rainfallAmount * CONFIG.FIREFLY_RAIN_DIM);
    const ci = mote.idx * 3;
    fireflyMoteColor[ci] = fireflyMoteColor[ci + 1] = fireflyMoteColor[ci + 2] = mote.brightness;
    if (!motionReduced()) {
      fireflyMotePos[ci] = mote.baseX + Math.sin(t*0.3 + mote.phase) * 1.5;
      fireflyMotePos[ci + 2] = mote.baseZ + Math.cos(t*0.23 + mote.phase) * 1.5;
      fireflyMotePos[ci + 1] = 1.2 + Math.sin(t*0.5 + mote.phase) * 0.6;
    }
  }
  if (fireflyClusterMotes.length) {
    fireflyMoteGeo.attributes.color.needsUpdate = true;
    fireflyMoteGeo.attributes.position.needsUpdate = true;
  }
```

(`fireflyMoteGeo.attributes.position.needsUpdate` also covers the `motionReduced()` branch
not running — the position attribute still holds last frame's values, same frozen-in-place
behavior the old `light.position` writes had when skipped.)

### 3. `engine/forest-engine.js:4909-4917` — `qaProbeFireflyClusters`

Replace the two `m.light.intensity` reads:

```js
             anyVisible: fireflyClusterMotes.some(function(m){ return m.light.intensity > 0; }),
             maxIntensity: fireflyClusterMotes.reduce(function(acc, m){ return Math.max(acc, m.light.intensity); }, 0),
```

with:

```js
             anyVisible: fireflyClusterMotes.some(function(m){ return m.brightness > 0; }),
             maxIntensity: fireflyClusterMotes.reduce(function(acc, m){ return Math.max(acc, m.brightness); }, 0),
```

Every other field and the function's external return shape stays byte-identical — existing
e2e specs (`firefly-swarms.spec.ts`, `firefly-rain-interaction.spec.ts`,
`firefly-alarm-response.spec.ts`, `firefly-alarm-per-species.spec.ts`,
`firefly-glow-detection.spec.ts`) must keep passing unchanged.

### 4. New hook — `qaSceneRealLightCount`

Add inside the same `?qaHooks=1` block as `qaProbeFireflyClusters` (`engine/forest-engine.js`,
inside the `if(... .has('qaHooks'))` block starting `:4799`), directly after the
`qaProbeFireflyClusters` assignment (`:4917`):

```js
  // LUL-5945: live count of real THREE.Light instances actually in the scene
  // graph -- the fix this hook exists to prove is "fireflies stop being
  // lights", so this counts isLight===true nodes directly rather than
  // inferring it from a probe that could be satisfied by coincidence.
  window.ForestEngine.qaSceneRealLightCount = function(){
    let n = 0;
    scene.traverse(function(o){ if (o.isLight) n++; });
    return n;
  };
```

`scene.traverse` is the same API the teardown dispose pass already uses
(`engine/forest-engine.js:9171`).

### 5. `engine/forest-engine.d.ts` — declare the new hook

Add next to the `qaProbeFireflyClusters` declaration (after its closing `};`, currently
`:120-126`):

```ts
      /** LUL-5945: live count of real THREE.Light instances (`isLight===true`)
       * in the scene graph right now -- proves the firefly-mote render-cost
       * fix actually removed the per-mote THREE.PointLight, not just that the
       * visual brightness math still works (qaProbeFireflyClusters covers
       * that half). Baseline (sun/moon DirectionalLight, hemisphere light,
       * any fixed landmark/beacon point lights) is whatever it is on the
       * branch this runs against -- the test asserts the count does NOT
       * increase when fireflies are active at night vs. absent at noon, not
       * a specific baseline number. */
      qaSceneRealLightCount?: () => number;
```

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint engine/forest-engine.js engine/forest-engine.d.ts` — clean.
- `npx next build` — green.
- `node --test` — full unit suite still green (this change touches no pure `lib/game/*`
  module; `fireflyAlarmResponse.ts`/`decoyScentGlowWeight` are untouched).
- `npx playwright test firefly` — every existing `firefly-*.spec.ts` file passes unchanged
  (proves `qaProbeFireflyClusters`'s external contract held).
- `npx playwright test e2e/firefly-render-cost.spec.ts` — new spec passes (below).

## e2e

**Specs.** `e2e/firefly-render-cost.spec.ts` — new, two tests:
1. `"firefly motes at night add no real scene lights"` — stages night
   (`qaHour: 2`), reads `qaSceneRealLightCount()` once at noon (`qaHour: 11`, fireflies
   absent) and once at night, and asserts the two counts are equal — proves activating up to
   36 motes adds zero real lights, which is the actual regression fix.
2. `"firefly mote brightness still falls off with distance after the render-primitive swap"`
   — stages night, teleports the player with `qaTeleportTo(x, z)`
   (`engine/forest-engine.d.ts:791`) first to a cluster's own center (from
   `qaProbeFireflyClusters().clusters`, e.g. `fireflyMeadow`'s `{x, z}`, distance 0 ->
   `decoyScentGlowWeight` weight 1) and reads `maxIntensity` ("near"), then teleports to
   `(16, 45)` and reads `maxIntensity` again ("far"). `(16, 45)` is ~29u (toroidal
   `wrapDist`, `lib/game/wrap.ts:26-33`, span 96 in the micro world) from the nearest of all
   6 scaled clusters — no point in the 96u micro world clears every cluster's 45u
   `FIREFLY_CLUSTER_RADIUS` outright (the clusters' scaled spread plus the world's wraparound
   already covers it), but `decoyScentGlowWeight`'s falloff is linear and uncapped below the
   radius — `Math.max(0, 1 - dist / site.radius)`, `lib/game/decoyScentSites.ts:52` — so 29u
   out of 45u (weight ~0.35) still reads clearly dimmer than 0u out (weight 1). Asserts the
   near reading is greater than the far reading and the far reading is `>= 0`. Proves the
   proximity-based visual mechanic (the thing a player actually sees) survived the swap from
   light-intensity to vertex-color brightness.

**World.** micro (default). No `qaBuildScene` staging needed — firefly clusters are a fixed
module-scope list (`FIREFLY_CLUSTERS`, `lib/game/fireflyClusters.ts`), always present and
scaled by `CONFIG.fireflyScaleMul` regardless of world size; the micro world already runs
them (see `e2e/firefly-swarms.spec.ts`, the existing precedent this spec file follows).

**Hooks.** `qaSceneRealLightCount(): number` — new, declared above. `qaProbeFireflyClusters`
and `qaTeleportTo(x, z)` — existing (`engine/forest-engine.d.ts:120`, `:791`).

**Tester scenario.** None: this is a render-cost regression fix with no new player-facing
state, mechanic, or copy (Q1-Q6 of the feature checklist do not apply — nothing here is a
feature proposal). The founder's "the game is slow" *feel* is not provable by Playwright;
per the CTO's plan caveat, route a feel confirmation through the CEO/founder once this
merges, in case a second contributor to the slowdown remains (the plan names
`antialias:true` + uncapped `setPixelRatio` at `:411-412` as the candidate if so).

**Not covered.** Actual frame-time/FPS measurement — Playwright's software/swiftshader GPU
path does not reproduce the real cost difference a dynamic light causes on real hardware.
`qaSceneRealLightCount` proves the light was removed structurally; it does not re-measure
the frame-time win. That requires the founder's own-hardware read after merge.

## Cues

No new state, no new readout, no new input, no new copy. Purely a render-primitive swap
behind an existing, unchanged visual mechanic (mote brightness falloff) — Q15/Q16 of the
feature checklist (cue triple, new inputs/settings) do not apply.

## Constraints

- `activeFireflyClusters`, `activeFireflyDetectClusters`, `fireflyAlarmBoost`,
  `decoyScentGlowWeight`, and the brightness formula
  (`0.6 * w * alarmScalar * (1 - rainfallAmount * CONFIG.FIREFLY_RAIN_DIM)`) stay
  byte-identical — this is a render-primitive swap only, no gameplay/detection math changes.
- `qaProbeFireflyClusters`'s return shape (every field name and meaning) is unchanged —
  every existing firefly e2e spec must pass with zero edits.
- No change to `lib/game/fireflyAlarmResponse.ts`, `lib/game/fireflyClusters.ts`, or any
  `CONFIG.FIREFLY_*` tuning constant.

## Out of scope

- `antialias:true` / uncapped `setPixelRatio` (`engine/forest-engine.js:411-412`) — named by
  the CTO's plan as a secondary static cost. Do not touch it in this PR; file a follow-up
  tuning ticket only if the founder reports the slowdown isn't fully resolved after this
  ships.
- Any other light in the scene (sun/moon `DirectionalLight`, hemisphere light, landmark/
  beacon lights) — not implicated by the profiling, not touched.
