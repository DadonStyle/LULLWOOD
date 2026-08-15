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
import { expect, type Page, type ConsoleMessage } from '@playwright/test';

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
 */
export async function boot(page: Page, { qaHooks = false }: { qaHooks?: boolean } = {}) {
  await page.goto(qaHooks ? '/?qaHooks=1' : '/', { waitUntil: 'networkidle', timeout: 60_000 });
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
