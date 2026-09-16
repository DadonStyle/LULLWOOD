# SPEC: LUL-2306 Predator player-sized collision body + committed go-around/unstick

**Ticket:** LUL-2306 · **Tier:** C — edits `engine/forest-engine.js` (predator steering/
collision) and adds `lib/game/steer.ts` (pure movement-simulation logic). `REVIEW: APPROVED`
from the Code Reviewer is required before merge; do not merge on green alone.

**Written against:** `release/next` @ `5425082` (2026-09-16). Re-derive every `file:line`
below from the branch you actually implement on if it has moved — LUL-2320 already shifted
these once (see the PLAN document on this ticket for that history); expect other PRs to have
landed since this SPEC was written.

## Files

- `lib/game/steer.ts` — created. `pickCommittedAvoidDirection()` (hysteresis wrapper around
  the existing `pickAvoidDirection()`) and `findLocalPath()` (bounded local search).
- `lib/game/steer.test.ts` — created. Unit tests for both functions above.
- `engine/forest-engine.js` — edited. `moveRad` field, `avoidDir()` wrapper swap, the two
  movement-collision call sites, the stuck-detection threshold/branch, `qaPredatorState()`.
- `engine/forest-engine.d.ts` — edited. `qaPredatorState()`'s return type gains `moveRad`.
- `docs/ELEMENTS.md` — edited. Fixes three stale claims (cover-collision exemption, stuck
  window, movement-collider radius) named below.
- `e2e/predator-steering.spec.ts` — created. Micro-world specs for the gap-pass, go-around,
  and rock-parity behaviours (see `## e2e`).

## The change

### 1. `lib/game/steer.ts` (new file)

