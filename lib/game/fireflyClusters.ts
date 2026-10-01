// LUL-5707 (cheap slice, proposal LUL-5704): fixed ambient firefly-glow clusters,
// visible only at dusk/night (engine/forest-engine.js's timeOfDay). Registered as
// EventSite[] (lib/game/eventSites.ts) like ROOSTS/SCENT_MASK_SITES/DECOY_SCENT_SITES
// rather than a bespoke tuning.js array -- same static-list, no rng() draw contract,
// so seeds stay byte-identical per seed.
import type { EventSite } from './eventSites.ts';

export interface FireflyCluster extends EventSite {
  readonly id: string;
  readonly moteCount: number;
}

// Wide ambient falloff radius, not an 8u interaction radius like the scent sites --
// fireflies should read as visible well before the player is standing in the cluster.
export const FIREFLY_CLUSTER_RADIUS = 45;

// Mobile renders only the first FIREFLY_MOBILE_CLUSTER_COUNT entries (engine/
// forest-engine.js), desktop renders all of them -- order matters.
export const FIREFLY_MOBILE_CLUSTER_COUNT = 4;

// Positions picked clear of ROOSTS (roostSites.ts), SCENT_MASK_SITES
// (scentMaskSites.ts), DECOY_SCENT_SITES (decoyScentSites.ts), CAVE and
// LANDMARKS (engine/tuning.js) so the glow doesn't overlap any of them.
export const FIREFLY_CLUSTERS: readonly FireflyCluster[] = [
  { id: 'fireflyMeadow',  kind: 'firefly', x: 0,    z: 100,  radius: FIREFLY_CLUSTER_RADIUS, moteCount: 6 },
  { id: 'fireflyBrook',   kind: 'firefly', x: 40,   z: -110, radius: FIREFLY_CLUSTER_RADIUS, moteCount: 5 },
  { id: 'fireflyHollow',  kind: 'firefly', x: -200, z: -60,  radius: FIREFLY_CLUSTER_RADIUS, moteCount: 7 },
  { id: 'fireflyRidge',   kind: 'firefly', x: 200,  z: -170, radius: FIREFLY_CLUSTER_RADIUS, moteCount: 4 },
  { id: 'fireflyThicket', kind: 'firefly', x: -170, z: 200,  radius: FIREFLY_CLUSTER_RADIUS, moteCount: 8 },
  { id: 'fireflyGlade',   kind: 'firefly', x: 180,  z: 60,   radius: FIREFLY_CLUSTER_RADIUS, moteCount: 6 },
];
