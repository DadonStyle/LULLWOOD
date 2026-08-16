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

export type AnalyticsEventInput =
  | { event: 'page_view' }
  | { event: 'cta_start_clicked' }
  | { event: 'game_start'; seed: number }
  | { event: 'win'; time_survived_ms: number; seed: number }
  | { event: 'loss'; predator_kind: PredatorKind; time_survived_ms: number; seed: number }
  | { event: 'session_length'; duration_ms: number; reached_gameplay: boolean }
  | { event: 'feature_engagement'; feature: string; action: string };

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
    track({ event: 'session_length', duration_ms: Date.now() - pageLoadTs, reached_gameplay: reachedGameplay });
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
