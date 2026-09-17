// LUL-2667 (4/6): `?qaHour=` pins the hour timeOfDayFromHour() sees (engine/
// forest-engine.js:327), so this file can assert the six documented
// time-of-day states and their boundary crossings deterministically instead
// of depending on the real wall-clock hour at CI run time. See
// docs/specs/lul-2667-time-of-day-coverage.md's ## e2e section.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

const VALID_STATES = ['night', 'early-morning', 'morning', 'noon', 'afternoon', 'evening'];

test('?qaHour=2 resolves night', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  const probe = await qaHook(page, 'qaProbeTimeOfDay');
  expect(probe.state).toBe('night');
  expect(probe.visual.starOpacity).toBe(0.85);
});

test('?qaHour=6 crosses the early-morning/morning boundary', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 6 });
  const atSix = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atSix.state).toBe('morning');

  await boot(page, { qaHooks: true, qaHour: 5 });
  const atFive = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atFive.state).toBe('early-morning');
});

test('?qaHour=11 crosses the morning/noon boundary', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 11 });
  const atEleven = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atEleven.state).toBe('noon');

  await boot(page, { qaHooks: true, qaHour: 10 });
  const atTen = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atTen.state).toBe('morning');
});

test('?qaHour=20 re-enters night for the second disjoint range', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 20 });
  const atTwenty = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atTwenty.state).toBe('night');

  await boot(page, { qaHooks: true, qaHour: 19 });
  const atNineteen = await qaHook(page, 'qaProbeTimeOfDay');
  expect(atNineteen.state).toBe('evening');
});

test('fog/light color values differ across states', async ({ page }) => {
  // Spec's suggested hours (2, 8, 12, 22) only produce 3 distinct states, not
  // 4: hour 22 falls in the same disjoint 'night' range as hour 2
  // (BOUNDARIES has two 'night' entries, startHour 0 and 20 -- lib/game/
  // timeOfDay.ts:26,32 -- and the visual config is looked up by *state*, not
  // hour, so both hours share TIME_OF_DAY_VISUALS.night byte-for-byte).
  // Swapped 22 -> 18 (evening) to actually exercise 4 distinct states,
  // preserving the test's intent.
  const fogColors = new Set<number>();
  const hemisphereSkies = new Set<number>();

  for (const hour of [2, 8, 12, 18]) {
    await boot(page, { qaHooks: true, qaHour: hour });
    const probe = await qaHook(page, 'qaProbeTimeOfDay');
    fogColors.add(probe.visual.fogColor);
    hemisphereSkies.add(probe.visual.hemisphereSky);
  }

  expect(fogColors.size).toBe(4);
  expect(hemisphereSkies.size).toBe(4);
});

test('absent ?qaHour falls back to the real clock', async ({ page }) => {
  await boot(page, { qaHooks: true });
  const probe = await qaHook(page, 'qaProbeTimeOfDay');
  expect(VALID_STATES).toContain(probe.state);
});
