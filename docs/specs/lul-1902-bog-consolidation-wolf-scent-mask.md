# SPEC — LUL-1902: consolidate the Bog into one zone + wolf-only scent-masking

Input: PLAN document on LUL-1902 (CTO), itself built on wiki `game/mechanics/bog-consolidation`
(CEO decision, 2026-09-07). This SPEC corrects three things the PLAN got wrong against the
live repo (line numbers had drifted, and one geometry conflict below is a real bug the PLAN
would have shipped) — Game Engineer should implement from this document, not the PLAN.

**Tier: C** (`engine/forest-engine.js` simulation — movement multiplier + a detection-channel
change). `REVIEW: APPROVED` required before merge, per AGENTS.md.

## Geometry correction — read this before touching `lib/game/bog.ts`

The PLAN's proposed `BOG_CENTER={x:-40,z:25}`, `BOG_OUTER_RADIUS=125` makes
`pickHardBabyPosition()`'s existing hard requirement — a point that is simultaneously
`biomeAt(x,z) > 0` AND `Math.hypot(x,z) >= BLACKOUT_MIN_RADIUS` (192) — **mathematically
impossible**: the farthest any point in that zone can be from the origin is
`dist(origin, BOG_CENTER) + BOG_OUTER_RADIUS = 47.17 + 125 = 172.17 < 192`. Blackout mode's
"deepest bog patch, far from spawn" baby placement would silently degrade to a random point
every single round (not an occasional edge case — always), because the function's own
`maxTries`-exhausted fallback (`lib/game/bog.ts:147-152`) returns the last random candidate
when no point satisfies all three conditions. The PLAN never checked this; verified live by
reimplementing the formula and Monte-Carlo sampling `pickHardBabyPosition`'s own sampling loop
(`half=240, margin=20`, 200 seeds, 200 tries each — see numbers below).

**Corrected geometry** (replaces the PLAN's numbers):
```ts
export const BOG_CENTER: Point = { x: -70, z: 44 };
export const BOG_INNER_RADIUS = 35;
export const BOG_OUTER_RADIUS = 135;
```
Verified live (Node, exact formula below):
- `oak (22,4)`: dist 141.4→ biomeAt ≈ **0.277** (inside the patch, not deeply — the tension is
  real: oak sits only 22.4 units from the origin, so any center far enough from the origin to
  satisfy `BLACKOUT_MIN_RADIUS` is necessarily far from oak too. Still clearly `> 0`, matching
  LUL-1483's actual invariant — "sits inside an actual bog patch" — not the PLAN's own
  `>0.5` aspiration, which was never a decision-doc requirement).
- `drownedCar (-95,46)`: biomeAt ≈ **1.0** (well inside the inner radius).
- `fireTower (-95,-95)`: dist 141.2 from center → biomeAt **0** (excluded, 6.2-unit margin
  past `BOG_OUTER_RADIUS`).
- `stoneMarker (100,-75)`, `radioMast (30,175)`, `chapelSteeple (20,-178)`: all **0**,
  comfortably excluded (nearest is stoneMarker at dist ≈205).
- Reach: `dist(origin, BOG_CENTER) + BOG_OUTER_RADIUS = 82.5 + 135 = 217.5 ≥ 192` — with this
  geometry, `pickHardBabyPosition`'s Monte-Carlo success rate is **200/200 seeds** (100%)
  finding a valid point within 200 tries (test script used both `half=240` and the function's
  own `margin=20`/`maxTries=200` defaults). The PLAN's original numbers score **0/200**.
- Zone area ≈ `π·135² / 480²` ≈ 24.9% of the map — one bounded, discoverable place, in the
  same ballpark as the PLAN's own 21% target, not a regression toward sprawl.

Do not re-derive these constants; they are the result of a numeric search across the actual
`LANDMARKS` positions and `BLACKOUT_MIN_RADIUS`, not a formula you can shortcut by eye.

## Second correction — the lake needs its own carve-out (PLAN gap, not in original scope list)

`CONFIG.lake` (`engine/tuning.js:39`, `{x:34,z:-28}`) sits **91 units from the PLAN's original
center** — inside its 125 outer radius — and **119 units from this SPEC's corrected center** —
inside its 135 outer radius either way. Without a carve-out, the lake would go from
always-dry (existing invariant, `lib/game/bog.test.ts:61`) to measurably boggy, which nothing
in the decision doc or PLAN calls for. Fix: reuse the exact home carve-out pattern
(`HOME_CLEAR_RADIUS`/`HOME_FADE_RADIUS`), keyed off the lake's own position, factored into a
shared `radialFade()` helper so it isn't duplicated three times (see code below).

## 1. `lib/game/bog.ts` — full replacement of the noise section (current lines 26–99)

Delete: `BOG_NOISE_SEED`, `BOG_NOISE_CELL`, `BOG_THRESHOLD`, `bogLatticeHash()`,
`bogValueNoise()` (all dead once `biomeAt` no longer calls them — confirmed via grep, no other
caller in the repo). Keep `smoothstep()` (still used). Keep `HOME_CLEAR_RADIUS`/
`HOME_FADE_RADIUS` (values unchanged: 8/16). Replace the file's top comment block (current
lines 8–15, "the bog is now a biome distributed by 2D noise...") — it will be wrong — with:

