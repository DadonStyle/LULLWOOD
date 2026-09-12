// LUL-155: pure aggregation over a RawEvent[] window. No I/O here on purpose
// -- keeps the four views trivially unit-testable without touching Blob.
// View spec: wiki `game/m4-analytics-plan` §3.

import type { RawEvent } from './events.ts';

const FUNNEL_STEPS = ['page_view', 'cta_start_clicked', 'game_start', 'win'] as const;

export interface FunnelStep {
  event: (typeof FUNNEL_STEPS)[number];
  count: number;
  /** % of this step's count relative to the first step (page_view). */
  pctOfFirst: number;
  /** % of this step's count relative to the previous step; null for the first step. */
  pctOfPrev: number | null;
}

export function computeFunnel(events: RawEvent[]): FunnelStep[] {
  const counts = FUNNEL_STEPS.map(
    (name) => new Set(events.filter((e) => e.event === name).map((e) => e.anon_id)).size,
  );
  const first = counts[0];
  return FUNNEL_STEPS.map((name, i) => ({
    event: name,
    count: counts[i],
    pctOfFirst: first === 0 ? 0 : (counts[i] / first) * 100,
    pctOfPrev: i === 0 ? null : counts[i - 1] === 0 ? 0 : (counts[i] / counts[i - 1]) * 100,
  }));
}

const PREDATOR_KINDS = ['wolf', 'bear', 'lion'] as const;
type PredatorKind = (typeof PREDATOR_KINDS)[number];

export interface OutcomesResult {
  winCount: number;
  lossCount: number;
  winRatePct: number | null; // null if no win or loss events at all
  lossByPredator: Record<PredatorKind, number>;
  timeSurvivedMs: {
    win: { p50: number | null; p90: number | null; n: number };
    loss: { p50: number | null; p90: number | null; n: number };
  };
}

/** Nearest-rank percentile over an ascending-sorted array. Null on empty input. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function numberProp(e: RawEvent, key: string): number | null {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringProp(e: RawEvent, key: string): string | null {
  const v = e[key];
  return typeof v === 'string' ? v : null;
}

export function computeOutcomes(events: RawEvent[]): OutcomesResult {
  const wins = events.filter((e) => e.event === 'win');
  const losses = events.filter((e) => e.event === 'loss');

  const lossByPredator: Record<PredatorKind, number> = { wolf: 0, bear: 0, lion: 0 };
  for (const loss of losses) {
    const kind = loss.predator_kind;
    if (typeof kind === 'string' && (PREDATOR_KINDS as readonly string[]).includes(kind)) {
      lossByPredator[kind as PredatorKind]++;
    }
  }

  const winDurations = wins
    .map((e) => numberProp(e, 'time_survived_ms'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const lossDurations = losses
    .map((e) => numberProp(e, 'time_survived_ms'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const total = wins.length + losses.length;

  return {
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: total === 0 ? null : (wins.length / total) * 100,
    lossByPredator,
    timeSurvivedMs: {
      win: { p50: percentile(winDurations, 50), p90: percentile(winDurations, 90), n: winDurations.length },
      loss: { p50: percentile(lossDurations, 50), p90: percentile(lossDurations, 90), n: lossDurations.length },
    },
  };
}

export type OutcomeTierKey = 'lantern' | 'night' | 'blackout' | 'unattributed';

const OUTCOME_TIER_KEYS: OutcomeTierKey[] = ['lantern', 'night', 'blackout', 'unattributed'];

export interface TierOutcomes {
  winCount: number;
  lossCount: number;
  winRatePct: number | null;
  runLengthMs: {
    win: { p50: number | null; n: number };
    loss: { p50: number | null; n: number };
  };
  /** Median distance in meters from home at the moment of death (`loss.distance_from_home_m`,
   * LUL-2461). Null if no loss in this tier carries the field (pre-instrumentation builds). */
  distanceFromHomeAtDeathM: { p50: number | null; n: number };
}

function tierOutcomesFor(wins: RawEvent[], losses: RawEvent[]): TierOutcomes {
  const winDurations = wins.map((e) => numberProp(e, 'time_survived_ms')).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const lossDurations = losses.map((e) => numberProp(e, 'time_survived_ms')).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const deathDistances = losses.map((e) => numberProp(e, 'distance_from_home_m')).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const total = wins.length + losses.length;

  return {
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: total === 0 ? null : (wins.length / total) * 100,
    runLengthMs: {
      win: { p50: percentile(winDurations, 50), n: winDurations.length },
      loss: { p50: percentile(lossDurations, 50), n: lossDurations.length },
    },
    distanceFromHomeAtDeathM: { p50: percentile(deathDistances, 50), n: deathDistances.length },
  };
}

