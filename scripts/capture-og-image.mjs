// One-off asset generator for LUL-49 (OG image). Not part of the e2e suite --
// run manually against a running production build when the game's visuals
// change enough to warrant a new social-card frame.
//
// Usage:
//   npm run build && npm run start -- -p 3111 &
//   node scripts/capture-og-image.mjs
//
// Captures a real in-game frame (not a mockup) at the 1200x630 size the OG/
// Twitter card spec recommends, and writes it to the two Next.js static
// image-convention paths so app/opengraph-image.png and app/twitter-image.png
// self-register without any metadata wiring.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3111;
const baseURL = `http://127.0.0.1:${PORT}`;
const WIDTH = 1200;
const HEIGHT = 630;

if (!process.env.CI) {
  const prefix = '/home/noam/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu';
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${prefix}:${process.env.LD_LIBRARY_PATH}`
    : prefix;
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean(window.ForestEngine) && document.querySelectorAll('canvas').length === 2,
    { timeout: 30_000 },
  );
  // Click the entry gate so the card shows the forest, not the title screen.
  await page.mouse.click(WIDTH / 2, HEIGHT / 2);
  await page.waitForTimeout(1200); // gate fade + pointer-lock settle
  // Let a few frames of fog/lighting/predator movement render so the shot
  // isn't the very first still frame post-fade.
  await page.waitForTimeout(2500);

  const png = await page.screenshot({ type: 'png' });
  for (const name of ['opengraph-image.png', 'twitter-image.png']) {
    writeFileSync(path.join(ROOT, 'app', name), png);
    console.log(`wrote app/${name} (${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
