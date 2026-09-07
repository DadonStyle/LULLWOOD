# SPEC — LUL-1485 (E4): `lib/game/wrap.ts` and convert every wrap-breaking site

Tier C. Written by Founding Engineer per `specs/bigger-wrapping-world-e2-e6` (wiki),
which is the decision-level plan — **do not re-derive that page**, it is still the
source of *why*. This document is the executor-ready follow-up: confirmed current
`file:line`s (all of §5.2's citations have drifted since E2/PR #389 and E3/PR #395
landed) and exact signatures. Read against `origin/release/next` @ `70967dc`.

**Land behind a flag** (ticket's own instruction, honored below) — `CONFIG.wrapEnabled`,
default `false`. This PR changes zero observable behavior until a fast-follow ticket
flips it after a Game Tester seam-walk. Do not flip it in this PR.

## Files

1. **New** `lib/game/wrap.ts`
2. **New** `lib/game/wrap.test.ts`
3. **Edit** `engine/tuning.js` — add `wrapEnabled` to `CONFIG`
4. **Edit** `lib/game/cover.ts` — `neighbourhood`, `blockedR`, `coverBlockedR`,
   `canopyBlockedR`, `blockedForPredator`, `pickAvoidDirection`, `hasLOS`,
   `findHideSpot`, `canSee`
5. **Edit** `lib/game/scent.ts` — `isScentDetected`
6. **Edit** `lib/game/predator.ts` — `backOffPoint`, `predatorSeparationPush`
7. **Edit** `lib/game/pack.ts` — `flankTarget`
8. **Edit** `engine/forest-engine.js` — every call site listed below, plus
   `treesNear()` (delete its body, delegate to the now-exported `neighbourhood`)
9. **Edit** `lib/game/cover.test.ts`, `lib/game/scent.test.ts`, `lib/game/predator.test.ts`,
   `lib/game/pack.test.ts` — extend existing suites with a `span` case per changed function
   (see Verification)

## 1. `lib/game/wrap.ts` (new)

```ts
/** Into the canonical range [-span/2, span/2). Identity when span is not
 * finite (wrap disabled) -- the comparisons below are never true for a
 * finite v against an infinite bound, so this degrades to a no-op exactly
 * matching pre-wrap behavior; no separate branch needed at call sites. */
export function wrapCoord(v: number, span: number): number {
  let x = v;
  while (x < -span / 2) x += span;
  while (x >= span / 2) x -= span;
  return x;
}

/** Shortest signed a-b on a circle of circumference `span`. Same
 * infinite-span no-op property as wrapCoord: with span=Infinity this is
 * exactly `a - b`. */
export function wrapDelta(a: number, b: number, span: number): number {
  return wrapCoord(a - b, span);
}

export function wrapDist(
  ax: number, az: number, bx: number, bz: number,
  spanX: number, spanZ: number,
): number {
  const dx = wrapDelta(ax, bx, spanX);
  const dz = wrapDelta(az, bz, spanZ);
  return Math.hypot(dx, dz);
}

/** Wraps a spatial-hash cell index into [-cellCount/2, cellCount/2). Same
 * no-op property when cellCount is not finite (span=Infinity passed in by
 * the caller). `cellCount` must be `span / cell`; grid keys are built by
 * plain `Math.floor(coord / cell)` on already-canonical coords, so the
 * cell-index range mirrors wrapCoord's coordinate range one-for-one. */
export function wrapCellIndex(idx: number, cellCount: number): number {
  let i = idx;
  while (i < -cellCount / 2) i += cellCount;
  while (i >= cellCount / 2) i -= cellCount;
  return i;
}
```

**CI-clean per the ticket's own citation**: `scripts/check-duplicate-logic.mjs:98-110`
flags an identifier only if the engine *declares* it without importing; every call
site below imports these four by name (`import { wrapDelta, wrapCoord, wrapCellIndex }
from '@/lib/game/wrap'`), which is explicitly allowed at `:130-132`. `wrapCellIndex` is
a fourth export beyond the ticket's original three — required by finding (b) below;
flagging it here rather than silently adding it.

## 2. `engine/tuning.js`

Add one field to `CONFIG` (`:14-28` today), next to `mapSize`:

```js
export const CONFIG = {
  ...
  mapSize: 480,
  wrapEnabled: false,   // LUL-1485: seam math is live everywhere but inert until a
                         // Game Tester seam-walk flips this true (fast-follow ticket)
  ...
};
```

In `engine/forest-engine.js`, add one derived constant near the existing `const half =
CONFIG.mapSize / 2;` (`:188`) and `const zMax = half;` (`:197`):

```js
const WRAP_SPAN = CONFIG.wrapEnabled ? CONFIG.mapSize : Infinity;
```

Import `wrapCoord, wrapDelta, wrapCellIndex` from `@/lib/game/wrap` in the existing
`@/lib/game/cover` import block (`:60-68`).

**Flag mechanic, stated once so it isn't re-derived per site:** every *distance/detection*
site below just calls `wrapDelta`/`wrapDist` with `WRAP_SPAN` unconditionally — no
`if(wrapEnabled)` needed, because `WRAP_SPAN = Infinity` makes those functions no-ops by
construction (proven above). Every *hard-bound* site (world-wall clamps, waypoint
clamps, backoff/flank retreat points) is different: clamping-with-margin and wrapping
are different formulas, not the same one parameterized by span, so those sites need an
explicit `Number.isFinite(span) ? wrapCoord(...) : <existing clamp>` branch. Do not
apply the "just pass Infinity" shortcut there — it would remove the margin entirely
even with the flag off, which is a real regression, not a no-op.

## 3. `lib/game/cover.ts`

**(b)/(c) `neighbourhood` — currently unexported, `:194-204`.** Export it and add wrap:

```ts
export function neighbourhood<T>(
  grid: SpatialGrid<T>, x: number, z: number, cell: number, span: number = Infinity,
): T[] {
  const cellCount = span / cell;
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  const out: T[] = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const arr = grid.get(gridKey(wrapCellIndex(gx, cellCount), wrapCellIndex(gz, cellCount)));
      if (arr) out.push(...arr);
    }
  }
  return out;
}
```

**`blockedR` (`:211-217`)** — add `span` param, thread to `neighbourhood`, wrap the delta:

```ts
export function blockedR(
  x: number, z: number, pr: number, grid: SpatialGrid<CircleCollider>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  for (const t of neighbourhood(grid, x, z, cell, span)) {
    const dx = wrapDelta(x, t.x, span), dz = wrapDelta(z, t.z, span);
    const rr = t.cr + pr;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}
```

**`coverBlockedR` (`:311-321`) — apply the wrap BEFORE rotation**, per the ticket's own
warning (this exact rotation convention has shipped the sign bug twice; read
`systems/los-rotated-aabb-sign-bug` before touching this function if unfamiliar):

```ts
export function coverBlockedR(
  x: number, z: number, pr: number, coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  for (const c of neighbourhood(coverGrid, x, z, cell, span)) {
    if (!coverKindBlocksMovement(c.kind)) continue;
    const dx = wrapDelta(x, c.x, span), dz = wrapDelta(z, c.z, span);
    const ry = c.ry ?? 0;
    const co = Math.cos(ry), si = Math.sin(ry);
    const lx = dx * co - dz * si, lz = dx * si + dz * co;
    if (Math.abs(lx) < c.hx + pr && Math.abs(lz) < c.hz + pr) return true;
  }
  return false;
}
```

**`canopyBlockedR` (`:330-337`)** — same treatment as `blockedR`:

```ts
export function canopyBlockedR(
  x: number, z: number, grid: SpatialGrid<CircleCollider>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  for (const t of neighbourhood(grid, x, z, cell, span)) {
    const rr = t.crCanopy;
    const dx = wrapDelta(x, t.x, span), dz = wrapDelta(z, t.z, span);
    if (dx * dx + dz * dz < (rr as number) * (rr as number)) return true;
  }
  return false;
}
```

**`blockedForPredator` (`:366-375`)** — thread `span` through, no other change:

```ts
export function blockedForPredator(
  x: number, z: number, pr: number,
  grid: SpatialGrid<CircleCollider>, coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  return blockedR(x, z, pr, grid, cell, span) || coverBlockedR(x, z, pr, coverGrid, cell, span);
}
```

**`pickAvoidDirection` (`:237-275`)** — add `span: number = Infinity` as the last
parameter (after `nearLookAhead`), thread it into both `blockedForPredator` calls inside
`clearDistance` (`:255-256`). No other line changes.

**(f) `hasLOS` (`:419-442`) — the highest-risk single function in this ticket.** The
existing walk enumerates candidate grid cells along the RAW `x0,z0 -> x1,z1` segment,
then tests every candidate prop against that same raw segment rotated into the prop's
local frame. Both parts break across a seam: the raw segment is 238 units long the wrong
way instead of 2 units the right way, and it never enumerates the seam-adjacent cell at
all.

Fix: compute the true short displacement once via `wrapDelta`, walk *that* vector for
cell enumeration (wrapping each sample back into canonical grid space), and for the
per-prop geometry test, express both segment endpoints relative to the prop using
`wrapDelta` for the start point and the already-correct short displacement for the
extent — this avoids ever constructing an out-of-range "virtual" absolute coordinate:

```ts
export function hasLOS(
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  const ddx = wrapDelta(x1, x0, span), ddz = wrapDelta(z1, z0, span);
  const d = Math.hypot(ddx, ddz), steps = Math.max(1, Math.ceil(d / (cell * 0.5)));
  const cellCount = span / cell;
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const sx = wrapCoord(x0 + ddx * u, span), sz = wrapCoord(z0 + ddz * u, span);
    const cx = wrapCellIndex(Math.floor(sx / cell), cellCount);
    const cz = wrapCellIndex(Math.floor(sz / cell), cellCount);
    const k = gridKey(cx, cz);
    if (seen.has(k)) continue;
    seen.add(k);
    const arr = coverGrid.get(k);
    if (!arr) continue;
    for (const c of arr) {
      const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
      const dx0 = wrapDelta(x0, c.x, span), dz0 = wrapDelta(z0, c.z, span);
      const dx1 = dx0 + ddx, dz1 = dz0 + ddz;
      if (segRayVsAABB(dx0 * co - dz0 * si, dx0 * si + dz0 * co, dx1 * co - dz1 * si, dx1 * si + dz1 * co, 0, 0, c.hx, c.hz)) {
        return false;
      }
    }
  }
  return true;
}
```

Sanity check this algebra before implementing: `dx1,dz1` must equal `(x0+ddx)-c.x,
(z0+ddz)-c.z` expressed via wrap-safe terms. `wrapDelta(x0,c.x,span) + ddx = (x0-c.x
wrapped) + ddx`, which is what's written above — confirm this holds under test (see
Verification) rather than trusting this derivation blind, given the function's history.

