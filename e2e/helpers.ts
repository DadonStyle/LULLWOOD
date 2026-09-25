// Shared driving helpers for the Playwright suite.
//
// LUL-35 (pass 2): every spec had its own copy of the same three things --
// the 1280x720 centre point, the "click the gate then wait for the fade" enter
// step, and the boot sequence (`goto` + the fixed settle wait). They were
// already drifting (different waits, different qaHooks handling), and a spec
// that drifts on *how it starts the game* is a spec that fails for reasons
// that have nothing to do with what it asserts. One copy, here.
//
// Deliberately not a Playwright fixture: the specs need to choose when to boot
// (the console-error tracker has to be attached before `goto`), and a fixture
// that auto-navigates would take that choice away.
import { expect, type Page, type ConsoleMessage, type Locator } from '@playwright/test';

// Centre of the 1280x720 viewport configured in playwright.config.ts. Kept
// only for specs that need a viewport-relative point for something other than
// the entry gate -- `enter()` itself clicks `#gateTitle` (see LUL-5118): a
// fixed coordinate can land on interactive content (e.g. EmbersShop buy
// buttons, which call stopPropagation()) once a project configures a small
// enough viewport, silently breaking every downstream step in that spec.
export const VIEW_X = 640;
export const VIEW_Y = 360;

// The engine chunk is dynamically imported, three is bundled with it, and the
// first frame has to render under swiftshader -- so "loaded" is not "ready".
// Waiting on the engine's own global is the real signal; the suite used a flat
// 4s sleep for this, which is both slower than it needs to be on a good run and
// too short on a bad one.
const ENGINE_READY_TIMEOUT = 30_000;

// LUL-83: every load used to get the byte-identical CONFIG.seed forest, so the
// whole suite was implicitly written against this one layout (predators/cover/
// hiding-spot positions all seed-derived). Now that the engine draws a fresh
// seed per load by default, `boot()` pins every spec back to that same layout
// via `?seed=` unless a spec explicitly opts out with `seed: null` -- that
// keeps the suite passing unmodified instead of making every terrain-dependent
// spec flaky. See engine/forest-engine.js's `resolveInitialSeed()`.
export const QA_PINNED_SEED = 20260718;

/** Collect console/page errors. Must be called before `boot()` to catch load-time errors. */
export function trackConsoleErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m: ConsoleMessage) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { consoleErrors, pageErrors };
}

/** Assert no console or page errors were seen, with the messages in the failure output. */
export function expectNoConsoleErrors({
  consoleErrors,
  pageErrors,
}: ReturnType<typeof trackConsoleErrors>) {
  expect(consoleErrors, consoleErrors.join(' | ')).toHaveLength(0);
  expect(pageErrors, pageErrors.join(' | ')).toHaveLength(0);
}

/**
 * Navigate to the game and wait until the engine has mounted and drawn.
 * `qaHooks` opts into the engine's `?qaHooks=1` test hooks (teleports, remount).
 * `seed` (LUL-83) pins the generated map layout via `?seed=`; defaults to
 * `QA_PINNED_SEED` so every spec keeps exercising the known layout it was
 * written against. Pass `seed: null` to get the real fresh-per-load default.
 * `qaWorld`/`qaNoRender` (LUL-2328) opt into the small-map boot preset and the
 * mesh-construction skip, respectively -- see docs/specs/lul-2328-qa-world-micro-hooks.md.
 * `qaHour` (LUL-2667) pins the hour `timeOfDayFromHour()` sees instead of the
 * real wall-clock hour, for deterministic time-of-day coverage.
 * `qaMissionKind` (LUL-3010) forces generateMap()'s mission draw to a single
 * kind, bypassing both the eligibility gate (MISSION_FAR_UNLOCK_WINS) and the
 * rng draw -- for a test that needs a specific variant (e.g. 'deepwater')
 * deterministically, on a fresh boot where progression has no wins yet.
 * `seedWelcomeSplashSeen` (LUL-2612) pre-seeds `lullwood:welcomeSeen` in
 * localStorage before the first byte loads, same technique as the
 * `RETURNING_PLAYER` init script in returning-player.spec.ts -- every
 * Playwright test gets a brand-new browser context, so without this every
 * spec in the suite would hit the first-visit marketing splash
 * (WelcomeSplash.tsx) instead of `#gate`. Only
 * e2e/welcome-splash.spec.ts passes `false` to exercise the real first-visit
 * path.
 */
