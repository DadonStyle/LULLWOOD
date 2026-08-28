// LUL-482: network sink that wires setSink() to POST /api/telemetry.
// Fire-and-forget: sendBeacon preferred, fetch({keepalive:true}) fallback.
// session_length fires on pagehide where the page may already be tearing down,
// so it MUST use sendBeacon — a pending promise can be killed mid-flight.
// Never await here, never let an error surface to callers.

import { setSink, type AnalyticsEvent } from './analytics';

const ENDPOINT = '/api/telemetry';

function sendEvent(event: AnalyticsEvent): void {
  const body = JSON.stringify(event);
  // sendBeacon is mandatory for session_length (pagehide context).
  // For all other events it is still preferred (no keep-alive overhead, queued by browser).
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    const queued = navigator.sendBeacon(ENDPOINT, blob);
    if (queued) return;
    // sendBeacon returns false when the queue is full — fall through to fetch
  }
  fetch(ENDPOINT, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {
    // swallow — telemetry must never throw into callers
  });
}

/**
 * Call once at app boot (client side only). Swaps the analytics sink from the
 * no-op dev sink to the real network transport. Idempotent — safe to call
 * multiple times though the second call is a no-op in practice because
 * setSink replaces the reference.
 */
export function initTelemetryTransport(): void {
  setSink(sendEvent);
}