```ts
import type { SpatialGrid, CircleCollider, CoverAABB } from './cover';
import { pickAvoidDirection, blockedForPredator, CELL } from './cover';

// Founder brief's 0.8-1.2s band, mid-point. A predator that picks a side to
// go around an obstacle holds that side for this long before it is allowed
// to re-evaluate, so it commits to one route instead of flipping left/right
// every frame against a cluster or a tree line (LUL-2306).
export const AVOID_COMMIT_TIME = 1.0;

export interface CommittedSteerResult {
  dir: [number, number];
  commitDir: [number, number] | null;
  commitT: number;
}

// Wraps pickAvoidDirection() (lib/game/cover.ts:348, unchanged) with a hold
// timer. While commitT > 0 the predator keeps steering along the direction
// it already picked, even if pickAvoidDirection() would now pick something
// else -- that re-evaluation-every-frame jitter is exactly LUL-2306 bug #2.
// Only once commitT has decayed to 0 does this check the direct heading
// (dx, dz) again: if it is clear, release the commitment and steer direct;
// if it is still blocked, pick a (possibly new) side via pickAvoidDirection()
// and start a fresh commit window.
export function pickCommittedAvoidDirection(
  commitDir: [number, number] | null,
  commitT: number,
  dt: number,
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
  span: number = Infinity,
): CommittedSteerResult {
  const nextT = Math.max(0, commitT - dt);
  if (commitDir && nextT > 0) {
    return { dir: commitDir, commitDir, commitT: nextT };
  }
  const directBlocked = blockedForPredator(
    x + dx * (rad + nearLookAhead), z + dz * (rad + nearLookAhead),
    rad, grid, coverGrid, cell, span,
  );
  if (!directBlocked) {
    return { dir: [dx, dz], commitDir: null, commitT: 0 };
  }
  const dir = pickAvoidDirection(x, z, rad, dx, dz, grid, coverGrid, cell, lookAhead, nearLookAhead, span);
  return { dir, commitDir: dir, commitT: AVOID_COMMIT_TIME };
}

// Node spacing for the bounded search below -- finer than the 8u spatial
// hash (CELL) so it can find a route through gaps a single avoidDir() probe
// would miss, without the cost of a full navmesh.
export const LOCAL_SEARCH_STEP = 2;
// Max straight-line distance a candidate node may sit from the predator that
// triggered the search -- keeps this local and cheap, not a full-map replan.
export const LOCAL_SEARCH_RADIUS = 30;
// Max nodes expanded per call. Called once per stuck-trigger (not per
// frame), so this budget is generous for that cadence and still cheap.
export const LOCAL_SEARCH_BUDGET = 48;
// How close the follower (engine side) must get to a waypoint before
// advancing to the next one.
export const LOCAL_SEARCH_ARRIVE_R = 1.2;

const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export interface LocalPathResult {
  // Nearest-first, at most 3 points -- the engine follows these in order,
  // then re-triggers a fresh search (via the normal stuck-detection path)
  // if it gets stuck again before reaching the live target.
  waypoints: [number, number][];
}

// Deterministic, seeded-rng-free greedy best-first search on a
// LOCAL_SEARCH_STEP grid, replacing "pick a random +/-20u waypoint" for a
// predator that is actively pursuing something (hunt/chase/investigate
// approach) and has been stuck long enough that the committed-avoid wrapper
// above hasn't resolved it alone (e.g. a concave tree cluster no single
// heading change escapes). Returns null if the start node is itself blocked
// (defers to the caller's existing trail-rewind) or the budget is exhausted
// before any node gets within one LOCAL_SEARCH_STEP of the target.
export function findLocalPath(
  x: number, z: number, targetX: number, targetZ: number, rad: number,
  grid: SpatialGrid<CircleCollider>, coverGrid: SpatialGrid<CoverAABB>,
  span: number = Infinity,
): LocalPathResult | null {
  const key = (gx: number, gz: number) => gx + ',' + gz;
  const toGrid = (wx: number, wz: number): [number, number] =>
    [Math.round(wx / LOCAL_SEARCH_STEP), Math.round(wz / LOCAL_SEARCH_STEP)];
  const toWorld = (gx: number, gz: number): [number, number] =>
    [gx * LOCAL_SEARCH_STEP, gz * LOCAL_SEARCH_STEP];
  const [sx, sz] = toGrid(x, z);
  const [tx, tz] = toGrid(targetX, targetZ);
  const dist2 = (gx: number, gz: number) => { const ddx = gx - tx, ddz = gz - tz; return ddx * ddx + ddz * ddz; };

  const startKey = key(sx, sz);
  const visited = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  let frontier: [number, number][] = [[sx, sz]];
  let reached: [number, number] | null = null;
  let expansions = 0;

  while (frontier.length && expansions < LOCAL_SEARCH_BUDGET) {
    frontier.sort((a, b) => dist2(a[0], a[1]) - dist2(b[0], b[1]));
    const [gx, gz] = frontier.shift()!;
    expansions++;
    if (dist2(gx, gz) <= 1) { reached = [gx, gz]; break; }
    for (const [ox, oz] of NEIGHBOR_OFFSETS) {
      const ngx = gx + ox, ngz = gz + oz;
      const k = key(ngx, ngz);
      if (visited.has(k)) continue;
      const [wx, wz] = toWorld(ngx, ngz);
      if (Math.hypot(wx - x, wz - z) > LOCAL_SEARCH_RADIUS) continue;
      if (blockedForPredator(wx, wz, rad, grid, coverGrid, CELL, span)) continue;
      visited.add(k);
      cameFrom.set(k, key(gx, gz));
      frontier.push([ngx, ngz]);
    }
  }
  if (!reached) return null;

  const path: [number, number][] = [];
  let curKey = key(reached[0], reached[1]);
  while (curKey !== startKey) {
    const [gx, gz] = curKey.split(',').map(Number);
    path.push(toWorld(gx, gz));
    const prev = cameFrom.get(curKey);
    if (!prev) break;
    curKey = prev;
  }
  path.reverse();
  return path.length ? { waypoints: path.slice(0, 3) } : null;
}
```

Note: `blockedForPredator` and `CELL` are already exported from `lib/game/cover.ts` (`:512`,
`:261`) — add them to `steer.ts`'s import, do not duplicate.

### 2. `engine/forest-engine.js`

