/**
 * Monthly $ budget guard. Hard ceiling, never disabled. Fires CEO (VP R&D)
 * alerts at 50 / 80 / 100% — each threshold exactly once per monthly period,
 * tracked in a tiny state file so re-checks don't spam.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface BudgetAlertState {
  /** Monthly period key, e.g. "2026-08" — resets tracking on month rollover. */
  period: string;
  /** Fractions already alerted this period. */
  alerted: number[];
}

export interface BudgetAlert {
  fraction: number; // threshold crossed, e.g. 0.8
  usedDollars: number;
  capDollars: number;
}

function periodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function loadState(path: string, now: Date): BudgetAlertState {
  let st: BudgetAlertState;
  try {
    st = JSON.parse(readFileSync(path, "utf8")) as BudgetAlertState;
  } catch {
    st = { period: periodKey(now), alerted: [] };
  }
  const key = periodKey(now);
  if (st.period !== key) st = { period: key, alerted: [] };
  return st;
}

function saveState(path: string, st: BudgetAlertState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(st, null, 2), "utf8");
}

/**
 * Given current spend fraction, return thresholds newly crossed since last
 * check and persist that they've now been alerted. Pure w.r.t. delivery — the
 * caller decides how to page the CEO.
 */
export function evaluateBudget(
  statePath: string,
  fraction: number,
  usedDollars: number,
  capDollars: number,
  thresholds: number[],
  now: Date = new Date(),
): BudgetAlert[] {
  const st = loadState(statePath, now);
  const newly = thresholds
    .filter((t) => fraction >= t && !st.alerted.includes(t))
    .sort((a, b) => a - b);
  if (newly.length > 0) {
    st.alerted = [...st.alerted, ...newly].sort((a, b) => a - b);
    saveState(statePath, st);
  }
  return newly.map((t) => ({ fraction: t, usedDollars, capDollars }));
}
