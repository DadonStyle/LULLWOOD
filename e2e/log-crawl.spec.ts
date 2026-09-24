// LUL-4527: Log Crawl-Through. Stages one log in the micro world (founder rule
// LUL-2377 -- no @fullmap reason applies) and proves the mechanic end to end:
// scent is suppressed for the whole time the player is mid-crawl, and resumes
// the instant they emerge at the far mouth.
//
// Geometry re-derived against this branch's live values (spec's placeholder
// numbers corrected per its own note): log at x=10,z=0,ry=0 -> hx=1.85, mouths
// at x=8.15 (entry) and x=11.85 (exit). Player starts at x=6.15 (2.0u short of
// the entry mouth, outside LOG_CRAWL_ENTER_RADIUS=1.2) facing +x (default
// yaw=0 -> KeyD moves +x, verified against qaTriggerCharge's own yaw comment
// and the fx/fz/rx/rz composition in the movement block).
//
// Speed: walk=6, LOG_CRAWL_SPEED_MUL=0.5 -> crawl pace 3 u/s. Entry-to-exit
// span is 3.7u (2*hx), so a full crossing takes ~1.23s once triggered.
//
// LUL-5008 review fix: the "no catch while inside" half of this test used to
// stage a wolf on the log's own long axis and assert its state stayed 'roam'.
// That's not a meaningful check here -- this feature is scent-only (SPEC
// deviation #4: "No new predator-alert loop, no new predator state ... pure
// side effect of gating the single depositScent() call site"; sight/noise are
// untouched) but any predator placed anywhere near the crossing confounds the
// assertion with two pre-existing, unrelated systems: hasLOS()'s walkable-
// cover exemption (lib/game/cover.ts's LUL-2320(A) comment) means a predator
// with a sightline down the log's axis sees straight through it once the
// player is standing inside the log's own footprint (true for the *entire*
// crawl, by construction), and checkNoise() rolls an unseeded
// Math.random() every frame the player is moving regardless of scent
// (NOISE_RADIUS_WALK=14 comfortably covers this whole scene). Neither channel
// is part of what this feature changes, so asserting on predator state during
// the "inside" phase was testing the wrong thing, and non-deterministically.
//
// Fix: the "no catch while inside" half now reads qaProbeScentTrail().livePoints
// directly -- the raw depositScent() count -- which is exactly the mechanism
// the SPEC claims changes ("the forced branch has no call site for it at
// all"). The "picks up the trail at the exit" half still exercises the real
// predator AI, staged in close *after* the crawl ends (via
// qaStagePredatorNearPlayer, same tool e2e/hide-alert.spec.ts and friends use
// to bring a predator into range only once the state under test is ready),
// where sight/noise/scent all legitimately apply again and there's nothing
// left to confound.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test('log crawl-through breaks scent continuity end to end', async ({ page }) => {
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);
  await qaHook(page, 'qaSetWindHighSpeed', false);
  await qaHook(page, 'qaBuildScene', {
    props: [{ kind: 'log', x: 10, z: 0, ry: 0 }],   // hx=1.85 -> mouths at x=8.15 and x=11.85
    // Parked far away (same isolate-the-mechanic idiom as cover-rustle.spec.ts's
    // RUSTLE_SCENE) -- see the file header for why a predator can't sit near the
    // crossing itself without confounding the scent-suppression assertion below.
    predators: [{ kind: 'wolf', x: 9999, z: 9999, state: 'roam' }],
  });
  await qaHook(page, 'qaTeleportTo', 6.15, 0);   // 2.0u short of the entry mouth, facing +x by default
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  // walk forward (+x) toward and through the log
  await page.keyboard.down('KeyD');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));   // closes the 2.0u gap and crosses LOG_CRAWL_ENTER_RADIUS
  let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have entered crawl on approach').toBe(true);

  const entryTrail = await page.evaluate(() => window.ForestEngine?.qaProbeScentTrail?.());
  const pointsAtEntry = entryTrail?.livePoints ?? 0;

  // advance partway through the crossing -- still well short of the ~1.23s a full
  // crossing takes at crawl pace (3.7u / 3u/s) -- and confirm no new scent point
  // landed while inside (depositScent() has no call site in the forced-crawl branch).
  await qaHook(page, 'qaAdvance', stepsFor(0.6));
  ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should still be mid-crawl').toBe(true);
  const midTrail = await page.evaluate(() => window.ForestEngine?.qaProbeScentTrail?.());
  expect(midTrail?.livePoints, 'no scent point should be deposited while inLogCrawl is true')
    .toBeLessThanOrEqual(pointsAtEntry);

  // advance clear of the log
  await qaHook(page, 'qaAdvance', stepsFor(1));
  ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have exited crawl by now').toBe(false);

  // Bring the wolf in close now that the crawl is over -- 1.5u ahead of the player's
  // current (post-exit) position, inside SCENT_RADIUS_WALK(2.2) -- and let normal
  // movement resume depositing scent. Sight/noise/scent all legitimately apply again
  // here, so routing this half through the real predator AI is the right check.
  await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 1.5, 0);
  await qaHook(page, 'qaAdvance', stepsFor(1));   // a couple SCENT_DEPOSIT_INTERVAL(0.3s) beats
  const pred = await page.evaluate(() => window.ForestEngine?.qaPredatorState?.(0));
  expect(pred?.state, 'predator should pick up the resumed trail once the player is moving normally again')
    .not.toBe('roam');
  await page.keyboard.up('KeyD');
});
