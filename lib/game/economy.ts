// LUL-1043: Embers -- the run currency. Pure earn/spend math, no Three.js, no
// localStorage, no wall-clock reads (see wiki systems/unit-testing-standard).
// Full design: wiki game/economy/embers. This is the design's "cheap version":
// the `peril` term (8 per species that chased you, max 24) is deliberately
// excluded -- it's the one exploit surface (bait all three species) and the
// only term needing new engine tracking, and the ticket wants the experiment
// that decides whether this loop lives to contain no unsure exploitable term.
// Do not add peril back into this module without a new ticket.

import { VEIL_MAX_HOLD } from './veil.ts';
import { SCENT_LIFETIME } from './scent.ts';
import type { MissionKind } from './mission.ts';

// CEO ruling 2026-09-03: corrected table (wiki game/economy/tier-reward-multipliers §11).
// Each pair is { win, loss } — win scales computeWinPayout total, loss scales
// computeDeathPayout total. Do not adjust without re-running the farm guards in the wiki;
// blackout's loss 1.25 is the bracket-floor ceiling and night's 1.35 protects the band-top
// farmer at pL=0.75 — both were corrected twice from the original spec filing.
export type DifficultyTier = 'lantern' | 'night' | 'blackout';

const TIER_MULTIPLIERS: Record<DifficultyTier, { win: number; loss: number }> = {
  lantern:  { win: 1.00, loss: 1.00 },
  night:    { win: 1.75, loss: 1.35 },
  blackout: { win: 2.00, loss: 1.25 },
};

export interface RunPayout {
  depth: number;
  survival: number;
  carried: number;
  rescue: number;
  spent: number;
  total: number;
}

/** Keyed by SHOP_CATALOG id. Absent key === tier 0 (not purchased) — freshEmbersState()
 * starts empty rather than pre-filling every known id, so a new catalog entry needs no
 * migration of existing saves. Always read through tierOf(), never index directly --
 * an absent key is `undefined` at runtime even though the Record type says `number`
 * (no noUncheckedIndexedAccess in tsconfig.json). */
export type EmbersTiers = Record<string, number>;

export interface EmbersState {
  balance: number;
  tiers: EmbersTiers;
}

export function freshEmbersState(): EmbersState {
  return { balance: 0, tiers: {} };
}

// ---- Earn ------------------------------------------------------------

export const CARRIED = 120; // win only -- the child's warmth
export const RESCUE = 50; // win only -- successful extraction at the pickup cinematic (LUL-2295)
const DEPTH_DIVISOR = 4; // "how far out you dared"
const SURVIVAL_UNIT_SECONDS = 20;
const SURVIVAL_CAP = 6; // load-bearing: stalling in a bush stops paying past 120s

export function computeDepth(maxDistFromHome: number): number {
  return Math.floor(maxDistFromHome / DEPTH_DIVISOR);
}

export function computeSurvival(survivedSeconds: number): number {
  return Math.min(SURVIVAL_CAP, Math.floor(survivedSeconds / SURVIVAL_UNIT_SECONDS));
}

// LUL-1258: M2 Deepwater's completion bonus. Win-only, like CARRIED/RESCUE --
// forfeited on death, same as the rest of the "reached it but didn't make it
// home" case. The detour's real payout is `depth` (uncapped on win, capped on
// death already); this is a flat bonus on top, priced deliberately low per
// game/economy/mission-rewards §2 ("the greed comes from the depth").
export const MISSION_FIREPOWER_REWARD = 8;

// LUL-3010: oakHollow's completion bonus -- priced below MISSION_FIREPOWER_REWARD (8) since
// the detour itself is far cheaper (≈22m vs ≈106m round trip, no timer risk). Half, same
// "greed comes from depth, not the flat bonus" pricing rule as the original.
export const MISSION_OAKHOLLOW_REWARD = 6;

// LUL-4958: Slack Water -- +10 Embers, the smallest reward in the full M1-M5 mission set
// (M4 Ghost 18, M2 Deepwater 12, M5 Cold Walk 22, M3 Slack Water 10 -- wiki
// game/economy/mission-rewards:135-139). Deliberate floor price: this is the only mission
// that pays the player to stand still, which SURVIVAL_CAP is designed to discourage: "it
// pays once, for one 20-second window, and waiting past 120s still earns nothing" -- not an
// exploit, but priced at the floor as a watch-item per that doc.
export const MISSION_SLACKWATER_REWARD = 10;

