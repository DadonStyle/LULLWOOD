// LUL-1485 (E4): shared torus-wrap coordinate math. Every distance/LOS/
// detection site in cover.ts/scent.ts/predator.ts/pack.ts and
// engine/forest-engine.js that compares two world positions goes through
// this module instead of a raw subtraction, so a single flag
// (CONFIG.wrapEnabled, see engine/tuning.js) can make the map a torus
// without touching call sites again later. See docs/specs/lul-1485-wrap.md.

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
