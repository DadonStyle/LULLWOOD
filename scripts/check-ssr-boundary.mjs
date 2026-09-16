#!/usr/bin/env node
// LUL-2864: keep all per-request compute in the browser. The founder's own
// 2026-09-17 audit found zero SSR workload today -- no middleware.ts, no
// cookies()/headers()/connection()/noStore() outside app/internal, all 9
// public routes statically prerendered. This script is the regression guard
// so that stays true, plus the guard for the two places a future client-
// first auth build is most likely to drag the app back into per-request
// server work: a middleware/proxy matcher widened to a public route, and a
// page-rendering file switched to force-dynamic.
//
// Route handlers under app/api/** are deliberately exempt from the
// cookies()/headers() check -- they are the "minimal data plane" this
// ticket says is fine (2 routes today: /api/telemetry, /api/suggestions),
// and the client-first auth ADR's own refresh-token design needs to read a
// cookie from exactly one of them. See wiki
// decisions/lul-2864-client-first-auth-adr. Banning cookies() there would
// make that ADR unbuildable while doing nothing for the actual problem this
// ticket names (per-request PAGE compute).
//
// No `|| true` and no ::warning:: downgrade anywhere in this path -- a new
// violation is a hard failure, same convention as
// scripts/check-elements-citations.mjs and scripts/check-duplicate-logic.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(root, 'app');
const INTERNAL_PREFIX = path.join(APP_DIR, 'internal') + path.sep;
const API_PREFIX = path.join(APP_DIR, 'api') + path.sep;
const PRERENDER_MANIFEST = path.join(root, '.next', 'prerender-manifest.json');

// The 9 public routes LUL-2864's audit found statically prerendered. A route
// falling off this list -- or off "static" compute -- without a deliberate
// edit to this file is the strongest signal that per-request server
// compute crept back in.
const PUBLIC_ROUTE_ALLOWLIST = [
  '/',
  '/suggest',
  '/devlog',
  '/devlog/the-return-trip',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/opengraph-image.png',
  '/twitter-image.png',
];

const PAGE_FILE_NAMES = new Set([
  'page.tsx', 'page.ts',
  'layout.tsx', 'layout.ts',
  'error.tsx', 'error.ts',
  'not-found.tsx', 'not-found.ts',
  'loading.tsx', 'loading.ts',
  'template.tsx', 'template.ts',
  'default.tsx', 'default.ts',
  'sitemap.ts', 'robots.ts', 'manifest.ts',
  'opengraph-image.tsx', 'opengraph-image.ts',
  'twitter-image.tsx', 'twitter-image.ts',
]);

const FORBIDDEN_IMPORTS = [
  { module: 'next/headers', names: ['cookies', 'headers', 'connection'] },
  { module: 'next/cache', names: ['unstable_noStore'] },
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
}

function findMiddlewareFiles() {
  // The pre-Next-16 convention. Anyone reintroducing it (e.g. a merge from
  // an older branch, or a dependency codemod running backwards) must fail
  // loudly rather than silently running a second, unreviewed proxy.
  const found = [];
  for (const candidate of ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js']) {
    const p = path.join(root, candidate);
    if (fs.existsSync(p)) found.push(candidate);
  }
  return found;
}

