# SPEC: predator/cover movement-collision unification (rock, reed)

**Ticket:** LUL-1643 (spec routed via LUL-1656). **Tier: C** — `engine/forest-engine.js`
simulation (predator movement/collision/steering). Blocking review (`REVIEW: APPROVED`)
required before merge. Per the 2026-09-05 founder directive, Game Tester / Playwright-as-
verdict is currently suspended — verification below requires a manual live check by
whoever implements or reviews this, not a green Playwright run alone.

**Citations verified against branch `lul-1644-time-of-day-impl` @ `8a2de7f`** (this repo's
current HEAD at spec-writing time). Re-check line numbers before editing if the branch you
implement on has moved — `docs/ELEMENTS.md`'s own line-shift history this week shows how
fast these drift.

## Root cause (do not re-derive; already confirmed in LUL-1643's plan document)

Player movement collision is `blocked()` = `blockedR` (tree/landmark circles) `||`
`coverBlockedR` (rock/log/bramble/reed AABBs, gated by `coverKindBlocksPlayerMovement()`)
`||` `canopyBlockedR` (tree canopy, camera-only). Predator movement calls `blockedR()`
directly and never `coverBlockedR()` at all — predators pass through every cover kind,
not just rock. This spec makes rock/reed solid to predators too, reusing the exact same
kind predicate the player already uses. Log/bramble (`HIDE_KINDS`) stay walkable for both.
`canopyBlockedR` stays player-only (camera/eye-height concern, no predator analogue).

## Files changed

- `lib/game/cover.ts`
- `lib/game/cover.test.ts`
- `engine/forest-engine.js`

No other file changes. Do not touch `lib/game/pack.ts`, `lib/game/charge.ts`, hide-spot
eligibility (`findHideSpot`/`HIDE_KINDS`), or LOS (`hasLOS`/`canSee`) — all explicitly out
of scope (see below).

---

## 1. `lib/game/cover.ts`

### 1a. Rename `coverKindBlocksPlayerMovement` → `coverKindBlocksMovement`

The function (`cover.ts:114-116`) now gates both actors, not just the player — its name
predates this ticket. Rename the declaration and its one internal call site
(`cover.ts:310`, inside `coverBlockedR`). Do not change its body or logic:

```ts
export function coverKindBlocksMovement(kind: string): boolean {
  return kind !== 'tree' && !HIDE_KINDS[kind];
}
```

Update every other reference to the old name (grep `coverKindBlocksPlayerMovement` to
confirm none remain in `.ts`/`.js` files):
- `lib/game/cover.ts:71` (comment) and `:302` (comment) — reword to drop the
  now-inaccurate claim that "predators already ignore all cover-prop collision" (see
  §1d below for the exact comment fix).
- `engine/forest-engine.js:47` (import name), `:532` (comment), `:596` (call site) — see
  §3a below.
- `lib/game/cover.test.ts` — see §2 below.
- `e2e/lul211-founder-report.spec.ts:27` — a comment mentioning the old name. Tier A
  (`e2e/**`), one-line find/replace, not required for correctness but do it in the same
  PR since it's free and avoids a dangling reference to a renamed function.

### 1b. New composite: `blockedForPredator`

Insert immediately after the `blocked()` function (after `cover.ts:354`, before the
`segRayVsAABB` section). Placed after `blocked()` for reading order even though
`pickAvoidDirection` (defined earlier in the file, §1c) calls it — function declarations
hoist, so the forward reference is valid and needs no reordering:

```ts
// ---- composite predator movement block (LUL-1643) ---------------------------
// Predator counterpart to blocked() above: grid + cover, deliberately no
// canopyBlockedR. Canopy exists only to keep the *player's camera* out of
// foliage at eye height (LUL-267) -- a rendering concern predators, which have
// no camera, don't share. Reuses coverBlockedR/coverKindBlocksMovement, the
// exact same solid/walkable predicate blocked() uses for the player, so rock/
// reed are solid and log/bramble stay walkable for both actors identically.
export function blockedForPredator(
  x: number,
  z: number,
  pr: number,
  grid: SpatialGrid<CircleCollider>,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
): boolean {
  return blockedR(x, z, pr, grid, cell) || coverBlockedR(x, z, pr, coverGrid, cell);
}
```

