#!/usr/bin/env node
// LUL-UI-HYGIENE: the design-time half of the UI audit.
//
// e2e/mobile/ui-hygiene.spec.ts is the gate -- it asserts and fails CI. This is
// the same measurement pointed at a human: it writes a screenshot and a plain
// defect list per screen, for every viewport a player can actually be in. It is
// how the 2026-08-30 mobile audit was produced.
//
//   node scripts/ui-audit.mjs --port 3211 --out /tmp/uiaudit
//
// Assumes a build is already being served on --port (npm run build && npm run
// start -- -p PORT). It deliberately does not start one: pointing this at a
// stale server is the single easiest way to audit a build you are not looking
// at, so the port is always explicit.
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit } from '../lib/ui/hygiene.ts';

// Same guard playwright.config.ts:8-13 carries, and for the same reason: this
// box has no root and no system Chromium deps, so the browser's shared libs
// live in a user-owned apt-download prefix (wiki: systems/headless-qa-rig).
// This script does not go through playwright.config.ts, so without repeating
// the guard here `chromium.launch()` dies on `libasound.so.2: cannot open
// shared object file` -- which is exactly how it failed the first time it was
// run on this rig. CI runners have root and get real libs from
// `playwright install --with-deps`, so leave them alone.
if (!process.env.CI) {
  const prefix = '/home/noam/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu';
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${prefix}:${process.env.LD_LIBRARY_PATH}`
    : prefix;
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const PORT = arg('port', '3111');
const OUT = arg('out', './ui-audit-out');
const BASE = `http://127.0.0.1:${PORT}`;

// Landscape first: components/OrientationGate.tsx blocks portrait play, so
// 851x393 is the screen a mobile player is actually looking at. Portrait is
// still captured -- the rotate prompt is a screen too, and it can regress.
const VIEWPORTS = [
  { label: 'mobile-landscape', device: 'Pixel 5', viewport: { width: 851, height: 393 } },
  { label: 'mobile-portrait', device: 'Pixel 5', viewport: { width: 393, height: 851 } },
  { label: 'desktop', device: null, viewport: { width: 1280, height: 720 } },
];

const STATES = [
  ['gate', async () => {}],
  ['ingame', async (p) => { await p.locator('#gate').click(); await p.waitForTimeout(2000); }],
  ['settings', async (p) => { await p.locator('#settingsBtn').click().catch(() => {}); await p.waitForTimeout(400); }],
];

// Inlined rather than imported from e2e/ui-hygiene-collect.ts: that file is
// TypeScript compiled by Playwright's own loader, which this plain-node script
// does not run under. Keep the two in sync -- the rules they feed are shared.
const COLLECT = `(${function () {
  const vw = window.innerWidth, vh = window.innerHeight;
  const els = [];
  const alphaOf = (bg) => {
    const m = /rgba?\(([^)]+)\)/.exec(bg);
    if (!m) return 0;
    const parts = m[1].split(',').map(Number);
    return parts.length > 3 ? parts[3] : 1;
  };
  const keyOf = (e) => {
    const t = e.getAttribute('data-testid');
    if (t) return '[' + t + ']';
    if (e.id) return '#' + e.id;
    const c = typeof e.className === 'string' ? e.className.trim() : '';
    return c ? '.' + c.split(/\s+/)[0] : e.tagName.toLowerCase();
  };
  const walk = (root) => {
    for (const c of Array.from(root.children)) {
      const cs = getComputedStyle(c), r = c.getBoundingClientRect();
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
        parseFloat(cs.opacity) > 0.01 && r.width > 1 && r.height > 1;
      const onScreen = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      if (visible && onScreen) {
        const ownText = Array.from(c.childNodes).filter(n => n.nodeType === 3)
          .map(n => (n.textContent || '').trim()).join(' ').trim();
        const parentCs = c.parentElement ? getComputedStyle(c.parentElement) : null;
        const ownsPointer = cs.cursor === 'pointer' && (!parentCs || parentCs.cursor !== 'pointer');
        els.push({
          key: keyOf(c), x: r.x, y: r.y, w: r.width, h: r.height,
          fontPx: parseFloat(cs.fontSize),
          tappable: cs.pointerEvents !== 'none' &&
            (['BUTTON', 'A', 'INPUT', 'SELECT'].includes(c.tagName) || c.hasAttribute('data-testid') || ownsPointer),
          pointerEvents: cs.pointerEvents, position: cs.position,
          opaqueBg: alphaOf(cs.backgroundColor) >= 0.35,
          isText: ownText.length > 0,
          isBackdrop: (r.width * r.height) >= vw * vh * 0.7,
        });
      }
      walk(c);
    }
  };
  walk(document.body);
  return { vp: { w: vw, h: vh }, els };
}})()`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const lines = [];
let errorCount = 0;

for (const { label, device, viewport } of VIEWPORTS) {
  const ctx = await browser.newContext(
    device ? { ...devices[device], viewport, isMobile: true, hasTouch: true } : { viewport },
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', e => consoleErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.ForestEngine && document.querySelectorAll('canvas').length === 2,
    { timeout: 60_000 },
  );

  for (const [state, drive] of STATES) {
    // Portrait only ever shows the rotate gate -- driving it into the game is
    // measuring a screen no player reaches.
    if (label === 'mobile-portrait' && state !== 'gate') continue;
    await drive(page);
    const { vp, els } = await page.evaluate(COLLECT);
    const defects = audit(els, vp);
    errorCount += defects.filter(d => d.severity === 'error').length;
    await page.screenshot({ path: join(OUT, `${label}-${state}.png`) });
    lines.push(`\n### ${label} / ${state}  (${vp.w}x${vp.h})  ->  ${label}-${state}.png`);
    lines.push(defects.length
      ? defects.map(d => `  ${d.severity === 'error' ? 'ERROR' : ' warn'}  [${d.rule}] ${d.message}`).join('\n')
      : '  clean');
  }
  if (consoleErrors.length) lines.push(`  console errors: ${consoleErrors.length}\n    ${consoleErrors.join('\n    ')}`);
  await ctx.close();
}

await browser.close();
const report = lines.join('\n');
writeFileSync(join(OUT, 'report.txt'), report + '\n');
console.log(report);
console.log(`\n${errorCount} error-severity defect(s). Screenshots and report.txt in ${OUT}`);
