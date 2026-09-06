// LUL-UI-HYGIENE: the standing gate for "the UI must look clean and everything
// must be easy to reach". Every rule here fires on a defect that was real and
// shipped on 2026-08-30 -- this suite is the regression net for that audit, not
// a speculative style checker.
//
// Runs under the mobile project (Pixel 5) and is deliberately checked in
// LANDSCAPE, because components/OrientationGate.tsx blocks portrait play: the
// screen a mobile player actually sees is 851x393-ish, not 393x851.
import { test, expect, type Page } from '@playwright/test';
import { audit, checkReachability, type Defect } from '@/lib/ui/hygiene';
import { collectElems, tapDepth } from '../ui-hygiene-collect';

const LANDSCAPE = { width: 851, height: 393 };

function report(defects: Defect[]) {
  const errors = defects.filter(d => d.severity === 'error');
  const warns = defects.filter(d => d.severity === 'warn');
  const fmt = (d: Defect) => `  [${d.rule}] ${d.message}`;
  return { errors, warns, text: [...errors, ...warns].map(fmt).join('\n') };
}

test.use({ viewport: LANDSCAPE });

async function boot(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as any).ForestEngine && document.querySelectorAll('canvas').length === 2,
    { timeout: 30_000 },
  );
}

test('entry gate is clean on a phone', async ({ page }) => {
  await boot(page);
  const { vp, els } = await collectElems(page);
  const { errors, text } = report(audit(els, vp));
  expect(errors, `entry gate UI defects:\n${text}`).toEqual([]);
});

test('in-game HUD leaves the player a clear view', async ({ page }) => {
  await boot(page);
  await page.locator('#gate').click();
  await page.waitForTimeout(1500);
  const { vp, els } = await collectElems(page);
  const { errors, text } = report(audit(els, vp));
  expect(errors, `in-game UI defects:\n${text}`).toEqual([]);
});

test('everything important is at most two taps away', async ({ page }) => {
  await boot(page);
  await page.locator('#gate').click();
  await page.waitForTimeout(1500);
  // The menu is the first tap. Anything that needs a third is over budget.
  const MENU = '[data-testid="menuToggle"]';
  const depths = {
    Fullscreen: await tapDepth(page, '[data-testid="menuFullscreen"]', [MENU]),
    Settings: await tapDepth(page, '#settingsBtn', [MENU]),
    Pause: await tapDepth(page, '[data-testid="touchPause"]', [MENU]),
    Sound: await tapDepth(page, '[data-testid="menuSound"]', [MENU]),
    Restart: await tapDepth(page, '[data-testid="menuRestart"]', [MENU]),
  };
  const { errors, text } = report(checkReachability(depths));
  expect(errors, `reachability:\n${text}\ndepths=${JSON.stringify(depths)}`).toEqual([]);
});

test('settings dialog fits the screen without scrolling', async ({ page }) => {
  await boot(page);
  await page.locator('#gate').click();
  await page.waitForTimeout(1000);
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(300);
  const overflow = await page
    .locator('#settingsPanel')
    .evaluate(e => e.scrollHeight - e.clientHeight);
  expect(overflow, 'settings dialog must not hide controls below a scroll fold on a phone').toBeLessThanOrEqual(0);
  const { vp, els } = await collectElems(page);
  const { errors, text } = report(audit(els, vp));
  expect(errors, `settings dialog UI defects:\n${text}`).toEqual([]);
});
