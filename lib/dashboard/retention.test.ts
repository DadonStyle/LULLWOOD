import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrunable, parseEventDate, TELEMETRY_RETENTION_MS } from './retention.ts';

const NOW_MS = Date.UTC(2026, 0, 31); // 2026-01-31T00:00:00Z
const CUTOFF_MS = NOW_MS - TELEMETRY_RETENTION_MS; // 2026-01-01T00:00:00Z

test('isPrunable: exactly 30d old is the boundary, not prunable', () => {
  assert.equal(isPrunable('events/2026/01/01/uuid.json', NOW_MS), false);
  assert.equal(parseEventDate('events/2026/01/01/uuid.json')?.getTime(), CUTOFF_MS);
});

test('isPrunable: 29d old is not prunable', () => {
  assert.equal(isPrunable('events/2026/01/02/uuid.json', NOW_MS), false);
});

test('isPrunable: 31d old is prunable', () => {
  assert.equal(isPrunable('events/2025/12/31/uuid.json', NOW_MS), true);
});

test('isPrunable: malformed pathname fails safe to false', () => {
  assert.equal(parseEventDate('events/2026/01/not-a-day/uuid.json'), null);
  assert.equal(isPrunable('events/2026/01/not-a-day/uuid.json', NOW_MS), false);
});

test('isPrunable: suggestions/ pathname is never prunable by this route', () => {
  assert.equal(parseEventDate('suggestions/2025/01/01/uuid.json'), null);
  assert.equal(isPrunable('suggestions/2025/01/01/uuid.json', NOW_MS), false);
});
