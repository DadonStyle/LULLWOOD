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
  : 'https://lullwood.vercel.app';
const HOST = new URL(SITE_URL).host;

const keyFile = readdirSync(path.join(ROOT, 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  throw new Error('No IndexNow key file found under public/ (expected <32-char-hex>.txt)');
}
const KEY = keyFile.replace(/\.txt$/, '');
const KEY_LOCATION = `${SITE_URL}/${keyFile}`;

// Mirrors the URLs currently listed in app/sitemap.ts. Update both together.
const urlList = [SITE_URL];

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
