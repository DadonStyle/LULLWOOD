// LUL-4527: Log Crawl-Through. Stages one log and one roaming predator in the
// micro world (founder rule LUL-2377 -- no @fullmap reason applies) and proves
// the mechanic end to end: scent is suppressed for the whole time the player is
// mid-crawl, and resumes the instant they emerge at the far mouth.
//
// Geometry re-derived against this branch's live values (spec's placeholder
// numbers corrected per its own note): log at x=10,z=0,ry=0 -> hx=1.85, mouths
// at x=8.15 (entry) and x=11.85 (exit). Player starts at x=6.15 (2.0u short of
// the entry mouth, outside LOG_CRAWL_ENTER_RADIUS=1.2) facing +x (default
// yaw=0 -> KeyD moves +x, verified against qaTriggerCharge's own yaw comment
// and the fx/fz/rx/rz composition in the movement block). Predator staged
// 1.5u past the exit mouth (x=13.35), inside SCENT_RADIUS_WALK(2.2) once the
// player resumes depositing scent right at the exit -- see the SPEC's
// deviation #5 for why 1.5u, not a naive "6u from the exit" guess.
//
// Speed: walk=6, LOG_CRAWL_SPEED_MUL=0.5 -> crawl pace 3 u/s. Entry-to-exit
// span is 3.7u (2*hx), so a full crossing takes ~1.23s once triggered.
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
    predators: [{ kind: 'wolf', x: 13.35, z: 0, state: 'roam' }],
  });
  await qaHook(page, 'qaTeleportTo', 6.15, 0);   // 2.0u short of the entry mouth, facing +x by default
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  // walk forward (+x) toward and through the log
  await page.keyboard.down('KeyD');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));   // closes the 2.0u gap and crosses LOG_CRAWL_ENTER_RADIUS
  let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have entered crawl on approach').toBe(true);

  let pred = await page.evaluate(() => window.ForestEngine?.qaPredatorState?.(0));
  expect(pred?.state, 'predator must not have caught a trail while player is still inside').toBe('roam');

  // advance well past the ~1.23s a full crossing takes at crawl pace (3.7u / 3u/s)
  await qaHook(page, 'qaAdvance', stepsFor(3));
  ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have exited crawl by now').toBe(false);

  // a couple more deposit intervals (SCENT_DEPOSIT_INTERVAL=0.3s) so the resumed trail lands
  await qaHook(page, 'qaAdvance', stepsFor(1));
  pred = await page.evaluate(() => window.ForestEngine?.qaPredatorState?.(0));
  expect(pred?.state, 'predator should pick up the resumed trail right at the exit').not.toBe('roam');
  await page.keyboard.up('KeyD');
});