**Finding beyond §5.2's enumerated list, report this on the ticket:** `findHideSpot`
(`:456-478`) has its **own, third, independent copy** of the 3×3 neighbourhood scan —
distinct from both `neighbourhood()` and the engine's `treesNear()` that §5.2 already
named. Fix: delete its inline scan and delegate to `neighbourhood()`, same pattern as
`coverBlockedR`:

```ts
export function findHideSpot(
  x: number, z: number, coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): CoverAABB | null {
  let best: CoverAABB | null = null, bestD = Infinity;
  for (const c of neighbourhood(coverGrid, x, z, cell, span)) {
    if (!HIDE_KINDS[c.kind]) continue;
    const dx = wrapDelta(x, c.x, span), dz = wrapDelta(z, c.z, span);
    const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
    const lx = dx * co - dz * si, lz = dx * si + dz * co;
    const d = distanceToCoverEdge(lx, lz, c.hx, c.hz);
    if (d < HIDE_RADIUS && d < bestD) { bestD = d; best = c; }
  }
  return best;
}
```

**`canSee` (`:519-528`)** — add `span` param, thread to its internal `hasLOS` call:

```ts
export function canSee(
  dist: number, detect: number, detectMul: number, state: DetectionState,
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>, cell: number = CELL, span: number = Infinity,
): boolean {
  if (dist >= effectiveDetect(detect, detectMul, state)) return false;
  return hasLOS(x0, z0, x1, z1, coverGrid, cell, span);
}
```

