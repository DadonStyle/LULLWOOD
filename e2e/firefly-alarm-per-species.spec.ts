// LUL-5761 cheap slice (accepted per decisions/lul-5761-firefly-alarm-per-species-accepted-
// 2026-10-02, design game/mechanics/firefly-alarm-per-species): fireflyAlarmBoost
// (lib/game/fireflyAlarmResponse.ts) looks up each predator's own alarm range by kind
// (bear -> CONFIG.FIREFLY_ALARM_RANGE_BEAR = 150u, lion -> CONFIG.FIREFLY_ALARM_RANGE_LION
// = 100u, engine/tuning.js) instead of one flat FIREFLY_ALARM_RANGE for every kind. No
// HUD/audio/caption change -- reuses the same alarmScalar/alarmActive probe and mote-
// brightness ramp as e2e/firefly-alarm-response.spec.ts (LUL-5752/5756). The pure per-kind
// math is unit-tested in lib/game/fireflyAlarmResponse.test.ts; this proves the real game
// path (real predator objects, real fireflyAlarmBoost call site in the mote loop) agrees.
//
// qaPlacePredatorKindAt (new this ticket, same body as qaIsolatePredatorKindAt but does NOT
// park every other predator inert) lets a test stage a bear and a lion at the same time, to
// prove each uses its own range independently rather than one kind leaking into the other's
// lookup.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

test('a bear alarms from a distance a lion cannot -- bear range (150u) exceeds lion range (100u)', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const before = await qaHook(page, 'qaProbeFireflyClusters');
  const meadow = before.clusters[0];
  const d = 120; // between FIREFLY_ALARM_RANGE_LION (100) and FIREFLY_ALARM_RANGE_BEAR (150)

  await qaHook(page, 'qaPlacePredatorKindAt', 'bear', meadow.x + d, meadow.z);
  await qaHook(page, 'qaAdvance', 1);
  const bearAlarmed = await qaHook(page, 'qaProbeFireflyClusters');
  expect(bearAlarmed.alarmActive, 'a bear at 120u must alarm -- inside its own 150u range').toBe(true);

  await qaHook(page, 'qaClearAllPredators');
  await qaHook(page, 'qaPlacePredatorKindAt', 'lion', meadow.x + d, meadow.z);
  await qaHook(page, 'qaAdvance', 1);
  const lionAlarmed = await qaHook(page, 'qaProbeFireflyClusters');
  expect(lionAlarmed.alarmActive, 'a lion at the same 120u must NOT alarm -- outside its own 100u range').toBe(false);
  expect(lionAlarmed.alarmScalar).toBe(1);
});

test('a bear and a lion each alarm their own in-range cluster at the same time', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  const meadow = probe.clusters[0];
  const hollow = probe.clusters[2]; // far from meadow, same pairing precedent as firefly-alarm-response.spec.ts

  // Bear sits 140u from meadow (inside its 150u range, outside lion's 100u);
  // lion sits 40u from hollow (inside its own 100u range).
  await qaHook(page, 'qaPlacePredatorKindAt', 'bear', meadow.x + 140, meadow.z);
  await qaHook(page, 'qaPlacePredatorKindAt', 'lion', hollow.x + 40, hollow.z);
  await qaHook(page, 'qaAdvance', 1);

  const after = await qaHook(page, 'qaProbeFireflyClusters');
  expect(after.alarmActive, 'both predators are within their own per-species range on their own cluster').toBe(true);
  expect(after.maxIntensity).toBeGreaterThan(probe.maxIntensity);
});

test('a lion outside its own range but inside the bear range still does not alarm', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  const meadow = probe.clusters[0];

  // 110u: outside FIREFLY_ALARM_RANGE_LION (100) but inside FIREFLY_ALARM_RANGE_BEAR (150) --
  // proves the lion branch doesn't fall back to the larger bear range.
  await qaHook(page, 'qaPlacePredatorKindAt', 'lion', meadow.x + 110, meadow.z);
  await qaHook(page, 'qaAdvance', 1);

  const after = await qaHook(page, 'qaProbeFireflyClusters');
  expect(after.alarmActive).toBe(false);
  expect(after.alarmScalar).toBe(1);
});
