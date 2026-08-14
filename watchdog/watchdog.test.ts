/**
 * Correctness tests for the watchdog. Run: `node --test watchdog/`
 * These assert code-correctness only (no real generations, no network).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CONFIG,
  nextWeeklyReset,
  nextMonthlyReset,
} from "./config.ts";
import { decide } from "./watchdog.ts";
import { evaluateBudget } from "./budget.ts";
import { readCheckpoint, writeCheckpoint } from "./checkpoint.ts";
import { runCycle } from "./cli.ts";
import { FixtureSource, SidecarSource, type UsageSignal } from "./sources.ts";
import { writeFileSync } from "node:fs";

const now = new Date("2026-08-13T12:00:00Z");

function sig(
  five: number,
  weekly: number,
  monthly: number,
  resets: { five?: Date; weekly?: Date; monthly?: Date } = {},
): UsageSignal {
  return {
    fiveHour: { fraction: five, resetAt: resets.five ?? new Date(now.getTime() + 3_600_000), units: "tokens", used: five, cap: 1, present: true },
    weekly: { fraction: weekly, resetAt: resets.weekly ?? new Date(now.getTime() + 3 * 86_400_000), units: "tokens", used: weekly, cap: 1, present: true },
    monthlyDollars: { fraction: monthly, resetAt: resets.monthly ?? new Date(now.getTime() + 15 * 86_400_000), units: "$", used: monthly, cap: 1, present: true },
    missing: [],
  };
}

test("continues when all limits are below stop threshold", () => {
  const d = decide(sig(0.5, 0.9, 0.3), DEFAULT_CONFIG, now);
  assert.equal(d.action, "continue");
  assert.equal(d.closest, "weekly"); // highest fraction
});

test("waits when a single limit crosses 95%", () => {
  const d = decide(sig(0.96, 0.2, 0.2), DEFAULT_CONFIG, now);
  assert.equal(d.action, "wait");
  assert.equal(d.blocking, "fiveHour");
  assert.ok(d.waitUntil);
});

test("output line matches the required format", () => {
  const wu = new Date(now.getTime() + 3_600_000);
  const d = decide(sig(0.97, 0.5, 0.2, { five: wu }), DEFAULT_CONFIG, now);
  assert.equal(
    d.line,
    `5h: 97% · weekly: 50% · monthly-$: 20% · closest: 5h · action: wait until ${wu.toISOString()}`,
  );
});

test("continue line format", () => {
  const d = decide(sig(0.1, 0.2, 0.3), DEFAULT_CONFIG, now);
  assert.equal(
    d.line,
    "5h: 10% · weekly: 20% · monthly-$: 30% · closest: monthly-$ · action: continue",
  );
});

test("when multiple limits are over cap, waits on the SOONEST reset", () => {
  const soon = new Date(now.getTime() + 90 * 60_000); // 5h window, 90m out
  const later = new Date(now.getTime() + 3 * 86_400_000); // weekly, 3d out
  const d = decide(
    sig(0.97, 0.99, 0.2, { five: soon, weekly: later }),
    DEFAULT_CONFIG,
    now,
  );
  assert.equal(d.action, "wait");
  assert.equal(d.blocking, "fiveHour"); // soonest reset wins
  assert.equal(d.waitUntil!.getTime(), soon.getTime());
  // closest is still reported as the max-fraction limit (weekly at 99%)
  assert.equal(d.closest, "weekly");
});

test("weekly cap that resets days out is honored (5h does NOT clear it)", () => {
  const soon = new Date(now.getTime() + 60 * 60_000);
  const weekOut = new Date(now.getTime() + 4 * 86_400_000);
  // Only the weekly cap is over; the 5h window is fine.
  const d = decide(
    sig(0.4, 0.98, 0.2, { five: soon, weekly: weekOut }),
    DEFAULT_CONFIG,
    now,
  );
  assert.equal(d.blocking, "weekly");
  assert.equal(d.waitUntil!.getTime(), weekOut.getTime());
});

test("budget alerts fire once per threshold, no repeats", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const state = join(dir, "budget.json");
  // Cross 50% and 80% at once.
  let alerts = evaluateBudget(state, 0.82, 82, 100, [0.5, 0.8, 1.0], now);
  assert.deepEqual(alerts.map((a) => a.fraction), [0.5, 0.8]);
  // Re-check same level → no new alerts.
  alerts = evaluateBudget(state, 0.82, 82, 100, [0.5, 0.8, 1.0], now);
  assert.deepEqual(alerts, []);
  // Cross 100% → only the 100% alert fires.
  alerts = evaluateBudget(state, 1.01, 101, 100, [0.5, 0.8, 1.0], now);
  assert.deepEqual(alerts.map((a) => a.fraction), [1.0]);
});

test("budget alert tracking resets on month rollover", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const state = join(dir, "budget.json");
  evaluateBudget(state, 0.9, 90, 100, [0.5, 0.8], new Date("2026-08-31T23:00:00Z"));
  const next = evaluateBudget(state, 0.6, 60, 100, [0.5, 0.8], new Date("2026-09-01T01:00:00Z"));
  assert.deepEqual(next.map((a) => a.fraction), [0.5]); // fresh period
});

test("nextWeeklyReset lands on the configured UTC day/hour in the future", () => {
  const r = nextWeeklyReset(now, 3, 0); // Wed 00:00 UTC; now is Thu
  assert.equal(r.getUTCDay(), 3);
  assert.equal(r.getUTCHours(), 0);
  assert.ok(r.getTime() > now.getTime());
});

test("nextMonthlyReset is the 1st of next month UTC", () => {
  const r = nextMonthlyReset(now);
  assert.equal(r.getUTCMonth(), 8); // Sept (0-indexed)
  assert.equal(r.getUTCDate(), 1);
});

test("checkpoint round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const path = join(dir, "cp.json");
  writeCheckpoint(path, { issueId: "LUL-7", state: { step: 3 }, lastLine: "x", pausedAt: "t", resumeAt: null });
  const cp = readCheckpoint(path);
  assert.equal(cp?.issueId, "LUL-7");
  assert.equal((cp?.state as { step: number }).step, 3);
});

test("runCycle simulate: over-limit path checkpoints and returns a wait", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  process.env.WATCHDOG_CHECKPOINT_FILE = join(dir, "cp.json");
  process.env.WATCHDOG_BUDGET_STATE_FILE = join(dir, "b.json");
  const d = await runCycle(new FixtureSource(sig(0.99, 0.5, 0.2)), DEFAULT_CONFIG, { simulate: true, now: () => now });
  assert.equal(d.action, "wait");
  const cp = readCheckpoint(process.env.WATCHDOG_CHECKPOINT_FILE!);
  assert.ok(cp, "checkpoint should be written before waiting");
  assert.equal(cp?.resumeAt, d.waitUntil?.toISOString());
});

test("SidecarSource flags missing signals instead of assuming 0%", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const path = join(dir, "signal.json");
  writeFileSync(path, JSON.stringify({}), "utf8");
  const s = new SidecarSource(path, DEFAULT_CONFIG).read(now);
  assert.ok(s.missing.includes("fiveHour"));
  assert.ok(s.missing.includes("weekly"));
  assert.equal(s.fiveHour.present, false);
});

test("SidecarSource parses real header shape + 429 → 100% with retry-after reset", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const path = join(dir, "signal.json");
  writeFileSync(path, JSON.stringify({
    anthropicRatelimit: { tokensLimit: 1000, tokensRemaining: 100, resetAt: new Date(now.getTime() + 600_000).toISOString(), retryAfterSeconds: 300 },
    weekly: { usedTokens: 950, capTokens: 1000 },
    monthly: { spentCents: 5000, budgetCents: 10000 },
  }), "utf8");
  const s = new SidecarSource(path, DEFAULT_CONFIG).read(now);
  assert.equal(s.fiveHour.fraction, 1); // 429 pins to 100%
  assert.equal(s.fiveHour.resetAt.getTime(), now.getTime() + 300_000); // retry-after wins
  assert.equal(s.weekly.fraction, 0.95);
  assert.equal(s.monthlyDollars.fraction, 0.5);
  assert.equal(s.monthlyDollars.used, 50);
});
