/**
 * Usage sources: where the watchdog reads its cheap, zero-model-call signals.
 *
 * A `UsageSource` returns a `UsageSignal` describing each limit's used/cap and
 * concrete reset time. NONE of these make a generation. The primary source
 * parses Anthropic rate-limit *response headers* (mirrored to a sidecar file by
 * the adapter) + a persisted usage ledger for the weekly cap, and Paperclip's
 * own spend accounting for the monthly $ cap.
 */

import { readFileSync } from "node:fs";
import {
  DEFAULT_CONFIG,
  nextMonthlyReset,
  nextWeeklyReset,
  type WatchdogConfig,
} from "./config.ts";

export interface LimitReading {
  /** Fraction used, clamped to [0, 1+] (can exceed 1 if over cap). */
  fraction: number;
  /** Concrete moment this limit next resets. */
  resetAt: Date;
  /** Human units for the runbook/output, e.g. "tokens", "requests", "$". */
  units: string;
  used: number;
  cap: number;
  /** True when this reading is a real signal; false when unavailable/degraded. */
  present: boolean;
}

export interface UsageSignal {
  fiveHour: LimitReading;
  weekly: LimitReading;
  monthlyDollars: LimitReading;
  /** Any limit whose real signal was missing (drives CEO escalation). */
  missing: string[];
}

export interface UsageSource {
  read(now: Date): UsageSignal;
}

/** Shape of the sidecar JSON the adapter writes from response headers. */
interface Sidecar {
  // Snapshot of the most recent Anthropic rate-limit headers (5h window).
  anthropicRatelimit?: {
    tokensRemaining?: number;
    tokensLimit?: number;
    requestsRemaining?: number;
    requestsLimit?: number;
    // ISO8601 reset from `anthropic-ratelimit-*-reset`.
    resetAt?: string;
    // Present when the last response was a 429.
    retryAfterSeconds?: number;
  };
  // Accumulated ledger for the weekly cap (adapter increments per request).
  weekly?: { usedTokens?: number; capTokens?: number; windowStart?: string };
  // Paperclip spend accounting for the monthly $ cap.
  monthly?: { spentCents?: number; budgetCents?: number };
}

function clampFraction(used: number, cap: number): number {
  if (!(cap > 0)) return 0;
  const f = used / cap;
  return f < 0 ? 0 : f;
}

/**
 * Reads the header sidecar + ledger + spend. Missing pieces degrade to a
 * "not present" reading (fraction 0) and are reported in `missing` so the
 * caller can escalate rather than silently assuming 0% usage.
 */
export class SidecarSource implements UsageSource {
  constructor(
    private readonly path: string,
    private readonly config: WatchdogConfig = DEFAULT_CONFIG,
  ) {}

  private load(): Sidecar {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Sidecar;
    } catch {
      return {};
    }
  }

  read(now: Date): UsageSignal {
    const s = this.load();
    const missing: string[] = [];

    // 5h rolling window — prefer tokens headroom, fall back to requests.
    const rl = s.anthropicRatelimit;
    let five: LimitReading;
    if (
      rl &&
      rl.tokensLimit != null &&
      rl.tokensRemaining != null &&
      rl.tokensLimit > 0
    ) {
      const used = rl.tokensLimit - rl.tokensRemaining;
      // A 429 with retry-after means we are effectively at 100% now.
      const fraction =
        rl.retryAfterSeconds != null
          ? 1
          : clampFraction(used, rl.tokensLimit);
      const resetAt = rl.retryAfterSeconds != null
        ? new Date(now.getTime() + rl.retryAfterSeconds * 1000)
        : rl.resetAt
          ? new Date(rl.resetAt)
          : new Date(now.getTime() + this.config.fiveHourWindowMs);
      five = {
        fraction,
        resetAt,
        units: "tokens",
        used,
        cap: rl.tokensLimit,
        present: true,
      };
    } else {
      missing.push("fiveHour");
      five = {
        fraction: 0,
        resetAt: new Date(now.getTime() + this.config.fiveHourWindowMs),
        units: "tokens",
        used: 0,
        cap: 0,
        present: false,
      };
    }

    // Weekly cap — from the accumulated ledger, fixed weekly reset.
    const w = s.weekly;
    const weeklyReset = nextWeeklyReset(
      now,
      this.config.weeklyResetDayUtc,
      this.config.weeklyResetHourUtc,
    );
    let weekly: LimitReading;
    if (w && w.capTokens != null && w.usedTokens != null && w.capTokens > 0) {
      weekly = {
        fraction: clampFraction(w.usedTokens, w.capTokens),
        resetAt: weeklyReset,
        units: "tokens",
        used: w.usedTokens,
        cap: w.capTokens,
        present: true,
      };
    } else {
      missing.push("weekly");
      weekly = {
        fraction: 0,
        resetAt: weeklyReset,
        units: "tokens",
        used: 0,
        cap: 0,
        present: false,
      };
    }

    // Monthly $ cap — from Paperclip spend accounting.
    const m = s.monthly;
    const budgetCents = m?.budgetCents ?? this.config.monthlyBudgetCents;
    let monthlyDollars: LimitReading;
    if (budgetCents > 0 && m?.spentCents != null) {
      monthlyDollars = {
        fraction: clampFraction(m.spentCents, budgetCents),
        resetAt: nextMonthlyReset(now),
        units: "$",
        used: m.spentCents / 100,
        cap: budgetCents / 100,
        present: true,
      };
    } else {
      // A 0/undefined budget is not an error on the subscription path (no API
      // spend), but we flag it so the runbook reader knows it's uncapped-$.
      missing.push("monthlyDollars");
      monthlyDollars = {
        fraction: 0,
        resetAt: nextMonthlyReset(now),
        units: "$",
        used: (m?.spentCents ?? 0) / 100,
        cap: budgetCents / 100,
        present: false,
      };
    }

    return { fiveHour: five, weekly, monthlyDollars, missing };
  }
}

/** In-memory source for demos/tests — exact fractions, no I/O. */
export class FixtureSource implements UsageSource {
  constructor(private readonly signal: UsageSignal) {}
  read(): UsageSignal {
    return this.signal;
  }
}
