import type { SpatialGrid, CircleCollider, CoverAABB } from './cover.ts';
import { pickAvoidDirection, blockedForPredator, CELL } from './cover.ts';

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
  const frontier: [number, number][] = [[sx, sz]];
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
