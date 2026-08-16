// Lullwood headless smoke suite. Ported from the VP R&D's proof-of-capability probe
// (shared/qa/smoke.mjs, wiki: systems/headless-qa-rig) into @playwright/test, then
// extended past the initial-load-only coverage per LUL-20 / LUL-21.
//
// The standalone shared/qa/smoke.mjs is kept working separately -- it is how the rig
// gets re-verified without checking out the repo.
//
// Do not add perf/frame-timing assertions here: rendering goes through swiftshader
// (no GPU in this environment), so timing numbers would measure the software
// rasterizer, not the game. Do not assert on audio *behavior* -- the browser is
// launched with --mute-audio (playwright.config.ts), so the WebAudio graph runs but
// is never actually heard; only AudioContext lifecycle (created/closed) is checked.
// Boot/enter/console-error helpers are shared with the other specs in
// e2e/helpers.ts (LUL-35 pass 2) -- each file used to carry its own copy.
import { test, expect } from '@playwright/test';
import { boot, enter, expectNoConsoleErrors, readObjective, trackConsoleErrors } from './helpers';

test.describe('initial load', () => {
  test('title gate, engine API, two canvases, no console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    await boot(page);

    const load = await page.evaluate(() => ({
      title: document.title,
      // LUL-28: three is bundled into the engine module now, so there is no
      // `window.THREE` to read a revision off. The engine re-exports it as
      // `ForestEngine.threeRevision` so this pin stays checkable from here.
      threeRevision: window.ForestEngine?.threeRevision ?? null,
      engineInit: typeof window.ForestEngine?.init,
      engineDispose: typeof window.ForestEngine?.dispose,
      canvases: [...document.querySelectorAll('canvas')].map((c) => [
        (c as HTMLCanvasElement).width,
        (c as HTMLCanvasElement).height,
      ]),
      text: document.body.innerText,
    }));

    expect(load.title).toBe('Lullwood');
    expect(String(load.threeRevision)).toBe('128');
    // Assert the contract (init/dispose are callable), not the exact key list --
    // an exact-equality check on Object.keys(ForestEngine) fails every time the
    // engine gains a key for an unrelated reason (it did when `threeRevision` was
    // added; see shared/qa/smoke.mjs, which never regressed on this). Reading
    // `window.THREE` was also dropped here: the bundled build intentionally never
    // sets it (LUL-28), so it adds no signal beyond what `engineInit`/`engineDispose`
    // already cover.
    expect(load.engineInit, 'ForestEngine.init must be callable').toBe('function');
    expect(load.engineDispose, 'ForestEngine.dispose must be callable').toBe('function');
    expect(load.canvases).toHaveLength(2);
    expect(load.text).toContain('LULLWOOD');
    expect(load.text).toContain('click to enter');
    expect(load.text).toContain('WASD');
    expect(load.text).toContain('hold still');

    await enter(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');

    const playing = await page.evaluate(() => document.body.innerText);
    expect(playing).not.toContain('click to enter');
    expect(playing).toMatch(/Find the lost child/);

    expectNoConsoleErrors(errors);
  });
});

// `H` hide toggle: e2e/hide.spec.ts (LUL-29 -- deterministic, no baby-walk
// needed, kept separate so it stays fast). Mount/unmount/remount + dispose()
// lifecycle: e2e/lifecycle.spec.ts (needs `next dev` for StrictMode, so it
// runs under a separate Playwright project against a different webServer --
// see playwright.config.ts).

