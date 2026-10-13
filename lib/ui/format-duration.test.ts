// Run: node --test lib/ui/format-duration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatRunTime } from './format-duration.ts';

test('formatDuration renders m:ss, rounding and clamping', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65.4), '1:05');
  assert.equal(formatDuration(3599.6), '60:00');
  assert.equal(formatDuration(-3), '0:00');
});

test('formatRunTime matches what the leaderboard stores and the sky balloon shows (ms round-trip)', () => {
  for (const s of [0, 15.7135, 59.4996, 59.5004, 125.0, 125.49949, 3599.4]) {
    const storedMs = Math.round(s * 1000);
    assert.equal(formatRunTime(s), formatDuration(storedMs / 1000), String(s));
  }
  assert.equal(formatRunTime(125.2), '2:05');
});
