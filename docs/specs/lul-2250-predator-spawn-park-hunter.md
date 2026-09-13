# LUL-2250 -- whole-map predator spawn + park/unpark + hunter guarantee

Rollout step 6/6 (final) of epic LUL-2223. Blocked by LUL-2249 (chunk streaming, done --
PR #616 merged to `release/next` at `ac6e69b`). Tier **C** (`engine/forest-engine.js` is
Tier C by path regardless of diff content) -- Code Reviewer blocking review
(`REVIEW: APPROVED`) required before merge.

**Written against:** `release/next` @ `ade8aa7`. **Do not trust these line numbers
blindly** -- the four other children of this epic have each shifted the file by dozens
of lines; locate every symbol by name/content first, use the number only to confirm you
found the right one.

## What this is

Three changes to `engine/forest-engine.js`, all downstream of LUL-2249's streaming ring
(`STREAM_RADIUS_CHUNKS`, `chunkXZ()`, `:901`/`:906`):

1. `placePredators()` (`:1923`) spawns over the whole map instead of a fixed annulus.
2. Predators outside the live 5x5 chunk ring go `parked`: not simulated, not visible,
   forgotten (state resets) so the player can't tell an 8-chunk-away predator apart from
   one that was never generated.
3. A guarantee that at least 2 predators stay active near the player -- an all-parked
   board (plausible now that spawn is whole-map) would mean walking for minutes with no
   threat, which breaks the game's entire premise.

## 1. Whole-map spawn draw

`placePredators()`'s per-predator loop (`:1923-1962`) currently draws:

```js
let x, z, tries = 0;
do { const ang=rng()*Math.PI*2, d=half*(0.42+rng()*0.45); x=Math.cos(ang)*d; z=Math.sin(ang)*d; tries++; }
while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 34 || blockedR(x, z, p.rad+0.5)) && tries < 60);
```

Replace only the draw line inside the `do`, keep the `while` condition (the >=50u-from-
origin reject via `x*x+z*z < 2500`, >=34u-from-child, `blockedR`, `tries < 60`) and the
`inLake`/`pushOutOfLakeClearance` push after the loop byte-for-byte identical:

```js
do { x=rnd(-half+margin, half-margin); z=rnd(-half+margin, half-margin); tries++; }
```

`rnd`/`half`/`margin` already exist (`:307`, `:252`, `:253`) and this is the exact
`[-half+margin, half-margin]^2` draw `generateCover()`/`generateReeds()`/
`generateBogTrees()`/`generateThrowables()` already use (`:704`, `:1082`, `:1136`,
`:1242`) -- reuse, don't reinvent.

**Draws from `rng()` only**, same call as before (2 draws/attempt, same as the annulus
draw) -- never `Math.random()`.

**Determinism declaration (mandatory in the PR body, precedent `docs/specs/lul-1484-grow-map.md`
"Determinism"):** this changes which candidates each retry loop rejects on every seed
where the annulus and the whole-map draw disagree -- i.e. nearly every seed. `placePredators()`
runs before `generateCover()` against the same shared `rng` stream (`:1263-1265` --
`buildGrid(); player.x=0; player.z=0; ...; placePredators(); generateCover();`), so this
reshuffles cover/prop placement once, for every seed, the same way the LUL-791 lake-reject
comment (`:1936-1948`) already warns a draw-count change here does. `map-seed.spec.ts` will
need its pinned-seed fixture regenerated in the same PR (screenshot/position fixtures, not
logic) -- expected, not a regression.

**New spawn distribution means predators can spawn already parked.** Most of the map's
area is outside the 300x300u ring around the always-(0,0) spawn point (5x5 of 8x8 chunks
= 39% of the 480x480 map), so most predators will spawn parked now. `placePredators()`
must set `p.parked` correctly *before* the function returns, not rely on the first tick's
park-scan (see §2) to catch up -- a fullmap e2e reading state in the same frame `enter()`
resolves would otherwise race a one-frame stale `parked=false`/`g.visible=true` flash.
`player.x=0; player.z=0;` is already set immediately before `placePredators()` is called
(`:1262`), so compute it inline:

```js
p.x=x; p.z=z; p.wpx=x; p.wpz=z; p.vx=0; p.vz=0; p.yaw=rng()*Math.PI*2;
const [ccx, ccz] = chunkXZ(x, z), [pcx, pcz] = chunkXZ(player.x, player.z);
p.parked = Math.max(Math.abs(ccx-pcx), Math.abs(ccz-pcz)) > STREAM_RADIUS_CHUNKS;
```
(place right after the existing `p.yaw=rng()*Math.PI*2;` line) and add one line after the
existing `p.g.visible = !p.inert;` at the top of the loop (`:1927`) -- once `p.parked` is
known, correct it:
```js
if(p.parked) p.g.visible = false;
```
`chunkXZ`/`STREAM_RADIUS_CHUNKS` draw no rng, so this doesn't touch the draw-count
argument above.

## 2. Park / unpark

**New per-predator field:** `p.parked` (boolean). Add to `makePredator()`'s returned
object (next to the other per-predator state, `:1906-1912`) as `parked: false`, and reset
it explicitly in `placePredators()` (handled by §1 above) and in `qaBuildScene()`'s
per-predator reset block (`:5085-5093`, add `p.parked = false;` alongside the other
explicit resets there -- self-corrects on the next real tick regardless since the RAF
loop is already running pre-`enter()`, LUL-2283's own comment on this exact hazard at
`e2e/predator-determinism.spec.ts:33-39`, but match the file's existing belt-and-suspenders
style: every other field `qaBuildScene` stages gets reset explicitly even where a later
system would also catch it, e.g. `p.hunt = false` there today).