- **Import** (`:58-83` block importing from `@/lib/game/cover`): add `PLAYER_COLLISION_RADIUS`
  to the existing named-import list (it is not currently imported here). Add a new import:
  `import { pickCommittedAvoidDirection, findLocalPath, LOCAL_SEARCH_ARRIVE_R } from '@/lib/game/steer';`

- **`makePredator()` return object** (`:1918`, `rad:s.rad,`): add alongside it —
  ```js
  rad: s.rad, moveRad: PLAYER_COLLISION_RADIUS,
  ```
  and in the same return object's other new-field group (next to `stuckT:0, trail:[], ...` at
  `:1922`), add:
  ```js
  commitDir: null, commitT: 0, lastSteerState: 'roam', searchPath: null,
  ```

- **Per-predator state-change reset** (top of the per-predator loop, `:2527`
  `let desx = 0, desz = 0, speed = 0, facePlayer = false;`): immediately after that line, add:
  ```js
  if (p.state !== p.lastSteerState) { p.commitDir = null; p.commitT = 0; p.searchPath = null; p.lastSteerState = p.state; }
  ```
  This is a single generic reset point instead of auditing every `p.state = '...'` assignment
  in the file (there are 20+) — any state change clears the commitment and any in-flight
  local-search path, which is always safe (worst case: one extra `stuckT` accumulation cycle
  before a fresh search or commit).

- **`avoidDir()` wrapper** (`:2044`):
  ```js
  // before
  function avoidDir(p, dx, dz){ return pickAvoidDirection(p.x, p.z, p.rad, dx, dz, grid, coverGrid, CELL, undefined, undefined, WRAP_SPAN); }
  // after
  function avoidDir(p, dx, dz, dt){
    const r = pickCommittedAvoidDirection(p.commitDir, p.commitT, dt, p.x, p.z, p.moveRad, dx, dz, grid, coverGrid, CELL, undefined, undefined, WRAP_SPAN);
    p.commitDir = r.commitDir; p.commitT = r.commitT;
    return r.dir;
  }
  ```
  Update the one call site (`:2908`, `[desx, desz] = avoidDir(p, desx, desz);`) to
  `avoidDir(p, desx, desz, dt)` — `dt` is already in scope (`updatePredators(dt, ...)`'s own
  parameter).

- **Movement-collision call site #1** (desired-move probe, `:2924`):
  ```js
  // before
  const blockedX = predatorBlocked(nx, p.z, p.rad), blockedZ = predatorBlocked(p.x, nz, p.rad);
  // after
  const blockedX = predatorBlocked(nx, p.z, p.moveRad), blockedZ = predatorBlocked(p.x, nz, p.moveRad);
  ```

- **Movement-collision call site #2** (separation-push commit, `:3020-3021`):
  ```js
  // before
  if(!predatorBlocked(nx, p.z, p.rad)) p.x = nx;
  if(!predatorBlocked(p.x, nz, p.rad)) p.z = nz;
  // after
  if(!predatorBlocked(nx, p.z, p.moveRad)) p.x = nx;
  if(!predatorBlocked(p.x, nz, p.moveRad)) p.z = nz;
  ```
  The `predatorSeparationPush(p.x, p.z, p.rad, others, WRAP_SPAN)` call immediately above
  this (`:3016`) keeps `p.rad` unchanged — it sizes the spacing *between predators*, not
  terrain collision, and is explicitly out of scope (founder constraint: separation feel
  unchanged).

- **Everywhere else `p.rad` is read stays `p.rad`, unchanged** — verified by grep after the
  above edits, the only remaining `predatorBlocked(..., p.rad)` / `blockedR(..., p.rad)` call
  sites are: the catch checks (`isCaught`/`canCatchInChase`, `:2658`, `:2755`, `:2768`), the
  sniff-margin `canSee()` call (`:2452`), `predatorSeparationPush` (`:3016`), the spawn-clearance
  loop (`:1973`), and the QA staging hooks (`qaHideBehindCover`/`qaHideBehindCoverKind`/
  `stageBlindChaseThroughCover`/`stageBehindTree`, `~:4360-4990`) — those hooks place a
  predator at exact catch/standoff range for e2e determinism and are deliberately unaffected.

