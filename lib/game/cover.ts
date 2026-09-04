// LUL-450 (resumes LUL-383b/LUL-387): geometry helpers for the hiding-
// collision bug class, lifted out of engine/forest-engine.js so they are
// unit-testable without a Three.js scene (see wiki systems/unit-testing-
// standard). This is a narrow slice of the LUL-425/wave-3 extraction scope
// (findHideSpot's edge math + generateCover's tree-clearance predicate
// only) -- hasLOS/coverBlockedR/blockedR/canopyBlockedR/effectiveDetect/
// canSee stay in the engine for now; see wiki game/lul450-status for why
// wave 3 itself wasn't picked up here.

// ---- hide-trigger edge distance (LUL-405/LUL-430) --------------------------
// findHideSpot() previously approximated a cover prop's edge as a circle of
// radius Math.max(hx, hz) -- the *longer* half-extent, applied uniformly in
// every direction. For a 7:1 log (hx up to 2.4, hz down to 0.35) this
// balloons the eligible hide-trigger region on the log's thin side to a
// ~4.6-unit-radius disc, several times the object's actual ~0.35-0.6-unit
// thickness there -- a player 4+ units off to the side, not touching or
// visually near the log, could press H and succeed.
//
// This computes the real (rotation-aware) distance from a point to the
// prop's rectangular footprint instead: 0 if the point is inside the rect,
// the straight-line distance to the nearest edge/corner otherwise.
// `lx`/`lz` are the point's coordinates in the prop's own local (unrotated)
// frame -- same world->local convention coverBlockedR()/hasLOS() already use
// (systems/los-rotated-aabb-sign-bug): the point delta rotated by
// (cos(ry), sin(ry)) applied as lx = dx*co - dz*si, lz = dx*si + dz*co.
export function distanceToCoverEdge(lx: number, lz: number, hx: number, hz: number): number {
  const dx = Math.max(Math.abs(lx) - hx, 0);
  const dz = Math.max(Math.abs(lz) - hz, 0);
  return Math.hypot(dx, dz);
}

// ---- cover-vs-tree spawn clearance (LUL-396) --------------------------------
// generateCover() placed rock/log/bramble props checking inLake()/inSpawn()/
// inBaby() only -- it never checked tree positions, so a prop could spawn
// overlapping a tree trunk's own movement-collision circle (t.cr). Worst
// case for a HIDE_KINDS prop (bramble/log): an unreachable or broken hide
// spot, since the player's own tree collision (blockedR) would keep them
// from ever standing where findHideSpot() would trigger.
//
// Circle-vs-circle overlap test against the trunk's *movement* radius, not
// the much larger, player-only canopy radius (LUL-267) -- deliberately the
// same radius blockedR() itself collides the player and predators against.
export interface TreeTrunk {
  x: number;
  z: number;
  cr: number;
}

