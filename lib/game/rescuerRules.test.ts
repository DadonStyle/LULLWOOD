import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescuerRules } from './rescuerRules.ts';
import { COOLDOWN_MS, IP_LIMIT, PLAUSIBILITY_FLOOR_MS } from './leaderboard.ts';

test('rescuerRules: covers every gate a run has to pass', () => {
  const text = rescuerRules(null).join('\n');
  for (const needle of ['Blackout', 'admin mode', 'carry them home', 'top-right', '3-20 letters', 'country']) {
    assert.ok(text.includes(needle), needle);
  }
});

test('rescuerRules: numbers come from the enforced constants', () => {
  const text = rescuerRules(null).join('\n');
  assert.ok(text.includes(`${(PLAUSIBILITY_FLOOR_MS / 1000).toFixed(1)} seconds`));
  assert.ok(text.includes(`${COOLDOWN_MS / 1000} seconds between submissions`));
  assert.ok(text.includes(`at most ${IP_LIMIT} per hour`));
});

test('rescuerRules: names the time to beat when there is a record, and says so when there is not', () => {
  assert.ok(rescuerRules(125_000).some((r) => r.includes('beat the current top rescuer') && r.includes('2:05')));
  assert.ok(rescuerRules(null).some((r) => r.includes('any valid win takes first place')));
});
