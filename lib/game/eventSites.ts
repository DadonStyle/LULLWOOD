// LUL-1486: generic spatial-dispatch primitive for distributed events (first
// consumer: Fog Tide, see fogTide.ts). A `kind` string keeps this file
// event-agnostic -- a second event type needs no change here.
import { wrapDist } from './wrap.ts';

export interface EventSite {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly kind: string;
}

/**
 * Proximity-weighted blend, in [0,1], of every site of `kind` near (x,z).
 * 1 at a site's own center, linearly down to 0 exactly at its radius edge,
 * 0 beyond it. Multiple overlapping sites of the same kind take the
 * strongest (nearest-site) weight, not a sum -- overlap should never read
 * as a stronger event than being inside one site alone.
 * `spanX`/`spanZ` default to Infinity, matching wrap.ts's own no-op
 * convention: plain Euclidean distance until CONFIG.wrapEnabled is true.
 */
export function sitesNear(
  x: number, z: number,
  sites: readonly EventSite[],
  kind: string,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  let weight = 0;
  for (const s of sites) {
    if (s.kind !== kind || s.radius <= 0) continue;
    const dist = wrapDist(x, z, s.x, s.z, spanX, spanZ);
    const w = Math.max(0, 1 - dist / s.radius);
    if (w > weight) weight = w;
  }
  return weight;
}