```ts
// LUL-1902: the bog was a biome scattered by 2D noise over the whole square
// (~30-37% of the map, many separate patches) -- a mechanical side effect of
// squaring the world (LUL-1483), not a deliberate design call. Consolidated
// to one discoverable place: a single fixed center + radial falloff, same
// smoothstepped-edge softness as before so a patch edge still reads as
// terrain, not a wall.
```

Replace lines 26–99 (`// ---- Bog biome noise ----` through the end of `biomeAt`) with:

```ts
// ---- Bog biome geometry ----------------------------------------------------
// Fixed geography, like CONFIG.lake/CONFIG.home/LANDMARKS -- a place you can
// actually learn, not something that reshuffles with the per-game rng seed.
//
// Numbers below were chosen by numeric search against three constraints that
// all had to hold simultaneously: both oak/drownedCar (engine/tuning.js
// LANDMARKS) land inside the zone without repositioning; fireTower/
// stoneMarker/radioMast/chapelSteeple stay outside it; and the zone reaches
// far enough from the origin that pickHardBabyPosition's existing
// biomeAt>0 && hypot>=BLACKOUT_MIN_RADIUS requirement stays satisfiable (it
// is NOT satisfiable at every center/radius pair -- verify BLACKOUT_MIN_RADIUS
// reachability before changing these). Do not "clean up" these values without
// re-running that check.
export const BOG_CENTER: Point = { x: -70, z: 44 };
export const BOG_INNER_RADIUS = 35; // full bogginess (1.0) inside this distance from BOG_CENTER
export const BOG_OUTER_RADIUS = 135; // bogginess reaches 0 at this distance; smoothstep between inner and outer

// Home/spawn (CONFIG.home = {x:0,z:0}; generateMap() also sets player.x =
// player.z = 0) must never be boggy. Fully dry inside HOME_CLEAR_RADIUS,
// blends up to the unmodified bog value by HOME_FADE_RADIUS. If CONFIG.home
// ever moves off the origin, this must move with it.
const HOME_CLEAR_RADIUS = 8;
const HOME_FADE_RADIUS = 16;

// LUL-1902: BOG_CENTER/BOG_OUTER_RADIUS put CONFIG.lake (engine/tuning.js,
// {x:34,z:-28}) ~119 units from BOG_CENTER -- inside BOG_OUTER_RADIUS, so
// without this carve-out the lake would go from always-dry to measurably
// boggy, breaking the existing invariant nothing in this ticket's decision
// asked to change. Mirrors HOME_* exactly, keyed off the lake's own
// position. If CONFIG.lake ever moves, this must move with it.
const LAKE_CENTER: Point = { x: 34, z: -28 };
const LAKE_CLEAR_RADIUS = 20;
const LAKE_FADE_RADIUS = 32;

// Shared by both carve-outs above: 1 (no effect) past `fadeR`, 0 (fully
// cleared) inside `clearR`, smoothstepped between -- same shape either one
// used inline before this ticket.
function radialFade(x: number, z: number, center: Point, clearR: number, fadeR: number): number {
  const dist = Math.hypot(x - center.x, z - center.z);
  if (dist >= fadeR) return 1;
  if (dist <= clearR) return 0;
  return smoothstep((dist - clearR) / (fadeR - clearR));
}

/**
 * Bogginess at a world point, 0 (dry) to 1 (deepest bog) -- continuous, not
 * boolean, so the movement/noise multipliers below ease in across a patch
 * edge instead of stepping. Deterministic and pure: same (x, z) always
 * returns the same value, no rng, no dependency on the per-game seed.
 */
export function biomeAt(x: number, z: number): number {
  const dist = Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z);
  const t = (BOG_OUTER_RADIUS - dist) / (BOG_OUTER_RADIUS - BOG_INNER_RADIUS);
  const raw = t <= 0 ? 0 : t >= 1 ? 1 : smoothstep(t);
  const homeFade = radialFade(x, z, { x: 0, z: 0 }, HOME_CLEAR_RADIUS, HOME_FADE_RADIUS);
  const lakeFade = radialFade(x, z, LAKE_CENTER, LAKE_CLEAR_RADIUS, LAKE_FADE_RADIUS);
  return raw * homeFade * lakeFade;
}

// LUL-1902: how long the wolf-scent-mask (see checkScent() in the engine)
// takes to fade to 0 after the player leaves the bog. Not an instant on/off
// at the patch edge -- decision doc calls for "decaying over a short window
// after leaving."
export const BOG_MASK_DECAY_TIME = 6; // seconds

/** Rises instantly to `currentBogginess` when it's higher than `prevMask`
 * (no lag entering the bog), decays linearly to 0 over `decayTime` seconds
 * once the player leaves (currentBogginess drops below prevMask). Pure,
 * called once per frame by the engine with its own persisted `prevMask`. */
export function bogMaskLevel(
  currentBogginess: number,
  prevMask: number,
  dt: number,
  decayTime: number = BOG_MASK_DECAY_TIME,
): number {
  if (currentBogginess >= prevMask) return currentBogginess;
  return Math.max(currentBogginess, prevMask - dt / decayTime);
}
```