export const MISSION_REWARDS: Record<MissionKind, number> = {
  deepwater: MISSION_FIREPOWER_REWARD,
  oakHollow: MISSION_OAKHOLLOW_REWARD,
  slackWater: MISSION_SLACKWATER_REWARD,
};

// LUL-1666: secondary-objective bonuses for deepwater, additive on top of
// MISSION_FIREPOWER_REWARD (never a replacement) -- CEO-accepted reward
// schedule, decisions/secondary-objectives-accepted-2026-09-06. M1/M4/M5 rows
// from the same table are deferred until those missions ship (CTO scope
// ruling, decisions/lul-1666-scope-deepwater-only-2026-09-06) -- do not add
// them here without a MISSION_POOL entry to key them off.
export const FIREPOWER_RETRIEVAL_BONUS = 8;
export const FIREPOWER_SPEEDRUN_BONUS = 10;

// LUL-1210: Stone Marker veil-charm, priced against Deeper Lungs I (120) so it reads as
// worse value than saving -- game/economy/veil-charm-price. 125-unit landmark distance ->
// depth >= 31 at the point of purchase by geometry, 16-point margin.
export const VEIL_CHARM_PRICE = 15;

// LUL-1640 forward-fix (LUL-1412): every RunPayout field is scaled and rounded
// individually, and `total` is the sum of those already-rounded fields --
// never an independent round of the raw sum. This guarantees
// depth+survival+carried+home===total by construction (the invariant
// components/Hud.tsx's RunRecap renders), instead of only holding at ×1.00.
// missionBonus and secondaryBonus have no RunPayout field of their own
// (LUL-1258/LUL-1666, unchanged here) and are folded straight into total,
// scaled the same as everything else.
export function computeWinPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  tier: DifficultyTier = 'lantern',
  missionBonus = 0,
  secondaryBonus = 0,
): RunPayout {
  const mult = TIER_MULTIPLIERS[tier].win;
  const cappedDepth = Math.min(computeDepth(maxDistFromHome), 62); // caps blackout's 2.0x win multiplier at 476E (post-LUL-1806 CARRIED/RESCUE); inert for lantern/night, whose max depth is 48
  const depth = Math.round(cappedDepth * mult);
  const survival = Math.round(computeSurvival(survivedSeconds) * mult);
  const carried = Math.round(CARRIED * mult);
  const rescue = Math.round(RESCUE * mult);
  const total = depth + survival + carried + rescue + Math.round(missionBonus * mult) + Math.round(secondaryBonus * mult);
  return { depth, survival, carried, rescue, spent: 0, total };
}

export function computeDeathPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  objectiveDistFromHome: number,
  tier: DifficultyTier = 'lantern',
): RunPayout {
  const mult = TIER_MULTIPLIERS[tier].loss;
  const cappedDepth = Math.min(computeDepth(maxDistFromHome), computeDepth(objectiveDistFromHome));
  const depth = Math.round(cappedDepth * mult);
  const survival = Math.round(computeSurvival(survivedSeconds) * mult);
  const total = depth + survival;
  return { depth, survival, carried: 0, rescue: 0, spent: 0, total };
}

export function applyPayout(state: EmbersState, payout: RunPayout): EmbersState {
  return { ...state, balance: state.balance + payout.total };
}

/** Deducts an in-run unbanked spend (e.g. the Stone Marker charm) from a computed payout,
 * clamped so `total` never goes negative. Does not touch depth/survival/carried/rescue --
 * `spent` is a separate, honestly-labeled line item, not folded into the other four (which
 * LUL-1640/LUL-1412 made sum to `total` by construction before any spend is applied). LUL-1210. */
