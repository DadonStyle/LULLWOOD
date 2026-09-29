// LUL-2389 slice (b, folds in slice c): ROOSTS registered as EventSite[] (lib/game/eventSites.ts)
// instead of a bespoke tuning.js array. `id` replaces the old cosmetic `kind: 'canopyNE'` label
// (grep confirms no code path reads it); `kind: 'roost'` is the real EventSite discriminator.
// Static list, no rng() draw -- same contract as LANDMARKS (engine/tuning.js), seeds stay
// byte-identical per seed.
import type { EventSite } from './eventSites.ts';

export interface RoostSite extends EventSite {
  readonly id: string;
}

export const ROOSTS: readonly RoostSite[] = [
  { id: 'canopyNE', kind: 'roost', x: 110,  z: 90,   radius: 20 },
  { id: 'canopyN',  kind: 'roost', x: 55,   z: 135,  radius: 20 },
  { id: 'canopyW',  kind: 'roost', x: -140, z: 15,   radius: 20 },
  { id: 'canopyS',  kind: 'roost', x: -30,  z: -140, radius: 20 },
  { id: 'canopyE',  kind: 'roost', x: 150,  z: -25,  radius: 20 },
];