- **Stuck detection + bounded search** (`:2930-2946`):
  ```js
  // before
  if(speed > 1 && p.reroute <= 0 && p.alert <= 0){
    if(moved < speed*dt*0.35) p.stuckT += dt; else p.stuckT = Math.max(0, p.stuckT - dt*2);
    if(p.stuckT > 3){                              // go back along the trail, then a different way
      const back = p.trail[0] || [p.x - ux*6, p.z - uz*6];
      p.rrX = back[0]; p.rrZ = back[1]; p.reroute = 1.4; p.stuckT = 0;
      // fresh, different waypoint (LUL-857: kept off the water same as the roam pick above)
      const freshx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.x + (rng()-0.5)*40, -half+4, half-4);
      const freshz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.z + (rng()-0.5)*40, -half+4, zMax-4);
      const freshKept = keepWaypointOffLake(freshx, freshz, CONFIG.lake);
      p.wpx = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.x, WRAP_SPAN) : clamp(freshKept.x, -half+4, half-4);
      p.wpz = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.z, WRAP_SPAN) : clamp(freshKept.z, -half+4, zMax-4);
    }
  }
  // after
  if(speed > 1 && p.reroute <= 0 && p.alert <= 0){
    if(moved < speed*dt*0.35) p.stuckT += dt; else p.stuckT = Math.max(0, p.stuckT - dt*2);
    if(p.stuckT > 1.0){                            // LUL-2306: 3 -> 1.0 (game-time; LUL-2283's qaSetFixedStep removed the wall-clock jitter LUL-1597 reverted this for)
      const back = p.trail[0] || [p.x - ux*6, p.z - uz*6];
      p.rrX = back[0]; p.rrZ = back[1]; p.reroute = 1.4; p.stuckT = 0;
      const pursuing = p.hunt || p.state === 'chase' || (p.state === 'investigate' && p.inv === 'approach');
      if(pursuing){
        const path = findLocalPath(p.x, p.z, player.x, player.z, p.moveRad, grid, coverGrid, WRAP_SPAN);
        p.searchPath = path ? path.waypoints : null;
      } else {
        p.searchPath = null;
      }
      if(!pursuing || !p.searchPath){
        // roam, or the bounded search itself found nothing -- same guaranteed
        // unstick as before (LUL-857: kept off the water same as the roam pick above)
        const freshx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.x + (rng()-0.5)*40, -half+4, half-4);
        const freshz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.z + (rng()-0.5)*40, -half+4, zMax-4);
        const freshKept = keepWaypointOffLake(freshx, freshz, CONFIG.lake);
        p.wpx = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.x, WRAP_SPAN) : clamp(freshKept.x, -half+4, half-4);
        p.wpz = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.z, WRAP_SPAN) : clamp(freshKept.z, -half+4, zMax-4);
      }
    }
  }
  ```
  `pursuing` intentionally excludes `investigate`'s `sniff`/`standoff`/`back`/`leave`
  sub-phases (short-range, already near the target) and `roam`/`flank` — roam keeps exactly
  its existing random-waypoint recovery (unchanged), per the founder's own decision (5).

- **New state-independent branch: follow an in-flight search path.** Add immediately after
  the existing `else if(p.reroute > 0){ ... }` block (same priority tier — this must run
  *before* the `p.hunt`/`p.state === '...'` chain so a live search isn't fought by that
  frame's state-specific `desx`/`desz`, exactly like `p.reroute > 0` already does):
  ```js
  } else if(p.searchPath && p.searchPath.length){
    const [wx, wz] = p.searchPath[0];
    const wdx = wx - p.x, wdz = wz - p.z, wd = Math.hypot(wdx, wdz);
    if(wd < LOCAL_SEARCH_ARRIVE_R) p.searchPath = p.searchPath.slice(1);
    else { desx = wdx/wd; desz = wdz/wd; speed = p.spec.speed*0.7*pLakeMul; }
  }
  ```
  When the path is exhausted (`p.searchPath` becomes `[]`), this branch stops matching and
  the very next frame falls through to the predator's normal state logic (chase/hunt/
  investigate), which re-aims at the live player — now benefiting from the committed-avoid
  wrapper if it is blocked again, and re-triggering a fresh bounded search if `stuckT`
  crosses 1.0s again. A one-frame stall at zero speed the instant a waypoint is reached
  (before advancing to the next) is an accepted simplification, imperceptible at
  `LOCAL_SEARCH_ARRIVE_R`'s 1.2u radius.

