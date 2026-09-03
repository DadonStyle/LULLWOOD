// Node's built-in test runner -- no new devDependency for one unit test.
// Run: `npm test` (or `node --test lib/**/*.test.ts` directly). Node 24 runs
// .ts files natively via type-stripping, no build step needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, setSink } from './analytics.ts';

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
