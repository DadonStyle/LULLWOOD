// LUL-5756 (cheap slice LUL-5759): fireflies behaviorally react to a hunting
// predator closing on their cluster -- same multiplicative-composition
// pattern as the other glow-weight terms (veilDetectMul, fogTideDetectMul,
// CONFIG.FIREFLY_RAIN_DIM) rather than a bespoke branch. Per the accepted
// design (wiki game/mechanics/firefly-alarm-response, cheap-slice Q39), this
// is a single scalar computed once per frame from every cluster (not just
// the ones actually rendered this session -- mobile's
// FIREFLY_MOBILE_CLUSTER_COUNT budget slice doesn't gate this) and applied
// uniformly to every rendered mote -- no per-cluster branching.
import { wrapDist } from './wrap.ts';
import { CONFIG } from '../../engine/tuning.js';
import type { EventSite } from './eventSites.ts';

export interface AlarmPredator {
  readonly x: number;
  readonly z: number;
  readonly inert?: boolean;
  readonly kind?: string;
}

/**
 * LUL-5761 cheap slice: bear and lion alarm fireflies from their own range
 * (`CONFIG.FIREFLY_ALARM_RANGE_BEAR` / `_LION`) instead of the one flat
 * `CONFIG.FIREFLY_ALARM_RANGE` -- every other kind (e.g. wolf) keeps the
 * flat range unchanged.
 */
function alarmRangeFor(kind: string | undefined): number {
  if (kind === 'bear') return CONFIG.FIREFLY_ALARM_RANGE_BEAR;
  if (kind === 'lion') return CONFIG.FIREFLY_ALARM_RANGE_LION;
  return CONFIG.FIREFLY_ALARM_RANGE;
}

/**
 * 1.0 baseline, ramping linearly to `1 + CONFIG.FIREFLY_ALARM_BOOST` as the
 * nearest live (non-`inert`) predator closes on any one cluster from that
 * predator's own alarm range (`alarmRangeFor`) down to 0 -- the single
 * highest ramp across every predator/cluster pair wins. `player` is accepted
 * for parity with this file's neighbors (decoyScentGlowWeight,
 * scentMaskGlowWeight) but isn't part of the formula: alarm is
 * predator-to-cluster proximity only, and the existing glow-weight term
 * (`w`, forest-engine.js's mote render loop) already zeroes a mote's
 * intensity once the player is too far to see it.
 */
export function fireflyAlarmBoost(
  predators: readonly AlarmPredator[],
  clusters: readonly EventSite[],
  player: { readonly x: number; readonly z: number },
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  void player;
  let maxRamp = 0;
  for (const cluster of clusters) {
    for (const p of predators) {
      if (p.inert) continue;
      const d = wrapDist(p.x, p.z, cluster.x, cluster.z, spanX, spanZ);
      const ramp = Math.max(0, 1 - d / alarmRangeFor(p.kind));
      if (ramp > maxRamp) maxRamp = ramp;
    }
  }
  return 1 + maxRamp * CONFIG.FIREFLY_ALARM_BOOST;
}