export function overlapsTreeTrunk(x: number, z: number, propRadius: number, trees: readonly TreeTrunk[]): boolean {
  for (const t of trees) {
    const dx = x - t.x, dz = z - t.z, rr = propRadius + t.cr;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// ---- walkable-cover-vs-tree-canopy spawn clearance (LUL-384, LUL-491 review) -
// overlapsTreeTrunk() above deliberately checks only the trunk's movement
// radius (t.cr), not the wider canopy radius (t.crCanopy, LUL-267) -- fine
// for rock/bramble, which stay solid either way, so a prop spawning inside a
// canopy circle but outside the trunk circle changes nothing observable.
// LUL-384 made 'log' walkable, which breaks that assumption: canopyBlockedR()
// blocks the player unconditionally within crCanopy regardless of what's on
// the ground there, so a log whose footprint overlaps a nearby canopy circle
// (without overlapping the trunk circle -- overlapsTreeTrunk alone would miss
// this) invites the player to walk across it and then wedges them at the
// invisible canopy edge mid-crossing. Found by LUL-491's re-review via direct
// blocked()-sampling across a log's full span in
// e2e/lul211-founder-report.spec.ts. generateCover() only calls this for
// walkable kinds (coverKindBlocksPlayerMovement() false); rock/bramble/reed
// keep the cheaper trunk-only check, unchanged.
export interface TreeCanopy {
  x: number;
  z: number;
  crCanopy: number;
}

export function overlapsTreeCanopy(x: number, z: number, propRadius: number, trees: readonly TreeCanopy[]): boolean {
  for (const t of trees) {
    const dx = x - t.x, dz = z - t.z, rr = propRadius + t.crCanopy;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// ---- which cover kinds block the player's own movement (LUL-384) -----------
// coverBlockedR() below already skipped 'tree' (its circle-grid collision via
// blockedR()/grid is separate, so re-blocking it here would be a double
// check, not new behaviour). This adds 'log' to that same skip list: a
// fallen log is the one cover prop a person would naturally step/run over
// rather than route around, and predators already ignore all cover-prop
// collision entirely (LUL-119/LUL-211's "predators pass through" rule) --
// making the player consistent with that for logs specifically, not for
// rock/bramble/reed, which stay solid. LOS blocking (hasLOS()) and hide-spot
// eligibility (findHideSpot()/HIDE_KINDS) both read coverGrid independently
// of this function and are unchanged: a log is still sight-cover and still a
// valid hiding spot, it just no longer stops you from walking or running
// across it to get there.
export function coverKindBlocksPlayerMovement(kind: string): boolean {
  return kind !== 'tree' && kind !== 'log';
}

// ============================================================================
// LUL-425 (wave 3 of LUL-277): cover/LOS geometry + hiding, lifted out of
// init()'s closure in engine/forest-engine.js. This is the highest-value
// wave on measured bug history -- the same rotated-AABB sign bug shipped
// twice in two different functions that share one rotation convention
// (systems/los-rotated-aabb-sign-bug, LUL-91 and LUL-268) because neither
// was callable from a test. Everything below is a straight lift: the engine
// still owns `grid`/`coverGrid`/`hidden`/`hideTime`/`lightDimmed` and passes
// them in at the call site: see the thin same-name wrappers left in
// forest-engine.js (`hasLOS`, `blockedR`, `blocked`, `findHideSpot`), which
// just inject that closure state and otherwise change nothing about any call
// site. Refactor, not retune -- the existing Playwright suite is unchanged
// and is the proof.
//
// Scoped out on purpose: mesh construction, layoutCoverMeshes(), and
// generateCover()'s InstancedMesh writes all stay in the engine (Three.js
// only). generateCover()'s inLake/inSpawn/inBaby rejection also stays put --
// those predicates read live map state (CONFIG.lake, the baby's rolled
// position) that isn't cover/LOS geometry. rollCoverPropShape() below lifts
// the one piece of that loop's math that is pure: the roll -> kind/hx/hz/y
// assignment.
//
// effectiveDetect()/canSee() below are exported, unit-tested, and (as of
// LUL-641) imported by forest-engine.js -- this is the one shipped copy.
// They take the sight multiplier as a plain `detectMul` value rather than a
// `lightDimmed` boolean specifically so a caller can compose more than one
// multiplier into it; the engine passes DIFFICULTY_PRESETS[difficulty]
// .detectMul * veilDetectMul(veilAmount) (lib/game/veil.ts), the continuous
// mist-veil ramp that superseded LUL-291's flat dimming cut.

export type RNG = () => number;

// A spatial hash keyed by `${cellX},${cellZ}` at cell size `CELL` -- both
// `grid` (tree/landmark movement circles) and `coverGrid` (cover-prop AABBs)
// use this exact shape and bucketing convention in the engine.
export type SpatialGrid<T> = Map<string, T[]>;

// Same cell size the engine's own `CELL` constant used before this
// extraction (engine/forest-engine.js). Exported so both the grid builders
// (still in the engine) and every query function below key cells
// identically -- a mismatch here would silently make every 3x3-neighbourhood
// scan below miss cells that actually have content.
export const CELL = 8;

export function gridKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

// Trees, bog trees and landmarks all live in one `grid` for movement
// collision (blockedR/canopyBlockedR). `crCanopy` is optional because
// landmark entries don't carry one (LUL-374) -- canopyBlockedR must keep
// silently never-blocking on those the same way the original code did
// (comparing against `undefined` produces `NaN < …`, always false), not an
// explicit "skip if missing" branch, since that's the exact behaviour the
// existing map relies on.
export interface CircleCollider {
  x: number;
  z: number;
  cr: number;
  crCanopy?: number;
}

// LOS/movement-blocking AABBs: tagged trees (kind: 'tree', no `ry`, treated
// as axis-aligned) plus the four dedicated cover-prop kinds (log/rock/
// bramble/reed), which do carry `ry`. See the kind==='tree' asymmetry note
// on hasLOS()/coverBlockedR() below -- it is deliberate, not an oversight.
export interface CoverAABB {
  x: number;
  z: number;
  hx: number;
  hz: number;
  kind: string;
  ry?: number;
}

function neighbourhood<T>(grid: SpatialGrid<T>, x: number, z: number, cell: number): T[] {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  const out: T[] = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const arr = grid.get(gridKey(gx, gz));
      if (arr) out.push(...arr);
    }
  }
  return out;
}

// ---- tree/landmark circle collision -----------------------------------------
// `blockedR` on `main`: predators call this directly (not through `blocked`)
// for their own movement, so its shape (circle vs. circle, `pr` the moving
// body's own radius) is load-bearing for predator steering, not just player
// movement.
export function blockedR(x: number, z: number, pr: number, grid: SpatialGrid<CircleCollider>, cell: number = CELL): boolean {
  for (const t of neighbourhood(grid, x, z, cell)) {
    const dx = x - t.x, dz = z - t.z, rr = t.cr + pr;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// ---- LUL-593 (wave 4 of LUL-277): predator obstacle-avoidance steering -----
// `avoidDir()` on main: every predator's per-frame movement fallback when its
// desired heading (desx/desz, whatever roam/chase/investigate/flank picked)
// would walk it straight into a blocked() circle. Lives here, not in a new
// module, because it is nothing but another blockedR() caller against the
// same SpatialGrid<CircleCollider> this file already owns -- no separate
// grid abstraction needed. Tries the raw heading first, then eight fallback
// angles (order matters: nearest deflection first, so a predator prefers the
// smallest course correction that actually clears the obstacle).
//
// LUL-1091 changed the two ends of this. Each candidate is now probed at TWO
// distances (near and far) because a single far probe steps clean over a trunk
// that is closer than the probe band and reports the heading clear. And when
// every angle is blocked it returns the LEAST-blocked candidate, never the
// original heading -- returning the known-bad heading (the old behaviour,
// inherited from main) is a guaranteed wedge inside a tree cluster.
const AVOID_ANGLES: readonly number[] = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2];

export function pickAvoidDirection(
  x: number,
  z: number,
  rad: number,
  dx: number,
  dz: number,
  grid: SpatialGrid<CircleCollider>,
  cell: number = CELL,
  lookAhead: number = 2.4,
  nearLookAhead: number = 0.8,
): [number, number] {
  const near = rad + nearLookAhead;
  const far = rad + lookAhead;
  // LUL-1091: a single far-only probe lands past obstacles nearer than `near`,
  // so both distances must be sampled -- a direction only counts as clear if
  // neither probe hits.
  const clearDistance = (rx: number, rz: number): number => {
    if (blockedR(x + rx * near, z + rz * near, rad, grid, cell)) return 0;
    if (blockedR(x + rx * far, z + rz * far, rad, grid, cell)) return near;
    return far;
  };

  if (clearDistance(dx, dz) === far) return [dx, dz];

  // Every AVOID_ANGLES candidate is tried; the least-blocked one (greatest
  // clear distance) wins so a fully-boxed-in predator never falls back to the
  // heading already known to be blocked.
  let bestDir: [number, number] = [dx, dz];
  let bestDist = -1;
  for (const ang of AVOID_ANGLES) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    const dist = clearDistance(rx, rz);
    if (dist === far) return [rx, rz];
    if (dist > bestDist) { bestDist = dist; bestDir = [rx, rz]; }
  }
  return bestDir;
}

// LUL-1091(d): axis-separated collision damped the blocked axis to 0.2x and
// left the free axis untouched -- for a head-on approach (no velocity on the
// free axis to begin with) that kills nearly all speed instead of sliding
// around the obstacle. Projecting the full speed onto the free axis keeps a
// predator moving at approach speed, redirected along the wall.
export function slideVelocity(vx: number, vz: number, blockedX: boolean, blockedZ: boolean): [number, number] {
  if (blockedX && blockedZ) return [0, 0];
  if (blockedX) {
    const sign = vz !== 0 ? Math.sign(vz) : 1;
    return [0, sign * Math.hypot(vx, vz)];
  }
  if (blockedZ) {
    const sign = vx !== 0 ? Math.sign(vx) : 1;
    return [sign * Math.hypot(vx, vz), 0];
  }
  return [vx, vz];
}

// ---- cover-prop rotated-AABB collision (LUL-211, LUL-268) -------------------
// World->local rotation convention, shared with hasLOS() below and with
// distanceToCoverEdge()'s callers: localX = dx*cos(ry) - dz*sin(ry),
// localZ = dx*sin(ry) + dz*cos(ry) -- the *inverse* of Three's Y-rotation
// matrix (systems/los-rotated-aabb-sign-bug; LUL-268 shipped the same sign
// bug again in this exact function months after LUL-91 fixed it in hasLOS()).
//
// `kind === 'tree'` is always skipped (its own circle-grid collision via
// blockedR() above already handles it); LUL-384 additionally skips 'log' via
// coverKindBlocksPlayerMovement() -- a fallen log is the one cover prop a
// person would naturally step/run over rather than route around, and
// predators already ignore all cover-prop collision (LUL-119/LUL-211). LOS
// (hasLOS() below, which does NOT skip either kind) and hide-spot
// eligibility (findHideSpot()/HIDE_KINDS) both read coverGrid independently
// of this function and are unchanged by either skip.
export function coverBlockedR(x: number, z: number, pr: number, coverGrid: SpatialGrid<CoverAABB>, cell: number = CELL): boolean {
  for (const c of neighbourhood(coverGrid, x, z, cell)) {
    if (!coverKindBlocksPlayerMovement(c.kind)) continue;
    const dx = x - c.x, dz = z - c.z;
    const ry = c.ry ?? 0;
    const co = Math.cos(ry), si = Math.sin(ry);
    const lx = dx * co - dz * si, lz = dx * si + dz * co;
    if (Math.abs(lx) < c.hx + pr && Math.abs(lz) < c.hz + pr) return true;
  }
  return false;
}

// ---- tree canopy collision (LUL-267) -----------------------------------------
// Wider than the trunk's own movement radius (t.cr) so the camera can't end
// up inside the foliage mesh -- see canopyRadiusAtEye() below for how
// `crCanopy` is derived. Deliberately its own function (not folded into
// blockedR) for the same predators-call-blockedR-directly reason
// coverBlockedR documents: this only ever affects the player's own movement
// block via blocked(), so predator pathing near trees is unchanged.
export function canopyBlockedR(x: number, z: number, grid: SpatialGrid<CircleCollider>, cell: number = CELL): boolean {
  for (const t of neighbourhood(grid, x, z, cell)) {
    const rr = t.crCanopy;
    const dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz < (rr as number) * (rr as number)) return true;
  }
  return false;
}

// Matches `blocked()`'s hardcoded `pr` on `main` -- the player's own
// movement-collision radius, reused for both the tree-circle and
// cover-AABB checks.
export const PLAYER_COLLISION_RADIUS = 0.6;

// ---- composite player movement block ----------------------------------------
export function blocked(
  x: number,
  z: number,
  grid: SpatialGrid<CircleCollider>,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
): boolean {
  return (
    blockedR(x, z, PLAYER_COLLISION_RADIUS, grid, cell) ||
    coverBlockedR(x, z, PLAYER_COLLISION_RADIUS, coverGrid, cell) ||
    canopyBlockedR(x, z, grid, cell)
  );
}

// ---- segment vs. axis-aligned box (slab test) --------------------------------
// Already pure on `main` -- lifted as-is. `(cx,cz,hx,hz)` is the box in
// whatever frame the caller already rotated the segment into (see hasLOS()
// below, which rotates into the box's own local frame before calling this).
export function segRayVsAABB(
  x0: number, z0: number, x1: number, z1: number,
  cx: number, cz: number, hx: number, hz: number,
): boolean {
  const minX = cx - hx, maxX = cx + hx, minZ = cz - hz, maxZ = cz + hz;
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < minX || x0 > maxX) return false;
  } else {
    let t0 = (minX - x0) / dx, t1 = (maxX - x0) / dx;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < minZ || z0 > maxZ) return false;
  } else {
    let t0 = (minZ - z0) / dz, t1 = (maxZ - z0) / dz;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  return true;
}