/**
 * LUL-2392: median and p25 gap between a chase->roam give-up and the next scentOnto()
 * re-acquisition, per difficulty tier -- feeds the Economist's LUL-1449 measurement for
 * Deeper Lungs veil-tree re-pricing (LUL-1439). p25, not p50, decides tiers 2-3 (need
 * 14-16s of quiet): the ticket's ask is specifically "does even a below-median run get
 * enough quiet", which p50 alone cannot answer.
 */
export interface ChaseGapTierResult {
  gapMs: { p50: number | null; p25: number | null; n: number };
}

export function computeChaseGapByTier(events: RawEvent[]): Record<OutcomeTierKey, ChaseGapTierResult> {
  const gaps = events.filter((e) => e.event === 'chase_gap');
  const byTier = new Map<OutcomeTierKey, number[]>();
  for (const key of OUTCOME_TIER_KEYS) byTier.set(key, []);
  for (const e of gaps) {
    const d = stringProp(e, 'difficulty');
    const key: OutcomeTierKey = d === 'lantern' || d === 'night' || d === 'blackout' ? d : 'unattributed';
    const ms = numberProp(e, 'duration_ms');
    if (ms !== null) byTier.get(key)!.push(ms);
  }
  return Object.fromEntries(
    OUTCOME_TIER_KEYS.map((key) => {
      const durations = byTier.get(key)!.sort((a, b) => a - b);
      return [key, { gapMs: { p50: percentile(durations, 50), p25: percentile(durations, 25), n: durations.length } }];
    }),
  ) as Record<OutcomeTierKey, ChaseGapTierResult>;
}

/**
 * LUL-2461: win rate is measurable per difficulty tier today (win/loss already carry
 * `difficulty`), just not broken out that way anywhere -- computeOutcomes() pools all
 * tiers. This is the lightweight per-tier counterpart the Economist's LUL-1413
 * blackout-multiplier pricing needs. Callers filter `events` to the desired build range
 * (e.g. build_sha >= a known commit) before calling this -- ancestry checks need git,
 * which this module deliberately does not touch (see file header).
 */
export function computeOutcomesByTier(events: RawEvent[]): Record<OutcomeTierKey, TierOutcomes> {
  const wins = events.filter((e) => e.event === 'win');
  const losses = events.filter((e) => e.event === 'loss');

  const winsByTier = new Map<OutcomeTierKey, RawEvent[]>();
  const lossesByTier = new Map<OutcomeTierKey, RawEvent[]>();
  for (const key of OUTCOME_TIER_KEYS) {
    winsByTier.set(key, []);
    lossesByTier.set(key, []);
  }
  for (const e of wins) {
    const d = stringProp(e, 'difficulty');
    const key: OutcomeTierKey = d === 'lantern' || d === 'night' || d === 'blackout' ? d : 'unattributed';
    winsByTier.get(key)!.push(e);
  }
  for (const e of losses) {
    const d = stringProp(e, 'difficulty');
    const key: OutcomeTierKey = d === 'lantern' || d === 'night' || d === 'blackout' ? d : 'unattributed';
    lossesByTier.get(key)!.push(e);
  }

  return Object.fromEntries(
    OUTCOME_TIER_KEYS.map((key) => [key, tierOutcomesFor(winsByTier.get(key)!, lossesByTier.get(key)!)]),
  ) as Record<OutcomeTierKey, TierOutcomes>;
}

