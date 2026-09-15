#!/usr/bin/env node
// LUL-2599: below Node 22.18, TypeScript type stripping isn't available and
// `node --test` silently drops every *.test.ts file under lib/ while still
// exiting 0 -- 394 scripts/*.test.mjs pass, ~700 assertions across all 27
// lib/game modules never run, and nothing says so. Runs as `pretest` so the
// gap fails loud instead of reporting a green partial suite.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseMinVersion(range) {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)/.exec(range ?? '');
  if (!m) throw new Error(`unsupported engines.node range: ${range}`);
  return m.slice(1, 4).map(Number);
}

function parseVersion(version) {
  return version.split('.').map(Number);
}

function isAtLeast(actual, min) {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > min[i]) return true;
    if (actual[i] < min[i]) return false;
  }
  return true;
}

function checkNodeVersion(requiredRange, actualVersion) {
  const min = parseMinVersion(requiredRange);
  const actual = parseVersion(actualVersion);
  if (isAtLeast(actual, min)) return { ok: true };
  return {
    ok: false,
    message:
      `this repo requires Node ${requiredRange} (current: v${actualVersion}). Below Node 22.18, TypeScript type ` +
      "stripping isn't available and node --test silently drops every *.test.ts file under lib/ while still " +
      'exiting 0 -- use the pinned version in .nvmrc (`nvm use`).',
  };
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const result = checkNodeVersion(pkg.engines?.node, process.versions.node);
  if (!result.ok) {
    console.error(`check-node-version: FAILED: ${result.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { parseMinVersion, parseVersion, isAtLeast, checkNodeVersion };
