import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshProgression, recordRun, type Progression } from './progression.ts';

test('freshProgression starts every tier at zero with no best time', () => {
  const p = freshProgression();
  for (const tier of ['lantern', 'night', 'blackout'] as const) {
    assert.deepEqual(p[tier], { bestTime: null, runs: 0, wins: 0, currentStreak: 0 });
  }
});

test('a win sets the first record', () => {
  const { progression, newRecord } = recordRun(freshProgression(), 'lantern', 100, true);
  assert.equal(newRecord, true);
  assert.deepEqual(progression.lantern, { bestTime: 100, runs: 1, wins: 1, currentStreak: 1 });
});

test('a slower win does not overwrite bestTime', () => {
  const first = recordRun(freshProgression(), 'lantern', 100, true).progression;
  const { progression, newRecord } = recordRun(first, 'lantern', 150, true);
  assert.equal(newRecord, false);
  assert.deepEqual(progression.lantern, { bestTime: 100, runs: 2, wins: 2, currentStreak: 2 });
});

test('a win exactly equal to bestTime does not set newRecord', () => {
  const first = recordRun(freshProgression(), 'lantern', 100, true).progression;
  const { progression, newRecord } = recordRun(first, 'lantern', 100, true);
  assert.equal(newRecord, false);
  assert.deepEqual(progression.lantern, { bestTime: 100, runs: 2, wins: 2, currentStreak: 2 });
});

test('a death increments runs but not wins/streak, and resets currentStreak', () => {
  const won = recordRun(freshProgression(), 'lantern', 100, true).progression;
  const { progression, newRecord } = recordRun(won, 'lantern', 50, false);
  assert.equal(newRecord, false);
  assert.deepEqual(progression.lantern, { bestTime: 100, runs: 2, wins: 1, currentStreak: 0 });
});

test('win-then-win increments currentStreak to 2', () => {
  const first = recordRun(freshProgression(), 'night', 200, true).progression;
  const { progression } = recordRun(first, 'night', 180, true);
  assert.equal(progression.night.currentStreak, 2);
});

test('recordRun does not mutate other tiers', () => {
  const p: Progression = freshProgression();
  const { progression } = recordRun(p, 'blackout', 300, true);
  assert.deepEqual(progression.lantern, { bestTime: null, runs: 0, wins: 0, currentStreak: 0 });
  assert.deepEqual(progression.night, { bestTime: null, runs: 0, wins: 0, currentStreak: 0 });
});
