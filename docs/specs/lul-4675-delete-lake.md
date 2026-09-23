# SPEC: LUL-4675 delete the lake entirely

**Ticket:** LUL-4675 · **Tier:** C — engine simulation + spawn logic changes across
`engine/forest-engine.js`, `lib/game/chronicle.ts` signature change, plus `docs/ELEMENTS.md`
(CI-enforced citations). Needs `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `a6bb9c8` (2026-09-23). Re-derive every `file:line`
below from the branch you actually implement on if it has moved — this doc verified every
citation live against this sha; CTO's PLAN comment on the ticket (also verified same day)
matches it exactly, so no drift was found, but re-grep before trusting a line number anyway.

This spec supersedes the wiki plan `decisions/lul-3256-water-removal-plan.md`'s section 7
(stage 3 in that doc's numbering) — that doc's base was `6b920fd`/2026-09-18 and has drifted
on the minimap-spec claim (see **Deviation from the PLAN** below). Trust this doc's line
numbers and per-file instructions over the wiki page or the ticket's PLAN comment.

## Files

- `lib/game/lake.ts` — deleted, whole file.
- `lib/game/lake.test.ts` — deleted, whole file.
- `engine/tuning.js` — edited: remove `CONFIG.lake`, `LW`, three dead comment blocks.
- `engine/forest-engine.js` — edited: remove the lake import, `inLake()`, all spawn-rejection
  and push-out-of-clearance call sites, the water/glow/wisp render block, the two speed
  multipliers (simplified, not just deleted — see below), `HINT_PRIORITY`/`HINT_TEXT`'s
  `lake` entries, the minimap dot, the two proximity checks, the HUD-state switch case, the
  `reedsInLakeClear` debug counter, and every now-dead comment naming the lake.
- `lib/game/chronicle.ts` — edited: `nearestLandmarkName()` drops the `lake: Point` param
  and the `'the Lake'` landmark entry.
- `lib/game/chronicle.test.ts` — edited: drop the `LAKE` constant and the `lake` arg from
  every `nearestLandmarkName()` call; delete the lake half of one test.
- `components/Hud.tsx` — edited: one comment, drop `lake/` from a key list.
- `components/GameCanvas.tsx` — edited: two comments and two CSS selector lists, drop
  `lake`/`[data-hint-key="lake"]`.
- `docs/ELEMENTS.md` — edited: delete the `### Lake` section, delete the `LA` matrix row and
  column (and the five footnotes that exist only for it), edit ~14 scattered prose
  references.
- `scripts/elements-resolved-symbols.json` — edited: remove the `"inLake"` entry (the symbol
  it resolves is being deleted).
- `e2e/hints.spec.ts`, `e2e/mobile/hints.spec.ts` — edited: delete the "the lake hint..." test
  in each.
- `e2e/wind-assisted-evasion.spec.ts` — edited: drop `'lake'` from one array literal.
- `e2e/bog-zone.spec.ts` — edited: delete a two-line probe-and-assert block.
- `e2e/prop-density.spec.ts`, `e2e/mobile/prop-density.spec.ts` — edited: delete the
  `reedsInLakeClear` assertion (+ its comment) in each.
- `e2e/qa-world-micro.spec.ts`, `e2e/force-hunt-closes.spec.ts` — edited: rename `pLakeMul` to
  `pSpeedScaleMul` in comments only (the identifier is renamed in the engine, see below); drop
  one now-false rationale sentence in `qa-world-micro.spec.ts`.
- `e2e/minimap.spec.ts`, `e2e/minimap-setting.spec.ts`, `e2e/mobile/minimap.spec.ts`,
  `e2e/mobile/minimap-setting.spec.ts` — **no change**. See Deviation below.
- `e2e/charge-dodge.spec.ts`, `e2e/smoke.spec.ts`, `e2e/scent.spec.ts` — **no change**. Their
  case-insensitive "lake" grep hits are all inside the word "flake"; verified by reading each
  hit in context.

## Deviation from the PLAN

The ticket description and the CTO's PLAN comment both say the four `minimap*.spec.ts` files
(desktop + mobile pairs) "need scene-setup edits, not deletion" because their lake dependency
is indirect (landmark-count or minimap-region assertions). That was true of an earlier version
of these files; at current HEAD it is not. I read all four files in full (45, 70, 35, 39 lines):
none references `CONFIG.lake`, `LANDMARKS`, a landmark count, or a minimap region — they
assert on-canvas clamping via `qaProbeMinimapPoint()` at fixed coordinates (`(0,200)`,
`(40,150)`, `(0,0)`) and on `#minimap`'s visibility under admin-mode settings, neither of
which the lake's deletion touches. Leave all four untouched. Flag this in the PR description
per the ticket's own "flag either way" instruction style, so the reviewer doesn't go looking
for a missing edit.

## The change

### 1. `lib/game/lake.ts`, `lib/game/lake.test.ts`

Delete both files outright. Confirm no other importer exists first:
`grep -rn "from '@/lib/game/lake'" --include=*.ts --include=*.tsx --include=*.js .` — expect
the only hit to be `engine/forest-engine.js:175-181` (removed in step 3).

### 2. `engine/tuning.js`

- Delete `lake:    { x: 34, z: -28, r: 15, clear: 22, glow: 0x86b8ff },` (`:59`).
- Delete `export const LW = 50;             // lake wisps` (`:171`).
- `:51-58` is a comment block entirely about `keepWaypointOffLake()` pushing a waypoint back
  into the lake near a map edge — delete the whole block (from `// LUL-874: keep this well
  clear of the map edge...` through `...before moving the lake or shrinking mapSize (wiki
  game/lul857-review-pr183).`), since the mechanism it documents no longer exists.