function checkProxyScope() {
  // Next.js 16 renamed middleware.ts -> proxy.ts (export `proxy`, not
  // `middleware` -- see proxy.ts's own header comment). A proxy with no
  // `config.matcher`, or a matcher touching anything outside /internal,
  // runs server compute on every matched request. Today's only proxy.ts
  // gates /internal/*; this check is what stops that scope from silently
  // widening to a public route.
  const failures = [];
  for (const candidate of ['proxy.ts', 'proxy.js', 'src/proxy.ts', 'src/proxy.js']) {
    const p = path.join(root, candidate);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const matcherMatch = src.match(/matcher\s*:\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/s);
    if (!matcherMatch) {
      failures.push(`${candidate}: no \`config.matcher\` found -- a proxy with no matcher runs against every request by default`);
      continue;
    }
    const patterns = [...matcherMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    if (patterns.length === 0) {
      failures.push(`${candidate}: \`config.matcher\` present but no path pattern could be parsed out of it`);
      continue;
    }
    for (const pattern of patterns) {
      if (pattern !== '/internal' && !pattern.startsWith('/internal/')) {
        failures.push(`${candidate}: matcher pattern "${pattern}" reaches outside /internal -- per-request server compute on a public route`);
      }
    }
  }
  return failures;
}

function checkPageFiles() {
  const failures = [];
  if (!fs.existsSync(APP_DIR)) return failures;
  const allFiles = [];
  walk(APP_DIR, allFiles);
  const pageFiles = allFiles.filter(
    (p) => PAGE_FILE_NAMES.has(path.basename(p)) && !p.startsWith(INTERNAL_PREFIX) && !p.startsWith(API_PREFIX),
  );

  for (const file of pageFiles) {
    const rel = path.relative(root, file);
    const src = fs.readFileSync(file, 'utf8');

    if (/export\s+const\s+dynamic\s*=\s*['"`]force-dynamic['"`]/.test(src)) {
      failures.push(`${rel}: \`export const dynamic = 'force-dynamic'\` on a public page -- forces per-request server render`);
    }
    if (/export\s+const\s+revalidate\s*=\s*0\b/.test(src)) {
      failures.push(`${rel}: \`export const revalidate = 0\` on a public page -- disables static caching, forces per-request server render`);
    }
    if (/export\s+const\s+runtime\s*=\s*['"`]nodejs['"`]/.test(src)) {
      failures.push(`${rel}: \`export const runtime = 'nodejs'\` on a public page -- forces the Node runtime where edge/static would do`);
    }

    for (const importMatch of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const [, namesRaw, moduleName] = importMatch;
      const rule = FORBIDDEN_IMPORTS.find((r) => r.module === moduleName);
      if (!rule) continue;
      const imported = namesRaw.split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of imported) {
        if (rule.names.includes(name)) {
          failures.push(`${rel}: imports \`${name}\` from '${moduleName}' on a public page -- reads per-request request state, forces server render`);
        }
      }
    }
  }
  return failures;
}

function checkPrerenderManifest() {
  if (!fs.existsSync(PRERENDER_MANIFEST)) {
    return [`${path.relative(root, PRERENDER_MANIFEST)} not found -- this check must run after \`next build\``];
  }
  const manifest = JSON.parse(fs.readFileSync(PRERENDER_MANIFEST, 'utf8'));
  const routes = manifest.routes ?? {};
  const failures = [];
  for (const route of PUBLIC_ROUTE_ALLOWLIST) {
    const entry = routes[route];
    if (!entry) {
      failures.push(`${route}: missing from .next/prerender-manifest.json -- no longer statically prerendered`);
      continue;
    }
    if (entry.compute !== 'static') {
      failures.push(`${route}: compute="${entry.compute}" in .next/prerender-manifest.json, expected "static" -- now runs per-request`);
    }
  }
  return failures;
}

function main() {
  const failures = [
    ...findMiddlewareFiles().map((f) => `${f}: middleware.ts exists -- reintroduces per-request compute across every matched route (renamed to proxy.ts in Next.js 16; see proxy.ts's own header)`),
    ...checkProxyScope(),
    ...checkPageFiles(),
    ...checkPrerenderManifest(),
  ];

  if (failures.length > 0) {
    console.error(`check-ssr-boundary: FAIL -- ${failures.length} SSR-boundary violation(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nSee LUL-2864 and wiki decisions/lul-2864-client-first-auth-adr -- this repo keeps all per-request compute in the browser. Static prerendering (this check\'s allowlist) is not server workload and is not what this guards against.',
    );
    return 1;
  }

  console.log('check-ssr-boundary: OK -- no middleware, no forced per-request rendering on a public page, all 9 allowlisted routes still static.');
  return 0;
}

process.exit(main());
