// LUL-4789: timeOfDayDetectMul() composed into effectiveDetect(p)/canSee(p,dist)
// (engine/forest-engine.js:2598/:2602). These specs pin the wall-clock hour via
// ?qaHour= and read qaPredatorState(0).detectRange, which is effectiveDetect(p)
// evaluated live -- a pure read of current module state, so no ticks need to run.
// See docs/specs/lul-4789-cover-time-of-day-visibility.md's ## e2e section.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const NIGHT_HOUR = 2;
const NOON_HOUR = 12;
const EXPECTED_RATIO = 1.15 / 0.8;

async function detectRangeAt(page: Parameters<typeof boot>[0], hour: number, coverKind: 'rock' | 'bramble') {
  await boot(page, { qaHooks: true, qaHour: hour });
  await enter(page);
  await qaHook(page, 'qaBuildScene', {
    props: [{ kind: coverKind, x: 0, z: -8 }],
    predators: [{ kind: 'lion', x: 0, z: -15 }],
  });
  const state = await qaHook(page, 'qaPredatorState', 0);
  return state.detectRange;
}

test('night (qaHour: 2) detection range is 20% shorter than noon (qaHour: 12), for a lion near a rock', async ({ page }) => {
  const nightRange = await detectRangeAt(page, NIGHT_HOUR, 'rock');
  const noonRange = await detectRangeAt(page, NOON_HOUR, 'rock');
  const expected = nightRange * EXPECTED_RATIO;
  expect(Math.abs(noonRange - expected) / expected).toBeLessThan(0.01);
});

test('the same night/noon ratio holds for a lion near a bramble', async ({ page }) => {
  const nightRange = await detectRangeAt(page, NIGHT_HOUR, 'bramble');
  const noonRange = await detectRangeAt(page, NOON_HOUR, 'bramble');
  const expected = nightRange * EXPECTED_RATIO;
  expect(Math.abs(noonRange - expected) / expected).toBeLessThan(0.01);
});
