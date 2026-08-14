/**
 * Core watchdog: turn a UsageSignal into a continue-vs-wait DECISION and the
 * canonical per-cycle output line. Pure and synchronous — no I/O, no model
 * calls — so it is trivially testable and costs nothing to run every cycle.
 */

import { DEFAULT_CONFIG, type LimitKind, type WatchdogConfig } from "./config.ts";
import type { LimitReading, UsageSignal } from "./sources.ts";

export interface Decision {
  action: "continue" | "wait";
  /** The limit that is closest to its cap (highest fraction). */
  closest: LimitKind;
  /** When action === "wait": the limit forcing the wait and its reset time. */
  blocking?: LimitKind;
  waitUntil?: Date;
  fractions: Record<LimitKind, number>;
  /** The canonical per-cycle output line. */
  line: string;
  /** Missing real signals surfaced by the source. */
  missing: string[];
}

const KIND_LABEL: Record<LimitKind, string> = {
  fiveHour: "5h",
  weekly: "weekly",
  monthlyDollars: "monthly-$",
};

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Decide whether the next cycle may begin.
 *
 * Rule: if ANY limit is at/above stopFraction (default 95%), we must wait —
 * and we wait on the binding limit's own reset moment. When several are over,
 * the binding limit is the one that resets SOONEST, so we re-check as early as
 * possible (a 5h window may clear long before the weekly cap). If none are over
 * threshold, we continue. The "closest" field always reports the max-fraction
 * limit for visibility, independent of the wait decision.
 */
export function decide(
  signal: UsageSignal,
  config: WatchdogConfig = DEFAULT_CONFIG,
  now: Date = new Date(),
): Decision {
  const entries: Array<[LimitKind, LimitReading]> = [
    ["fiveHour", signal.fiveHour],
    ["weekly", signal.weekly],
    ["monthlyDollars", signal.monthlyDollars],
  ];

  const fractions = Object.fromEntries(
    entries.map(([k, r]) => [k, r.fraction]),
  ) as Record<LimitKind, number>;

  // Closest = highest fraction.
  const closest = entries.reduce((a, b) =>
    b[1].fraction > a[1].fraction ? b : a,
  )[0];

  // Limits at/over the stop threshold.
  const over = entries.filter(([, r]) => r.fraction >= config.stopFraction);

  let action: Decision["action"] = "continue";
  let blocking: LimitKind | undefined;
  let waitUntil: Date | undefined;

  if (over.length > 0) {
    action = "wait";
    // Bind to the soonest-resetting over-threshold limit.
    const binding = over.reduce((a, b) =>
      b[1].resetAt.getTime() < a[1].resetAt.getTime() ? b : a,
    );
    blocking = binding[0];
    waitUntil = binding[1].resetAt;
  }

  const line =
    `5h: ${pct(fractions.fiveHour)} · ` +
    `weekly: ${pct(fractions.weekly)} · ` +
    `monthly-$: ${pct(fractions.monthlyDollars)} · ` +
    `closest: ${KIND_LABEL[closest]} · ` +
    (action === "continue"
      ? "action: continue"
      : `action: wait until ${waitUntil!.toISOString()}`);

  return {
    action,
    closest,
    blocking,
    waitUntil,
    fractions,
    line,
    missing: signal.missing,
  };
}