export async function boot(
  page: Page,
  {
    qaHooks = false,
    seed = QA_PINNED_SEED,
    // LUL-2377 (founder rule 2026-09-11): the micro world is the DEFAULT. A spec
    // gets the 480u forest only by passing `qaWorld: 'full'` explicitly, and
    // only inside a file tagged `@fullmap` with a `// fullmap-reason:` line --
    // lib/e2e-policy/world-policy.test.ts fails the unit-test run otherwise.
    // The QA rig never runs @fullmap; the `fullmap` Playwright project exists
    // only under E2E_FULLMAP=1 (playwright.config.ts).
    qaWorld = 'micro',
    qaNoRender = false,
    qaHour = null,
    qaMissionKind = null,
    seedWelcomeSplashSeen = true,
  }: {
    qaHooks?: boolean;
    seed?: number | null;
    qaWorld?: 'micro' | 'full';
    qaNoRender?: boolean;
    qaHour?: number | null;
    qaMissionKind?: 'deepwater' | 'oakHollow' | 'slackWater' | null;
    seedWelcomeSplashSeen?: boolean;
  } = {},
) {
  if (seedWelcomeSplashSeen) {
    await page.addInitScript(() => window.localStorage.setItem('lullwood:welcomeSeen', '1'));
  }
  const params = new URLSearchParams();
  if (qaHooks) params.set('qaHooks', '1');
  if (seed !== null) params.set('seed', String(seed));
  if (qaWorld === 'micro') params.set('qaWorld', 'micro');
  if (qaNoRender) params.set('qaNoRender', '1');
  if (qaHour !== null) params.set('qaHour', String(qaHour));
  if (qaMissionKind !== null) params.set('qaMissionKind', qaMissionKind);
  const query = params.toString();
  await page.goto(query ? `/?${query}` : '/', { waitUntil: 'networkidle', timeout: 120_000 });
  // Both canvases exist = the engine's WebGL canvas joined the minimap canvas
  // that ships in the static overlay markup, i.e. init() has actually run.
  await page.waitForFunction(
    () => Boolean(window.ForestEngine) && document.querySelectorAll('canvas').length === 2,
    { timeout: ENGINE_READY_TIMEOUT },
  );
}

/**
 * Click the entry gate and let the fade + pointer-lock request settle.
 * Clicks `#gateTitle` rather than a viewport coordinate -- it's inert copy
 * inside `#gate` (components/Hud.tsx) that no small viewport can ever place
 * over interactive content, unlike a fixed (VIEW_X, VIEW_Y) point.
 */
export async function enter(page: Page) {
  await page.locator('#gateTitle').click();
  await page.waitForTimeout(1200); // gate fade + requestPointerLock settle
}

/** Current objective banner text (empty string when it is not mounted). */
export async function readObjective(page: Page) {
  return (await page.locator('#objective').textContent()) ?? '';
}

type QaHooks = NonNullable<Window['ForestEngine']>;
// `init`/`dispose`/`threeRevision` live on the same object but aren't `qa*`
// test hooks -- excluding non-function members keeps qaHook() from being
// called with something Parameters<> can't apply to.
type QaHookName = {
  [K in keyof QaHooks]: QaHooks[K] extends ((...a: any[]) => any) | undefined ? K : never;
}[keyof QaHooks];

/**
 * Call an already-installed `qa*` hook by name, throwing if it's missing
 * instead of silently no-opping the way `window.ForestEngine?.hook?.()`
 * does. A missing hook almost always means the page wasn't booted with
 * `{ qaHooks: true }` -- with the optional-chained form that produces a
 * downstream `element(s) not found` that reads like a UI bug, not a boot
 * mistake (wiki: game/qa-hooks-silent-noop, PR #199 / LUL-482).
 */
