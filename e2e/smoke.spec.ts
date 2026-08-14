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
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const VIEW_X = 640;
const VIEW_Y = 360;

function trackConsoleErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m: ConsoleMessage) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { consoleErrors, pageErrors };
}

async function enter(page: Page) {
  await page.mouse.click(VIEW_X, VIEW_Y);
  await page.waitForTimeout(1200); // gate fade + requestPointerLock settle
}

async function readObjective(page: Page) {
  return (await page.locator('#objective').textContent()) ?? '';
}

test.describe('initial load', () => {
  test('title gate, engine API, two canvases, no console errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = trackConsoleErrors(page);

    await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);

    const load = await page.evaluate(() => ({
      title: document.title,
      // LUL-28: three is bundled into the engine module now, so there is no
      // `window.THREE` to read a revision off. The engine re-exports it as
      // `ForestEngine.threeRevision` so this pin stays checkable from here.
      threeRevision: (window as any).ForestEngine?.threeRevision ?? null,
      // Nothing else may leak onto window -- asserts the <script>-tag/global
      // loading path is really gone, not just unused.
      threeGlobal: typeof (window as any).THREE,
      engineApi:
        typeof (window as any).ForestEngine === 'object'
          ? Object.keys((window as any).ForestEngine).sort()
          : null,
      canvases: [...document.querySelectorAll('canvas')].map((c) => [
        (c as HTMLCanvasElement).width,
        (c as HTMLCanvasElement).height,
      ]),
      text: document.body.innerText,
    }));

    expect(load.title).toBe('Lullwood');
    expect(String(load.threeRevision)).toBe('128');
    expect(load.threeGlobal, 'three must not leak onto window (LUL-28)').toBe('undefined');
    expect(load.engineApi).toEqual(['dispose', 'init', 'threeRevision']);
    expect(load.canvases).toHaveLength(2);
    expect(load.text).toContain('LULLWOOD');
    expect(load.text).toContain('click to enter');
    expect(load.text).toContain('WASD');
    expect(load.text).toContain('hide from predators');

    await enter(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');

    const playing = await page.evaluate(() => document.body.innerText);
    expect(playing).not.toContain('click to enter');
    expect(playing).toMatch(/Find the lost child/);

    expect(consoleErrors, consoleErrors.join(' | ')).toHaveLength(0);
    expect(pageErrors, pageErrors.join(' | ')).toHaveLength(0);
  });
});

// `H` hide toggle: e2e/hide.spec.ts (deterministic, no baby-walk needed, kept
// separate so it stays fast). Mount/unmount/remount + dispose() lifecycle:
// e2e/lifecycle.spec.ts (needs `next dev` for StrictMode, so it runs under a
// separate Playwright project against a different webServer -- see
// playwright.config.ts).

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
    const { consoleErrors, pageErrors } = trackConsoleErrors(page);

    await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);

    // Pre-entry: gate is mounted, objective/status are not -- the old
    // version kept #objective/#status in the DOM at all times.
    await expect(page.locator('#gate')).toHaveCount(1);
    await expect(page.locator('#objective')).toHaveCount(0);
    await expect(page.locator('#status')).toHaveCount(0);

    await enter(page);
    await expect(page.locator('#gate')).toHaveCount(0); // unmounted, not just hidden
    await expect(page.locator('#objective')).toBeVisible();

    // Drive the range inputs like a real drag would (Playwright's `fill()`
    // refuses `type=range`): set the DOM value directly and dispatch the
    // same 'input' event React's onChange listens for.
    await page.locator('#pace').evaluate((el: HTMLInputElement) => {
      el.value = '10';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#paceVal')).toHaveText('10');

    await page.locator('#fog').evaluate((el: HTMLInputElement) => {
      el.value = '0.09';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#fogVal')).toHaveText('.090');

    await expect(page.locator('#sound')).toHaveText('Sound: on');
    await page.locator('#sound').click();
    await expect(page.locator('#sound')).toHaveText('Sound: off');
    await page.locator('#sound').click();
    await expect(page.locator('#sound')).toHaveText('Sound: on');

    expect(consoleErrors, consoleErrors.join(' | ')).toHaveLength(0);
    expect(pageErrors, pageErrors.join(' | ')).toHaveLength(0);
  });
});

test.describe('lift the child / win', () => {
  // Walking a computed straight line to the child (BABY_X/BABY_Z from the seeded
  // map RNG, see wiki:systems/headless-qa-rig) is not reliable here: this seed's
  // spawn sits in a pocket where -- confirmed by hand with a throwaway script --
  // almost every heading out to +-90 degrees snags on a tree within a couple of
  // meters, same as a real player would have to route around by eye. That is a
  // property of "walk a straight vector across procedural terrain", not evidence
  // the lift/win state machine is broken, and scripting real obstacle-avoidance
  // navigation is out of scope for what this test is trying to prove. So it uses
  // the `qaTeleportNearBaby` hook (public/forest-engine.js, opt-in via
  // `?qaHooks=1`, same convention as GameLoader's `__qaRemount`) to place the
  // player at pickup range directly and assert the actual mechanic: E ->
  // cinematic -> win screen. Reliable child-seeking navigation across arbitrary
  // procedural terrain is filed separately (see LUL-21 handoff comment).
  test('teleport to pickup range, pressing E, and the win screen', async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto('/?qaHooks=1', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);
    await enter(page);

    await page.evaluate(() => (window as any).ForestEngine.qaTeleportNearBaby());
    await page.waitForTimeout(300); // let the next tick() recompute canPickup from the new position

    const objective = await readObjective(page);
    expect(objective, 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

    await page.keyboard.press('KeyE');
    // Pickup cinematic runs ~11.3s (public/forest-engine.js key3 timeline) before
    // finishPickup() flips the win screen on.
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#winScreen h1')).toHaveText('YOU WON');
  });
});

test.describe('predator catch / death', () => {
  test('a hunting predator closes the distance and kills you', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?qaHooks=1', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);
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
    const lured = await page.evaluate(() => (window as any).ForestEngine.qaLurePredator());
    expect(['wolf', 'bear', 'lion'], 'a predator was lured').toContain(lured);

    // NOTE: which species this is depends on which spawned nearest for the seed.
    // Pinning a specific one needs a spawn-point hook; filed as follow-up.
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

