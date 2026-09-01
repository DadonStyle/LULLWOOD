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
  const counts = FUNNEL_STEPS.map((name) => events.filter((e) => e.event === name).length);
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
  const durations = sessionEvents
    .map((e) => numberProp(e, 'duration_ms'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const reachedCount = sessionEvents.filter((e) => e.reached_gameplay === true).length;

  return {
    sessionCount: sessionEvents.length,
    reachedGameplayRatePct: sessionEvents.length === 0 ? null : (reachedCount / sessionEvents.length) * 100,
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