## 4. `lib/game/scent.ts`

**(d) `isScentDetected` (`:95-111`)** — add `span`, wrap the delta:

```ts
export function isScentDetected(
  point: ScentPoint, age: number, queryX: number, queryZ: number,
  windX: number, windZ: number, noseMultiplier: number,
  lifetime: number = SCENT_LIFETIME, span: number = Infinity,
): boolean {
  if (isScentExpired(age, lifetime)) return false;
  const { x: dx0, z: dz0 } = driftedScentPosition(point, age, windX, windZ);
  const dx = wrapDelta(queryX, dx0, span);
  const dz = wrapDelta(queryZ, dz0, span);
  const r = scentPickupRadius(point.radius, age, lifetime, noseMultiplier);
  return dx * dx + dz * dz < r * r;
}
```

Do not touch the linear scan in `checkScent()` (engine `:1176-1180`) — confirmed still
bounded by lifetime × deposit interval, not area, matching the ticket's own note. Do not
touch `depositScent()` (`:1170-1174`) — it stores absolute, canonical positions; nothing
to wrap at write time, only at query time.

## 5. `lib/game/predator.ts`

**`backOffPoint` (`:244-254`)** — hard-bound site, explicit branch, not the Infinity
shortcut:

```ts
export function backOffPoint(
  x: number, z: number, ux: number, uz: number, dist: number,
  half: number, zMax: number = half, span: number = Infinity,
): [number, number] {
  const rawX = x - ux * dist, rawZ = z - uz * dist;
  if (Number.isFinite(span)) return [wrapCoord(rawX, span), wrapCoord(rawZ, span)];
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  return [clamp(rawX, -half + 4, half - 4), clamp(rawZ, -half + 4, zMax - 4)];
}
```