test.describe('HUD lifted to React (LUL-34)', () => {
  // Before LUL-34, the engine wrote directly into a DOM overlay that was
  // always present, just toggled via `style.display`. Now GameCanvas/Hud
  // conditionally *mount* these nodes from React state, and the panel
  // controls call into the engine's action API (setPace/setFog/toggleSound)
  // instead of native `addEventListener` handlers the engine installed
  // itself. Assert the parts of that rewrite a plain textContent check
  // wouldn't catch: real mount/unmount, and the round trip through React's
  // event handlers back into the engine still lands.
  test('gate/objective mount and unmount with engine state; panel controls round-trip through React into the engine', async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);

    await boot(page);

    // Pre-entry: gate is mounted, objective/status are not -- the old
    // version kept #objective/#status in the DOM at all times.
    await expect(page.locator('#gate')).toHaveCount(1);
    await expect(page.locator('#objective')).toHaveCount(0);
    await expect(page.locator('#status')).toHaveCount(0);

    // LUL-35 (pass 2) regression guard: the panel must open showing the values
    // the engine is actually running (CONFIG.walk 6, CONFIG.fog 0.04). It used
    // to open at mist `.045` while the scene rendered `0.04`, because that
    // default was written out by hand in three places and two of them drifted.
    await expect(page.locator('#paceVal')).toHaveText('6');
    await expect(page.locator('#fogVal')).toHaveText('.040');

    await enter(page);
    await expect(page.locator('#gate')).toHaveCount(0); // unmounted, not just hidden
    await expect(page.locator('#objective')).toBeVisible();

    // Drive the range inputs like a real drag would (Playwright's `fill()`
    // refuses `type=range`). Assigning `el.value` is NOT enough: React installs
    // a value tracker on every input it manages, and a direct assignment updates
    // that tracker's cached value too -- so React concludes nothing changed and
    // never fires onChange. A real drag never hits this, because the browser
    // sets the value through the native setter. Do the same here: call the
    // native setter explicitly so the tracker goes stale, then dispatch 'input'.
    const setRange = (selector: string, value: string) =>
      page.locator(selector).evaluate((el, v) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!;
        nativeSetter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);

    await setRange('#pace', '10');
    await expect(page.locator('#paceVal')).toHaveText('10');

    await setRange('#fog', '0.09');
    await expect(page.locator('#fogVal')).toHaveText('.090');

    // LUL-87/LUL-44: a real Playwright `.click()` here chains several CDP
    // round trips (hover, hit-test recheck, stability-across-frames,
    // mousedown, mouseup), each needing the renderer main thread to respond.
    // Under this rig's software rendering plus real CI contention that thread
    // can be saturated for extended stretches (wiki:systems/dt-clamp-vs-walltime),
    // so the cumulative wait can blow even a 90s budget -- diagnosed by
    // sampling `document.elementFromPoint` at #sound's exact coordinates every
    // 300ms through a reproduced contention window matching the CI failure
    // signature: the canvas never won the hit test (0/75 samples), which rules
    // out "canvas intercepts the click" as a product bug. `el.click()` still
    // dispatches a real, bubbling DOM click event that React's synthetic
    // handler treats identically to a physical one -- it just skips
    // Playwright's own multi-step actionability polling, which is what was
    // actually timing out.
    const clickButton = (selector: string) =>
      page.locator(selector).evaluate((el) => (el as HTMLElement).click());

    await expect(page.locator('#sound')).toHaveText('Sound: on');
    await clickButton('#sound');
    await expect(page.locator('#sound')).toHaveText('Sound: off');
    await clickButton('#sound');
    await expect(page.locator('#sound')).toHaveText('Sound: on');

    expectNoConsoleErrors(errors);
  });
});