**Per-tick recompute.** `tick()` calls `if(playing) updatePredators(...)` at `:5993`.
Insert a new `if(playing){ ... }` block immediately above that line (after
`carriedCryPulse`/`jumpPressed` reset, which the diff doesn't touch) that recomputes
`p.parked` for every non-inert predator against the player's *current* chunk, before
`updatePredators()`/`updateWolfPack()` run this same frame -- so a transition (either
direction) takes effect the same tick, not one tick late:

```js
if(playing){
  const [pcx, pcz] = chunkXZ(player.x, player.z);
  for(const p of predators){
    if(p.inert) continue;
    const [ccx, ccz] = chunkXZ(p.x, p.z);
    const wasParked = p.parked;
    p.parked = Math.max(Math.abs(ccx-pcx), Math.abs(ccz-pcz)) > STREAM_RADIUS_CHUNKS;
    if(p.parked && !wasParked){
      // LUL-2250: forgets you the moment you leave its region -- state and
      // hunt/lkp memory both reset, not just state, or a predator that was
      // mid force-hunt (p.hunt, checked *before* the state switch below --
      // see the `else if(p.hunt)` branch at :2544) would resume an unbreakable
      // beeline for the player the instant it's brought back by the hunter
      // guarantee (§3) or a player backtrack, defeating "forgets you".
      p.state = 'roam'; p.spotted = false; p.inv = ''; p.lkpSweeps = 0; p.hunt = false;
      p.g.visible = false;
    } else if(!p.parked && wasParked){
      p.g.visible = true;
    }
  }
}
if(playing) updatePredators(dt, noiseRadius, cryNoiseRadius);
```

**Skip parked predators in the three consuming loops** (all three already skip `p.inert`
-- OR `p.parked` into the same guard, do not add a second branch):

- `updateWolfPack()` (`:2385-2387`): `const wolves = predators.filter(p => p.kind === 'wolf' && !p.inert);`
  -> add `&& !p.parked`.
- `updatePredators()`'s own loop (`:2419-2420`): `if(p.inert) continue;` -> `if(p.inert || p.parked) continue;`.
- The threat scan in `tick()` (`:6009-6011`, computes `nearDist`/`approaching`/`exposedNow`/
  `coveredNow` -- the piano/vignette/cover-desaturation feed): `if(p.inert) continue;`
  -> `if(p.inert || p.parked) continue;`.

**Do not touch** the other `for(const p of predators)` sites (`:2160` charge-clear,
`:3320` `hide_alert` throwable-noise check, `:4049`/`:4069` `qaLurePredator*`, `:5219`
throwable-noise, `:6336` hint "is a predator near" check). All of them are gated by a
noise/detect/LOS radius far smaller than the minimum possible distance to a parked
predator (>= `(STREAM_RADIUS_CHUNKS-1) * TREE_CHUNK_SIZE` = 120u by construction, since
at least one full chunk width separates the live ring's outer edge from a parked chunk)
-- a parked predator geometrically cannot satisfy any of those checks, so touching them
is dead-code churn, not a fix. `qaLurePredator*`'s "nearest" search could technically
return a parked predator on an otherwise-empty board, but that hook already exists to
lure an *inert-excluded* predator for a staged interaction, not to model park semantics;
leave it.

## 3. Hunter guarantee

**New constants**, next to `STREAM_RADIUS_CHUNKS` (`:901`, same section -- these are
about the same ring, not general tuning, matching that constant's own precedent for
staying in `forest-engine.js` rather than `tuning.js`):

```js
const MIN_ACTIVE_HUNTERS = 2;
const HUNTER_GUARANTEE_T = 90;   // seconds of game time an under-min board is tolerated
```

**Timer.** Module-level `let sinceBelowMinHunters = 0;` next to `sinceClose`/`huntTime`
(`:1919`), reset in `placePredators()` alongside `sinceClose = 0;` (`:1961`). Extend the
per-tick block from §2 (same `if(playing){ ... }`, after the parked-recompute loop, which
already has `activeHunters` in scope if you count it inline):

```js
  let activeHunters = 0;
  for(const p of predators) if(!p.inert && !p.parked) activeHunters++;
  if(activeHunters < MIN_ACTIVE_HUNTERS) sinceBelowMinHunters += dt; else sinceBelowMinHunters = 0;
  if(sinceBelowMinHunters > HUNTER_GUARANTEE_T){
    relocateParkedHunter(pcx, pcz);
    sinceBelowMinHunters = 0;
  }
```

**`relocateParkedHunter(pcx, pcz)`** -- new function, placed right after `placePredators()`:

```js
function relocateParkedHunter(pcx, pcz){
  const target = predators.find(p => !p.inert && p.parked);   // lowest array index, per the ticket
  if(!target) return;   // every non-inert predator already active -- guarantee already holds
  const ring = [];
  for(let dx=-STREAM_RADIUS_CHUNKS; dx<=STREAM_RADIUS_CHUNKS; dx++){
    for(let dz=-STREAM_RADIUS_CHUNKS; dz<=STREAM_RADIUS_CHUNKS; dz++){
      if(Math.max(Math.abs(dx), Math.abs(dz)) !== STREAM_RADIUS_CHUNKS) continue;   // outer edge only
      const ccx = pcx+dx, ccz = pcz+dz;
      if(ccx < 0 || ccx >= TREE_CHUNKS_PER_AXIS || ccz < 0 || ccz >= TREE_CHUNKS_PER_AXIS) continue;
      ring.push([ccx, ccz]);
    }
  }
  if(!ring.length) return;   // never true at CONFIG.mapSize=480 (8x8 chunks, ring fits from any player position -- see spec body); guards the QA micro map (2x2) where parking never triggers at all
  const [ccx, ccz] = ring[Math.floor(rng()*ring.length)];
  const x0 = Math.max(-half+margin, ccx*TREE_CHUNK_SIZE - half), x1 = Math.min(half-margin, (ccx+1)*TREE_CHUNK_SIZE - half);
  const z0 = Math.max(-half+margin, ccz*TREE_CHUNK_SIZE - half), z1 = Math.min(half-margin, (ccz+1)*TREE_CHUNK_SIZE - half);
  let x, z, tries = 0;
  do {
    x = rnd(x0, x1); z = rnd(z0, z1); tries++;
  } while((Math.hypot(x-player.x, z-player.z) < 70 || playerCanSee({x, z}) || blockedR(x, z, target.rad+0.5)) && tries < 60);
  if(inLake(x,z)){ const pushed = pushOutOfLakeClearance(x, z, CONFIG.lake); x = pushed.x; z = pushed.z; }
  target.x = x; target.z = z; target.wpx = x; target.wpz = z;
  target.parked = false; target.g.visible = true; target.g.position.set(x, 0, z);
  logChronicle('hunter_relocated', { kind: target.kind });
}
```

Notes for the implementer:
- `playerCanSee(p)` (`:3661`) only reads `p.x`/`p.z` off its argument -- passing a plain
  `{x, z}` literal (not a real predator) is safe and matches the "outside `PLAYER_FOV_COS`"
  requirement directly (reject *while* `playerCanSee()` is true).
- Draws from `rng()` (chunk pick + `rnd()` x/z, same stream every other spawn/relocate
  draw already uses). This runs conditionally at runtime, not during `generateMap()`'s
  fixed-sequence generation, so it does **not** perturb `generateCover()`'s draw count
  the way §1 does -- no determinism declaration needed for this part, but two identical
  seeded playthroughs that both trigger a relocation at the same game-time will still
  relocate to the same point (same `rng` stream position), which is what
  `predator-determinism.spec.ts` (§ e2e below) actually needs.
- `ring.length` is always >= 1 on the real 480-wide, 8-chunks-per-axis map, from any
  in-bounds player position, because `TREE_CHUNKS_PER_AXIS` (8) >= `STREAM_RADIUS_CHUNKS*2+1`
  (5) in each axis -- even a player standing in corner chunk (0,0) has a valid ring cell
  toward the map's interior (e.g. (2,0)..(2,2)). The `qaWorld=micro` map (`applyQaWorldMicroPreset()`,
  `engine/tuning.js:210-219`, `CONFIG.mapSize=96` -> 2x2 chunks) can never satisfy
  `cheb === STREAM_RADIUS_CHUNKS(2)` at all -- on micro, **no predator is ever parked** (max
  possible chunk Chebyshev distance in a 2x2 grid is 1), so `relocateParkedHunter` is
  simply never called there; the guard exists for that shape, not a real full-map gap.

**Chronicle code.** `logChronicle()` (`:2974`) is plain JS -- calling it with
`'hunter_relocated'` needs no change there. `lib/game/chronicle.ts`'s `ChronicleCode`
union (`:12-21`) is a separate, optional type used only by the player-facing recap
formatter (`formatChronicle()`, not by the engine's own buffer). **Do not add
`'hunter_relocated'` to that union or to `formatChronicle()`'s switch.** It has a
`default: return ''` fallback (`:91`) specifically so an unlisted code renders nothing --
this event is an internal simulation diagnostic (proving the guarantee fired, for e2e/
QA), not something the player experienced or should see in their run recap; the other
nine codes are all directly player-visible (scent locks, hides, win/death, etc.). If
product later wants it player-facing, that's a new decision, not implied by this ticket.

## Hooks

`qaPredatorState(idx)` (`:4502-4508`, `.d.ts` return type `:201-212`): add `parked:
p.parked` to both the JS return object and the `.d.ts` type.

**New:** `qaProbeActiveHunters()`, next to `qaProbeChunkStreaming` (`:3886-3892`, `.d.ts`
`:110-114`):

```js
window.ForestEngine.qaProbeActiveHunters = function(){
  return {
    active: predators.filter(p => !p.inert && !p.parked).length,
    sinceBelowMin: sinceBelowMinHunters,
  };
};
```
`.d.ts`: `qaProbeActiveHunters?: () => { active: number; sinceBelowMin: number };`

`qaSetPredatorRoam`/`qaFastForwardPredatorToWaypoint`/`qaSetFixedStep`/`qaAdvance`/
`qaTeleportTo`/`qaTeleportNearBaby` already exist (`:4271`, `:4359`, `:3830`, `:3834`,
`:3802`, `:3726`) and need no changes.

## e2e (mandatory, ships in this PR)

**Do not create `e2e/predator-streaming.spec.ts`.** LUL-2249 already established the
precedent (`e2e/prop-density.spec.ts:22-24`) of folding new streaming-ring proofs into
the existing `describe('chunked streaming', ...)` block in `e2e/prop-density.spec.ts`
*specifically to avoid growing `lib/e2e-policy/world-policy.test.ts`'s `FULLMAP_ALLOWLIST`*
(LUL-2377: "keep this list SHRINKING") -- that file is already allowlisted with a
`@fullmap` reason covering the same ring mechanism. A second file needs its own new
allowlist entry for what is mechanically the same ring this file already boots full-map
to test. Add to the existing `describe('chunked streaming', ...)` block:

- `'predators spawn uniformly whole-map and outside the ring start parked @fullmap'`:
  `boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED })`, then for every
  `i` in 0..8, `qaPredatorState(i)` -- for each non-inert predator, compute its chunk vs.
  `qaProbeChunkStreaming().playerChunk`, assert `parked === (chebyshev > 2)` and (read via
  a new tiny read-only probe, or infer from `qaProbeChunkStreaming` + position) that
  `g.visible` tracks it. Simplest: extend `qaPredatorState` isn't enough for `g.visible`
  (Three.js object, not serializable state) -- add `visible: p.g.visible` to
  `qaPredatorState`'s return too (small addition, same hook, cite in the same diff).
- `'the child-carry pickup point puts at least one predator in the ring, matching an
  off-annulus spawn @fullmap'`: sanity that whole-map spawn didn't break "some predator
  is reachable" -- assert `qaProbeChunkStreaming().liveChunks.length > 0` and at least one
  `qaPredatorState(i)` is non-null and non-parked at spawn, across `QA_PINNED_SEED` +2 more
  seeds (same seed list `prop-density.spec.ts` already loops over).
- `'unparking on approach and re-parking on retreat toggles visible+parked @fullmap'`:
  boot, find a parked predator (from the first test's logic), `qaTeleportTo()` next to it
  (within the ring), settle, assert `parked === false && visible === true`; teleport back
  to spawn, settle, assert `parked === true && visible === false` and `state === 'roam'`.
- `'hunter guarantee relocates a parked predator within 90s if fewer than 2 are active
  @fullmap'`: boot, `qaSetFixedStep`+`enter()` (determinism-spec pattern, `:39-46`), drive
  every non-inert predator's `x`/`z` far from the player via `qaTeleportTo` (or direct
  position writes if a hook is cleaner) so all 9 park, `qaAdvance` past 90s game time
  (`Math.ceil(90/FIXED_DT)` steps), assert `qaProbeActiveHunters().active >= 2`. Then find
  the relocated one (the one whose `parked` flipped false / whose position changed) and
  assert its distance to the player is `>= 70` and `playerCanSee`-equivalent is false --
  expose this via a new read-only `qaProbePlayerCanSee(x, z)` hook (thin wrapper on the
  existing `playerCanSee()`, one line, same install block) rather than re-deriving the FOV
  cone math in the test.

`e2e/predator-determinism.spec.ts` (`:14-22` `readPredatorState`, pushes whatever
`qaPredatorState` returns for `i` in 0..8) needs **no changes** -- it already does a deep
`toEqual` over the hook's full return object, so the new `parked`/`visible` fields ride
along and must still match byte-for-byte between the two identically-seeded pages; that's
the existing test doing its job on the new fields for free.

**Mobile mirror:** none of the above touches `isMobile()`/`EngineActions`/DOM -- this is
pure simulation. Per the mobile-parity checklist, a mirror is only required when a touch
affordance is involved; there is none here, so no `e2e/mobile/*` file is needed. State
that explicitly in the PR body so Code Reviewer doesn't bounce it for a missing mirror.

## Close-out (do in this PR's body, not a separate ticket)

- The epic's `docs/specs/lul-2223-baseline-perf.md` citation in the ticket is **wrong** --
  the actual file is `docs/specs/lul-2245-baseline-perf.md`. That doc's own "Known
  limitation" section says `qaProbePerf()`'s `calls`/`triangles` were unusable for this
  exact comparison and named LUL-2257 as the fix; LUL-2257 is already merged
  (`lastScenePerf`, `engine/forest-engine.js:5647`/`5676`, read at `:3852`) -- the numbers
  are trustworthy now. Record post-merge `qaProbePerf()` (desktop + mobile, at spawn and
  near-child, same methodology as the existing table) as a new section appended to
  `docs/specs/lul-2245-baseline-perf.md`, not a new `lul-2223-*` file.
- Drop `shared/local-qa/requests/lul-2223-map-epic.md` per `shared/local-qa/REQUESTING-A-TEST.md`'s
  template: desktop + mobile play, night preset; no pop-in at the fog line, no chunk seam,
  no clipping through reeds, beacon visible during the child-carry leg, >=1 predator
  encounter per 3-minute run without standing still. Note explicitly under "not covered by
  automation": density feel, beacon legibility on a phone in daylight.
- After this PR merges and Code Reviewer approves: verify the epic's 6 acceptance criteria
  (LUL-2247 bog density, LUL-2248 beacons, LUL-2246 detection timing + encounter rate,
  LUL-2249 chunk cap + perf, this ticket's park/spawn/guarantee, and "every child carried
  desktop+mobile e2e" -- this child is simulation-only, no touch surface, covered above),
  comment on LUL-2223 with the verification, and set LUL-2223 `done`. This step is mine
  (Founding Engineer) to do once the PR lands, not the implementer's -- matches how
  LUL-2249 itself was closed out (verify-then-close after the review gate, not bundled
  into the implementation PR).

## Must NOT change

Everything the ticket's own "Must NOT change" list names (win rule, LUL-1081 end-screen
persistence, seed determinism *mechanism* -- a declared one-time reshuffle from §1 is not
a determinism break, `generateMap()` stream order, `CONFIG.wrapEnabled`/`WRAP_SPAN`,
LUL-437/LUL-22 sniff timing, fixed geography, shared tree/cone geometries/materials never
disposed, CI scripts, the `## e2e` section rule). Nothing in this spec touches any of
those beyond the single declared cover/prop reshuffle.
