#!/usr/bin/env node
// LUL-2599: below Node 22.18, TypeScript type stripping isn't available and
// `node --test` silently drops every *.test.ts file -- 394 scripts/*.test.mjs
// still pass, ~700 assertions across all 27 lib/game modules never run, and
// the command still exits 0. This wraps the real test run: it runs the exact
// same `node --test` invocation, then fails loud if *.test.ts files exist on
// disk but none of them actually showed up as a collected subtest.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next']);

function findTestFiles(rootDir, suffix) {
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(dir, entry.name));
        continue;
      }
      if (entry.name.endsWith(suffix)) results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

// node's TAP reporter prints a top-level "# Subtest: <file path>" line for
// every test file it actually ran.
function parseTapSubtestFiles(tap) {
  const files = [];
  for (const line of tap.split('\n')) {
    const m = /^# Subtest: (.+)$/.exec(line.trim());
    if (m) files.push(m[1]);
  }
  return files;
}

function checkCollection(onDiskTsTests, ranFiles, nodeVersion) {
  if (onDiskTsTests.length === 0) return { ok: true };
  const ranTs = ranFiles.filter((f) => f.endsWith('.test.ts'));
  if (ranTs.length === 0) {
    return {
      ok: false,
      message:
        `found ${onDiskTsTests.length} *.test.ts file(s) on disk but node --test collected none of them ` +
        `(current Node: v${nodeVersion}). Below Node 22.18, TypeScript type stripping isn't available and ` +
        '.test.ts files are silently skipped -- use the pinned version in .nvmrc (`nvm use`).',
    };
  }
  return { ok: true };
}

function main() {
  const repoRoot = process.cwd();
  const onDiskTsTests = findTestFiles(repoRoot, '.test.ts');

  const result = spawnSync(
    process.execPath,
    ['--test', '--experimental-test-module-mocks', '--test-reporter=tap'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  const ranFiles = parseTapSubtestFiles(result.stdout ?? '');
  const collection = checkCollection(onDiskTsTests, ranFiles, process.versions.node);
  if (!collection.ok) {
    console.error(`\ncheck-test-collection: FAILED: ${collection.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { findTestFiles, parseTapSubtestFiles, checkCollection };