export interface SessionsResult {
  sessionCount: number;
  reachedGameplayRatePct: number | null;
  durationMs: { p50: number | null; p90: number | null; avg: number | null };
  /**
   * Return rate computed only from anon_id sightings inside the fetched
   * window -- a sighting the day before the window starts is invisible, so
   * this undercounts near the edges. Acceptable for v1 per the wiki plan;
   * revisit if the window ever needs to look further back than the
   * selected range.
   */
  d1ReturnPct: number | null;
  d7ReturnPct: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayIndex(ts: number): number {
  return Math.floor(ts / DAY_MS);
}

function computeReturnRate(events: RawEvent[], dayOffset: number): number | null {
  const daysByAnon = new Map<string, Set<number>>();
  for (const e of events) {
    const day = utcDayIndex(e.ts);
    const set = daysByAnon.get(e.anon_id) ?? new Set<number>();
    set.add(day);
    daysByAnon.set(e.anon_id, set);
  }
  if (daysByAnon.size === 0) return null;

  const maxDay = Math.max(...events.map((e) => utcDayIndex(e.ts)));

  let eligible = 0;
  let returned = 0;
  for (const days of daysByAnon.values()) {
    const firstDay = Math.min(...days);
    // Only count this anon_id if their return day is actually observable
    // inside the window we fetched (i.e. firstDay + offset <= maxDay).
    if (firstDay + dayOffset > maxDay) continue;
    eligible++;
    if (days.has(firstDay + dayOffset)) returned++;
  }
  return eligible === 0 ? null : (returned / eligible) * 100;
}

export function computeSessions(events: RawEvent[]): SessionsResult {
  const sessionEvents = events.filter((e) => e.event === 'session_length');
  const bySession = new Map<string, { duration: number | null; reached: boolean }>();
  for (const e of sessionEvents) {
    // Legacy rows (emitted before LUL-1430) carry no session_id. Give each its
    // own key rather than collapsing a player's history into one session -- we
    // do not retroactively invent a grouping the emitter never recorded.
    const sid =
      typeof e.session_id === 'string' && e.session_id.length > 0
        ? e.session_id
        : `legacy:${e.anon_id}:${e.ts}`;
    const d = numberProp(e, 'duration_ms');
    const prev = bySession.get(sid);
    if (prev === undefined) {
      bySession.set(sid, { duration: d, reached: e.reached_gameplay === true });
    } else {
      bySession.set(sid, {
        duration: d === null ? prev.duration : prev.duration === null ? d : Math.max(prev.duration, d),
        reached: prev.reached || e.reached_gameplay === true,
      });
    }
  }
  const rows = [...bySession.values()];
  const durations = rows
    .map((r) => r.duration)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const reachedCount = rows.filter((r) => r.reached).length;

  return {
    sessionCount: bySession.size,
    reachedGameplayRatePct: bySession.size === 0 ? null : (reachedCount / bySession.size) * 100,
    durationMs: {
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      avg: durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length,
    },
    d1ReturnPct: computeReturnRate(events, 1),
    d7ReturnPct: computeReturnRate(events, 7),
  };
}

export interface FeatureEngagementRow {
  feature: string;
  action: string;
  count: number;
}

export function computeFeatureEngagement(events: RawEvent[]): FeatureEngagementRow[] {
  const rows = new Map<string, FeatureEngagementRow>();
  for (const e of events) {
    if (e.event !== 'feature_engagement') continue;
    const feature = typeof e.feature === 'string' ? e.feature : 'unknown';
    const action = typeof e.action === 'string' ? e.action : 'unknown';
    const key = JSON.stringify([feature, action]);
    const existing = rows.get(key);
    if (existing) existing.count++;
    else rows.set(key, { feature, action, count: 1 });
  }
  return Array.from(rows.values()).sort((a, b) => b.count - a.count);
}

export interface EconomyMetrics {
  winPayout: { p50: number | null; p90: number | null; n: number };
  lossPayout: { p50: number | null; p90: number | null; n: number };
  /** P3: median(loss payout) / median(win payout) * 100. */
  failureBandPct: number | null;
  /**
   * P4: derived death-depth = payout - min(6, floor(time_survived_ms / 20000)) on each
   * loss. Unreachable on lantern/night (child-spawn 60-96m); falsification predicts p95 <= 60 on blackout.
   */
  lossDepth: { p50: number | null; p95: number | null; pctAbove24: number | null; n: number };
}

export type EconomyTierKey = 'lantern' | 'night' | 'blackout' | 'unattributed';

export interface EconomyResult extends EconomyMetrics {
  /**
   * P5: a purchase is a decrease in an anon_id's balance sequence (win/loss events,
   * ts-ordered) -- no `purchase` event needed. Falsification card predicts >=60% of
   * anon_ids that ever cross 120 balance show a decrease within the next 3 runs.
   * Not split by tier: balance sequences have holes when a player changes difficulty
   * between runs, making per-tier sequences meaningless.
   */
  purchase: {
    crossed120Count: number;
    purchasedWithin3RunsCount: number;
    purchasedWithin3RunsPct: number | null;
  };
  byDifficulty: Record<EconomyTierKey, EconomyMetrics>;
}

const SURVIVAL_TERM_CAP = 6;
const SURVIVAL_TERM_DIVISOR_MS = 20000;
const DEPTH_FALSIFY_THRESHOLD = 24;
const PURCHASE_BALANCE_THRESHOLD = 120;
const PURCHASE_WINDOW_RUNS = 3;

const TIER_KEYS: EconomyTierKey[] = ['lantern', 'night', 'blackout', 'unattributed'];

function economyMetricsFor(wins: RawEvent[], losses: RawEvent[]): EconomyMetrics {
  const winPayouts = wins
    .map((e) => numberProp(e, 'payout'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const lossPayouts = losses
    .map((e) => numberProp(e, 'payout'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const winPayoutP50 = percentile(winPayouts, 50);
  const lossPayoutP50 = percentile(lossPayouts, 50);

  const lossDepths = losses
    .map((e) => {
      const payout = numberProp(e, 'payout');
      const survivedMs = numberProp(e, 'time_survived_ms');
      if (payout === null || survivedMs === null) return null;
      const survivalTerm = Math.min(SURVIVAL_TERM_CAP, Math.floor(survivedMs / SURVIVAL_TERM_DIVISOR_MS));
      return payout - survivalTerm;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const pctAbove24 =
    lossDepths.length === 0 ? null : (lossDepths.filter((d) => d > DEPTH_FALSIFY_THRESHOLD).length / lossDepths.length) * 100;

  return {
    winPayout: { p50: winPayoutP50, p90: percentile(winPayouts, 90), n: winPayouts.length },
    lossPayout: { p50: lossPayoutP50, p90: percentile(lossPayouts, 90), n: lossPayouts.length },
    failureBandPct:
      winPayoutP50 === null || lossPayoutP50 === null || winPayoutP50 === 0 ? null : (lossPayoutP50 / winPayoutP50) * 100,
    lossDepth: {
      p50: percentile(lossDepths, 50),
      p95: percentile(lossDepths, 95),
      pctAbove24,
      n: lossDepths.length,
    },
  };
}

export function computeEconomy(events: RawEvent[]): EconomyResult {
  const wins = events.filter((e) => e.event === 'win');
  const losses = events.filter((e) => e.event === 'loss');

  // P5: chronological balance sequence per anon_id, across win+loss events.
  const runsByAnon = new Map<string, number[]>();
  const chronological = [...wins, ...losses].sort((a, b) => a.ts - b.ts);
  for (const e of chronological) {
    const balance = numberProp(e, 'balance');
    if (balance === null) continue;
    const arr = runsByAnon.get(e.anon_id) ?? [];
    arr.push(balance);
    runsByAnon.set(e.anon_id, arr);
  }

  let crossed120Count = 0;
  let purchasedWithin3RunsCount = 0;
  for (const balances of runsByAnon.values()) {
    const crossIdx = balances.findIndex((b) => b >= PURCHASE_BALANCE_THRESHOLD);
    if (crossIdx === -1) continue;
    crossed120Count++;
    for (let i = crossIdx + 1; i <= crossIdx + PURCHASE_WINDOW_RUNS && i < balances.length; i++) {
      if (balances[i] < balances[i - 1]) {
        purchasedWithin3RunsCount++;
        break;
      }
    }
  }

  const winsByTier = new Map<EconomyTierKey, RawEvent[]>();
  const lossesByTier = new Map<EconomyTierKey, RawEvent[]>();
  for (const key of TIER_KEYS) {
    winsByTier.set(key, []);
    lossesByTier.set(key, []);
  }
  for (const e of wins) {
    const d = stringProp(e, 'difficulty');
    const key: EconomyTierKey = d === 'lantern' || d === 'night' || d === 'blackout' ? d : 'unattributed';
    winsByTier.get(key)!.push(e);
  }
  for (const e of losses) {
    const d = stringProp(e, 'difficulty');
    const key: EconomyTierKey = d === 'lantern' || d === 'night' || d === 'blackout' ? d : 'unattributed';
    lossesByTier.get(key)!.push(e);
  }

  const byDifficulty = Object.fromEntries(
    TIER_KEYS.map((key) => [key, economyMetricsFor(winsByTier.get(key)!, lossesByTier.get(key)!)]),
  ) as Record<EconomyTierKey, EconomyMetrics>;

  return {
    ...economyMetricsFor(wins, losses),
    purchase: {
      crossed120Count,
      purchasedWithin3RunsCount,
      purchasedWithin3RunsPct: crossed120Count === 0 ? null : (purchasedWithin3RunsCount / crossed120Count) * 100,
    },
    byDifficulty,
  };
}