- `:67` `// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home.` —
  change to `// Fixed constants, not an rng draw, same treatment as CONFIG.home.`.
- `:207` inside `applyQaWorldMicroPreset()`'s comment: `LANDMARKS/CAVE/ CONFIG.lake are
  deliberately left untouched -- tuning.js's own LANDMARKS comment already documents...` —
  drop `CONFIG.lake` from that sentence: `LANDMARKS/CAVE are deliberately left untouched...`.

### 3. `engine/forest-engine.js` — imports and the `inLake()` helper

- `:175-181` — remove all six named imports from `@/lib/game/lake` (`inLakeWater`,
  `inLakeClearance`, `lakeSpeedMultiplier`, `pushOutOfLakeClearance`,
  `pushOutOfLakeClearanceAvoiding`, `keepWaypointOffLake`) and the import statement itself if
  nothing else is imported from that path (nothing else is, per step 1).
- `:292` comment `// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home`
  → drop `CONFIG.lake/` the same way as tuning.js `:67`.
- `:636` `function inLake(x,z){ return inLakeClearance(x, z, CONFIG.lake); }` — delete.
- `:638-639` comment `// LUL-873: keepWaypointOffLake() extracted to lib/game/lake.ts (pure,
  CONFIG.lake passed in explicitly) -- imported above.` — delete, dead history note.

### 4. Spawn-rejection call sites

- `:703` comment `// LUL-396: cover props only ever checked inLake()/inSpawn()/inBaby()
  against` and `:737` comment `existing inLake()/inSpawn()/inBaby() check above already has).`
  — both are historical framing comments for `generateCover()`; drop `inLake()/` from each,
  leaving `inSpawn()/inBaby()`.
- `:752` `if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;` (in `generateCover()`,
  fn starts `:744`) → `if(inSpawn(x,z) || inBaby(x,z)) continue;`.
- `:1166-1171` — a five-line comment block in `generateReeds()` (fn starts `:1181`) entirely
  about why the loop's `inLake()` check is a documented no-op post-LUL-2225 — delete the whole
  block (`// LUL-2247 review fix: this loop never checked...` through `...as a guard if the
  bog or lake geometry ever moves again. overlapsTreeTrunk()` — keep any trailing clause of
  that last line that continues onto `overlapsTreeTrunk()`'s own unrelated purpose, re-read
  in context before cutting since the sentence may run past word "again.").
- `:1189` `if(inLake(x, z)) continue;` (in `generateReeds()`) → delete the line.
- `:1269` `} while(inLake(baby.x, baby.z));` — this is the loop condition for the baby/child
  polar-draw retry (see `lib/game/chronicle.test.ts` note below, unrelated file). Read the
  full `do { ... } while(...)` block starting a few lines above `:1269` before touching it:
  if `inLake()` is the *only* condition, replace with the loop's next real terminating
  condition or remove the `do/while` retry entirely and keep one draw — re-derive from
  `docs/ELEMENTS.md:322` (`generateMap()` — polar draw... rejected while inLake(baby.x,baby.z)
  is true (only spawn guard on the child...)`) which confirms `inLake()` is the *only* guard
  on the child's spawn draw. Since it's the only guard, deleting it means the child's spawn
  draw no longer retries at all — replace the `do { <draw> } while(inLake(...))` with a single
  unconditional draw (drop the `do`/`while` wrapper, run the body once).
- `:1292` `if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;` (in `generateThrowables()`,
  fn starts `:770`) → `if(inSpawn(x,z) || inBaby(x,z)) continue;`.

### 5. Push-out-of-clearance call sites

- `:2073-2086` — comment block in the predator spawn loop referencing `inLake()`,
  `pushOutOfLakeClearance()`, and the bog/lake geometry note — delete the whole block (from
  `// LUL-395 review fix: the reject condition never checked the lake` through the sentence
  ending `...as of this review too. overlapsTreeTrunk()`; re-read in context, same caveat as
  step 4's `:1166-1171` — don't cut a trailing clause that belongs to the next unrelated
  topic).
- `:2095-2104` —
  ```js
  if(inLake(x,z)){
    // LUL-2735: the plain push only guarantees clear-of-lake, not
    // clear-of-origin/baby (see the wrapper's own comment in lib/game/lake.ts).
    ...
    const pushed = pushOutOfLakeClearanceAvoiding(x, z, CONFIG.lake, [
      ...
    ]);
    ...
  }
  ```
  Delete the entire `if(inLake(x,z)){ ... }` block. Read `:2095-2115` in full before cutting —
  confirm the closing brace and whatever follows it (there may be an `else` or subsequent
  unconditional code in the same loop iteration that must survive un-nested).
- `:2173` `if(inLake(x,z)){ const pushed = pushOutOfLakeClearance(x, z, CONFIG.lake); x =
  pushed.x; z = pushed.z; }` — delete the line.

### 6. Waypoint clamp

- `:2869` `const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);` — read the surrounding
  ~5 lines (this assigns `kept` which is then likely used for `nwx`/`nwz` reassignment or a
  waypoint commit) and remove the call, restoring direct use of `nwx`/`nwz` in whatever used
  `kept`.
- `:3113` `const freshKept = keepWaypointOffLake(freshx, freshz, CONFIG.lake);` — same
  treatment for `freshx`/`freshz`/`freshKept`.
- `:4154` comment `... the inner/outer radii, home, the lake, every LANDMARKS/CAVE position)`
  — drop `, the lake` from the list.

### 7. The two speed multipliers — simplify, don't just delete (`:2655-2690` region)

