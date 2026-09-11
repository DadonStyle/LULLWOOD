// LUL-2310: F11 / Alt+Enter fullscreen shortcut, routed through
// lib/game/fullscreen.ts's toggleFullscreen() -- the same function
// components/GameMenu.tsx's `menuFullscreen` button calls (see docs/
// ELEMENTS.md's LUL-2310 entry for the full browser collision-matrix
// writeup). Chromium can't actually enter real OS fullscreen headlessly
// (requestFullscreen()'s user-activation check has no gesture chain to
// satisfy here), so every test stubs document.documentElement.
// requestFullscreen / document.exitFullscreen before boot() and asserts the
// *call path* -- was it invoked, was the key's browser default prevented --
// rather than a real visual fullscreen transition. Safari/Firefox stay
// manual: playwright.config.ts is chromium-only.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

async function stubFullscreenAPI(page: import('@playwright/test').Page) {
  // Patched on the prototypes, not the `document`/`document.documentElement`
  // instances: an init script runs before the HTML is parsed, so
  // `document.documentElement` is still `null` at this point and an instance
  // assignment throws (silently, since this isn't strict-mode script) and
  // never takes effect. `Element`/`Document` themselves already exist.
  await page.addInitScript(() => {
    (window as any).__fsCalls = { request: 0, exit: 0 };
    let active = false;
    Object.defineProperty(Document.prototype, 'fullscreenElement', {
      configurable: true,
      get() {
        return active ? document.documentElement : null;
      },
    });
    Element.prototype.requestFullscreen = function () {
      (window as any).__fsCalls.request++;
      active = true;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    Document.prototype.exitFullscreen = function () {
      (window as any).__fsCalls.exit++;
      active = false;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
}

function fsCalls(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).__fsCalls as { request: number; exit: number });
}

/** Dispatches a real `keydown` on `window` (matches the engine's `on(window, 'keydown', ...)`
 * listener) and returns whether the event's browser default was prevented. */
function pressFullscreenKey(
  page: import('@playwright/test').Page,
  opts: { code: string; altKey?: boolean; repeat?: boolean },
) {
  return page.evaluate(({ code, altKey, repeat }) => {
    const e = new KeyboardEvent('keydown', {
      code,
      altKey: !!altKey,
      repeat: !!repeat,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, opts);
}

test.describe('fullscreen shortcut (F11 / Alt+Enter)', () => {
  test('F11 on the gate screen requests fullscreen and prevents the browser default', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);

    const prevented = await pressFullscreenKey(page, { code: 'F11' });
    expect(prevented).toBe(true);
    expect(await fsCalls(page)).toEqual({ request: 1, exit: 0 });
  });

  test('F11 in-run toggles fullscreen on, then off', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);
    await enter(page);

    await pressFullscreenKey(page, { code: 'F11' });
    expect(await fsCalls(page)).toEqual({ request: 1, exit: 0 });

    await pressFullscreenKey(page, { code: 'F11' });
    expect(await fsCalls(page)).toEqual({ request: 1, exit: 1 });
  });

  test('Alt+Enter drives the same path as F11, on the gate and in-run alike', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);

    let prevented = await pressFullscreenKey(page, { code: 'Enter', altKey: true });
    expect(prevented).toBe(true);
    expect(await fsCalls(page)).toEqual({ request: 1, exit: 0 });

    await enter(page);
    prevented = await pressFullscreenKey(page, { code: 'Enter', altKey: true });
    expect(prevented).toBe(true);
    expect(await fsCalls(page)).toEqual({ request: 1, exit: 1 });
  });

  test('a plain Enter (no Alt) is not the shortcut', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);

    await pressFullscreenKey(page, { code: 'Enter' });
    expect(await fsCalls(page)).toEqual({ request: 0, exit: 0 });
  });

  test('e.repeat is ignored -- a held key does not spam request/exit calls', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);

    await pressFullscreenKey(page, { code: 'F11', repeat: true });
    await pressFullscreenKey(page, { code: 'Enter', altKey: true, repeat: true });
    expect(await fsCalls(page)).toEqual({ request: 0, exit: 0 });
  });

  test('does nothing once the death screen is up', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    await qaHook(page, 'qaTriggerDeath', 'wolf', 'chase');
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });

    await pressFullscreenKey(page, { code: 'F11' });
    expect(await fsCalls(page)).toEqual({ request: 0, exit: 0 });
  });

  test('menuFullscreen label flips on a synthetic fullscreenchange event from the key path', async ({ page }) => {
    await stubFullscreenAPI(page);
    await boot(page);
    await enter(page);

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    const btn = page.getByTestId('menuFullscreen');
    await expect(btn).toHaveText(/Fullscreen: off/);

    await pressFullscreenKey(page, { code: 'F11' });
    await expect(btn).toHaveText(/Fullscreen: on/);
  });
});