export function applySpend(payout: RunPayout, spentAmount: number): RunPayout {
  const spent = Math.max(0, Math.min(spentAmount, payout.total));
  return { ...payout, spent, total: payout.total - spent };
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

// ---- Spend: Quiet Step -- scent decays faster per tier ----------------
// 20% faster decay per tier, compounding (tier2 decays 20% faster than tier1, which is
// already 20% faster than base) -- same "derive from the base constant" discipline as
// DEEPER_LUNGS_HOLD_SECONDS above, so a future SCENT_LIFETIME retune propagates here too.
export const QUIET_STEP_LIFETIME_SECONDS = [
  SCENT_LIFETIME,
  SCENT_LIFETIME * 0.8,
  SCENT_LIFETIME * 0.8 * 0.8,
] as const;
export const QUIET_STEP_COSTS = [80, 150] as const;
export const QUIET_STEP_MAX_TIER = QUIET_STEP_COSTS.length;

export function effectiveScentLifetime(tier: number): number {
  const idx = Math.max(0, Math.min(QUIET_STEP_LIFETIME_SECONDS.length - 1, tier));
  return QUIET_STEP_LIFETIME_SECONDS[idx];
}

// ---- Spend: Pocket Stones -- +2 free throwables per run ----------------
// Single tier. Effect wiring lives in engine/forest-engine.js (enter()) -- this module
// only owns the price and the reserve size, same split as VEIL_CHARM_PRICE above.
// POCKET_STONES_COSTS' only load-bearing property is its .length (used for the max-tier
// gate in nextCost/purchase/setEmbers's clamp) -- it must stay length 1, a single-tier
// item. The actual difficulty-scaled price lives in POCKET_STONES_COST_BY_DIFFICULTY
// below; the array's value itself is an unused placeholder (LUL-2983).
export const POCKET_STONES_COSTS = [80] as const;
export const POCKET_STONES_RESERVE = 2;
export const POCKET_STONES_COST_BY_DIFFICULTY: Record<DifficultyTier, number> = {
  lantern: 80,
  night: 120,
  blackout: 140,
};

// ---- Shop catalog -------------------------------------------------------
// Single source of truth for what's for sale, driving both EmbersShop's render
// (components/Hud.tsx) and setEmbers()'s clamp (engine/forest-engine.js). Adding a
// fourth item means adding one entry here -- no new action, no new EmbersShop markup.
export type ShopItemKind = 'permanent' | 'consumable';
export interface ShopItem {
  id: string;
  label: string;
  kind: ShopItemKind;
  costs: readonly number[]; // costs[tier] = price to go from tier -> tier+1
}
export const SHOP_CATALOG: readonly ShopItem[] = [
  { id: 'deeperLungs', label: 'Deeper Lungs', kind: 'permanent', costs: DEEPER_LUNGS_COSTS },
  { id: 'quietStep', label: 'Quiet Step', kind: 'permanent', costs: QUIET_STEP_COSTS },
  { id: 'pocketStones', label: 'Pocket Stones', kind: 'permanent', costs: POCKET_STONES_COSTS },
];

function catalogItem(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find((i) => i.id === id);
}

/** Always 0 for an id with no key yet -- the one safe way to read a tier. */
export function tierOf(state: EmbersState, id: string): number {
  return state.tiers[id] ?? 0;
}

/** Cost to go from `tier` to `tier + 1` for `id`, or null once maxed / for an unknown id.
 * `difficulty` only affects pocketStones (see POCKET_STONES_COST_BY_DIFFICULTY above) --
 * every other item's price is difficulty-independent, unchanged from `item.costs[tier]`. */
export function nextCost(id: string, tier: number, difficulty: DifficultyTier = 'night'): number | null {
  const item = catalogItem(id);
  if (!item) return null;
  if (tier >= item.costs.length) return null;
  return id === 'pocketStones' ? POCKET_STONES_COST_BY_DIFFICULTY[difficulty] : item.costs[tier];
}

/** No-op (returns `state` unchanged, same reference) if already maxed, unaffordable, or
 * `id` isn't in the catalog -- callers don't need to pre-check. Replaces
 * purchaseDeeperLungs(); callers that need "did this actually purchase" (the engine's
 * cue-triple gate, see forest-engine.js) compare the returned reference to the input. */
export function purchase(state: EmbersState, id: string, difficulty: DifficultyTier = 'night'): EmbersState {
  const tier = tierOf(state, id);
  const cost = nextCost(id, tier, difficulty);
  if (cost === null || state.balance < cost) return state;
  return { balance: state.balance - cost, tiers: { ...state.tiers, [id]: tier + 1 } };
}
