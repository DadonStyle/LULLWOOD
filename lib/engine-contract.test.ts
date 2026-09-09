// Node's built-in test runner, same pattern as lib/analytics.test.ts.
// Run: `npm test` (or `node --test lib/**/*.test.ts` directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_ACTION_KEYS, assertEngineContract } from './engine-contract.ts';
import { setSink, type AnalyticsEvent } from './analytics.ts';

function fullActions(): Record<string, unknown> {
  const actions: Record<string, unknown> = {};
  for (const key of ENGINE_ACTION_KEYS) actions[key] = () => {};
  return actions;
}

// `NODE_ENV` is typed read-only (Next.js's global env typing) -- true at the
// type level, not at runtime, and this is the one place that needs to flip it
// to exercise both branches of assertEngineContract's dev/prod split.
function withNodeEnv(value: string | undefined, fn: () => void) {
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    fn();
  } finally {
    env.NODE_ENV = prev;
  }
}

test('assertEngineContract: does nothing when init() returns null (the idempotent-reentry guard)', () => {
  assert.doesNotThrow(() => assertEngineContract(null));
});

test('assertEngineContract: does nothing when every ENGINE_ACTION_KEYS entry is present', () => {
  withNodeEnv('production', () => {
    assert.doesNotThrow(() => assertEngineContract(fullActions()));
  });
});

test('assertEngineContract: throws naming the missing keys outside production (dev default)', () => {
  withNodeEnv('development', () => {
    const actions = fullActions();
    delete actions.setScentTrailVisible;
    delete actions.restart;
    assert.throws(() => assertEngineContract(actions), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /setScentTrailVisible/);
      assert.match(err.message, /restart/);
      return true;
    });
  });
});

test('assertEngineContract: in production, never throws -- console.error + telemetry instead', () => {
  withNodeEnv('production', () => {
    const actions = fullActions();
    delete actions.setEmbers;

    const captured: AnalyticsEvent[] = [];
    setSink((e) => captured.push(e));
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    try {
      assert.doesNotThrow(() => assertEngineContract(actions));
      assert.equal(errorCalls.length, 1);
      assert.match(String(errorCalls[0][0]), /setEmbers/);

      const violations = captured.filter(
        (e): e is Extract<AnalyticsEvent, { event: 'engine_contract_violation' }> =>
          e.event === 'engine_contract_violation',
      );
      assert.equal(violations.length, 1);
      assert.deepEqual(violations[0].missing_keys, ['setEmbers']);
    } finally {
      console.error = originalError;
      setSink(() => {});
    }
  });
});