Current code (`updatePredators()`, fn starts `:2655`):

```js
// LUL-2422: CONFIG.speedScaleMul (default 1, set by applyQaWorldMicroPreset) folded in
// here so every `*pLakeMul` speed site below is scaled together -- mirrors detectScaleMul's
// fold-in at effectiveDetect() (LUL-2407).
const pLakeMul = lakeSpeedMultiplier(inLakeWater(p.x, p.z, CONFIG.lake)) * (CONFIG.speedScaleMul || 1);
// LUL-2611: speedScaleMul's own comment (engine/tuning.js) says its job is crossing-time
// parity for roam wander and the staged qaTeleportNear*/qaStageChaseAtContact-style safety
// window -- not pursuit-speed parity against a live, moving player. Folding it into every
// `*pLakeMul` site (LUL-2422) missed that distinction: at the micro world's 0.2 factor, a
// lion's full chase speed (9.2*0.2=1.84u/s) can never close on or even keep pace with the
// player's own (unscaled) walk speed (6u/s), so the `chase`/`hunt` full-species-speed lines
// below -- the two states whose whole job is "catch a player that may be moving" -- use this
// water-only multiplier instead of pLakeMul. Every other state (roam/investigate/flank/
// reroute/standoff) is untouched: those don't need to out-pace a moving player (investigate/
// approach is deliberately 0.45x even on the full map) and existing specs
// (qaStageChaseAtContact's wolf-glue test, force-hunt-closes, scent/scent-trail) already
// pass against a stationary or scent-driven target, unaffected by this split.
const pPursuitMul = lakeSpeedMultiplier(inLakeWater(p.x, p.z, CONFIG.lake));
```

`lakeSpeedMultiplier(inLake)` returns `1` when `inLake` is `false` (`lib/game/lake.ts:42-44`),
and once the lake is gone no predator or player position is ever "in the lake" — so
`pLakeMul` collapses to exactly `(CONFIG.speedScaleMul || 1)` and `pPursuitMul` collapses to
exactly `1`, unconditionally. Replace the block above with:

```js
// LUL-2422: CONFIG.speedScaleMul (default 1, set by applyQaWorldMicroPreset) folded in
// here so every `*pSpeedScaleMul` speed site below is scaled together -- mirrors
// detectScaleMul's fold-in at effectiveDetect() (LUL-2407).
const pSpeedScaleMul = CONFIG.speedScaleMul || 1;
```

Then:
- Rename every remaining `pLakeMul` usage to `pSpeedScaleMul`: `:2801, 2807, 2872, 2987, 3010,
  3034, 3038, 3066` (8 sites, all `speed = ... * pLakeMul` shapes — identifier rename only, no
  other change).
- `pPursuitMul` is now always `1`; its two call sites drop the multiply entirely rather than
  multiplying by a variable that's always 1 (dead multiplication is worse than none — a
  reviewer or future editor should not have to prove `pPursuitMul === 1` again to trust the
  code):
  - `:2821` `else { desx=ux; desz=uz; speed=p.spec.speed*pPursuitMul; }` →
    `else { desx=ux; desz=uz; speed=p.spec.speed; }`.
  - `:2933` — same shape, same edit.
