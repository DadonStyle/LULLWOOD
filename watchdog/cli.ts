/**
 * Watchdog entrypoint + end-of-cycle loop.
 *
 *   node watchdog/cli.ts check         # one cheap read, print the line, exit
 *   node watchdog/cli.ts run-cycle     # checkpoint → check → wait-or-continue
 *   node watchdog/cli.ts demo          # simulated near-limit + budget alerts
 *
 * The watchdog is the ONLY thing allowed to pause the studio. It never makes a
 * generation; every signal is a cheap file/header/spend read.
 */

import { DEFAULT_CONFIG, type WatchdogConfig } from "./config.ts";
import {
  SidecarSource,
  FixtureSource,
  type UsageSignal,
  type UsageSource,
} from "./sources.ts";
import { decide, type Decision } from "./watchdog.ts";
import { writeCheckpoint, type Checkpoint } from "./checkpoint.ts";
import { evaluateBudget, type BudgetAlert } from "./budget.ts";

const SCRATCH = process.env.PAPERCLIP_TASK_SCRATCH_DIR ||
  process.env.PAPERCLIP_SCRATCH_DIR || ".watchdog";
const SIGNAL_FILE = process.env.WATCHDOG_SIGNAL_FILE || `${SCRATCH}/signal.json`;
const CHECKPOINT_FILE = process.env.WATCHDOG_CHECKPOINT_FILE ||
  `${SCRATCH}/checkpoint.json`;
const BUDGET_STATE_FILE = process.env.WATCHDOG_BUDGET_STATE_FILE ||
  `${SCRATCH}/budget-state.json`;

// Re-check at least this often even while waiting on a far-out weekly cap,
// so a changed cap or a cleared 5h window is noticed promptly.
const MAX_POLL_MS = 5 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deliver a CEO (VP R&D) budget alert. Best-effort: posts a comment on this
 * issue via the Paperclip API. The budget ceiling itself is enforced by the
 * decision logic regardless of whether delivery succeeds.
 */