**`predatorSeparationPush` (`:266-287`)** — add `span`, wrap the inter-predator delta:

```ts
export function predatorSeparationPush(
  x: number, z: number, rad: number,
  others: { x: number; z: number; rad: number }[],
  span: number = Infinity,
): [number, number] {
  let px = 0, pz = 0;
  for (const o of others) {
    const dx = wrapDelta(x, o.x, span), dz = wrapDelta(z, o.z, span);
    const dist = Math.hypot(dx, dz);
    const minDist = rad + o.rad;
    if (dist >= minDist) continue;
    const overlap = minDist - dist;
    const [ux, uz] = dist > 0.0001 ? [dx / dist, dz / dist] : [1, 0];
    px += ux * overlap * 0.5;
    pz += uz * overlap * 0.5;
  }
  return [px, pz];
}
```

## 6. `lib/game/pack.ts`

**`flankTarget` (`:69-88`)** — hard-bound site (explicit branch) for the final clamp,
AND its own internal distance calc needs the delta wrapped:

```ts
export function flankTarget(
  playerX: number, playerZ: number, escX: number, escZ: number, side: 1 | -1,
  wolfX: number, wolfZ: number, bounds: FlankBounds, span: number = Infinity,
): [number, number] {
  const { half, zMax } = bounds;
  const ang = FLANK_ANGLE * side;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ex = escX * ca - escZ * sa, ez = escX * sa + escZ * ca;
  const ddx = wrapDelta(playerX, wolfX, span), ddz = wrapDelta(playerZ, wolfZ, span);
  const dist = Math.hypot(ddx, ddz) * FLANK_DIST_MUL;
  const rawX = playerX + ex * dist, rawZ = playerZ + ez * dist;
  if (Number.isFinite(span)) return [wrapCoord(rawX, span), wrapCoord(rawZ, span)];
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  return [clamp(rawX, -half + 4, half - 4), clamp(rawZ, -half + 4, zMax - 4)];
}
```

## 7. `engine/forest-engine.js` call sites

All of these pass `WRAP_SPAN` (the module-level constant from §2) as the new trailing
argument, except the explicit-branch bound sites which pass it as `span` to the
already-branch-aware lib function.

