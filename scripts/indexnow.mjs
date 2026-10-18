// Self-serve search-engine submission for LUL-173. Not part of the build or CI --
// IndexNow treats frequent pinging as abuse and will start ignoring the key.
// Run manually, at most once per production deploy:
//
//   node scripts/indexnow.mjs
//
// Bing, DuckDuckGo (Bing-backed), Yandex and Seznam consume IndexNow directly.
// Google does not -- that path is Search Console (see README).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://www.lullwoodgame.com';
const HOST = new URL(SITE_URL).host;

const keyFile = readdirSync(path.join(ROOT, 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  throw new Error('No IndexNow key file found under public/ (expected <32-char-hex>.txt)');
}
const KEY = keyFile.replace(/\.txt$/, '');
const KEY_LOCATION = `${SITE_URL}/${keyFile}`;

// Every URL in the deployed sitemap, read live so this can never drift from
// app/sitemap.ts (a hand-copied list here only ever held the homepage).
const sitemap = await fetch(`${SITE_URL}/sitemap.xml`);
if (!sitemap.ok) throw new Error(`sitemap.xml: HTTP ${sitemap.status}`);
const urlList = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .filter((url) => new URL(url).host === HOST);
if (urlList.length === 0) throw new Error('sitemap.xml lists no URLs on this host');
console.log(`IndexNow: submitting ${urlList.length} URLs`);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  }),
});

const body = await res.text();
console.log(`IndexNow: HTTP ${res.status}${body ? ` -- ${body}` : ''}`);
if (res.status !== 200 && res.status !== 202) {
  process.exitCode = 1;
}
