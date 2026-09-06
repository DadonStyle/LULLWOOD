// Node's built-in test runner -- no new devDependency for one unit test.
// Run: `npm test` (or `node --test lib/**/*.test.ts` directly). Node 24 runs
// .ts files natively via type-stripping, no build step needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, setSink, startSessionTracking, type AnalyticsEvent } from './analytics.ts';

test('track() never throws, even when the sink throws', () => {
  setSink(() => {
    throw new Error('sink is broken');
  });
  try {
    assert.doesNotThrow(() => track({ event: 'page_view' }));
    assert.doesNotThrow(() =>
      track({ event: 'loss', predator_kind: 'wolf', time_survived_ms: 1200, seed: 42, payout: 15, balance: 150 }),
    );
  } finally {
    setSink(() => {}); // don't leak the throwing sink into other tests
  }
});

test('startSessionTracking: three visibilitychange:hidden fires emit three rows sharing one session_id', () => {
  // No jsdom in this repo's test setup -- stub just enough of window/document
  // on globalThis for analytics.ts's `typeof window !== 'undefined'` checks
  // and its listener/location/localStorage reads to resolve without throwing.
  const visibilityListeners: Array<() => void> = [];
  let visibilityState = 'visible';
  const fakeDocument = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') visibilityListeners.push(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') {
        const i = visibilityListeners.indexOf(cb);
        if (i >= 0) visibilityListeners.splice(i, 1);
      }
    },
  };
  const fakeWindow = {
    addEventListener() {},
    removeEventListener() {},
    location: { pathname: '/test' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).document = fakeDocument;

  const captured: AnalyticsEvent[] = [];
  setSink((e) => captured.push(e));

  try {
    const stop = startSessionTracking();
    visibilityState = 'hidden';
    for (let i = 0; i < 3; i++) visibilityListeners.forEach((cb) => cb());
    stop();
  } finally {
    (globalThis as Record<string, unknown>).window = prevWindow;
    (globalThis as Record<string, unknown>).document = prevDocument;
    setSink(() => {});
  }

  const rows = captured.filter(
    (e): e is Extract<AnalyticsEvent, { event: 'session_length' }> => e.event === 'session_length',
  );
  assert.equal(rows.length, 3);
  const ids = new Set(rows.map((r) => r.session_id));
  assert.equal(ids.size, 1);
  assert.ok(rows[0].session_id.length > 0);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].duration_ms >= rows[i - 1].duration_ms);
  }
});
