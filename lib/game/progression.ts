// LUL-2558: personal-best time + tier streak counter. Pure functions, no I/O, no
// wall-clock reads (see wiki systems/unit-testing-standard). Engine owns the mutable
// `progression` var; components/Hud.tsx does the localStorage I/O.

import type { DifficultyTier } from './economy.ts';

export interface TierRecord {
  bestTime: number | null;   // seconds; fastest WIN completion for this tier, null = no win yet
  runs: number;               // every run (win or death) increments this
  wins: number;                // every win increments this
  currentStreak: number;      // consecutive wins; any death resets to 0
}

export type Progression = Record<DifficultyTier, TierRecord>;

function freshTierRecord(): TierRecord {
  return { bestTime: null, runs: 0, wins: 0, currentStreak: 0 };
}

export function freshProgression(): Progression {
  return { lantern: freshTierRecord(), night: freshTierRecord(), blackout: freshTierRecord() };
}

/** Pure transition. `survivedSeconds` is the run's elapsed time at the outcome (same value
 * already passed to computeWinPayout/computeDeathPayout). `newRecord` is true only on a win
 * that beats (strictly, lower than) the tier's current bestTime -- a death never sets one,
 * and a win that ties or is slower than an existing bestTime does not either. */
export function recordRun(
  p: Progression,
  difficulty: DifficultyTier,
  survivedSeconds: number,
  won: boolean,
): { progression: Progression; newRecord: boolean } {
  const prev = p[difficulty];
  const newRecord = won && (prev.bestTime === null || survivedSeconds < prev.bestTime);
  const next: TierRecord = {
    bestTime: newRecord ? survivedSeconds : prev.bestTime,
    runs: prev.runs + 1,
    wins: prev.wins + (won ? 1 : 0),
    currentStreak: won ? prev.currentStreak + 1 : 0,
  };
  return { progression: { ...p, [difficulty]: next }, newRecord };
}