- **`qaPredatorState()`** (`:4710`): add `moveRad: p.moveRad` to the returned object, next to
  the existing `rad: p.rad`.

### 3. `engine/forest-engine.d.ts`

Add `moveRad: number;` to `qaPredatorState`'s return type (`:215-230`), next to `rad: number;`.

### 4. `docs/ELEMENTS.md`

- **`:434-441`** ("Cannot physically collide with cover props... **Deliberate**, not a gap"):
  stale since LUL-1643 — `blockedForPredator()` (`lib/game/cover.ts:512`) already runs
  `coverBlockedR()` for predators. Rewrite to state predators collide with rock/reed
  (solid) and pass through log/bramble (walkable), identically to the player via
  `blockedForPredator()`/`blocked()` sharing `coverKindBlocksMovement()` — and now, post
  this ticket, at the *same* radius as the player (`moveRad = PLAYER_COLLISION_RADIUS`).
- **`:477-483`** (stuck detection, "under 35% of intended speed for >3s ... LUL-1091 shipped
  this at 0.8s but LUL-1597 reverted it"): update the threshold to 1.0s, and add a line
  noting LUL-2283's `qaSetFixedStep()` removed the wall-clock jitter that motivated the
  LUL-1597 revert, plus the new behaviour once triggered: a bounded local search
  (`lib/game/steer.ts` `findLocalPath()`) toward the live target for hunt/chase/
  investigate-approach, replacing the random ±20u waypoint for those states only (roam is
  unchanged).
- **`:487-490`** ("Movement collider: circular, radius `PSPEC[kind].rad` (0.8/1.5/1.0)..."):
  correct to: movement collision uses `moveRad = PLAYER_COLLISION_RADIUS` (0.6, same as the
  player) for all three species; `PSPEC[kind].rad` (0.8/1.5/1.0, unchanged) still governs
  catch range (`isCaught`/`canCatchInChase`), sniff margin, and predator-vs-predator
  separation.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean (`lint` script; `next lint` is removed in Next 16).
- `node --test lib/game/steer.test.ts` — new unit tests pass.
- `node --test lib/game/cover.test.ts` — unchanged, still green (verified while writing this
  SPEC: the existing `blockedForPredator(...)` unit tests already call it with a literal
  `0.6` radius, i.e. they already model `moveRad`, not a species `rad` — no edits needed
  there).
- `node --test lib/e2e-policy/world-policy.test.ts` — still passes; the new spec file boots
  micro by default and needs no `@fullmap` addition (see `## e2e`).
- `grep -n "p\.rad" engine/forest-engine.js` — confirm the only remaining hits are the ones
  named in "Everywhere else" above (catch/sniff/separation/spawn-clearance/QA-staging).
- `npx playwright test tree-pathing predator-determinism blind-chase-cover charge-dodge
  force-hunt-closes predator-memory predator-spawn-clearance` — all pass unchanged (run
  locally with `E2E_FULLMAP=1` for the `@fullmap`-tagged ones per LUL-2377; predators should,
  if anything, reach the player *faster* now that they can use gaps the player can, never
  slower — do not weaken any of these specs' timing assertions to make them pass).
- `node --test` (full unit suite) — 0 new failures vs. the baseline recorded at
  `~/.paperclip/shared/local-qa/state/e2e-baseline.json` on the day of implementation.

## e2e

**Specs.**
- `e2e/predator-steering.spec.ts` (new, micro world, no `@fullmap`) —
  - `'wolf/bear/lion each pass the same 1.4u trunk gap the player passes'` (new): proves
    decision (1) is wired end-to-end, not just correct in `steer.ts`/`cover.ts` isolation.
  - `'a predator commits around a 5-trunk wall instead of grinding into it'` (new): proves
    decisions (2)+(3) together — go-around plus the bounded search for the case a single
    heading change can't resolve.
  - `'a rock still blocks a predator exactly where it blocks the player'` (new): parity
    check at the new shared `moveRad`.
- `e2e/tree-pathing.spec.ts` (must pass unchanged, `@fullmap`, already allowlisted in
  `lib/e2e-policy/world-policy.test.ts` — do not add a new allowlist entry, this file is
  already on it) — re-run after implementing; the single-tree-behind case it covers should
  stay green (LUL-1091's near/far-probe fallback this spec exercises is unchanged) and, if
  anything, resolve faster now that all three species share the player's smaller radius.
- `e2e/predator-determinism.spec.ts`, `blind-chase-cover.spec.ts`, `charge-dodge.spec.ts`,
  `force-hunt-closes.spec.ts`, `predator-memory.spec.ts`, `predator-spawn-clearance.spec.ts`
  — must pass unchanged (regression only, no edits expected).

**World.** Micro, via `qaBuildScene`, for all three new tests in `predator-steering.spec.ts`:
- Gap test: `qaBuildScene({ trees: [{x:-1.05,z:0,s:1},{x:1.05,z:0,s:1}], predators: [{kind, x:0, z:8, state:'chase'}] })`
  for each of `kind` in `wolf`/`bear`/`lion` (one `test()` per species, same shape as
  `tree-pathing.spec.ts`'s existing loop), then `qaTeleportTo(0, -8)` for the player. Two
  trees at `s:1` give trunk radius `0.35` each; centers `2.1` apart leaves a `1.4`u edge-to-
  edge gap (`2.1 - 0.35 - 0.35`), which the player's `0.6` radius passes (`1.4 > 2*0.6`) and,
  pre-fix, the bear's `1.5` radius does not (`1.4 < 2*1.5`). Player and predator have clear
  sightlines through the gap at these coordinates (no LOS-blocking prop between them), so
  `chase` closes on live `canSee()` the whole approach — no `scentLock` staging needed.
  `qaSetFixedStep(1/30)`, then poll `qaAdvance(30)` in a loop (chunked, matching LUL-2611's
  diagnostic-on-hang pattern from `e2e/cover-feedback.spec.ts`) up to a measured `MAX_MS`,
  reading `qaPredatorState(idx)` each chunk; assert `moveRad === 0.6` (the field this SPEC
  adds) and that the predator reaches contact range (`dist < rad + 1.3`) within `MAX_MS` —
  live-measure `MAX_MS` while implementing (do not guess-and-widen; follow
  `tree-pathing.spec.ts`'s own "measured, not guessed" precedent in its file header) and set
  it to ~4x the measured value.
- Go-around test: `qaBuildScene({ trees: [{x:-3.2,z:0,s:1.3},{x:-1.6,z:0,s:1.3},{x:0,z:0,s:1.3},{x:1.6,z:0,s:1.3},{x:3.2,z:0,s:1.3}], predators: [{kind:'wolf', x:0, z:8, state:'chase'}] })`,
  player at `(0,-8)` via `qaTeleportTo`. `s:1.3` trees (radius `0.455`) spaced `1.6`u apart
  leave a `0.69`u gap — impassable for both the player and the fixed `moveRad` (needs
  `1.2`u) — forcing a real route around one end (wall half-width `3.2 + 0.455 ≈ 3.66`u).
  Assert: (a) reaches contact within a live-measured `MAX_MS`, generous margin per the same
  convention as above; (b) never reports `dist` unchanged (±`0.05`u) across two consecutive
  1s-of-game-time samples while `stuckT`-style grinding would show — i.e. assert forward
  progress, not just the terminal outcome, so a regression that "eventually times out into
  the random-waypoint fallback and gets lucky" doesn't read as a pass.
- Rock-parity test: `qaBuildScene({ props: [{kind:'rock', x:0, z:0, ry:0}], predators: [{kind:'wolf', x:0, z:-6, state:'chase'}] })`,
  player at `(0,6)`. Assert the wolf's `x`/`z` (via `qaPredatorState`) never lands inside the
  rock's AABB (same half-extents `qaBuildScene` used to place it) at any polled step, proving
  `blockedForPredator()`'s rock-solid branch is live at the new `moveRad`, not just at the
  old species `rad`.

**Hooks.**
- `window.ForestEngine.qaPredatorState(idx)` — existing (`engine/forest-engine.js:4710`),
  extended in this PR to add `moveRad`.
- `window.ForestEngine.qaBuildScene(scene)` — existing, unchanged.
- `window.ForestEngine.qaTeleportTo(x, z)` — existing, unchanged.
- `window.ForestEngine.qaSetFixedStep(dt)` / `qaAdvance(steps)` — existing, unchanged.
- No new hooks needed — every behaviour this ticket changes is already reachable through
  `qaBuildScene` + `qaPredatorState` + the fixed-step advance pair.

**Tester scenario.** Player-visible only indirectly (predators feel less "sticky" and less
prone to visibly wedging against trees) — no HUD/copy change to request a dedicated nightly
scenario for. Request file: none — the three new e2e specs above are the regression coverage;
they run every PR via CI, not just nightly.

**Not covered.** Feel/tuning of how "committed" the go-around looks, or how natural the
bounded-search path looks when animated (both visual/feel judgments, unverified until a
human plays it — flag this explicitly in the PR per the FE's `Hard boundaries`). Real-device
frame-time impact of `findLocalPath()`'s worst-case 48-node expansion (budgeted to be cheap,
but only measured against the swiftshader software-rendering rig, not a real GPU/mobile
device).

## Cues

**Visual.** None — founder constraint: "they should look the same". No mesh, material, or
animation change; `makePredator()`'s visual construction (`engine/forest-engine.js:1867-1927`)
is untouched, confirmed it never reads `rad`/`moveRad` (scales off `sz`/`len`/`h` only).
**Audio.** None new.
**Explanation.** None new — no new copy, caption, or hint.
**Reduced motion.** Not applicable — no new animation to reduce; existing predator gait/turn
animation (driven by `p.vx`/`p.vz`/`p.yaw`, unchanged) is unaffected by the collision-radius
or steering-target changes.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- No visual change to the animals (founder constraint, verified above).
- Seeded `rng` only — `findLocalPath()`/`pickCommittedAvoidDirection()` take no rng at all
  (fully deterministic); the pre-existing `rng()` call in the stuck-recovery fresh-waypoint
  fallback is untouched and only reached when `findLocalPath()` itself returns `null` or the
  predator isn't in a pursuing state.
- Catch range (`isCaught`/`canCatchInChase`, `p.rad + CATCH_MARGIN`), sniff margin, and
  `predatorSeparationPush` all keep reading `p.rad`, unchanged.
- Predators must never pass a gap the player cannot, and never be blocked by a gap the
  player passes — this is exactly what setting `moveRad = PLAYER_COLLISION_RADIUS` and
  swapping every movement-collision call site (and only those) achieves; the gap-pass e2e
  test above is the direct proof.
- Species top speed / accel unchanged (`accel = 3.6` stays as-is).

## Out of scope

- LUL-2311, LUL-2320 (already landed).
- LUL-2250 (spawn placement/streaming ring) — no shared file with this change beyond both
  touching `engine/forest-engine.js`; sequencing (before/alongside) is the CTO's call per the
  ticket, not re-litigated here.
- Catch/sniff/separation feel, species top speed, predator-vs-predator or predator-vs-child
  collision (none of these exist today and this ticket does not add them).
- Lake-avoidance for the new bounded-search waypoints (`findLocalPath()`'s output is not
  routed through `keepWaypointOffLake()`) — `docs/ELEMENTS.md`'s existing "chase priority
  over lake-avoidance" note already documents that a pursuing predator crossing open water
  mid-chase is intentional and unchanged; the bounded search only fires for pursuing states.
- Any change to `investigate`'s `sniff`/`standoff`/`back`/`leave` sub-phases' stuck handling
  — only `approach` gets the bounded search; the others are short-range and already near
  their target.
