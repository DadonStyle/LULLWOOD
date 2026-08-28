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

// Centre of the 1280x720 viewport configured in playwright.config.ts. The gate
// covers the whole viewport, so any point works -- centre is just the honest
// "where a player would click".
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
 */
export async function boot(
  page: Page,
  { qaHooks = false, seed = QA_PINNED_SEED }: { qaHooks?: boolean; seed?: number | null } = {},
) {
  const params = new URLSearchParams();
  if (qaHooks) params.set('qaHooks', '1');
  if (seed !== null) params.set('seed', String(seed));
  const query = params.toString();
  await page.goto(query ? `/?${query}` : '/', { waitUntil: 'networkidle', timeout: 60_000 });
  // Both canvases exist = the engine's WebGL canvas joined the minimap canvas
  // that ships in the static overlay markup, i.e. init() has actually run.
  await page.waitForFunction(
    () => Boolean(window.ForestEngine) && document.querySelectorAll('canvas').length === 2,
    { timeout: ENGINE_READY_TIMEOUT },
  );
}

/** Click the entry gate and let the fade + pointer-lock request settle. */
export async function enter(page: Page) {
  await page.mouse.click(VIEW_X, VIEW_Y);
  await page.waitForTimeout(1200); // gate fade + requestPointerLock settle
}

/** Current objective banner text (empty string when it is not mounted). */
export async function readObjective(page: Page) {
  return (await page.locator('#objective').textContent()) ?? '';
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