// ---- line of sight (LUL-91 / systems/los-rotated-aabb-sign-bug) -------------
// Walks the x0,z0 -> x1,z1 segment in half-cell steps and only tests cover
// registered in the cells it actually passes through -- never all cover,
// never all 1,300 trees. `kind === 'tree'` is deliberately NOT skipped here
// (unlike coverBlockedR above): a tagged tree still blocks sight, it just
// was never made a movement collider by this extraction's sibling function.
// Untagged trees (`t.s <= 1.4`, see generateCover() in the engine) never
// entered `coverData` at all, so they never reach this function regardless.
// Sight-only: mist veil (LUL-382) shrinks the *detect range* the engine's
// own effectiveDetect()/canSee() compare against, it does not touch LOS
// itself, so this function needing no veil awareness is intentional, not a
// gap.
export function hasLOS(
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(d / (cell * 0.5)));
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const cx = Math.floor((x0 + (x1 - x0) * u) / cell), cz = Math.floor((z0 + (z1 - z0) * u) / cell);
    const k = gridKey(cx, cz);
    if (seen.has(k)) continue;
    seen.add(k);
    const arr = coverGrid.get(k);
    if (!arr) continue;
    for (const c of arr) {
      const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
      const dx0 = x0 - c.x, dz0 = z0 - c.z, dx1 = x1 - c.x, dz1 = z1 - c.z;
      if (segRayVsAABB(dx0 * co - dz0 * si, dx0 * si + dz0 * co, dx1 * co - dz1 * si, dx1 * si + dz1 * co, 0, 0, c.hx, c.hz)) {
        return false;
      }
    }
  }
  return true;
}

