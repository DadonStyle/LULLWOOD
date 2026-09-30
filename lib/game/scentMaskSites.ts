// LUL-5493 (cheap slice, proposal LUL-5491): three fixed scent-masking sites --
// standing inside one gates depositScent() in the engine so the player's own
// footstep scent isn't laid down while there. Registered as EventSite[]
// (lib/game/eventSites.ts) like ROOSTS/FOG_TIDE_SITES rather than a bespoke
// tuning.js array -- same static-list, no rng() draw contract, so seeds stay
// byte-identical per seed.
import { wrapDist } from './wrap.ts';
import type { EventSite } from './eventSites.ts';

export interface ScentMaskSite extends EventSite {
  readonly id: string;
  readonly type: 'marsh' | 'pine';
}

export const SCENT_MASK_RADIUS = 8;

// Positions picked clear of ROOSTS (roostSites.ts) and FOG_TIDE_SITES
// (fogTide.ts) so the new glow meshes don't overlap either.
export const SCENT_MASK_SITES: readonly ScentMaskSite[] = [
  { id: 'marshNW', kind: 'scentMask', type: 'marsh', x: -90, z: 90,  radius: SCENT_MASK_RADIUS },
  { id: 'pineSE',  kind: 'scentMask', type: 'pine',  x: 90,  z: -90, radius: SCENT_MASK_RADIUS },
  { id: 'marshS',  kind: 'scentMask', type: 'marsh', x: 0,   z: 160, radius: SCENT_MASK_RADIUS },
];

/**
 * Index into `sites` of the nearest scent-masking site containing (x,z), or -1
 * if the point is outside every site. Wrap-aware, same spanX/spanZ no-op
 * default as wrap.ts's own convention (plain Euclidean distance until
 * CONFIG.wrapEnabled is true).
 */
export function findScentMaskSiteIndex(
  x: number, z: number,
  sites: readonly ScentMaskSite[] = SCENT_MASK_SITES,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (wrapDist(x, z, s.x, s.z, spanX, spanZ) <= s.radius) return i;
  }
  return -1;
}

/**
 * 0..1 glow weight for one site: 1 at its own center, linearly down to 0
 * exactly at its radius edge. Per-site (unlike eventSites.ts's sitesNear(),
 * which blends the strongest of several sites into one number) because each
 * glow mesh needs its own intensity, not a scene-wide blend.
 */
export function scentMaskGlowWeight(
  x: number, z: number, site: EventSite,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  const dist = wrapDist(x, z, site.x, site.z, spanX, spanZ);
  return Math.max(0, 1 - dist / site.radius);
}
