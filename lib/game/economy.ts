// LUL-1043: Embers -- the bank-or-lose run currency. Design: wiki
// game/economy/embers. Scope/decision: wiki decisions/embers-accepted-2026-08-29
// (the cheap version only -- no `peril` term, no Steady Arms/Ash-Foot sinks,
// both gated on this version showing people actually spend). Pure, no
// Three.js, no engine state -- same shape as outcome.ts/veil.ts per wiki
// systems/unit-testing-standard. The engine (engine/forest-engine.js) is the
// only caller: it tracks `maxDistFromHome` and `survivedSeconds` and calls
// winPayout()/deathPayout() from arriveHome()/triggerDeath().

export interface EmbersPayout {
  depth: number;
  survival: number;
  carried: number;
  home: number;
  total: number;
}

// How far out the player dared -- uncapped, unlike survival below.
export function depthEmbers(maxDistFromHome: number): number {
  return Math.floor(Math.max(0, maxDistFromHome) / 4);
}

// CAPPED at 6 (120s) -- the cap is the point. Ten minutes hiding in a bush
// pays the same as a clean two-minute crossing, which is what kills the
// stall strategy the deleted `lullwood:bestTimeSeconds` score used to reward
// (that score was uncapped and higher-is-better, so it paid stalling forever).
const SURVIVAL_CAP = 6;
export function survivalEmbers(survivedSeconds: number): number {
  return Math.min(SURVIVAL_CAP, Math.floor(Math.max(0, survivedSeconds) / 20));
}

export const CARRIED_EMBERS = 60; // WIN ONLY -- the child's warmth
export const HOME_EMBERS = 25; // WIN ONLY -- the doorstep

// A death is not multiplied down: the player keeps every Ember earned by
// covering ground and surviving. What death costs is exactly
// CARRIED_EMBERS + HOME_EMBERS (85), landing hardest on a death that happens
// after the pickup -- the single tensest moment in the run.
export function winPayout(maxDistFromHome: number, survivedSeconds: number): EmbersPayout {
  const depth = depthEmbers(maxDistFromHome);
  const survival = survivalEmbers(survivedSeconds);
  return { depth, survival, carried: CARRIED_EMBERS, home: HOME_EMBERS, total: CARRIED_EMBERS + HOME_EMBERS + depth + survival };
}

export function deathPayout(maxDistFromHome: number, survivedSeconds: number): EmbersPayout {
  const depth = depthEmbers(maxDistFromHome);
  const survival = survivalEmbers(survivedSeconds);
  return { depth, survival, carried: 0, home: 0, total: depth + survival };
}

// ---- Deeper Lungs: the one sink in this cheap version ---------------------
// Extends the mist-veil hold window (VEIL_MAX_HOLD, lib/game/veil.ts) 5s -> 6
// -> 7 -> 8 across three purchases. Steady Arms / Ash-Foot (the rest of the
// full design's tree) are held on the Economist's own gate -- see
// decisions/embers-accepted-2026-08-29 -- so this is the only sink wired up.
export const DEEPER_LUNGS_COSTS = [120, 300, 600] as const;
export const DEEPER_LUNGS_MAX_TIER = DEEPER_LUNGS_COSTS.length;

// `currentTier` is 0..DEEPER_LUNGS_MAX_TIER (0 = no purchase yet). Returns
// null once maxed -- there is nothing left to buy.
export function deeperLungsCost(currentTier: number): number | null {
  if (currentTier < 0 || currentTier >= DEEPER_LUNGS_MAX_TIER) return null;
  return DEEPER_LUNGS_COSTS[currentTier];
}

export function canBuyDeeperLungs(balance: number, currentTier: number): boolean {
  const cost = deeperLungsCost(currentTier);
  return cost != null && balance >= cost;
}
