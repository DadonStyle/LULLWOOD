// M4.1 (LUL-153): event schema + client emitter. Schema is locked on the wiki
// (`game/m4-analytics-plan`) -- do not add/rename events without updating that
// page first. This ticket's sink is a genuine no-op (console.debug in dev
// only): zero network connections. Real transport is LUL-154, a separate,
// independently reviewable ticket -- so a network call added to hot call
// sites (pickup/win, death/loss, hide-key) is small and isolated rather than
// bundled into the schema decision.
//
// `anon_id` is a v4 UUID kept in `localStorage` only -- first-party, no
// cookie, no cross-site identifier. It identifies a browser profile, not a
// person.

export type PredatorKind = 'wolf' | 'bear' | 'lion';

export type Difficulty = 'lantern' | 'night' | 'blackout';

export type AnalyticsEventInput =
  | { event: 'page_view' }
  | { event: 'cta_start_clicked' }
  | { event: 'game_start'; seed: number }
  // LUL-1043: `payout`/`balance` added so the Embers curve modelled on wiki
  // game/economy/embers can be checked against real players -- `payout` is
  // this run's Embers total (RunPayout.total from lib/game/economy.ts),
  // `balance` is the running total after it's applied.
  | { event: 'win'; time_survived_ms: number; seed: number; payout: number; balance: number; difficulty: Difficulty }
  // LUL-2461: `distance_from_home_m` is the player's distance from CONFIG.home at the
  // moment triggerDeath() fired (engine/forest-engine.js) -- for the Economist's
  // blackout-pricing model (LUL-1413), which needs where a run actually ended.
  | { event: 'loss'; predator_kind: PredatorKind; time_survived_ms: number; seed: number; payout: number; balance: number; carrying: boolean; difficulty: Difficulty; distance_from_home_m: number }
  | { event: 'session_length'; duration_ms: number; reached_gameplay: boolean; session_id: string }
  | { event: 'feature_engagement'; feature: string; action: string; carrying?: boolean }
  // LUL-2239: production-only signal from lib/engine-contract.ts's assertEngineContract()
  // -- fires when init()'s return object (engine/forest-engine.js) is missing a key
  // ENGINE_ACTION_KEYS promises exists (the LUL-1697 failure mode). Should never fire in
  // practice; existing only to catch it if the type-level guard is ever bypassed.
  | { event: 'engine_contract_violation'; missing_keys: string[] };

export type AnalyticsEvent = AnalyticsEventInput & {
  ts: number;
  anon_id: string;
  build_sha: string;
  path: string;
};

export type Sink = (event: AnalyticsEvent) => void;

const ANON_ID_KEY = 'lullwood:anonId';

// Not cryptographically strong, but anon_id is a browser-profile marker, not
// a security token -- only used as a fallback where crypto.randomUUID is
// unavailable (older Safari/Firefox).
function fallbackUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readAnonId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const fresh = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallbackUuidV4();
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    // private mode / quota exceeded -- events still fire, just unattributable across sessions
    return 'unavailable';
  }
}

let cachedAnonId: string | null = null;
function getAnonId(): string {
  if (cachedAnonId == null) cachedAnonId = readAnonId();
  return cachedAnonId;
}

const noopSink: Sink = (event) => {
  if (process.env.NODE_ENV !== 'production') console.debug('[analytics]', event);
};

let sink: Sink = noopSink;

/** Swaps the sink. LUL-154 (durable transport) calls this once; no call site changes. */
export function setSink(next: Sink) {
  sink = next;
}

let reachedGameplay = false;

/**
 * Never throws. A telemetry bug must not be able to crash the game loop or
 * the render path -- every call site depends on that guarantee.
 */
export function track(input: AnalyticsEventInput): void {
  try {
    if (input.event === 'game_start') reachedGameplay = true;
    const event: AnalyticsEvent = {
      ...input,
      ts: Date.now(),
      anon_id: getAnonId(),
      build_sha: process.env.NEXT_PUBLIC_BUILD_SHA || 'dev',
      path: typeof window !== 'undefined' ? window.location.pathname : '/',
    };
    sink(event);
  } catch {
    // swallow -- see the doc comment above
  }
}

const pageLoadTs = Date.now();

let cachedSessionId: string | null = null;
/** Stable for one page load. Lets the aggregator collapse the N prefix rows
 *  one session emits (one per tab-away) back into a single session. */
function getSessionId(): string {
  if (cachedSessionId == null) {
    cachedSessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallbackUuidV4();
  }
  return cachedSessionId;
}

/**
 * Fires `session_length` on `pagehide`/`visibilitychange:hidden`. Call once
 * from a client-only mount point; returns a cleanup function. The eventual
 * real sink (LUL-154) must forward this particular event via
 * `navigator.sendBeacon` (never a normal awaited fetch) since the page is
 * mid-teardown when it fires and a pending promise can be killed before it
 * flushes -- noted here because the no-op sink in this ticket can't enforce
 * it, but the transport ticket must honor it.
 */
export function startSessionTracking(): () => void {
  if (typeof window === 'undefined') return () => {};

  const fire = () => {
    track({
      event: 'session_length',
      duration_ms: Date.now() - pageLoadTs,
      reached_gameplay: reachedGameplay,
      session_id: getSessionId(),
    });
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') fire();
  };

  window.addEventListener('pagehide', fire);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    window.removeEventListener('pagehide', fire);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
