// LUL-5744 (cheap slice, decision decisions/lul-5742-firefly-glow-detection-
// accepted-2026-10-02): standing inside a firefly cluster's glow makes the
// player easier to spot -- same proximity-weighted-max falloff eventSites.ts's
// sitesNear() already proves for Fog Tide (fogTide.ts), reused here rather
// than a new curve (it's the same shape decoyScentGlowWeight() uses per-site,
// generalized to "brightest of several same-kind sites"). Pure functions, no
// CONFIG/tuning.js import -- the engine passes its own live cluster list
// (time-gated, unscaled-on-desktop/scaled-on-micro) and bonus constant in,
// same "caller owns CONFIG, these files own math" shape as
// veilDetectMul()/fogTideDetectMul() (veil.ts/fogTide.ts).
import { sitesNear, type EventSite } from './eventSites.ts';

const FIREFLY_SITE_KIND = 'firefly';

/** 0..1 glow weight at (x,z) from the brightest nearby cluster (sitesNear's
 * own max-not-sum rule -- see its own doc comment). */
export function fireflyGlowWeightAt(
  x: number, z: number,
  clusters: readonly EventSite[],
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  return sitesNear(x, z, clusters, FIREFLY_SITE_KIND, spanX, spanZ);
}

/** `bonus` is CONFIG.FIREFLY_GLOW_DETECT_BONUS (engine/tuning.js) -- a tuning
 * number named by the Game Economist (LUL-5744), not derived here. At w=0
 * (outside every cluster) this is a no-op (returns 1). */
export function fireflyGlowDetectMul(
  x: number, z: number,
  clusters: readonly EventSite[],
  bonus: number,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  return 1 + fireflyGlowWeightAt(x, z, clusters, spanX, spanZ) * bonus;
}