// ---- hiding spots (LUL-212, LUL-405/LUL-430) ---------------------------------
// A dedicated hide stance (KeyH) only works standing at one of these two
// prop kinds -- not any LOS-blocking cover. Reuses the same coverGrid spatial
// hash blockedR()/hasLOS() walk, no second data structure. Returns the
// nearest qualifying prop within `hideRadius` of its own rotation-aware
// rectangular edge (distanceToCoverEdge, above), or null. Tie-break: on an
// exact distance tie the first-encountered candidate wins (`d < bestD` is
// strict) -- whatever `main` already does, pinned by a test below.
export const HIDE_KINDS: Readonly<Record<string, boolean>> = { bramble: true, log: true };
export const HIDE_RADIUS = 2.2;

export function findHideSpot(
  x: number, z: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
): CoverAABB | null {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let best: CoverAABB | null = null, bestD = Infinity;
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const arr = coverGrid.get(gridKey(gx, gz));
      if (!arr) continue;
      for (const c of arr) {
        if (!HIDE_KINDS[c.kind]) continue;
        const dx = x - c.x, dz = z - c.z;
        const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
        const lx = dx * co - dz * si, lz = dx * si + dz * co;
        const d = distanceToCoverEdge(lx, lz, c.hx, c.hz);
        if (d < HIDE_RADIUS && d < bestD) { bestD = d; best = c; }
      }
    }
  }
  return best;
}