Everything below the old `biomeAt` (from `export const BLACKOUT_MIN_RADIUS = 192;` at old line
101 through end of file: `BOG_SPEED_MULTIPLIER`, `BOG_NOISE_MULTIPLIER`, `bogSpeedMultiplier()`,
`bogNoiseMultiplier()`, `clearOfLandmarks()`, `pickHardBabyPosition()`) is **unchanged** —
leave it exactly as-is, just now sitting below the new geometry/mask code above instead of the
old noise code.

## 2. `lib/game/bog.test.ts` — replace the noise-era assertions

Replace the `import` block (lines 1–12) — add `bogMaskLevel`, `BOG_MASK_DECAY_TIME`,
`BOG_CENTER`, `BOG_INNER_RADIUS`, `BOG_OUTER_RADIUS` to the named imports from `./bog.ts`.

Replace the test at lines 28–35 (`biomeAt stays within [0,1]...`, currently loops
`[-120,120]`) — the sampling range must cover the new zone, which sits outside that old
window. Use `[-half, half]` at `half=240` (`CONFIG.mapSize/2`, matching the live world), step
10 for runtime:
```ts
test('biomeAt stays within [0, 1] across the whole map square', () => {
  for (let x = -240; x <= 240; x += 10) {
    for (let z = -240; z <= 240; z += 10) {
      const b = biomeAt(x, z);
      assert.ok(b >= 0 && b <= 1, `biomeAt(${x},${z})=${b} out of range`);
    }
  }
});
```

Replace the test at lines 37–48 (`biomeAt finds both boggy and dry ground...`) — same range
fix (`-240..240` step 10); keep the rest of the body identical.

Replace lines 55–58 (`the relocated oak and drownedCar landmarks sit in a bog patch`) — the
`>0.5` bar doesn't hold for oak under the corrected geometry (see spec section above: oak is
only 22.4 units from the origin, so it can't be both deep-in-zone and the zone still reach
`BLACKOUT_MIN_RADIUS`). Use the values verified above, with margin:
```ts
test('the relocated oak and drownedCar landmarks sit in a bog patch', () => {
  assert.ok(biomeAt(22, 4) > 0.15, 'oak landmark should be inside the bog patch');
  assert.ok(biomeAt(-95, 46) > 0.9, 'drownedCar landmark should be deep inside the bog patch');
});
```

