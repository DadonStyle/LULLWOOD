// LUL-2667 (6/6): Ship 1 wayfinding S3 -- the child's cry is a second, independent
// predator-hearing channel targeting the child's fixed position, not the live player
// (docs/specs/lul-1255-wayfinding-ship1.md S3, docs/ELEMENTS.md "Wayfinding"). Distinct
// from checkNoise/hearNoise's footstep channel: gated on distance-to-baby, not
// distance-to-player, and fires even while the player is standing still and unseen.
// (S2, the landmark cue, already has full coverage: e2e/hints.spec.ts's "the landmark
// hint fires once on entry and never again". S4/S5 -- carried-noise floor and home-fire
// crackle -- were carry-leg-only channels LUL-2285 deleted 2026-09-23; nothing left to
// cover. S6 is a docs/ELEMENTS.md section, not a testable behaviour.)
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test('a roaming predator hears the child\'s cry and investigates, though the player is far outside its sight/scent/footstep range', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  // Player stays at spawn (0,0) and never moves -- footstep noiseRadius never computes
  // (isNoiseHeard: "noiseRadius <= 0 ... player standing still ... always a miss") and no
  // scent trail is ever laid. Child at (0,40), wolf 15 units from the child (well inside
  // CRY_NOISE_RADIUS=32) but 25 units from the player -- on the qaWorld=micro preset
  // (CONFIG.detectScaleMul=0.2) a wolf's effective detect radius is ~8.4, so sight cannot
  // fire at this distance either. Only the cry channel can move this predator.
  await qaHook(page, 'qaBuildScene', {
    child: { x: 0, z: 40 },
    predators: [{ kind: 'wolf', x: 0, z: 25, state: 'roam' }],
  });

  let probe = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(probe?.state, 'wolf must start roaming, not already alerted').toBe('roam');
  // makePredator() never initializes alertedBy -- it's undefined, not null, until the
  // first spotOnto()/hearNoise()/hearCry() call sets it, so a fresh predator reads falsy
  // either way.
  expect(probe?.alertedBy).toBeFalsy();

  // HEAR_CHANCE_PER_SEC=0.5 -> a per-tick roll of 0.5*dt each frame the wolf is in range;
  // 20s of ticks makes a miss (0.5^20) astronomically unlikely without depending on the
  // roll's own RNG stream.
  await qaHook(page, 'qaAdvance', stepsFor(20));

  probe = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(probe?.alertedBy, 'the cry channel, not sight/scent/footstep, must be what moved the wolf').toBe('cry');
  expect(probe?.state).toBe('investigate');
});

test('a roaming predator outside the cry radius never investigates, even after the same window', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  // Same child position, but the wolf sits at (0,-40) -- 80 units from the child (well
  // outside CRY_NOISE_RADIUS=32; checkNoise's cry branch is raw Math.hypot, not
  // wrap-aware, so this is a real miss, not a wrap-distance artifact) and 40 units from
  // the player, well outside its ~8.4-unit effective sight radius too. Falsification
  // control: proves the prior test's detection is genuinely range-gated on distance-to-
  // child, not a predator that investigates unconditionally after enough idle time.
  await qaHook(page, 'qaBuildScene', {
    child: { x: 0, z: 40 },
    predators: [{ kind: 'wolf', x: 0, z: -40, state: 'roam' }],
  });

  await qaHook(page, 'qaAdvance', stepsFor(20));

  const probe = await qaHook(page, 'qaProbePredatorState', 'wolf');
  expect(probe?.alertedBy).toBeFalsy();
  expect(probe?.state, 'out of cry range, the wolf must stay in roam').toBe('roam');
});