- **`:1300-1301`** — engine's own `hasLOS`/`findHideSpot` wrappers:
  ```js
  function hasLOS(x0,z0,x1,z1){ return geoHasLOS(x0,z0,x1,z1,coverGrid,CELL,WRAP_SPAN); }
  function findHideSpot(x,z){ return geoFindHideSpot(x,z,coverGrid,CELL,WRAP_SPAN); }
  ```
- **`:1311`** — `canSee()`'s call into `geoCanSee`: append `,WRAP_SPAN` after `coverGrid`.
- **`:1363-1364`** — the master delta, item (a):
  ```js
  const dx = wrapDelta(player.x, p.x, WRAP_SPAN), dz = wrapDelta(player.z, p.z, WRAP_SPAN), dist = Math.hypot(dx, dz) || 0.0001;
  const ux = dx/dist, uz = dz/dist;
  ```
  (Import `wrapDelta` per §2.) This one change is what fixes `canSee()`'s `dist` arg,
  `isCaught(dist,...)` (`:1447`), `canCatchInChase(...,dist,...)` (`:1509`), the chase
  heading (`ux,uz` used at `:1448, :1500, :1510, :1628`), and predator facing (`:1628`)
  — all of them consume `dx/dz/dist/ux/uz` computed here, not raw coordinates
  themselves, so no separate change is needed at any of those lines.
- **`:1136`** — `avoidDir()`: `function avoidDir(p, dx, dz){ return pickAvoidDirection(p.x, p.z, p.rad, dx, dz, grid, coverGrid, CELL, undefined, undefined, WRAP_SPAN); }`
  (positional — `pickAvoidDirection`'s new `span` param sits after `nearLookAhead`;
  pass the two defaulted params through explicitly since JS has no keyword args).
- **`:1600`** — predator integration clamp, hard-bound, explicit branch:
  ```js
  const nx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + p.vx*dt, WRAP_SPAN) : clamp(p.x + p.vx*dt, -half+2, half-2);
  const nz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + p.vz*dt, WRAP_SPAN) : clamp(p.z + p.vz*dt, -half+2, zMax-2);
  ```
- **`:1471-1473`** (roam waypoint pick) and **`:1617-1621`** (stuck-reroute fresh
  waypoint) — same explicit-branch pattern on both `clamp(...)` calls in each block.
- **`:1549`** — `backOffPoint(p.x, p.z, ux, uz, bd, half, zMax)` → append `, WRAP_SPAN`.
- **`:1345`** — `flankTarget(player.x, player.z, escX, escZ, side, p.x, p.z, { half, zMax })`
  → append `, WRAP_SPAN`.
- **`:1693`** — `predatorSeparationPush(p.x, p.z, p.rad, others)` → append `, WRAP_SPAN`.
- **`:1695`** — the separation-push clamp, same explicit-branch pattern as `:1600`.
- **`:3433-3435`** — **the player wall**, item (e)'s "most likely to be missed" site.
  Written with inline `Math.max`/`Math.min`, not `clamp()`:
  ```js
  const step = maxSpd*dt;
  const nx = Number.isFinite(WRAP_SPAN)
    ? wrapCoord(player.x + mvx*step, WRAP_SPAN)
    : Math.max(-lim, Math.min(lim, player.x + mvx*step));
  const nz = Number.isFinite(WRAP_SPAN)
    ? wrapCoord(player.z + mvz*step, WRAP_SPAN)
    : Math.max(-lim, Math.min(zLim, player.z + mvz*step));
  ```
  (`lim`/`zLim` at `:3433` stay defined and used only in the `else` arm.)
- **`checkScent()` (`:1176-1180`)** — its inner call into `isScentDetected` (find the
  exact call inside this function; not separately numbered in the citation set above)
  gets `, WRAP_SPAN` appended after the existing `lifetime` argument.