### 1c. `pickAvoidDirection` must probe cover too

Without this, predators get stopped dead at a rock's edge by the slide/push sites (§3b,
§3c) but never steer around it in advance — see the plan's "bonks into rock and stands
there" scenario. Change the signature (`cover.ts:236-246`) to take `coverGrid`, inserted
right after `grid` and before `cell`:

```ts
export function pickAvoidDirection(
  x: number,
  z: number,
  rad: number,
  dx: number,
  dz: number,
  grid: SpatialGrid<CircleCollider>,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
  lookAhead: number = 2.4,
  nearLookAhead: number = 0.8,
): [number, number] {
  const near = rad + nearLookAhead;
  const far = rad + lookAhead;
  const clearDistance = (rx: number, rz: number): number => {
    if (blockedForPredator(x + rx * near, z + rz * near, rad, grid, coverGrid, cell)) return 0;
    if (blockedForPredator(x + rx * far, z + rz * far, rad, grid, coverGrid, cell)) return near;
    return far;
  };
  // body below this point (the `if (clearDistance(dx, dz) === far) ...` loop through
  // `return bestDir;`) is UNCHANGED -- only the two blockedR(...) calls inside
  // clearDistance become blockedForPredator(...) with coverGrid threaded through.
  ...
}
```

Only the two lines inside `clearDistance` change from `blockedR(...)` to
`blockedForPredator(..., coverGrid, cell)`. Nothing else in the function body changes.

### 1d. Comment updates (accuracy, not logic)

Two comments in `cover.ts` assert "predators already ignore all cover-prop collision" as
settled fact — both false after this change and both cited directly by the LUL-43/119/211
history this codebase treats as load-bearing context. Update:

- `cover.ts:94-95` (inside the `coverKindBlocksMovement` doc comment, LUL-384 section):
  currently reads "...and predators already ignore all cover-prop collision entirely
  (LUL-119/LUL-211's "predators pass through" rule)." — replace with something like:
  "predators exempt log/bramble from movement collision too, via this same predicate
  (LUL-1643 unified rock/reed as predator colliders; see blockedForPredator())."
- `cover.ts:302-304` (inside `coverBlockedR`'s doc comment): currently reads "...a fallen
  log is the one cover prop a person would naturally step/run over rather than route
  around, and predators already ignore all cover-prop collision (LUL-119/LUL-211)." —
  drop the trailing clause; predators now route through this same function via
  `blockedForPredator()` (LUL-1643), they just share the identical log/bramble exemption.

---

## 2. `lib/game/cover.test.ts`

**Every logic change above ships with test coverage in this same commit — Tier C, no
exceptions.**

### 2a. Import list (`cover.test.ts:3-29`)

Rename `coverKindBlocksPlayerMovement` → `coverKindBlocksMovement`. Add
`blockedForPredator` to the import list.

### 2b. Rename the five `coverKindBlocksPlayerMovement` tests (`cover.test.ts:209-229`)

Same five assertions (tree→false, log→false, rock→true, bramble→false, reed→true), same
bodies, just `coverKindBlocksMovement` in the test name strings and the calls. Also
reword the section header comment at `:209` from `coverKindBlocksPlayerMovement` to
`coverKindBlocksMovement`.

### 2c. Thread `coverGrid` through all six existing `pickAvoidDirection` calls (`cover.test.ts:428-487`)

Every existing call passes `grid` as its 6th argument and nothing after — each needs an
empty `CoverAABB` grid inserted right after `grid`. Add this helper once, right before the
`pickAvoidDirection` test block (before line 428):

```ts
const emptyCoverGrid: SpatialGrid<CoverAABB> = new Map();
```

Then, in each of the six tests (lines 432, 440, 448, 460, 474, 482, 485 — note lines 482
and 485 are two calls in the same test), insert `emptyCoverGrid` as the 7th argument,
after `grid` and before whatever came next:

- `pickAvoidDirection(0, 0, 0.6, 1, 0, grid)` → `pickAvoidDirection(0, 0, 0.6, 1, 0, grid, emptyCoverGrid)` (6 occurrences, identical shape: lines 432, 440, 448, 460, 474, 482)
- `pickAvoidDirection(0, 0, 0.6, 1, 0, grid, CELL, 5.4)` (line 485) → `pickAvoidDirection(0, 0, 0.6, 1, 0, grid, emptyCoverGrid, CELL, 5.4)`

### 2d. New tests: `blockedForPredator` (add after the `blockedR` test block, i.e. after `cover.test.ts:426`)

```ts
// ---- blockedForPredator (LUL-1643: predators now collide with rock/reed) ---

test('blockedForPredator: rock blocks a predator the same way it blocks the player', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(blockedForPredator(0.5, 0, 0.6, grid, coverGrid), true);
});

test('blockedForPredator: reed blocks a predator', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 0.5, hz: 0.5, kind: 'reed', ry: 0 }]);
  assert.equal(blockedForPredator(0, 0, 0.6, grid, coverGrid), true);
});

test('blockedForPredator: log does not block a predator (HIDE_KINDS stays walkable for both actors)', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 2, hz: 1, kind: 'log', ry: 0 }]);
  assert.equal(blockedForPredator(0, 0, 0.6, grid, coverGrid), false);
});

test('blockedForPredator: bramble does not block a predator', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1, hz: 1, kind: 'bramble', ry: 0 }]);
  assert.equal(blockedForPredator(0, 0, 0.6, grid, coverGrid), false);
});

test('blockedForPredator: tree circle grid still blocks a predator (unchanged, unrelated to cover)', () => {
  const grid = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 1 }]);
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(blockedForPredator(0.5, 0, 0.6, grid, coverGrid), true);
});
```

### 2e. New tests: `pickAvoidDirection` now steers around cover (add after the existing pickAvoidDirection block, after the updated line 487)

```ts
test('pickAvoidDirection: a rock AABB dead ahead deflects the predator (LUL-1643)', () => {
  const grid = makeGrid<CircleCollider>([]);
  // rock centered at (3,0), hx=hz=0.5 -- sits on the raw heading's look-ahead point.
  const coverGrid = makeGrid<CoverAABB>([{ x: 3, z: 0, hx: 0.5, hz: 0.5, kind: 'rock', ry: 0 }]);
  const [rx, rz] = pickAvoidDirection(0, 0, 0.6, 1, 0, grid, coverGrid);
  assert.ok(!(rx === 1 && rz === 0), 'must deflect away from the raw heading');
});

test('pickAvoidDirection: a log AABB dead ahead does NOT trigger avoidance (walkable, matches player parity)', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 3, z: 0, hx: 0.5, hz: 0.5, kind: 'log', ry: 0 }]);
  const [rx, rz] = pickAvoidDirection(0, 0, 0.6, 1, 0, grid, coverGrid);
  assert.equal(rx, 1);
  assert.equal(rz, 0);
});
```

Run `node --test lib/game/cover.test.ts` (or the repo's `npm test`) and confirm all pass,
including the pre-existing ones with the added argument.

---

## 3. `engine/forest-engine.js`

### 3a. Import block (`forest-engine.js:46-66`)

Rename `coverKindBlocksPlayerMovement` → `coverKindBlocksMovement` in the import list
(line 47). Add `blockedForPredator as geoBlockedForPredator` to the same import block
(alongside the existing `blockedR as geoBlockedR` / `blocked as geoBlocked` aliases,
lines 58-59).

Update the one real call site at `forest-engine.js:596`:
`if(!coverKindBlocksPlayerMovement(kind) && ...)` → `if(!coverKindBlocksMovement(kind) && ...)`.

### 3b. New engine wrapper (insert after `forest-engine.js:536`, right after the existing `blocked()` wrapper)

```js
// LUL-1643: predator movement now consults cover the same way blocked() does
// for the player, minus canopyBlockedR (camera-only, LUL-267 -- see
// blockedForPredator()'s own comment in cover.ts for why canopy stays excluded).
function predatorBlocked(x,z,pr){ return geoBlockedForPredator(x,z,pr,grid,coverGrid); }
```

### 3c. Update the stale comment block at `forest-engine.js:522-534`

This comment currently documents the asymmetry this ticket removes ("predators call
blockedR() directly for their own movement... is unchanged" at line 527-528). Reword the
last sentence of that comment to state the new split precisely: predators now call
`predatorBlocked()` (grid + cover, no canopy) instead of bare `blockedR()`, for every real
movement call site (§3e-3g below); `blockedR()` itself is unchanged and still used
directly only where a tree/landmark-circle-only check is intentionally wanted (the QA
helpers that stage against `HIDE_KINDS` props only, §3h).

### 3d. Update the stale comment block at `forest-engine.js:438-444`

This is the exact comment the LUL-1643 plan calls "the known, deliberate gap" — it
currently says cover props are "deliberately NOT movement colliders [for predators]...
a fast-follow can add it if the founder wants these to be walls." That fast-follow is
this PR. Replace the last two sentences (443-444, "Declared in the LUL-43 handoff...")
with something like: "LUL-1643 made rock/reed real predator colliders (see
`predatorBlocked()` below and `blockedForPredator()` in `lib/game/cover.ts`); log/bramble
stay walkable for predators, matching the player's own exemption."

### 3e. Main predator move + slide (`forest-engine.js:1511`)

```js
const blockedX = predatorBlocked(nx, p.z, p.rad), blockedZ = predatorBlocked(p.x, nz, p.rad);
```
(was `blockedR(nx, p.z, p.rad)` / `blockedR(p.x, nz, p.rad)`). Nothing else on this line
or in the surrounding block changes.

### 3f. Predator-vs-predator separation push (`forest-engine.js:1606-1607`)

```js
if(!predatorBlocked(nx, p.z, p.rad)) p.x = nx;
if(!predatorBlocked(p.x, nz, p.rad)) p.z = nz;
```
(was `blockedR(...)` on both lines).

### 3g. `avoidDir` wrapper (`forest-engine.js:1120`)

```js
function avoidDir(p, dx, dz){ return pickAvoidDirection(p.x, p.z, p.rad, dx, dz, grid, coverGrid); }
```
(adds `coverGrid` as the new argument `pickAvoidDirection` now requires, per §1c).

### 3h. Predator spawn-point rejection loop (`forest-engine.js:1102`) — **explicitly OUT OF SCOPE, do not change**

The plan asked this spec to decide whether spawn placement should also reject
rock/reed overlap. **Decision: no, leave `blockedR(x, z, p.rad+0.5)` exactly as-is.**
Two independent reasons, either alone sufficient:

1. **Ordering**: `generateMap()` calls `placePredators()` (line 738) *before*
   `generateCover()` (line 739) — `coverGrid` is not yet built for the map currently
   being generated at the point this loop runs. Consulting cover here would read either
   an empty grid (first-ever generation) or the *previous* map's stale cover data (a
   restart) — neither is meaningful, and both are strictly worse than not checking.
2. **RNG determinism**: the loop's own comment (`forest-engine.js:1088-1099`, citing
   LUL-791/LUL-794) explicitly warns that changing this while-condition's rejection
   count on any candidate changes how many `rng()` draws this loop makes, which silently
   reshuffles every prop `generateCover()` places afterward against the same seeded
   stream. Adding a cover check here is exactly that class of change.

Making spawn placement cover-aware would require reordering `generateMap()` (running
`generateCover()`/`buildCoverGrid()` before `placePredators()`) — a materially bigger,
riskier change than this ticket's scope (movement collision only), and it would still
need to preserve today's RNG draw order/count to avoid reshuffling every seed's map. If
the founder wants this, it is a separate, explicitly-scoped follow-up ticket, not part of
this PR. Do not attempt it as part of implementing this spec.

### 3i. QA helper: `stageBlindChaseThroughCover` (`forest-engine.js:2705-2776`)

This helper currently iterates **every** non-tree cover kind (`forest-engine.js:2730`:
`if(c.kind === 'tree') continue;`) and deliberately stages the predator flush against the
prop's thin face, exploiting exactly the pass-through this ticket removes (its own
comment at 2732-2735 says so: "the predator (point A) never calls blocked()/
coverBlockedR() for its own movement... so it can sit right at the box's thin face").
Once rock/reed block predator movement, staging against those two kinds would place the
predator somewhere `predatorBlocked()` now rejects, and the `if(blockedR(ax,az,p.rad) ||
blocked(bx,bz)) continue;` guard (line 2747) would simply skip those candidates — not a
crash, but it silently shrinks the candidate pool to whatever bramble/log gives, while the
comment above it still claims "any non-tree cover prop." Fix both together:

1. Line 2730: `if(c.kind === 'tree') continue;` → `if(!HIDE_KINDS[c.kind]) continue;` —
   restricts staging to log/bramble, the kinds that stay non-colliding, matching the exact
   pattern `qaHideBehindCover`/`qaHideBehindCoverKind` already use (lines 2511, 2546).
2. Line 2747: `if(blockedR(ax, az, p.rad) || blocked(bx, bz)) continue;` →
   `if(predatorBlocked(ax, az, p.rad) || blocked(bx, bz)) continue;` — behaviorally a
   no-op at this call site once (1) restricts `c.kind` to `HIDE_KINDS` (predatorBlocked
   and blockedR agree there), but keeps this call site honest against the real
   production predicate rather than a stale narrower one.
3. Update the comment block at `forest-engine.js:2705-2724` and `:2732-2739` — replace
   references to "any non-tree cover prop" / "any dedicated cover prop" with "a
   log/bramble cover prop (`HIDE_KINDS`) — rock/reed now collide with the predator
   (LUL-1643), so this hook is restricted to the kinds that still don't." Keep the rest
   of the reasoning (catch-range math, `offA`/`offB` padding) unchanged — it does not
   depend on which kind is selected.

Do not change `window.ForestEngine.qaStageBlindChaseThroughCover` or
`window.ForestEngine.qaStageAndTraceBlindChase` (lines 2777-2779, 2811-2817) — both are
thin callers of `stageBlindChaseThroughCover()` and need no changes of their own.

### 3j. QA helpers `qaHideBehindCover` / `qaHideBehindCoverKind` (`forest-engine.js:2507-2564`) — **no change**

Both already filter to `HIDE_KINDS` only (lines 2511, 2546: `if(!HIDE_KINDS[c.kind])
continue;`) before ever computing a placement, so they never exploit the rock/reed
pass-through in the first place — `blockedR(px, pz, p.rad)` at lines 2514/2549 is already
equal to what `predatorBlocked` would compute at those positions, since log/bramble never
block predator movement, before or after this change. Leave both exactly as-is; do not
"fix" something that isn't broken here — this is the plan's audit item resolved as "no
action needed," not an oversight.

### 3k. QA helper `qaProbeBlocked` (`forest-engine.js:2368`) — **no change**

Wraps `blocked()` (the player composite), unrelated to predator movement. Unaffected by
this ticket.

---

## e2e specs — audited, no changes required

Searched `e2e/` for `blockedR`, `stageBlindChaseThroughCover`, `qaHideBehindCover`, and
LUL-119/LUL-211/LUL-388 references. Four specs call the affected QA helpers
(`blind-chase-cover.spec.ts`, `positional-hiding.spec.ts`, `cover-feedback.spec.ts`,
`scent.spec.ts`) — all of them go through `qaHideBehindCover`/`qaHideBehindCoverKind`/
`qaStageAndTraceBlindChase`, none assert on cover *kind* or reference `blockedR`/
`coverBlockedR` directly, and (per §3i/§3j) the helpers' externally-observable behavior is
unchanged by this PR — `stageBlindChaseThroughCover`'s pool shrinks to log/bramble
candidates only, which `forest-engine.js:2505`'s own sibling comment already notes is
~65% of `COVER_PROPS`, so a valid candidate remains available per species on every seed
these specs already rely on. `e2e/lul211-founder-report.spec.ts` exercises only *player*
movement (`qaStageWalkIntoCover`/`qaProbePlayer`/`blocked()`), untouched by this ticket,
aside from the one stale-comment mention already called out in §1a.

**If, while implementing, any of these four specs actually fails** — treat that as a spec
bug in this document (a wrong assumption about candidate availability on some seed), not
something to route around inside the engine. Stop and report per the spec-pipeline rule
(spec and code disagree → executor stops and reports, does not reconcile).

---

## Explicitly out of scope

- `canopyBlockedR` and player movement (`blocked()`) — unchanged, already correct.
- Hide-spot eligibility (`HIDE_KINDS`, `findHideSpot`) or LOS (`hasLOS`/`canSee`) —
  unchanged, this is a movement-collision fix only.
- Predator speed, detect range, chase/investigate/flank timing — no retuning.
- Predator spawn-point rejection (`forest-engine.js:1102`) — see §3h; a real gap, but a
  separate, larger, RNG-sensitive change. File a follow-up ticket if the founder wants it
  addressed; do not fold it into this PR.
- Mobile: this is a simulation/AI change with no player-facing input surface — nothing to
  route through `EngineActions`, no touch affordance needed. State this explicitly in the
  PR body per the desktop+mobile directive (the directive requires saying so, not that
  every PR touches mobile).

## Verification (what "done" looks like)

1. `node --test lib/game/cover.test.ts` (or `npm test`) — all tests pass, including the
   new ones in §2d/§2e and the six updated `pickAvoidDirection` calls in §2c.
2. `tsc --noEmit` clean.
3. `next build` passes; lint clean (`npm run lint` — not `next lint`, removed in
   Next.js 16).
4. **Manual live check, required — Playwright-as-verdict is suspended (2026-09-05
   directive), a green e2e run alone does not close this ticket.** Run the game locally,
   get a predator into `chase` state, and walk/lure it toward a rock. Confirm:
   - it slides around the rock's edge the way it already does for a tree (not a dead
     stop-and-stick, thanks to §1c's `pickAvoidDirection` fix);
   - it does the same for a reed clump;
   - it still crosses log and bramble props without hesitation (no regression there).
5. Run the four e2e specs named above (`npx playwright test blind-chase-cover
   positional-hiding cover-feedback scent` or equivalent) and read the actual output —
   per the "unit tests" CI-check caution and the Playwright-staleness caution in AGENTS.md,
   treat a red run as one input to investigate, not an automatic verdict either way.
6. Grep confirms zero remaining references to `coverKindBlocksPlayerMovement` anywhere in
   `.ts`/`.js` files (renamed to `coverKindBlocksMovement` everywhere, §1a).

## Routing

Game Engineer implements from this spec. If anything here is ambiguous or the spec and
the current code disagree once you open the files, stop and report — do not reconcile or
improvise (see AGENTS.md's spec-architecture section). Bounce to CTO only for genuine
spec-clarity gaps, not implementation difficulty.