test.describe('lift the child / carry home / win', () => {
  // Walking a computed straight line to the child (BABY_X/BABY_Z from the seeded
  // map RNG, see wiki:systems/headless-qa-rig) is not reliable here: this seed's
  // spawn sits in a pocket where -- confirmed by hand with a throwaway script --
  // almost every heading out to +-90 degrees snags on a tree within a couple of
  // meters, same as a real player would have to route around by eye. That is a
  // property of "walk a straight vector across procedural terrain", not evidence
  // the lift/win state machine is broken, and scripting real obstacle-avoidance
  // navigation is out of scope for what this test is trying to prove. So it uses
  // the `qaTeleportNearBaby` / `qaTeleportHome` hooks (engine/forest-engine.js,
  // opt-in via `?qaHooks=1`, same convention as GameLoader's `__qaRemount`) to
  // place the player at pickup range and then at the home landmark directly, and
  // assert the actual mechanic: E -> cinematic -> carrying -> arrive home -> win
  // screen. Reliable child-seeking navigation across arbitrary procedural terrain
  // is filed separately (see LUL-21 handoff comment).
  test('pressing E lifts the child; only reaching home (not the pickup) shows the win screen', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
    await page.waitForTimeout(300); // let the next tick() recompute canPickup from the new position

    const objective = await readObjective(page);
    expect(objective, 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

    await page.keyboard.press('KeyE');

    // LUL-38: pickup() no longer wins by itself -- the arms cinematic runs
    // ~11.3s (engine/forest-engine.js key3 timeline) and finishPickup() then
    // hands off to a "carry the child home" phase; only arriving at
    // CONFIG.home flips the win screen. Poll the HUD text for that handoff
    // instead of a fixed wall-clock sleep: game time and wall time diverge
    // under this rig's software rendering (wiki systems/dt-clamp-vs-walltime),
    // so a hardcoded ~11.3s wait would flake on a slower run.
    await expect
      .poll(() => readObjective(page), {
        message: 'pickup did not hand off to the carry-home objective (LUL-38)',
        timeout: 30_000,
      })
      .toContain('Carry the child home');
    await expect(page.locator('#winScreen'), 'reaching pickup range alone must not win (LUL-38)').toBeHidden();

    await page.evaluate(() => window.ForestEngine?.qaTeleportHome?.());
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#winScreen h1')).toHaveText('YOU WON');
  });
});

test.describe('predator catch / death', () => {
  test('a hunting predator closes the distance and kills you', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    // In-game, the trigger is standing still: if no predator has been within 20
    // units for 30s, the nearest is forced to hunt (`nearP.hunt = true`) and does
    // not give up. Waiting that out here does not work -- those 30s are GAME
    // seconds, and engine/forest-engine.js clamps dt to 0.05, so at the ~12 fps
    // this rig gets from software rendering, game time runs at ~63% of wall clock
    // and the animal's approach is slowed by the same factor. The old version of
    // this test waited 100s of wall clock for a sequence that needs far more, and
    // failed for reasons unrelated to the mechanic. See wiki:
    // systems/dt-clamp-vs-walltime.
    //
    // qaLurePredator() sets that same `hunt` flag and places the animal 6 units
    // out -- outside catch range (`p.rad + 1.3`, max 2.8). What is under test is
    // unchanged: it still has to close the distance itself, and the catch and
    // triggerDeath paths run for real. Only the waiting is skipped.
    const lured = await page.evaluate(() => window.ForestEngine?.qaLurePredator?.() ?? null);
    expect(['wolf', 'bear', 'lion'], 'a predator was lured').toContain(lured);

    // NOTE (LUL-29): which species this is depends on which spawned nearest for
    // the seed -- this run-to-run variation in death-path coverage is a
    // documented, accepted limitation, not silently dropped. Pinning a specific
    // species needs an engine-side `?qaHooks=1` hook (qaLurePredator only takes
    // "nearest"); that is real engine-touching work out of scope for a QA-only
    // pass, so it's filed as LUL-55 for the Founding Engineer rather than done
    // here. Once that hook lands, extend this test to loop all three kinds.
    const deathScreen = page.locator('#deathScreen');
    await expect(deathScreen).toBeVisible({ timeout: 30_000 });

    const kind = await page.locator('#deathKind').textContent();
    expect(['wolf', 'bear', 'lion']).toContain(kind);

    // The death "cutscene" is a real <video> overlay, not a CSS animation --
    // confirm it actually plays (paused stays false) rather than just being shown.
    const videoState = await page.evaluate(() => {
      const v = document.getElementById('deathVideo') as HTMLVideoElement | null;
      return v ? { display: getComputedStyle(v).display, paused: v.paused, currentTime: v.currentTime } : null;
    });
    expect(videoState?.display).toBe('block');
    expect(videoState?.paused).toBe(false);

    // CUT_END = 3.7s in forest-engine.js; the loss text reveals once the video ends.
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await expect(page.locator('#deathText h1')).toHaveText('YOU LOSE');
  });
});