async function alertCeo(alert: BudgetAlert): Promise<void> {
  const pctInt = Math.round(alert.fraction * 100);
  const body =
    `🚨 **Budget alert — monthly $ cap at ${pctInt}%** (CEO / VP R&D)\n` +
    `Spent $${alert.usedDollars.toFixed(2)} of $${alert.capDollars.toFixed(2)} ` +
    `on the API path this month.` +
    (pctInt >= 100
      ? ` **Hard ceiling reached — new API-path work is halted until the monthly reset.**`
      : ` Heads-up at the ${pctInt}% threshold; ceiling stays enforced.`);
  console.log(`[watchdog] CEO ALERT ${pctInt}%: ${body.split("\n")[0]}`);

  const base0 = process.env.PAPERCLIP_API_URL;
  const key = process.env.PAPERCLIP_API_KEY;
  const issue = process.env.PAPERCLIP_TASK_ID;
  if (!base0 || !key || !issue) return; // console alert already emitted
  const base = base0.replace(/\/$/, "").replace(/\/api$/, "");
  try {
    await fetch(`${base}/api/issues/${issue}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(process.env.PAPERCLIP_RUN_ID
          ? { "X-Paperclip-Run-Id": process.env.PAPERCLIP_RUN_ID }
          : {}),
      },
      body: JSON.stringify({ body }),
    });
  } catch (err) {
    console.error(`[watchdog] CEO alert delivery failed (non-fatal):`, err);
  }
}

/** Run the budget guard against the monthly-$ reading and page the CEO. */
async function runBudgetGuard(
  signal: UsageSignal,
  config: WatchdogConfig,
  now: Date,
): Promise<void> {
  const m = signal.monthlyDollars;
  if (!m.present || m.cap <= 0) return; // no $ cap configured on this path
  const alerts = evaluateBudget(
    process.env.WATCHDOG_BUDGET_STATE_FILE || BUDGET_STATE_FILE,
    m.fraction,
    m.used,
    m.cap,
    config.budgetAlertFractions,
    now,
  );
  for (const a of alerts) await alertCeo(a);
}

function checkpointActiveTicket(decision: Decision): void {
  const cp: Checkpoint = {
    issueId: process.env.PAPERCLIP_TASK_ID || "unknown",
    state: { note: "auto-checkpoint before wait", lastLine: decision.line },
    lastLine: decision.line,
    pausedAt: new Date().toISOString(),
    resumeAt: decision.waitUntil ? decision.waitUntil.toISOString() : null,
  };
  writeCheckpoint(CHECKPOINT_FILE, cp);
  console.log(`[watchdog] checkpoint written → ${CHECKPOINT_FILE}`);
}

/**
 * End-of-cycle loop. Returns once a limit has reset and work may continue.
 * `simulate` skips real sleeping (returns after the first wait plan) so the
 * logic can be exercised in CI without waiting hours.
 */
export async function runCycle(
  source: UsageSource,
  config: WatchdogConfig = DEFAULT_CONFIG,
  opts: { simulate?: boolean; now?: () => Date } = {},
): Promise<Decision> {
  const now = opts.now || (() => new Date());
  for (;;) {
    const t = now();
    const signal = source.read(t);
    await runBudgetGuard(signal, config, t);
    const decision = decide(signal, config, t);
    console.log(decision.line);
    if (decision.missing.length > 0) {
      console.warn(
        `[watchdog] MISSING real signal(s): ${decision.missing.join(", ")} — ` +
          `treated as 0% but flagged; escalate if the source should exist.`,
      );
    }

    if (decision.action === "continue") return decision;

    // Wait path: checkpoint, then sleep until the binding reset (capped).
    checkpointActiveTicket(decision);
    const waitMs = Math.max(0, decision.waitUntil!.getTime() - t.getTime());
    const sleepMs = Math.min(waitMs, MAX_POLL_MS);
    console.log(
      `[watchdog] waiting on ${decision.blocking} until ` +
        `${decision.waitUntil!.toISOString()} ` +
        `(sleep ${(sleepMs / 1000).toFixed(0)}s, then re-check)`,
    );
    if (opts.simulate) return decision; // exercise logic without real sleep
    await sleep(sleepMs);
  }
}

/** A forced near-limit + budget-alert fixture for the demo. */
function demoSignal(now: Date): UsageSignal {
  const in90min = new Date(now.getTime() + 90 * 60 * 1000);
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    // 5h window near cap and resetting soonest → this should bind the wait.
    fiveHour: {
      fraction: 0.97,
      resetAt: in90min,
      units: "tokens",
      used: 970_000,
      cap: 1_000_000,
      present: true,
    },
    // Weekly also over cap but resets days out → not the binding limit.
    weekly: {
      fraction: 0.96,
      resetAt: in3days,
      units: "tokens",
      used: 9_600_000,
      cap: 10_000_000,
      present: true,
    },
    // Monthly $ at 82% → crosses the 50% and 80% CEO alerts.
    monthlyDollars: {
      fraction: 0.82,
      resetAt: nextMonth,
      units: "$",
      used: 82,
      cap: 100,
      present: true,
    },
    missing: [],
  };
}

async function main(): Promise<void> {
  const cmd = process.argv[2] || "check";
  const now = new Date();

  if (cmd === "check") {
    const src = new SidecarSource(SIGNAL_FILE, DEFAULT_CONFIG);
    const signal = src.read(now);
    await runBudgetGuard(signal, DEFAULT_CONFIG, now);
    const d = decide(signal, DEFAULT_CONFIG, now);
    console.log(d.line);
    if (d.missing.length > 0) {
      console.warn(`[watchdog] missing signal(s): ${d.missing.join(", ")}`);
    }
    process.exit(d.action === "continue" ? 0 : 20);
  }

  if (cmd === "run-cycle") {
    const src = new SidecarSource(SIGNAL_FILE, DEFAULT_CONFIG);
    await runCycle(src, DEFAULT_CONFIG, { simulate: process.env.WATCHDOG_SIMULATE === "1" });
    return;
  }

  if (cmd === "demo") {
    console.log("=== DEMO 1: healthy — all limits low → continue ===");
    const healthy: UsageSignal = {
      fiveHour: { fraction: 0.30, resetAt: new Date(now.getTime() + 3e6), units: "tokens", used: 3, cap: 10, present: true },
      weekly: { fraction: 0.44, resetAt: new Date(now.getTime() + 2.6e8), units: "tokens", used: 44, cap: 100, present: true },
      monthlyDollars: { fraction: 0.20, resetAt: new Date(now.getTime() + 1e9), units: "$", used: 20, cap: 100, present: true },
      missing: [],
    };
    await runCycle(new FixtureSource(healthy), DEFAULT_CONFIG, { simulate: true });

    console.log("\n=== DEMO 2: forced near-limit — 5h 97%, weekly 96%, $ 82% ===");
    console.log("Expected: wait, bound to the SOONEST-resetting over-cap limit (5h), plus CEO alerts at 50% & 80%.");
    // Fresh budget-state so the demo reliably shows the alerts firing.
    process.env.WATCHDOG_BUDGET_STATE_FILE = `${SCRATCH}/demo-budget-state.json`;
    try { (await import("node:fs")).rmSync(process.env.WATCHDOG_BUDGET_STATE_FILE!, { force: true }); } catch {}
    const d = await runCycle(new FixtureSource(demoSignal(now)), DEFAULT_CONFIG, { simulate: true });
    console.log(`Decision: action=${d.action} blocking=${d.blocking} closest=${d.closest} waitUntil=${d.waitUntil?.toISOString()}`);
    return;
  }

  console.error(`unknown command: ${cmd}. use: check | run-cycle | demo`);
  process.exit(2);
}

// Only run main when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