export function qaHook<K extends QaHookName>(page: Page, name: K, ...args: any[]): Promise<any> {
  return page.evaluate(
    (evalArgs: { name: string; args: unknown[] }) => {
      const fn = (window.ForestEngine as any)?.[evalArgs.name];
      if (typeof fn !== 'function') {
        throw new Error(`${evalArgs.name} missing on window.ForestEngine — did you boot with { qaHooks: true }?`);
      }
      return fn(...evalArgs.args);
    },
    { name, args } as { name: string; args: unknown[] },
  );
}

// LUL-2734 established the pattern this generalizes: `qaAdvance()` drives
// `stepFrame()` synchronously inside a single `page.evaluate()` call -- a
// large step count run as one call has to complete inside one Playwright
// command round-trip, so on a contended rig the whole thing fails as a bare
// "Test timeout of Xms exceeded" pointing at qaHook, with no way to tell how
// much of the advance actually landed (root-caused live at
// e2e/cover-feedback.spec.ts's `advanceWithDiagnostics`, proved by 2
// consecutive green nightlies post-fix, LUL-2734 comment 2026-09-16T08:57Z).
// LUL-2802: `e2e/day-night-cycle.spec.ts` and `e2e/charge-dodge.spec.ts`
// each drive a single 120-165-step `qaAdvance()` the same unchunked way and
// showed the identical bare-timeout signature in CI (run 35086869286, shard
// 1/6) while passing cleanly every time run in isolation locally -- the same
// rig-contention shape, not a logic regression. Chunking doesn't change the
// simulation (same total fixed-dt steps, same order), only what a slow rig
// fails with.
const ADVANCE_CHUNK = 25;
const ADVANCE_CHUNK_TIMEOUT_MS = 6_000;

export async function advanceChunked(page: Page, totalSteps: number, chunkSize = ADVANCE_CHUNK): Promise<void> {
  for (let done = 0; done < totalSteps; done += chunkSize) {
    const steps = Math.min(chunkSize, totalSteps - done);
    await Promise.race([
      qaHook(page, 'qaAdvance', steps),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `qaAdvance(${steps}) did not return within ${ADVANCE_CHUNK_TIMEOUT_MS}ms ` +
                  `(${done}/${totalSteps} fixed-dt steps already advanced)`,
              ),
            ),
          ADVANCE_CHUNK_TIMEOUT_MS,
        ),
      ),
    ]);
  }
}

/**
 * LUL-2312: #objective/#actionPrompt/#throwPrompt/#chargePrompt/#status are
 * five always-mounted rows inside #actionSlot now (components/Hud.tsx),
 * each an <ActionPrompt> (components/ActionPrompt.tsx) that toggles
 * `data-visible="0"|"1"` on the row rather than mounting/unmounting it --
 * the row's grid track stays laid out either way (no pop-in layout shift).
 * Specs must assert on the attribute instead of the old `toHaveCount(0)` /
 * `toBeVisible()` pair, which no longer distinguishes the two states now
 * that the element is always in the DOM.
 */
export async function expectRowVisible(page: Page, id: string, timeout = 3_000) {
  await expect(page.locator(`#${id}`)).toHaveAttribute('data-visible', '1', { timeout });
}

export async function expectRowHidden(page: Page, id: string, timeout = 3_000) {
  await expect(page.locator(`#${id}`)).toHaveAttribute('data-visible', '0', { timeout });
}

/**
 * `toBeVisible()` only checks that an element isn't `display:none` and has a
 * non-zero bounding box -- it does not check the box is inside the viewport
 * (LUL-160: the canvas passed `toBeVisible()` while rendered a full viewport
 * off-screen). This asserts the element's box actually intersects what a
 * player would see.
 */
export async function assertInViewport(locator: Locator, page: Page, label = '') {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(viewport, `${label}: page must have a viewport size`).not.toBeNull();
  const { width: vw, height: vh } = viewport!;
  expect(box, `${label}: element must have a bounding box`).not.toBeNull();
  expect(box!.x, `${label}: left edge in viewport`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label}: top edge in viewport`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label}: right edge in viewport`).toBeLessThanOrEqual(vw + 1);
  expect(box!.y + box!.height, `${label}: bottom edge in viewport`).toBeLessThanOrEqual(vh + 1);
}