// ---- sight detection range (LUL-43, LUL-291, LUL-382, LUL-641) ---------------
// Detection range shrinks the longer the player has held still (never to
// zero -- standing still in the open next to a predator still gets you
// caught). Split out of canSee() (below) so the LUL-144 cover-feedback scan
// can test "in range" separately from "has line of sight" for every
// predator, not just stop at the first one that can see the player.
//
// `detectMul` is the caller's sight multiplier as a plain value, not a
// boolean flag -- LUL-641 collapsed the engine's own copy of this pair back
// into this one. The engine passes DIFFICULTY_PRESETS[difficulty].detectMul
// * veilDetectMul(veilAmount) (lib/game/veil.ts): a continuous mist-veil
// ramp, not the old binary LUL-291 dimming cut, which is why this no longer
// takes a `lightDimmed` boolean -- the caller composes whatever multipliers
// apply and hands over the single product.
export const STILL_RAMP = 1.2;        // seconds of continuous hold-still to reach full stillness
export const STILL_DETECT_CUT = 0.82; // max fraction stillness can shrink detect range by
export const CARRY_DETECT_MUL = 1.35; // Priced by Game Economist (LUL-1311): return-leg win rate
                                       // moves 0.850 -> 0.795, inside the 0.75-0.90 bracket the
                                       // tier multipliers (LUL-1043) were solved over -- 1.5 is the
                                       // ceiling before those need re-deriving. See wiki
                                       // game/economy/carry-leg-detection-price.

