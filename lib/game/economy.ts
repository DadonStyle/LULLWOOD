// LUL-1043: Embers -- the run currency. Pure earn/spend math, no Three.js, no
// localStorage, no wall-clock reads (see wiki systems/unit-testing-standard).
// Full design: wiki game/economy/embers. This is the design's "cheap version":
// the `peril` term (8 per species that chased you, max 24) is deliberately
// excluded -- it's the one exploit surface (bait all three species) and the
// only term needing new engine tracking, and the ticket wants the experiment
// that decides whether this loop lives to contain no unsure exploitable term.
// Do not add peril back into this module without a new ticket.

import { VEIL_MAX_HOLD } from './veil.ts';

export interface RunPayout {
  depth: number;
  survival: number;
  carried: number;
  home: number;
  total: number;
}

export interface EmbersTiers {
  /** 0..DEEPER_LUNGS_MAX_TIER -- how many Deeper Lungs tiers are purchased. */
  deeperLungs: number;
}

export interface EmbersState {
  balance: number;
  tiers: EmbersTiers;
}

export function freshEmbersState(): EmbersState {
  return { balance: 0, tiers: { deeperLungs: 0 } };
}

// ---- Earn ------------------------------------------------------------

const CARRIED = 60; // win only -- the child's warmth
const HOME = 25; // win only -- the doorstep
const DEPTH_DIVISOR = 4; // "how far out you dared"
const SURVIVAL_UNIT_SECONDS = 20;
const SURVIVAL_CAP = 6; // load-bearing: stalling in a bush stops paying past 120s

export function computeDepth(maxDistFromHome: number): number {
  return Math.floor(maxDistFromHome / DEPTH_DIVISOR);
}

export function computeSurvival(survivedSeconds: number): number {
  return Math.min(SURVIVAL_CAP, Math.floor(survivedSeconds / SURVIVAL_UNIT_SECONDS));
}

export function computeWinPayout(maxDistFromHome: number, survivedSeconds: number): RunPayout {
  const depth = computeDepth(maxDistFromHome);
  const survival = computeSurvival(survivedSeconds);
  return { depth, survival, carried: CARRIED, home: HOME, total: depth + survival + CARRIED + HOME };
}

export function computeDeathPayout(maxDistFromHome: number, survivedSeconds: number): RunPayout {
  const depth = computeDepth(maxDistFromHome);
  const survival = computeSurvival(survivedSeconds);
  return { depth, survival, carried: 0, home: 0, total: depth + survival };
}

export function applyPayout(state: EmbersState, payout: RunPayout): EmbersState {
  return { ...state, balance: state.balance + payout.total };
}

// ---- Spend: Deeper Lungs, the cheap version's one sink ----------------
// Index 0 is the base (no tiers owned) -- VEIL_MAX_HOLD seconds. Each tier's
// cost is the price of buying *up to* that tier from the one below it, not
// cumulative. Derived from VEIL_MAX_HOLD to ensure engine retuning propagates
// automatically (a future change to VEIL_MAX_HOLD will not silently have no effect).
export const DEEPER_LUNGS_HOLD_SECONDS = [
  VEIL_MAX_HOLD,
  VEIL_MAX_HOLD + 1,
  VEIL_MAX_HOLD + 2,
  VEIL_MAX_HOLD + 3,
] as const;
export const DEEPER_LUNGS_COSTS = [120, 300, 600] as const;
export const DEEPER_LUNGS_MAX_TIER = DEEPER_LUNGS_COSTS.length;

export function veilMaxHoldForTier(tier: number): number {
  const idx = Math.max(0, Math.min(DEEPER_LUNGS_HOLD_SECONDS.length - 1, tier));
  return DEEPER_LUNGS_HOLD_SECONDS[idx];
}

/** Cost to go from `tier` to `tier + 1`, or null once fully upgraded. */
export function nextDeeperLungsCost(tier: number): number | null {
  return tier >= DEEPER_LUNGS_MAX_TIER ? null : DEEPER_LUNGS_COSTS[tier];
}

/** No-ops (returns `state` unchanged) if already maxed or the balance can't
 * cover the next tier -- callers don't need to pre-check affordability. */
export function purchaseDeeperLungs(state: EmbersState): EmbersState {
  const cost = nextDeeperLungsCost(state.tiers.deeperLungs);
  if (cost === null || state.balance < cost) return state;
  return { balance: state.balance - cost, tiers: { ...state.tiers, deeperLungs: state.tiers.deeperLungs + 1 } };
}
