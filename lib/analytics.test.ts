// Node's built-in test runner -- no new devDependency for one unit test.
// Run: `npm test` (or `node --test lib/**/*.test.ts` directly). Node 24 runs
// .ts files natively via type-stripping, no build step needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, setSink, startSessionTracking, readAttribution, type AnalyticsEvent } from './analytics.ts';

test('track() never throws, even when the sink throws', () => {
  setSink(() => {
    throw new Error('sink is broken');
  });
  try {
    assert.doesNotThrow(() => track({ event: 'page_view' }));
    assert.doesNotThrow(() =>
      track({ event: 'loss', predator_kind: 'wolf', time_survived_ms: 1200, seed: 42, payout: 15, balance: 150, difficulty: 'night', distance_from_home_m: 30 }),
    );
    assert.doesNotThrow(() =>
      track({ event: 'loss', predator_kind: 'bear', time_survived_ms: 4300, seed: 43, payout: 22, balance: 172, difficulty: 'lantern', distance_from_home_m: 12 }),
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

test('game_start carries the viewport shape; other events do not', () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 667.4, innerHeight: 375, devicePixelRatio: 2.6666,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { pathname: '/' },
  };
  const captured: AnalyticsEvent[] = [];
  setSink((e) => captured.push(e));
  try {
    track({ event: 'game_start', seed: 7 });
    track({ event: 'page_view' });
  } finally {
    (globalThis as Record<string, unknown>).window = prevWindow;
    setSink(() => {});
  }
  const start = captured[0] as Extract<AnalyticsEvent, { event: 'game_start' }>;
  assert.equal(start.viewport_w, 667);
  assert.equal(start.viewport_h, 375);
  assert.equal(start.dpr, 2.67);
  assert.equal(typeof start.touch, 'boolean');
  assert.equal('viewport_w' in captured[1], false);
});

// LUL-6229: readAttribution() caches in module state, so each case loads a fresh
// copy of the module via a unique query string.
let attrImport = 0;
async function freshAttribution(opts: {
  referrer?: string;
  search?: string;
  hostname?: string;
  storage?: 'normal' | 'throwing';
  store?: Record<string, string>;
}) {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevDocument = g.document;
  const store = opts.store ?? {};
  const storage =
    opts.storage === 'throwing'
      ? {
          getItem: () => {
            throw new Error('denied');
          },
          setItem: () => {
            throw new Error('denied');
          },
        }
      : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  g.window = {
    location: { hostname: opts.hostname ?? 'www.lullwoodgame.com', search: opts.search ?? '', pathname: '/' },
    sessionStorage: storage,
  };
  g.document = { referrer: opts.referrer ?? '' };
  try {
    const mod = (await import(`./analytics.ts?attr=${attrImport++}`)) as { readAttribution: typeof readAttribution };
    return { read: mod.readAttribution, store, restore: () => { g.window = prevWindow; g.document = prevDocument; } };
  } catch (e) {
    g.window = prevWindow;
    g.document = prevDocument;
    throw e;
  }
}

test('readAttribution: referrer is host only, lowercased', async () => {
  const t = await freshAttribution({ referrer: 'https://Dev.To/someone/post?x=1#frag' });
  try {
    assert.deepEqual(t.read(), { referrer_host: 'dev.to' });
  } finally {
    t.restore();
  }
});

test('readAttribution: internal referrer is dropped; absent keys are omitted, not empty', async () => {
  const t = await freshAttribution({ referrer: 'https://www.lullwoodgame.com/devlog/x' });
  try {
    const a = t.read();
    assert.deepEqual(a, {});
    assert.equal('referrer_host' in a, false);
    assert.equal('utm_source' in a, false);
  } finally {
    t.restore();
  }
});

test('readAttribution: parses utm_*; empty utm value is omitted', async () => {
  const t = await freshAttribution({ search: '?utm_source=packtest&utm_medium=seoeng&utm_campaign=&other=1' });
  try {
    assert.deepEqual(t.read(), { utm_source: 'packtest', utm_medium: 'seoeng' });
  } finally {
    t.restore();
  }
});

test('readAttribution: values are sanitised to the server whitelist', async () => {
  const t = await freshAttribution({
    search: `?utm_source=My%20Source&utm_medium=%23%25%3F&utm_campaign=${'a'.repeat(100)}`,
  });
  try {
    const a = t.read();
    assert.equal(a.utm_source, 'my-source');
    assert.equal(a.utm_medium, '---');
    assert.equal(a.utm_campaign, 'a'.repeat(64));
    for (const v of Object.values(a)) assert.match(v as string, /^[A-Za-z0-9_.:/-]{0,64}$/);
  } finally {
    t.restore();
  }
});

test('readAttribution: first touch wins, a second call never overwrites', async () => {
  const store: Record<string, string> = {};
  const t = await freshAttribution({ referrer: 'https://dev.to/', search: '?utm_source=first', store });
  try {
    assert.deepEqual(t.read(), { referrer_host: 'dev.to', utm_source: 'first' });
    (globalThis as { window: { location: { search: string } } }).window.location.search = '?utm_source=second';
    (globalThis as { document: { referrer: string } }).document.referrer = 'https://example.org/';
    assert.deepEqual(t.read(), { referrer_host: 'dev.to', utm_source: 'first' });
    assert.ok(store['lullwood:attr']);
  } finally {
    t.restore();
  }
});

test('readAttribution: a stored value from an earlier route is reused in a new module load', async () => {
  const store = { 'lullwood:attr': JSON.stringify({ referrer_host: 'dev.to' }) };
  const t = await freshAttribution({ referrer: 'https://www.lullwoodgame.com/devlog', store });
  try {
    assert.deepEqual(t.read(), { referrer_host: 'dev.to' });
  } finally {
    t.restore();
  }
});

test('readAttribution: sessionStorage throwing still returns a value and never throws', async () => {
  const t = await freshAttribution({ referrer: 'https://dev.to/', storage: 'throwing' });
  try {
    assert.deepEqual(t.read(), { referrer_host: 'dev.to' });
    assert.deepEqual(t.read(), { referrer_host: 'dev.to' });
  } finally {
    t.restore();
  }
});

test('readAttribution: SSR (no window) returns {}', () => {
  const g = globalThis as Record<string, unknown>;
  const prev = g.window;
  delete g.window;
  try {
    assert.deepEqual(readAttribution(), {});
  } finally {
    g.window = prev;
  }
});
