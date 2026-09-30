// LUL-5566 (cheap slice, plan LUL-5560): one fixed scent-decoy site -- leaving it
// fires hearThrowableNoise() at the site's own (x,z) for every nearby predator,
// redirecting a live chase onto the fixed point instead of the real player (the
// same noiseTarget-override mechanism the roost noise loop already uses, see
// engine/forest-engine.js's updateRoosts()). Registered as EventSite[]
// (lib/game/eventSites.ts) like ROOSTS/SCENT_MASK_SITES rather than a bespoke
// tuning.js array -- same static-list, no rng() draw contract, so seeds stay
// byte-identical per seed.
import { wrapDist } from './wrap.ts';
import type { EventSite } from './eventSites.ts';

export interface DecoyScentSite extends EventSite {
  readonly id: string;
}

export const DECOY_SCENT_SITE_RADIUS = 8;

// Position picked clear of ROOSTS (roostSites.ts), SCENT_MASK_SITES
// (scentMaskSites.ts) and CAVE (tuning.js) so the new glow mesh doesn't overlap
// any of them.
export const DECOY_SCENT_SITES: readonly DecoyScentSite[] = [
  { id: 'hollowNW', kind: 'decoyScent', x: -150, z: 140, radius: DECOY_SCENT_SITE_RADIUS },
];

/**
 * Index into `sites` of the decoy site containing (x,z), or -1 if the point is
 * outside every site. Wrap-aware, same spanX/spanZ no-op default as wrap.ts's
 * own convention (plain Euclidean distance until CONFIG.wrapEnabled is true).
 */
export function findDecoyScentSiteIndex(
  x: number, z: number,
  sites: readonly DecoyScentSite[] = DECOY_SCENT_SITES,
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
 * exactly at its radius edge. Per-site, same shape as scentMaskGlowWeight()
 * (scentMaskSites.ts).
 */
export function decoyScentGlowWeight(
  x: number, z: number, site: EventSite,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  const dist = wrapDist(x, z, site.x, site.z, spanX, spanZ);
  return Math.max(0, 1 - dist / site.radius);
}
