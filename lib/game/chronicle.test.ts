import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestLandmarkName, formatChronicle, type ChronicleEvent } from './chronicle.ts';

const LANDMARKS = [
  { x: 22, z: 4, kind: 'oak' },
  { x: -95, z: 46, kind: 'drownedCar' },
  { x: 50, z: -50, kind: 'fireTower' },
  { x: -50, z: 50, kind: 'stoneMarker' },
];
const HOME = { x: 0, z: 0 };
const LAKE = { x: 60, z: 60 };

test('nearestLandmarkName returns null when nothing is within maxDist', () => {
  assert.equal(nearestLandmarkName(200, 200, LANDMARKS, HOME, LAKE), null);
});

test('nearestLandmarkName names the closest landmark within range', () => {
  assert.equal(nearestLandmarkName(23, 5, LANDMARKS, HOME, LAKE), 'the Split Oak');
  assert.equal(nearestLandmarkName(-94, 45, LANDMARKS, HOME, LAKE), 'the Drowned Car');
});

test('nearestLandmarkName also considers home and lake as named points', () => {
  assert.equal(nearestLandmarkName(1, 1, LANDMARKS, HOME, LAKE), 'the Cabin');
  assert.equal(nearestLandmarkName(59, 59, LANDMARKS, HOME, LAKE), 'the Lake');
});

test('nearestLandmarkName respects a custom maxDist', () => {
  assert.equal(nearestLandmarkName(30, 4, LANDMARKS, HOME, LAKE, 5), null);
  assert.equal(nearestLandmarkName(30, 4, LANDMARKS, HOME, LAKE, 50), 'the Split Oak');
});

test('nearestLandmarkName falls back to the raw kind for an unnamed landmark kind', () => {
  const unknown = [{ x: 10, z: 10, kind: 'mysteryStone' }];
  assert.equal(nearestLandmarkName(11, 10, unknown, HOME, LAKE), 'mysteryStone');
});

test('formatChronicle renders a line per known code, oldest first, with mm:ss timestamps', () => {
  const events: ChronicleEvent[] = [
    { t: 5, code: 'scent_lock', args: { kind: 'wolf' } },
    { t: 65, code: 'hide', args: { kind: 'bramble' } },
    { t: 90, code: 'pickup' },
    { t: 120, code: 'win' },
  ];
  assert.deepEqual(formatChronicle(events), [
    '0:05 — a wolf caught your scent.',
    '1:05 — you went still in the brambles.',
    '1:30 — you lifted the child.',
    '2:00 — you lifted her into the light.',
  ]);
});

test('formatChronicle appends a nearby landmark name when args.landmark is set', () => {
  const events: ChronicleEvent[] = [
    { t: 10, code: 'scent_lock', args: { kind: 'bear', landmark: 'the Fire Tower' } },
    { t: 20, code: 'death', args: { kind: 'lion', landmark: 'the Lake' } },
  ];
  assert.deepEqual(formatChronicle(events), [
    '0:10 — a bear caught your scent near the Fire Tower.',
    '0:20 — a lion caught you near the Lake.',
  ]);
});

test('formatChronicle handles hide in an unrecognized cover kind and predator_gave_up', () => {
  const events: ChronicleEvent[] = [
    { t: 3, code: 'hide', args: { kind: 'shrub' } },
    { t: 4, code: 'predator_gave_up', args: { kind: 'wolf' } },
    { t: 6, code: 'fog_tide_start' },
    { t: 8, code: 'fog_tide_end' },
  ];
  assert.deepEqual(formatChronicle(events), [
    '0:03 — you went still in cover.',
    '0:04 — the wolf lost your trail.',
    '0:06 — a fog tide rolled in.',
    '0:08 — the fog tide passed.',
  ]);
});

test('formatChronicle renders a line for hide_alert when a predator was alerted, and drops the line entirely when none were', () => {
  const events: ChronicleEvent[] = [
    { t: 12, code: 'hide_alert', args: { kind: 'bramble', alerted: 1 } },
    { t: 20, code: 'hide_alert', args: { kind: 'bramble', alerted: 0 } },
  ];
  assert.deepEqual(formatChronicle(events), [
    '0:12 — something stirred nearby as you went still.',
  ]);
});

test('formatChronicle defaults a missing predator kind to "predator"', () => {
  const events: ChronicleEvent[] = [{ t: 0, code: 'scent_lock' }];
  assert.deepEqual(formatChronicle(events), ['0:00 — a predator caught your scent.']);
});

test('formatChronicle caps output to the last maxLines events, dropping the oldest', () => {
  const events: ChronicleEvent[] = Array.from({ length: 15 }, (_, i) => ({
    t: i,
    code: 'pickup' as const,
  }));
  const lines = formatChronicle(events, 10);
  assert.equal(lines.length, 10);
  assert.equal(lines[0], '0:05 — you lifted the child.');
  assert.equal(lines[9], '0:14 — you lifted the child.');
});

test('formatChronicle defaults maxLines to 10', () => {
  const events: ChronicleEvent[] = Array.from({ length: 12 }, (_, i) => ({
    t: i,
    code: 'pickup' as const,
  }));
  assert.equal(formatChronicle(events).length, 10);
});

test('formatChronicle rounds negative/fractional seconds down to a sane clamp', () => {
  const events: ChronicleEvent[] = [{ t: -3, code: 'win' }];
  assert.deepEqual(formatChronicle(events), ['0:00 — you lifted her into the light.']);
});
