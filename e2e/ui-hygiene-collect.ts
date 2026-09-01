// LUL-UI-HYGIENE: the browser half of lib/ui/hygiene.ts.
// collectElems() runs inside the page and returns the geometry the pure rules
// judge. Kept in its own file so both the CI spec (e2e/mobile/ui-hygiene.spec.ts)
// and the screenshot CLI (scripts/ui-audit.mjs) measure the identical thing -- a
// second, drifting copy of this walker is exactly how a hygiene gate stops
// matching what a human sees.
import type { Page } from '@playwright/test';
import type { Elem, Viewport } from '@/lib/ui/hygiene';
import { OPAQUE_ALPHA, BACKDROP_COVERAGE } from '@/lib/ui/hygiene';

export async function collectElems(page: Page, opts: { opaqueAlpha?: number; backdrop?: number } = {}) {
  return page.evaluate(
    ({ opaqueAlpha, backdrop }) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const els: any[] = [];
      const alphaOf = (bg: string) => {
        const m = /rgba?\(([^)]+)\)/.exec(bg);
        if (!m) return 0;
        const parts = m[1].split(',').map(s => parseFloat(s));
        return parts.length > 3 ? parts[3] : 1;
      };
      const keyOf = (e: Element) => {
        const t = e.getAttribute('data-testid');
        if (t) return '[' + t + ']';
        if (e.id) return '#' + e.id;
        const c = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className.trim() : '';
        if (c) return '.' + c.split(/\s+/)[0];
        return e.tagName.toLowerCase();
      };
      const walk = (root: Element) => {
        for (const c of Array.from(root.children)) {
          const cs = getComputedStyle(c);
          const r = c.getBoundingClientRect();
          const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
            parseFloat(cs.opacity) > 0.01 && r.width > 1 && r.height > 1;
          // Below-the-fold SSR content shell (app/page.tsx main.about) is not
          // game chrome and is never on screen for a player -- body has
          // overflow:hidden. Excluded by the viewport test, not by name.
          const onScreen = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
          if (visible && onScreen) {
            const ownText = Array.from(c.childNodes)
              .filter(n => n.nodeType === 3)
              .map(n => (n.textContent || '').trim())
              .join(' ')
              .trim();
            // `cursor` INHERITS. #gate carries `cursor: pointer` so its title, subtitle and every <b> reported as pointer targets; the first run flagged ten "undersized tap targets" that are body copy. Closed by requiring the element to ORIGINATE the pointer cursor (parent does not already have it), unless it is a real control or carries a testid.
            const parentCs = c.parentElement ? getComputedStyle(c.parentElement) : null;
            const ownsPointer = cs.cursor === 'pointer' && parentCs?.cursor !== 'pointer';
            const tappable = cs.pointerEvents !== 'none' && (
              ['BUTTON', 'A', 'INPUT', 'SELECT'].includes(c.tagName) ||
              c.hasAttribute('data-testid') ||
              ownsPointer);
            els.push({
              key: keyOf(c),
              x: r.x, y: r.y, w: r.width, h: r.height,
              fontPx: parseFloat(cs.fontSize),
              tappable,
              pointerEvents: cs.pointerEvents,
              position: cs.position,
              opaqueBg: alphaOf(cs.backgroundColor) >= opaqueAlpha,
              isText: ownText.length > 0,
              isBackdrop: (r.width * r.height) >= vw * vh * backdrop,
            });
          }
          walk(c);
        }
      };
      walk(document.body);
      return { vp: { w: vw, h: vh }, els };
    },
    { opaqueAlpha: opts.opaqueAlpha ?? OPAQUE_ALPHA, backdrop: opts.backdrop ?? BACKDROP_COVERAGE },
  ) as Promise<{ vp: Viewport; els: Elem[] }>;
}

// The founder's two-tap rule, measured rather than asserted: from a cold
// in-game screen, how many taps to reach each named control. -1 = unreachable.
export async function tapDepth(page: Page, selector: string, path: string[]): Promise<number> {
  const visible = () => page.locator(selector).first().isVisible().catch(() => false);
  if (await visible()) return 0;
  let taps = 0;
  for (const step of path) {
    const el = page.locator(step).first();
    if (!(await el.isVisible().catch(() => false))) return -1;
    await el.click();
    taps++;
    await page.waitForTimeout(200);
    if (await visible()) return taps;
  }
  return -1;
}