export interface DetectionState {
  hidden: boolean;
  hideTime: number;
  carrying?: boolean;
}

export function effectiveDetect(detect: number, detectMul: number, state: DetectionState): number {
  const stillness = state.hidden ? Math.min(1, state.hideTime / STILL_RAMP) : 0;
  const carryMul = state.carrying ? CARRY_DETECT_MUL : 1;
  return detect * (1 - stillness * STILL_DETECT_CUT) * detectMul * carryMul;
}

// ---- can a predator see the player? ------------------------------------------
// Thin composition of effectiveDetect() + hasLOS(), lifted verbatim.
export function canSee(
  dist: number,
  detect: number,
  detectMul: number,
  state: DetectionState,
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL,
): boolean {
  if (dist >= effectiveDetect(detect, detectMul, state)) return false;
  return hasLOS(x0, z0, x1, z1, coverGrid, cell);
}

// ---- tree canopy radius at eye height (LUL-267) ------------------------------
// A cone tapers, so the true cross-section the camera can hit at a fixed eye
// height is narrower than the cone's base almost everywhere along its
// height. Derives the exact per-tree value from the (scaled) cone geometry
// instead of one fixed coefficient for every tree size -- see the engine's
// own comment on this function's call sites for the tuning history
// (LUL-266/LUL-267). `geo` stays engine-supplied (Three.js geometry
// constants) rather than duplicated here, so this can never silently drift
// from the mesh it's describing.
export interface CanopyGeometry {
  canopyR: number;
  cone1Height: number;
  apexY: number;
}

export function canopyRadiusAtEye(s: number, eye: number, geo: CanopyGeometry): number {
  return Math.max(0, (geo.canopyR / geo.cone1Height) * (geo.apexY * s - eye));
}

// ---- cover-prop shape roll (LUL-43) ------------------------------------------
// The one pure slice of generateCover()'s placement loop: given the already-
// rolled `roll` value and the shared seeded `rng`, decide the prop's kind and
// rotation-local half-extents. Preserves the exact rng() draw order and
// count per branch -- generateCover() appends to a seeded stream that must
// stay byte-identical for a given seed, so this must never reorder or add
// draws relative to `main`. The inLake/inSpawn/inBaby rejection and the
// InstancedMesh writes stay in the engine (see the module comment above).
export interface CoverPropShape {
  kind: 'log' | 'rock' | 'bramble';
  hx: number;
  hz: number;
  y: number;
}

export function rollCoverPropShape(roll: number, rng: RNG): CoverPropShape {
  if (roll < 0.4) {
    const long = 1.3 + rng() * 1.1, thin = 0.35 + rng() * 0.25;
    return rng() < 0.5 ? { kind: 'log', hx: long, hz: thin, y: 0.3 } : { kind: 'log', hx: thin, hz: long, y: 0.3 };
  } else if (roll < 0.75) {
    const r = 0.9 + rng() * 0.9;
    return { kind: 'rock', hx: r, hz: r * (0.7 + rng() * 0.5), y: r * 0.55 };
  } else {
    const r = 0.8 + rng() * 0.7;
    return { kind: 'bramble', hx: r, hz: r, y: r * 0.6 };
  }
}
