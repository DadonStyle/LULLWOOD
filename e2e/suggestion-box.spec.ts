// LUL-1918: /suggest is a static SSR page (app/suggest/page.tsx) with no game
// canvas, so like e2e/seo.spec.ts this suite never needs to boot the engine
// -- it's cheap, and doesn't belong in e2e/mobile (that dir drives the game's
// own touch controls via CDP, which this page has nothing to do with).
//
// Scope, per the ticket: only the client-side keystroke restriction and the
// 300-char cap. Server-side regex/rate-limit/honeypot behavior is covered by
// app/api/suggestions/route.test.ts (unit tests), not here.
import { test, expect, type Page } from '@playwright/test';

async function typeInto(page: Page, text: string) {
  const textarea = page.locator('#suggestion-text');
  await textarea.click();
  await textarea.pressSequentially(text, { delay: 0 });
  return textarea;
}

test.describe('suggestion box input restriction', () => {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    test(`${name}: digits, punctuation and uppercase never land in the field`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/suggest', { waitUntil: 'domcontentloaded' });

      const textarea = await typeInto(page, 'Add a 2nd Map! Please? #forest');

      // Every rejected keystroke (digits, !, ?, #) is dropped; uppercase is
      // folded to lowercase rather than rejected outright (see
      // components/SuggestionBox.tsx's sanitize() -- both a real player and
      // the server-side ^[a-z ]{3,300}$ regex only ever see the same charset).
      await expect(textarea).toHaveValue('add a nd map please forest');
    });

    test(`${name}: remaining-character count tracks the sanitized value`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/suggest', { waitUntil: 'domcontentloaded' });

      await typeInto(page, 'a good idea');
      await expect(page.locator('#suggestion-remaining')).toHaveText('289 characters left');
    });

    test(`${name}: input is hard-capped at 300 characters`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/suggest', { waitUntil: 'domcontentloaded' });

      const over300 = 'a'.repeat(320);
      const textarea = page.locator('#suggestion-text');
      // Paste path (fill) exercises the cap independently of the keystroke
      // path (pressSequentially) covered above -- both funnel through the
      // same sanitize(), but a regression that only breaks one path (e.g.
      // an onPaste handler bypassing sanitize) would be invisible to only one
      // of these two tests.
      await textarea.fill(over300);
      const value = await textarea.inputValue();
      expect(value.length).toBe(300);
      await expect(page.locator('#suggestion-remaining')).toHaveText('0 characters left');
    });

    test(`${name}: submit is disabled below the 3-character minimum`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/suggest', { waitUntil: 'domcontentloaded' });

      const submit = page.getByRole('button', { name: /send suggestion/i });
      await expect(submit).toBeDisabled();

      await typeInto(page, 'ok');
      await expect(submit).toBeDisabled();

      await typeInto(page, ' idea');
      await expect(submit).toBeEnabled();
    });
  }
});