Line 61 (`assert.equal(biomeAt(34, -28), 0); // CONFIG.lake`) stays **as written** — this is
exactly the invariant the new `LAKE_CENTER` carve-out exists to preserve. Do not touch it;
it's your regression check that the carve-out landed correctly.

Add three new tests after the existing `bogSpeedMultiplier`/`bogNoiseMultiplier` tests
(after current line 76):
```ts
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
```

Add a new test asserting the geometry constraint this SPEC exists to fix stays fixed (place
after the `pickHardBabyPosition never lands closer than BLACKOUT_MIN_RADIUS` test, current
line ~96):
```ts
test('the single-zone bog geometry still lets pickHardBabyPosition satisfy BLACKOUT_MIN_RADIUS', () => {
  // Regression check for LUL-1902: a center/radius pair that never reaches
  // BLACKOUT_MIN_RADIUS from the origin makes this function's own contract
  // impossible to satisfy -- it would silently fall back to a random,
  // non-boggy point on every call. See docs/specs/lul-1902-*.md.
  const reach = Math.hypot(BOG_CENTER.x, BOG_CENTER.z) + BOG_OUTER_RADIUS;
  assert.ok(reach >= BLACKOUT_MIN_RADIUS, `zone only reaches ${reach} from origin, need >= ${BLACKOUT_MIN_RADIUS}`);
});
```
(`BLACKOUT_MIN_RADIUS` is already imported at line 10 — no import change needed for this one.)

Every other existing test in the file (`home/spawn is kept dry...`, `the lake and the other two
landmarks...`, both `bogSpeedMultiplier`/`bogNoiseMultiplier` tests, all `pickHardBabyPosition`
tests, the LUL-1861 double-application test) is **unchanged** — they test functions this ticket
doesn't touch, or invariants the new geometry was specifically chosen to preserve.

## 3. `engine/tuning.js` — one new constant

Add immediately after the `PSPEC` block closes (after line 156, before the `CHASE_GAP` comment
at line 157):
```js
// LUL-1902: wolf-only nose-multiplier reduction while the player's bog-mask
// (lib/game/bog.ts bogMaskLevel()) is active. 0.7, not 1.0 -- the decision
// doc explicitly rejects a hard safe-room, so a wolf already close/fresh on
// the trail can still catch a masked scent, just at reduced range. Bears and
// lions are untouched -- see checkScent() in the engine.
export const WOLF_BOG_MASK_STRENGTH = 0.7;
```

## 4. `engine/forest-engine.js` — three edits

