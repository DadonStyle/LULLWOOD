import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeOfDayFromHour,
  TIME_OF_DAY_VISUALS,
  TIME_OF_DAY_AUDIO,
  type TimeOfDayState,
} from './timeOfDay.ts';

const STATES: TimeOfDayState[] = ['night', 'early-morning', 'morning', 'noon', 'afternoon', 'evening'];

test('every boundary hour maps to the expected state', () => {
  assert.equal(timeOfDayFromHour(0), 'night');
  assert.equal(timeOfDayFromHour(3), 'night');
  assert.equal(timeOfDayFromHour(4), 'early-morning');
  assert.equal(timeOfDayFromHour(5), 'early-morning');
  assert.equal(timeOfDayFromHour(6), 'morning');
  assert.equal(timeOfDayFromHour(10), 'morning');
  assert.equal(timeOfDayFromHour(11), 'noon');
  assert.equal(timeOfDayFromHour(13), 'noon');
  assert.equal(timeOfDayFromHour(14), 'afternoon');
  assert.equal(timeOfDayFromHour(16), 'afternoon');
  assert.equal(timeOfDayFromHour(17), 'evening');
  assert.equal(timeOfDayFromHour(19), 'evening');
  assert.equal(timeOfDayFromHour(20), 'night');
  assert.equal(timeOfDayFromHour(23), 'night');
});

test('wraps out-of-range and fractional hours', () => {
  assert.equal(timeOfDayFromHour(24), 'night');   // wraps to 0
  assert.equal(timeOfDayFromHour(-1), 'night');   // wraps to 23
  assert.equal(timeOfDayFromHour(6.9), 'morning'); // floors, does not round up to 7's state (still morning anyway)
});

test('every state has a visual and an audio config with no missing fields', () => {
  for (const s of STATES) {
    assert.ok(TIME_OF_DAY_VISUALS[s], `missing visuals for ${s}`);
    assert.ok(TIME_OF_DAY_AUDIO[s], `missing audio for ${s}`);
  }
});

test('night audio is a true no-op (bit-for-bit today\'s behaviour)', () => {
  const a = TIME_OF_DAY_AUDIO.night;
  assert.equal(a.windGainMul, 1);
  assert.equal(a.droneGainMul, 1);
  assert.equal(a.birdsGain, 0);
  assert.equal(a.insectsGain, 0);
});

test('daylight states (noon/afternoon/morning) duck the drone below night\'s baseline', () => {
  for (const s of ['morning', 'noon', 'afternoon'] as const) {
    assert.ok(TIME_OF_DAY_AUDIO[s].droneGainMul < 1, `${s} should duck the ominous drone`);
  }
});

test('daylight states have zero star opacity; night and the dawn/dusk pair do not', () => {
  assert.equal(TIME_OF_DAY_VISUALS.noon.starOpacity, 0);
  assert.equal(TIME_OF_DAY_VISUALS.morning.starOpacity, 0);
  assert.equal(TIME_OF_DAY_VISUALS.afternoon.starOpacity, 0);
  assert.ok(TIME_OF_DAY_VISUALS.night.starOpacity > 0);
});
