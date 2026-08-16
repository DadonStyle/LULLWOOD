// LUL-160: the WebGL canvas (engine/forest-engine.js's `renderer.domElement`)
// used to be a plain static-flow element that only ever looked full-screen
// because it was the sole thing in <body>'s normal flow. LUL-46's SSR content
// shell (app/page.tsx's <main class="about">) added real in-flow height
// *before* it in document order, which silently pushed the canvas hundreds of
// vh down the page -- invisible on both desktop and mobile, and easy to miss
// because html/body's overflow:hidden hid the scrollbar that would otherwise
// have revealed it. The fix pins the canvas with `position: fixed; inset: 0`
// (engine/forest-engine.js) so its position no longer depends on sibling
// content at all. This spec pins that contract down: the canvas must cover
// the full viewport, at (0,0), regardless of what else is in the document,
// on both a desktop and a mobile viewport.
import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

async function canvasRect(page: Page) {
  return page.evaluate(() => {
    // The minimap (#minimap) is the other <canvas> on the page -- the game's
    // WebGL canvas is the one without that id.
    const el = [...document.querySelectorAll('canvas')].find((c) => c.id !== 'minimap');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: style.position };
  });
}

test.describe('game canvas covers the full screen', () => {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    test(`${name} viewport: canvas fills (0,0)-(w,h), unaffected by the SSR content shell below it`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await boot(page);

      const rect = await canvasRect(page);
      expect(rect, 'the game canvas must be present').not.toBeNull();
      expect(rect!.position, 'canvas must be removed from document flow, not rely on being the only flow content').toBe('fixed');
      expect(rect!.x).toBe(0);
      expect(rect!.y).toBe(0);
      expect(rect!.width).toBe(viewport.width);
      expect(rect!.height).toBe(viewport.height);

      // The regression class this guards: nothing below the canvas in the
      // document (the SSR .about content shell) should be reachable inside
      // the viewport -- if it is, the canvas has been pushed down again.
      const aboutVisibleInViewport = await page.evaluate(() => {
        const about = document.querySelector('main.about');
        if (!about) return false;
        const r = about.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      });
      expect(aboutVisibleInViewport, '.about content shell must stay below the fold, not overlap the game viewport').toBe(false);
    });
  }
});