**(a) Import** — add to the existing `@/lib/game/bog` import block (lines 79–85):
```js
import {
  biomeAt,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  bogMaskLevel,
  pickHardBabyPosition,
  clearOfLandmarks,
} from '@/lib/game/bog';
```
Also add `WOLF_BOG_MASK_STRENGTH` to whichever existing import brings in `PSPEC`/`CHASE_GAP`
from `@/lib/game/tuning` (or `engine/tuning.js` relative import, whichever the file already
uses — grep the existing `PSPEC` import line, don't guess the path).

**(b) Persisted per-frame state** — line 366 currently reads:
```js
let veilCharge = 1, veilLocked = false, veilAmount = 0, staminaCharge = 1, staminaLowCuePlayed = false;
```
Change to:
```js
let veilCharge = 1, veilLocked = false, veilAmount = 0, staminaCharge = 1, staminaLowCuePlayed = false, playerBogMask = 0;
```
And in `restart()`, at line 3596 (`staminaCharge = 1; staminaLowCuePlayed = false;`), add the
reset on the same line:
```js
staminaCharge = 1; staminaLowCuePlayed = false; playerBogMask = 0;
```

**(c) Per-frame update** — line 3906 currently reads:
```js
const playerBogginess = biomeAt(player.x, player.z);   // LUL-1483: continuous 0..1, was a boolean z-band test
```
Add immediately after it (`dt` is already in scope, defined at line 3815 earlier in the same
function):
```js
playerBogMask = bogMaskLevel(playerBogginess, playerBogMask, dt);   // LUL-1902: decaying wolf-scent-mask, see checkScent()
```

**(d) `checkScent()`** — lines 1433–1440 currently read:
```js
function checkScent(p){
  if(isCaveImmune(caveImmuneT)) return false;
  for(let i = scentPoints.length - 1; i >= 0; i--){
    const s = scentPoints[i], age = clock.elapsedTime - s.t0;
    if(isScentDetected(s, age, p.x, p.z, windX, windZ, p.spec.nose, SCENT_LIFETIME, WRAP_SPAN)) return true;
  }
  return false;
}
```
Change to:
```js
function checkScent(p){
  if(isCaveImmune(caveImmuneT)) return false;
  // LUL-1902: wolf-only nose reduction while the player's bog-mask is active.
  // Bears/lions and all sight-based detect() are untouched.
  const nose = p.kind === 'wolf' ? p.spec.nose * (1 - WOLF_BOG_MASK_STRENGTH * playerBogMask) : p.spec.nose;
  for(let i = scentPoints.length - 1; i >= 0; i--){
    const s = scentPoints[i], age = clock.elapsedTime - s.t0;
    if(isScentDetected(s, age, p.x, p.z, windX, windZ, nose, SCENT_LIFETIME, WRAP_SPAN)) return true;
  }
  return false;
}
```
(`p.kind === 'wolf'` is the established species-check pattern already used elsewhere in this
file, e.g. line 1622, 1798.)

## 5. `docs/ELEMENTS.md` — rewrite "The Bog (LUL-25 / LUL-1483)" section

Current section is at `docs/ELEMENTS.md:1436–1487` (verify with
`grep -n "The Bog (LUL-25" docs/ELEMENTS.md` before editing — line numbers shift as other PRs
land; do not hardcode the offset without checking first, and run
`node scripts/check-elements-citations.mjs --fix` after editing per AGENTS.md's CI-guard note).

Retitle to `## The Bog (LUL-25 / LUL-1483 / LUL-1902)`. Replace the first paragraph (currently
"`isInBog()`/the fixed z-band this section used to describe are gone (LUL-1483). The bog is
now a biome distributed by 2D value noise over the whole `[-half, half]` square...") with:

> LUL-1902 replaced the 2D-noise-scattered biome (many patches, ~30-37% of the map) with a
> single fixed zone: `biomeAt(x, z)` now derives bogginess from distance to `BOG_CENTER`
> (`lib/game/bog.ts`), radial falloff smoothstepped between `BOG_INNER_RADIUS` (full
> bogginess) and `BOG_OUTER_RADIUS` (dry), same edge-softness approach as before — the bog is
> now one discoverable place (~25% of the map), not ambient terrain variation. Cost model
> (`bogSpeedMultiplier`/`bogNoiseMultiplier`, reeds, bog trees, splash foley) is byte-for-byte
> unchanged from LUL-1483 — only *where* bogginess is nonzero changed. `oak`/`drownedCar`
> (below) still sit inside the zone without repositioning; `CONFIG.lake` and
> `CONFIG.home`/spawn are both explicitly carved out to stay dry, mirroring each other's
> pattern (`HOME_CLEAR_RADIUS`/`HOME_FADE_RADIUS`, `LAKE_CLEAR_RADIUS`/`LAKE_FADE_RADIUS`).

Add a new paragraph after the existing "**New elements it adds**" paragraph (keep that
paragraph as-is — the Landmark/Reed/BogTree content it describes is unchanged by this ticket):

> **LUL-1902 — wolf-only scent-masking**: standing in (or having recently left) the bog
> suppresses the player's scent specifically against wolf-type predators. A persisted
> `playerBogMask` (`engine/forest-engine.js`) rises instantly with `biomeAt(player.x,
> player.z)` and decays linearly to 0 over `BOG_MASK_DECAY_TIME` (6s, `lib/game/bog.ts`)
> once the player leaves — not an instant on/off at the patch edge. `checkScent()` reduces
> only `p.spec.nose` for `p.kind === 'wolf'` by up to `WOLF_BOG_MASK_STRENGTH` (0.7, i.e. a
> 70% nose-multiplier cut at full mask — not 100%, so a wolf already close on the trail can
> still catch it). Bears, lions, and all sight-based `detect`/`canSee` are untouched. This is
> a deliberate tradeoff, not a safe room: the bog already costs half walk speed and 1.6x
> noise radius, so using it to shake a wolf is a real bet against being heard by a bear or
> lion instead (`docs/decisions` — wiki `game/mechanics/bog-consolidation`, CEO decision
> 2026-09-07, explicitly rejected a hard predator-exclusion zone for this reason).

Leave the rest of the section (the "**What's already known and citable**" paragraph about
reed/bog-tree collision reuse) unchanged — none of that is touched by this ticket.

## 6. `docs/FEATURE_CHECKLIST.md` — new entry

File currently has zero mentions of "bog" (confirmed live). Add a new dated section following
the existing format used by other entries in the file (check one existing entry's heading
style with `grep -n "^## " docs/FEATURE_CHECKLIST.md` and match it exactly — this SPEC doesn't
prescribe the exact heading text/numbering since that depends on what's already there when you
implement; match the surrounding convention). Content to include in that entry:
- Feature: Bog consolidation (single zone) + wolf-only scent-masking (LUL-1902).
- Big/visible: yes — the bog goes from ambient terrain variation to a discoverable named place;
  wolves specifically lose the scent trail while the player is masked.
- Cost/limit: unchanged bog cost (half speed, 1.6x noise radius) plus the mask itself is not
  free — decays over 6s and only reduces (not zeroes) wolf nose range.
- `docs/ELEMENTS.md` updated: yes, same PR (§5 above).
- Regression tests: `lib/game/bog.test.ts` (§2 above).

## Constraints — do not touch

- `bogSpeedMultiplier()`, `bogNoiseMultiplier()`, `BOG_SPEED_MULTIPLIER`,
  `BOG_NOISE_MULTIPLIER`, `clearOfLandmarks()`, `pickHardBabyPosition()`'s signature — all
  unchanged, not part of this diff.
- `isScentDetected()`'s signature, `scentPickupRadius()`'s signature — unchanged; the wolf
  multiplier composes with the existing `noseMultiplier` parameter exactly as `p.spec.nose`
  does today.
- Bear/lion behavior, all sight-based `detect()`/`canSee()` — untouched.
- `radioMast`/`chapelSteeple` (LUL-1782) — untouched, and this SPEC's geometry keeps both
  comfortably outside the new zone (verified above).
- `LANDMARKS` array itself (`engine/tuning.js:57-64`) — no repositioning needed; `oak`/
  `drownedCar` land inside the new zone as-is.

## Verification

- `npm test` (or the repo's existing `node --test` invocation scoped to
  `lib/game/bog.test.ts`) — every test in the file green, including the four new/changed ones
  in §2.
- `node scripts/check-elements-citations.mjs --fix` after editing `docs/ELEMENTS.md` — run
  before opening the PR, not after CI flags it (AGENTS.md's CI-guard note).
- `tsc --noEmit` clean, `next build` passes, lint clean (`npm run lint`) — standard
  definition-of-done, unaffected by this ticket's scope but still required.
- Manual/playtest check (Tier C, required before merge, per PLAN §4): stand in the new zone,
  confirm it reads as one discoverable place; confirm a wolf loses your scent trail while
  masked and re-acquires it after ~`BOG_MASK_DECAY_TIME` seconds of dry ground; confirm
  bears/lions are unaffected. **Gameplay/feel is unverified by the spec/build process — say so
  explicitly in the PR, per the Founding Engineer's "you assert code correctness only" rule.**
- `REVIEW: APPROVED` comment required before merge (Tier C, blocking).

## Out of scope

Bear/lion tuning, the cost-model constants, `pickHardBabyPosition`'s contract (still just
`biomeAt(x,z) > 0`, now reliably satisfiable — see geometry correction above),
`radioMast`/`chapelSteeple` positions, `isScentDetected`/`scentPickupRadius` signatures, any
minimap change (the bog was never shown there and this ticket doesn't add it).
