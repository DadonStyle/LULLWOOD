// Run: node --test lib/ui/format-duration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './format-duration.ts';

test('formatDuration renders m:ss, rounding and clamping', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65.4), '1:05');
  assert.equal(formatDuration(3599.6), '60:00');
  assert.equal(formatDuration(-3), '0:00');
});