- `:2759` comment `// LUL-2469: chargeSpeed(cs.distance) intentionally not folded into
  pLakeMul/speedScaleMul --` → `pLakeMul/speedScaleMul` becomes `pSpeedScaleMul` (it's naming
  the two things this charge speed is deliberately NOT multiplied by; there's only one now):
  `// LUL-2469: chargeSpeed(cs.distance) intentionally not folded into pSpeedScaleMul --`.

Player side (`:6734-6748`):

```js
// LUL-791/LUL-392: the lake used to be pure render -- no collision, no slow,
// walkable like dry ground. `inLakeWater` (the visible water radius `r`,
// not the wider `clear` spawn-clearance ring the spawn checks use) so the
// slow starts exactly where the water mesh does, not several units of dry
// shore early. A wade-slow, not a wall, per the ticket: the lake reads as
// an atmospheric hazard, and a hard invisible wall in a fog-heavy horror
// game reads as a bug even when intentional -- and it plays into the core
// hiding loop (risk the slow crossing, or go around).
const playerInLake = inLakeWater(player.x, player.z, CONFIG.lake);
```
Delete this comment block and the `playerInLake` declaration entirely (its only other two
uses — `:6748` and `:7345` — are both removed below, so nothing references it once these three
sites are gone; grep `playerInLake` after this step and confirm zero hits).

`:6748`:
```js
const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);
```
→ drop the trailing `* lakeSpeedMultiplier(playerInLake)`:
```js
const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess);
```

### 8. `HINT_PRIORITY` / `HINT_TEXT` (`:2251-2266`)

- `:2251-2252`:
  ```js
  const HINT_PRIORITY = ['scent','landmark','lake','bog','deepwater','oakHollow',
    'wolf','bear','lion','stamina','windAssist','cover','caveImmune','veilOverload','throwable','veil'];
  ```
  → drop `'lake',`:
  ```js
  const HINT_PRIORITY = ['scent','landmark','bog','deepwater','oakHollow',
    'wolf','bear','lion','stamina','windAssist','cover','caveImmune','veilOverload','throwable','veil'];
  ```
- `:2264` `lake:       'chest-deep water — half pace. predators wade too',` in `HINT_TEXT` —
  delete the line.

### 9. Chronicle call sites

- `:2433` `logChronicle('scent_lock', { kind: p.kind, landmark: nearestLandmarkName(p.x, p.z,
  LANDMARKS, CONFIG.home, CONFIG.lake) });` → drop the trailing `, CONFIG.lake` arg (see
  section 12, `nearestLandmarkName()`'s signature loses this param):
  `landmark: nearestLandmarkName(p.x, p.z, LANDMARKS, CONFIG.home) });`
- `:6294` — same edit, same call shape, `death` event.

### 10. Minimap dot render (`:6492-6493`)

```js
const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
```
Delete both lines. Read the surrounding function (this is inside `drawMinimapStatic()`, per
`docs/ELEMENTS.md:1469`) to confirm nothing after these two lines refers back to `lx`/`ly` —
if the bog fill immediately follows and declares its own `[bx,by]` or similar, this is a
clean two-line delete.
- `:6496` comment `// single clean disc to draw, same pattern as the lake immediately above.`
  → drop `, same pattern as the lake immediately above` (or delete the clause it's now
  dangling on — reread the full comment before editing, it's the bog's own dot).
- `:6502` comment `... distinctly from the lake/bog fills) ...` → `distinctly from the bog
  fill)`.

### 11. Proximity-hint checks

- `:7040` `const distLake = Math.hypot(player.x - CONFIG.lake.x, player.z - CONFIG.lake.z);`
  — delete.
- `:7230` `const near = distLake < CONFIG.lake.r*3;` — delete, and whatever conditional or
  chime-trigger this fed (per `docs/ELEMENTS.md:848-849`: "Bias the ambient 'twinkle' chime
  to play brighter/more often when the player is near it") — read `:7225-7235` in full and
  remove the `near`-gated branch, restoring whichever behavior applies when the lake-proximity
  bias is absent (almost certainly: the chime plays at its unbiased rate unconditionally, i.e.
  delete the `if(near)`/ternary wrapper and keep the non-biased path).

### 12. HUD-state switch case (`:7339-7345`, `:7378`)

- `:7339-7340` comment `// key -> [eligible this frame, world anchor {x,y,z} | null].
  Self/panel-anchored keys (lake/bog/deepwater/oakHollow/stamina/caveImmune/veil) never need
  an anchor --` → drop `lake/`.
- `:7345` `case 'lake': return [playerInLake, null];` inside `hintCandidate(key)` — delete the
  line.
- `:7378` `default: return false;   // landmark, lake, bog: time-only` (inside
  `hintDismissedByEvent(key, baseline)`) → drop `, lake`: `// landmark, bog: time-only`.

### 13. `reedsInLakeClear` debug counter (`:4305-4342`, inside `qaProbePropDensity`)

- `:4314` `let reedsInLakeClear = 0;` — delete.
- `:4320-4325`:
  ```js
      // LUL-2247 review fix: mandatory assertion from the ticket -- no reed
      // may land inside CONFIG.lake.clear. inLake() is the exact check
      // generateReeds() now runs at generation time (see its comment);
      // reported here too so the e2e spec can assert the finished map
      // rather than trusting the generator never regresses silently.
      if(cat === 'reed' && inLake(c.x, c.z)) reedsInLakeClear++;
  ```
  Delete the whole comment + line (the check it describes, `generateReeds()`'s own `inLake()`
  rejection, is already deleted in section 4).
- `:4342` `reedsInLakeClear,` in the returned object literal — delete.

## 14. `lib/game/chronicle.ts`

```ts
export function nearestLandmarkName(
  x: number,
  z: number,
  landmarks: (Point & { kind: string })[],
  home: Point,
  lake: Point,
  maxDist = 45,
): string | null {
  const points: (Point & { name: string })[] = [
    ...landmarks.map((l) => ({ x: l.x, z: l.z, name: LANDMARK_NAMES[l.kind] || l.kind })),
    { x: home.x, z: home.z, name: 'the Cabin' },
    { x: lake.x, z: lake.z, name: 'the Lake' },
  ];
```
→
```ts
export function nearestLandmarkName(
  x: number,
  z: number,
  landmarks: (Point & { kind: string })[],
  home: Point,
  maxDist = 45,
): string | null {
  const points: (Point & { name: string })[] = [
    ...landmarks.map((l) => ({ x: l.x, z: l.z, name: LANDMARK_NAMES[l.kind] || l.kind })),
    { x: home.x, z: home.z, name: 'the Cabin' },
  ];
```
Drop the `lake: Point` param and the `{ x: lake.x, ... 'the Lake' }` entry. `maxDist` moves up
to the 5th positional param — both call sites (section 9) already pass it as an implicit
default by omission, so this is source-compatible with them as written.

## 15. `lib/game/chronicle.test.ts`

- `:12` `const LAKE = { x: 60, z: 60 };` — delete.
- Every `nearestLandmarkName(..., HOME, LAKE` / `nearestLandmarkName(..., HOME, LAKE, N)` call
  (`:15, 19, 20, 29, 30, 35`) — drop the `, LAKE` argument, keeping any trailing `, 5` /
  `, 50` `maxDist` arg where present (`:29-30`).
- `:23-26`:
  ```ts
  test('nearestLandmarkName also considers home and lake as named points', () => {
    assert.equal(nearestLandmarkName(1, 1, LANDMARKS, HOME, LAKE), 'the Cabin');
    assert.equal(nearestLandmarkName(59, 59, LANDMARKS, HOME, LAKE), 'the Lake');
  });
  ```
  → delete the second assertion and retitle:
  ```ts
  test('nearestLandmarkName also considers home as a named point', () => {
    assert.equal(nearestLandmarkName(1, 1, LANDMARKS, HOME), 'the Cabin');
  });
  ```
- `:56` `{ t: 20, code: 'death', args: { kind: 'lion', landmark: 'the Lake' } },` is inside a
  `formatChronicle()` test — that function only formats an arbitrary string, it doesn't call
  `nearestLandmarkName()`, so this line is not broken by the signature change. Swap the
  literal to `'the Split Oak'` anyway so no reader mistakes it for a still-live landmark name
  once this PR merges — cosmetic, not required for correctness.

## 16. `components/Hud.tsx`

`:175-176`:
```ts
// LUL-2307: world-anchored hint keys render the down-arrow glyph and use the
// engine-projected hintX/hintY; the rest (lake/bog/deepwater/stamina/
```
→ drop `lake/`:
```ts
// engine-projected hintX/hintY; the rest (bog/deepwater/stamina/
```

## 17. `components/GameCanvas.tsx`

- `:434` comment `/* Self/panel-anchored keys (lake/bog/stamina/veil -- no real 3D point...`
  → drop `lake/`.
- `:441`:
  ```css
  #hintCaption[data-hint-key="lake"], #hintCaption[data-hint-key="bog"],
  ```
  → drop the `lake` selector, keep the rest of the list on the same line:
  ```css
  #hintCaption[data-hint-key="bog"],
  ```
- `:586` comment `/* LUL-2414: the bottom self-anchored #hintCaption family (lake/bog/stamina/`
  → drop `lake/`.
- `:626`:
  ```css
  #hintCaption[data-hint-key="lake"], #hintCaption[data-hint-key="bog"],
  ```
  → same edit as `:441`.

**`bog` stays in all four of the above** — the bog deletion is the sibling ticket (stage 5),
not this one; do not touch anything bog-specific here.

## 18. `docs/ELEMENTS.md`

**a. Delete the `### Lake` section wholesale.** Currently lines `846-905` (the blank line
after the `---` at `:845` through the `---` at `:905` inclusive) — re-locate with
`grep -n '^### Lake$\|^---$' docs/ELEMENTS.md` before cutting, since earlier edits in this
same PR (if done top-to-bottom) will not move these line numbers (they're near the top of the
Elements catalogue) but re-verify anyway. Leave the `---` at `:845` in place as the divider
before `### Home (the goal landmark)`.

**b. Delete the `LA` matrix row and column** (`:2072-2088` region — re-locate via
`grep -n '| \*\*LA\*\* Lake'`). The matrix is 17 columns wide in this fixed order: `PL, CH,
WO, BE, LI, TR, RO, LO, BR, GR, LA, HO, FO, FL, MI, UI, EM`. `LA` is the 11th column and the
11th row-group.
  - Delete the `LA` header cell from the header row.
  - Delete the entire `| **LA** Lake | ... |` row.
  - Delete the 11th data cell (the `LA` column's value) from each of the 10 rows above it —
    those cells currently read: `PL`→`SLOW⁴`, `CH`→`– ⁸`, `WO`→`–¹²`, `BE`→`–¹²`, `LI`→`–¹²`,
    `TR`→`–¹⁵`, `RO`→`–¹⁵`, `LO`→`–¹⁵`, `BR`→`–¹⁵`, `GR`→`STAND`. Rows below `LA` (`HO, FO,
    FL, MI, UI, EM`) already carry a blank placeholder cell for the `LA` column (upper-
    triangle-only matrix) — delete that one blank cell from each of those six rows too, so
    every row stays 16 cells wide after the edit.
  - Verify the edit by counting `|` separators per row before and after — every row must lose
    exactly one cell.

**c. Delete footnotes 4, 8, 12, 15, 19 in full** (`:2096-2101`, `:2111-2113`, `:2132-2145`,
`:2170-2171`, `:2185-2187` — re-locate via `grep -n '^⁴\|^⁸\|^¹²\|^¹⁵\|^¹⁹'`). Each is
referenced *only* from the `LA`-column cells deleted in (b) plus one prose cross-reference
each (handled in (d)) — confirmed by grepping every occurrence of each superscript in the
whole file before writing this spec. After (b) and (d) land, re-grep each of the five
superscripts and confirm zero remaining references before deleting the footnote text itself;
if any turn up, stop and re-derive rather than deleting a footnote something still points to.

**d. Scattered prose edits** (grep `grep -n -i lake docs/ELEMENTS.md` after (a)-(c) land to
get current line numbers; the list below is against pre-edit `a6bb9c8`):
  - `:148-151` (Player, "What it CANNOT do") — delete the whole bullet: `Cannot be blocked by
    the **lake**...This bullet used to say the lake had no effect at all; that was true until
    LUL-791 landed and is stale now.` (entirely about the lake; the footnote it cites is
    deleted in (c)).
  - `:153` `Cannot physically collide with the child, a predator, the lake, the fog, or the
    home landmark` → drop `, the lake`.
  - `:198` `No collider vs. lake, home, fog, child, or predators` → drop `lake, `.
  - `:322` `rejected while \`inLake(baby.x,baby.z)\` is true (only spawn guard on the child;
    no guard against landing near a tree/cover cluster).` — this sentence documents the code
    changed in section 4's `:1269` edit (the retry loop is removed, becomes a single draw).
    Rewrite to state the new behavior: `no rejection guard at all (no guard against landing
    near a tree/cover cluster either).`
  - `:341` `Placement-time-only clearance from the lake (\`inLake\`) and from trees/cover
    (\`inBaby()\`,` → drop `the lake (\`inLake\`) and from `, leaving `Placement-time-only
    clearance from trees/cover (\`inBaby()\`,`.
  - `:480-486` (Predator, "What it CANNOT do") — the bullet's second half is stale even before
    this ticket (see below); trim it to keep only the true, still-relevant first clause:
    `Cannot spawn inside the spawn clearing, too close to the child, or inside another
    collider (\`placePredators()\`'s rejection loop).` Delete the rest of the bullet (`**but
    this loop does not check \`inLake()\`**, unlike the tree and child spawn loops.
    \`UNVERIFIED\`/\`UNDEFINED\` whether a predator can spawn inside the lake's clear radius on
    some seeds — see matrix.`) — it claims an `UNVERIFIED`/`UNDEFINED` gap that footnote 12
    (deleted in (c)) says was already fixed by LUL-791/LUL-395; the claim was stale
    documentation independent of this ticket, and is moot regardless once the lake is gone.
  - `:927` `reads distinctly from the lake/bog fills (\`drawMinimapStatic()\`, LUL-2248) —` →
    `reads distinctly from the bog fill (\`drawMinimapStatic()\`, LUL-2248) —`.
  - `:1469` `tree positions (\`treeData\`, every 4th tree) and the lake's position/radius
    (\`drawMinimapStatic()\`) — not just player/child/predator state.` → drop `and the lake's
    position/radius`, keep `tree positions (\`treeData\`, every 4th tree)
    (\`drawMinimapStatic()\`) — not just player/child/predator state.`
  - `:1751` `Does not interact with any other world element (predators, cover, lake, etc.) —`
    → drop `, lake`.
  - `:2265-2266` `~~**LUL-392**~~ — **Fixed, PR #163.** Player now wades:
    \`lakeSpeedMultiplier()\` halves \`maxSpd\` inside \`inLakeWater()\`; see footnote 4 and
    the Lake section.` — this whole historical "Fixed" entry documents a mechanic that no
    longer exists; delete the entry (it's one bullet in a changelog-style list of past
    UNDEFINED-findings fixes — deleting one entry doesn't break the list's numbering, they're
    keyed by ticket number not position).
  - `:2274` `~~**LUL-395**~~ — **Fixed, PR #163.** \`placePredators()\`'s spawn-rejection loop
    now rejects \`inLake()\` too; see footnote 12.` — delete the entry, same reasoning.
  - `:2278` `~~**LUL-857**~~ — **Fixed.** \`updatePredators()\`'s roam and stuck-recovery
    waypoint picks now route through \`keepWaypointOffLake()\`; see footnote 12. (...)` —
    delete the entry, same reasoning.
  - `:2310-2311` `\`CONFIG.lake\` is now 131 units from \`BOG_CENTER\` (outside
    \`BOG_OUTER_RADIUS\` on its own), so the old lake carve-out in \`lib/game/bog.ts\` was
    dead code and was removed;` — this is establishing why the bog generator has no lake
    special-case; since `CONFIG.lake` no longer exists at all, simplify to: `The bog generator
    has no lake special-case (none was ever needed — see git history if the "why" matters);`.
  - `:2335` `rejecting \`inLake()\`/\`overlapsTreeTrunk()\` candidates in its own generation
    loop as of **LUL-2247**` → drop `\`inLake()\`/`, leaving `rejecting
    \`overlapsTreeTrunk()\` candidates in its own generation loop as of **LUL-2247**` — but
    only if `generateReeds()`'s own `inLake()` rejection really is gone (it is, per section 4
    `:1189`); this line is describing `generateReeds()`'s bog-context behavior, confirm it's
    the same function before editing.
  - `:2423` `covering thirteen keys: \`scent\`, \`landmark\`, \`lake\`, \`bog\`, \`deepwater\`,
    \`wolf\`/\`bear\`/\`lion\`, \`stamina\`, \`cover\` (hollow log/bramble), \`caveImmune\`,
    \`throwable\`, \`veil\`.` → drop `\`lake\`, ` and change the count: `covering twelve keys:
    \`scent\`, \`landmark\`, \`bog\`, \`deepwater\`, \`wolf\`/\`bear\`/\`lion\`, \`stamina\`,
    \`cover\` (hollow log/bramble), \`caveImmune\`, \`throwable\`, \`veil\`.`
  - `:2441` `\`lake\`/\`bog\`/\`deepwater\`/\`stamina\`/\`caveImmune\`/\`veil\`/\`landmark\`
    have no natural 3D point` → drop `\`lake\`/`.
  - `:2447` `\`lake\`/\`bog\`/\`stamina\`/\`veil\`/\`landmark\` share the bottom-center spot
    \`#captionToast\`` → drop `\`lake\`/`.
  - `:2452` `world-anchoring and share the same fixed slot as
    \`lake\`/\`bog\`/\`stamina\`/\`veil\`/\`landmark\`` → drop `\`lake\`/`.

**e. Run the citation gate.** `node scripts/check-elements-citations.mjs --report` before you
start (baseline: 55 citations, 12 anchored/12 ok/0 drifted, 39 resolved-symbol citations
clean — confirmed on `a6bb9c8`), then `node scripts/check-elements-citations.mjs` after every
edit above lands — it must print `OK -- ... 0 new` with no `unknown symbol` line for `inLake`
(that means step 18's resolved-symbols.json edit and the ELEMENTS.md edits are out of sync —
fix both together).

## 19. `scripts/elements-resolved-symbols.json`

Remove the `"inLake",` entry (`:26`). This is the whitelist of symbol-only citations the
checker in 18(e) trusts without a line number — since `inLake()` is deleted from the engine,
any remaining ELEMENTS.md citation of it (there should be none after 18(a)-(d)) would report
as `unknown symbol` otherwise.

## 20. `e2e/hints.spec.ts`

Delete the entire test block `:98-134`:
```ts
  test('the lake hint appears on first entry into the water, not on a second visit', async ({ page }) => {
    ...
    expect((await qaHook(page, 'qaProbeHints')).activeKey, 'an already-seen hint must not retrigger').not.toBe('lake');
  });
```
(starts at `test('the lake hint appears...` ends at the matching `});`). Leave the tests
before and after untouched (`landmark` hint test above it, `deepwater` hint test below it).

## 21. `e2e/mobile/hints.spec.ts`

Same edit, same test title, `:148-179`.

## 22. `e2e/wind-assisted-evasion.spec.ts`

`:21`:
```ts
const HINTS_AHEAD_OF_WIND_ASSIST = ['scent', 'landmark', 'lake', 'bog', 'deepwater', 'oakHollow', 'wolf', 'bear', 'lion', 'stamina'];
```
→ drop `'lake', `:
```ts
const HINTS_AHEAD_OF_WIND_ASSIST = ['scent', 'landmark', 'bog', 'deepwater', 'oakHollow', 'wolf', 'bear', 'lion', 'stamina'];
```

## 23. `e2e/bog-zone.spec.ts`

`:38-39`:
```ts
    const lake = await qaHook(page, 'qaProbeBog', CONFIG.lake.x, CONFIG.lake.z);
    expect(lake.bogginess).toBe(0);
```
Delete both lines outright — there is no lake position left to assert "stays dry" about, and
nothing else in the test depends on the `lake` variable. Do not substitute a hardcoded
`(34,-28)` coordinate; that would silently re-encode a magic number with no landmark backing
it, which is exactly the kind of drift this doc's `check-elements-citations.mjs` sibling
pattern exists to prevent for source comments — don't reinvent it in a test.

## 24. `e2e/prop-density.spec.ts`

`:63-65`:
```ts
    // Mandatory per the ticket: no reed may land inside CONFIG.lake.clear.
    // generateReeds() now runs inLake() as its own rejection check.
    expect(density.reedsInLakeClear, `seed ${seed} reeds inside CONFIG.lake.clear`).toBe(0);
```
Delete all three lines — the field itself is removed from the engine in section 13.

## 25. `e2e/mobile/prop-density.spec.ts`

`:38-39`, same shape:
```ts
    // Mandatory per the ticket: no reed may land inside CONFIG.lake.clear.
    expect(density.reedsInLakeClear, `seed ${seed} reeds inside CONFIG.lake.clear`).toBe(0);
```
Delete both lines.

## 26. `e2e/qa-world-micro.spec.ts`

- `:78-79` comment `CONFIG.speedScaleMul (LUL-2422) was folded into pLakeMul and applied to
  every \`*pLakeMul\` speed site in updatePredators()` → rename to `pSpeedScaleMul`/
  `*pSpeedScaleMul` (matches the engine rename in section 7).
- `:93` comment `Spawned well clear of CONFIG.lake (x:34,z:-28,r:15) so pLakeMul's lake
  component stays 1 -- isolates speedScaleMul as the only multiplier in play.` — the lake
  framing is now false (there's no lake to be "well clear of"); simplify to: `Child relocated
  to CRY_NOISE_RADIUS (32, lib/game/noise.ts) clear of the predator...` i.e. drop the whole
  "Spawned well clear of CONFIG.lake... isolates speedScaleMul as the only multiplier in
  play." sentence and keep the rest of the comment about the child/cry-noise roll unchanged.
- `:97` `this would flakily measure the investigate/approach leg's \`p.spec.speed*pLakeMul\`
  instead.` → rename to `p.spec.speed*pSpeedScaleMul`.

## 27. `e2e/force-hunt-closes.spec.ts`

`:42` comment `applyQaWorldMicroPreset() (engine/tuning.js) sets CONFIG.speedScaleMul=0.2,
folded into every predator's pLakeMul in updatePredators() (forest-engine.js)` → rename
`pLakeMul` to `pSpeedScaleMul`.

## Verification

- `npx tsc --noEmit` — clean (catches the `nearestLandmarkName()` signature change at both
  call sites and the test file).
- `npm run lint` (runs `eslint` — `next lint` was removed in Next 16) — clean.
- `npm run build` (or `next build`) — clean.
- `node --test lib/game/*.test.ts` (or however unit tests are invoked in this repo — check
  `package.json`'s `test` script) — `lib/game/chronicle.test.ts` passes; `lib/game/lake.test.ts`
  no longer exists to run.
- `node scripts/check-elements-citations.mjs` — `OK -- ... 0 new`, no `unknown symbol`.
- `npx playwright test e2e/hints.spec.ts e2e/mobile/hints.spec.ts e2e/wind-assisted-evasion.spec.ts e2e/bog-zone.spec.ts e2e/prop-density.spec.ts e2e/mobile/prop-density.spec.ts e2e/qa-world-micro.spec.ts e2e/force-hunt-closes.spec.ts e2e/scent.spec.ts e2e/smoke.spec.ts e2e/charge-dodge.spec.ts` — all green, all running the default micro world (none of these are `@fullmap`).
- `grep -rn -i "lake" engine/ lib/ components/ e2e/ docs/ELEMENTS.md scripts/elements-resolved-symbols.json` — zero hits other than false positives inside the word "flake" (spot-check each hit; do not treat a nonzero grep count as failure without reading it).
- `grep -rn "playerInLake\|pLakeMul\|pPursuitMul\|reedsInLakeClear" engine/` — zero hits.

## e2e

**Specs.**
- `e2e/hints.spec.ts` — deletes "the lake hint appears on first entry into the water, not on a
  second visit" (must pass unchanged otherwise: landmark/deepwater/oakHollow hint tests).
- `e2e/mobile/hints.spec.ts` — same deletion, mobile twin.
- `e2e/wind-assisted-evasion.spec.ts` — extended (array literal edit only); all its tests must
  pass unchanged.
- `e2e/bog-zone.spec.ts` — extended (two-line deletion); all its tests must pass unchanged.
- `e2e/prop-density.spec.ts`, `e2e/mobile/prop-density.spec.ts` — extended (assertion
  deletion); remaining density assertions (chunk caps, min-pair-spacing) must pass unchanged.
- `e2e/qa-world-micro.spec.ts` — must pass unchanged (comment-only edit); this is the spec
  that actually exercises `pSpeedScaleMul`'s roam-state crossing speed (the "scales roam-state
  wander speed with the micro map" test at `:82`), so it's the regression guard for section
  7's simplification, not just incidental.
- `e2e/force-hunt-closes.spec.ts` — must pass unchanged (comment-only edit); exercises
  `pSpeedScaleMul`'s chase/hunt path via `pPursuitMul`'s removal (the multiply-by-1 that's now
  gone) — this is the regression guard for the `pPursuitMul` deletion in section 7.
- `e2e/minimap.spec.ts`, `e2e/minimap-setting.spec.ts` + mobile — must pass unchanged, no
  edit (see Deviation above).
- Every other spec file in `e2e/` and `e2e/mobile/` not listed above — must pass unchanged;
  none references lake.

**World.** micro (default) for every spec above except the two `@fullmap`-tagged minimap
tests (unedited, pre-existing tag, not this ticket's concern).

**Hooks.** No new hooks. No existing `qa*` hook in the `?qaHooks` block references
`lake`/`inLake`/`CONFIG.lake` — confirmed by grepping `window.ForestEngine.qa` definitions in
`engine/forest-engine.js` against every hook name used in the edited e2e files above
(`qaProbeBog`, `qaProbePropDensity`, `qaProbeHints`, `qaTeleportTo`, `qaBuildScene`,
`qaSetFixedStep`, `qaAdvance`, `qaPredatorState`) — none is lake-specific, none needs an edit.

**Tester scenario.** None: not player-visible in the sense of adding new behavior — this is a
pure removal. The removal itself *is* player-visible (no more lake in the world), but there is
no new interaction to script a nightly request for; the deletion is proven by the e2e specs
above (a lake-hint test that used to pass now doesn't exist to run, and `qaProbeMinimapPoint`/
`qaProbeBog`/density specs keep passing without it). No `shared/local-qa/requests/` file
needed for this ticket.

**Not covered.** Whether the map "feels" empty or different at (34,-28) where the lake used to
be — that's a level-design/feel judgment for a human or the founder, not something a hook can
assert. The nightly local-qa run's `smoke.spec.ts`-adjacent screenshot pass (if any) will
surface anything visually broken; nothing here needs a special request for it.

## Cues

Not applicable in the "new cue" sense — this spec removes a player-facing element and its one
first-encounter hint cue (`HINT_TEXT.lake`, the `#hintCaption` pill reading "chest-deep water
— half pace. predators wade too"), rather than adding or changing one. The visual (water mesh
+ glow ring + wisps, section 10's render block — already covered by the PLAN's citation list,
not restated here since it's a pure Three.js scene-object removal, not part of "The change"
list above because it lives in the render setup rather than `update()`/`tick()`; grep
`CONFIG.lake.glow` in the ~`:1414-1431`/`:1666-1669` region if you need to re-locate it),
audio (ambient twinkle-chime proximity bias, section 11), and explanation (the hint text
above) cues all disappear together, consistently — no degraded/orphaned half-state where e.g.
the sound still fires but the hint text is gone.

## Constraints

- Do not touch anything bog-specific. `bog`/`BOG_*`/`lib/game/bog.ts` is the sibling ticket
  (stage 5); every edit above that touches a shared list/comment/CSS selector containing both
  `lake` and `bog` removes only the `lake` token.
- Do not touch `drownedCar`. Per the CTO's PLAN comment, it's the **bog's** landmark (wiki
  `decisions/lul-3256-water-removal-plan.md` §1), not the lake's — this ticket's own
  description misfiled that open question here. Nothing in this spec references it, and
  nothing should.
- `nearestLandmarkName()`'s behavior for every remaining landmark (`fireTower`, `stoneMarker`,
  `oak`, `drownedCar`, `home`/"the Cabin") must be byte-identical before and after — only the
  `lake`/"the Lake" entry is removed from its candidate-points list.
- The `pSpeedScaleMul`/`pPursuitMul`-removal simplification in section 7 must not change any
  predator's speed in any state on any map size — verified by `qa-world-micro.spec.ts`'s
  `speedScaleMul` describe block and `force-hunt-closes.spec.ts` passing unchanged (both are
  the actual behavioral regression guards, not just incidental passers).
- Land this as its own PR — the ticket explicitly says "no mega-PR," independent of LUL-4588
  (mission swap) and the bog-deletion sibling ticket, no ordering dependency between the
  three.

## Out of scope

- The bog and Deepwater mission removal (sibling tickets under the parent LUL-3256 scope cut)
  — not touched here.
- The `drownedCar` landmark's fate (survive as plain terrain vs. deleted) — belongs to the
  bog-deletion ticket per the CTO's PLAN comment; this ticket's description raised it in
  error.
- Any change to `e2e/minimap*.spec.ts` (desktop or mobile) — verified unnecessary, see
  Deviation above.
- Re-numbering the doc's remaining footnotes after deleting 4/8/12/15/19 — this doc's
  footnotes are keyed by number, not position, and other footnotes already skip around
  non-sequentially where entries were retired before (nothing in `check-elements-citations.mjs`
  validates footnote sequence); leave the gaps.