- **`treesNear()` (`:585-592`)** — delete the body, delegate to the newly-exported
  `neighbourhood`, closing finding (b)'s "fix both copies or the bug survives in one of
  them" by removing the second copy instead of maintaining two:
  ```js
  function treesNear(x, z){ return neighbourhood(grid, x, z, CELL, WRAP_SPAN); }
  ```
  (Import `neighbourhood` in the existing `@/lib/game/cover` import block.)
- **`blocked()`, predator-facing `blockedR`/`coverBlockedR`/`canopyBlockedR`/`blockedForPredator` call sites** —
  grep `blockedR(`, `coverBlockedR(`, `canopyBlockedR(`, `blockedForPredator(` in
  `forest-engine.js` after the above edits land (their call sites were not indexed by
  §5.2 individually since they all route through `avoidDir`/`blocked`/`predatorBlocked`
  wrappers already covered above) — if any direct call site remains unlisted, append
  `, WRAP_SPAN` to it and note it in the PR body as a site found during implementation,
  per the ticket's own "treat anything not on it as a finding worth reporting."

## What must NOT change

- `CONFIG.wrapEnabled` stays `false` in this PR. Flipping it is a separate, later ticket
  gated on a Game Tester seam-walk verdict.
- Do not touch `checkScent()`'s linear-scan shape, `depositScent()`, or any bog/biome
  logic from E2 — out of scope.
- Do not "fix" `camera.far`/star-shell radius — unrelated to this ticket, already ruled
  out for E2/E3.
- `mulberry32` draw order in `generateMap()` is untouched by this ticket (no new RNG
  draws) — no `QA_PINNED_SEED` re-pin needed here, unlike E2/E3.

## Verification

- `npm test` green, including new/extended suites below.
- **`lib/game/wrap.test.ts`** (new): `wrapDelta` symmetry (`wrapDelta(a,b,s) ===
  -wrapDelta(b,a,s)`), exact values at the seam (e.g. `wrapDelta(-119,119,240) === 2`,
  not `-238`), at exactly `±span/2`, and `wrapCoord` idempotence
  (`wrapCoord(wrapCoord(v,s),s) === wrapCoord(v,s)`). Also assert the Infinity-span
  no-op property explicitly (`wrapDelta(a,b,Infinity) === a-b`) — that property is what
  the flag mechanism depends on; if it's ever violated by a future edit to `wrap.ts`,
  this test is what catches it.
- **Per-function `span` case** added to `cover.test.ts`, `scent.test.ts`,
  `predator.test.ts`, `pack.test.ts` for every function touched above: one case with
  `span=Infinity` asserting byte-identical output to the pre-change function (regression
  guard for the flag-off path), one with a finite span exercising an actual seam.
- **The backbone construction, per the ticket:** for `canSee`/`hasLOS`/`blockedR`-family
  functions, assert **seam behavior equals the equivalent interior behavior after
  translation** — place the same two-point configuration once away from any boundary and
  once straddling the seam (with `span` finite), and assert identical results. A torus is
  translation-invariant; any diff is a bug. This is the strongest test available and
  should anchor the new coverage, not be an afterthought.
- Minimum seam scenarios (can be expressed as the translation test above or standalone):
  a predator placed across the seam from the player closes distance rather than fleeing
  (`ux,uz` point the short way); a walk across the seam does not clip through a trunk
  (`blockedR`/`coverBlockedR` see the wrap-adjacent cell); scent laid on one side is
  detected from the other (`isScentDetected`); `hasLOS` across the seam agrees with the
  equivalent non-seam case.
- `npx tsc --noEmit` clean, `npm run lint` clean.
- `node scripts/check-duplicate-logic.mjs` clean (expected — every `wrap.ts` export is
  imported by name everywhere it's used).
- Playwright suite green — no re-pin needed (no RNG draw order change).
- **With the flag left `false`:** manual smoke pass confirming zero behavior change
  (this PR should be a no-op in play). Game Tester seam-walk is the gate for the
  fast-follow flip ticket, not this one.

## Fast-follow (do not do in this PR)

Open a follow-up ticket: flip `CONFIG.wrapEnabled` to `true`, get a Game Tester play
verdict focused on walking every seam and chases that cross one, and only then this
closes out E4 for real (unblocks E5/LUL-1486).
