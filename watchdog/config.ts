/**
 * Watchdog configuration: the three limits, thresholds, and reset schedules.
 *
 * All limits are expressed so the watchdog can compute `used / cap` as a
 * fraction in [0, 1] and derive a concrete reset timestamp. Nothing here makes
 * a model call; values come from cheap signals (headers/ledger/spend).
 */

export type LimitKind = "fiveHour" | "weekly" | "monthlyDollars";

export interface WatchdogConfig {
  /**
   * Stop starting NEW work once the closest limit reaches this fraction.
   * Reserves headroom so the watchdog can always run its own cheap check and
   * write a checkpoint. Never spend to zero.
   */
  stopFraction: number;

  /** Fixed weekly reset. Anchor = day-of-week (0=Sun..6=Sat) + hour, in UTC. */
  weeklyResetDayUtc: number; // 0..6
  weeklyResetHourUtc: number; // 0..23

  /** Monthly $ cap on the API path, in cents. 0 disables the fraction calc. */
  monthlyBudgetCents: number;

  /** Budget alert thresholds (fractions) that page the CEO exactly once each. */
  budgetAlertFractions: number[];

  /** Rolling window length for the 5h limit, in ms. */
  fiveHourWindowMs: number;
}

export const DEFAULT_CONFIG: WatchdogConfig = {
  stopFraction: 0.95,
  // Anthropic weekly caps reset on a fixed weekly schedule; anchor is
  // configurable via env because the exact reset moment is account-specific.
  weeklyResetDayUtc: envInt("WATCHDOG_WEEKLY_RESET_DOW", 3), // Wed
  weeklyResetHourUtc: envInt("WATCHDOG_WEEKLY_RESET_HOUR", 0), // 00:00 UTC
  monthlyBudgetCents: envInt("WATCHDOG_MONTHLY_BUDGET_CENTS", 0),
  budgetAlertFractions: [0.5, 0.8, 1.0],
  fiveHourWindowMs: 5 * 60 * 60 * 1000,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Next fixed weekly reset at or after `now`, given a UTC day-of-week + hour.
 */
export function nextWeeklyReset(
  now: Date,
  dowUtc: number,
  hourUtc: number,
): Date {
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  // Advance to the target day-of-week.
  let deltaDays = (dowUtc - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  // If that computed moment is not strictly in the future, jump a week.
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

/** First day of next month, 00:00:00 UTC — the monthly $ cap reset. */
export function nextMonthlyReset(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}
