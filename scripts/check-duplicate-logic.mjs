#!/usr/bin/env node
// LUL-641 (LUL-277 wave 7, final): gate against the failure mode wave 7
// found -- effectiveDetect()/canSee()/STILL_RAMP/STILL_DETECT_CUT existed
// twice, once in lib/game/cover.ts (tested) and once, independently, in
// engine/forest-engine.js (shipped). Nine tests in cover.test.ts asserted
// on the copy the game never ran; retuning either copy left the other
// green. See wiki systems/unit-testing-standard, "wave 7" section.
//
// THE RULE (deliberately the sharp one, not the loose one)
//
// A loose "exported by lib/game/* with no non-test consumer" scan measured
// 40 hits on the tree that motivated this gate -- and over-counted badly:
// erased TypeScript types/interfaces and constants legitimately used only
// inside their own module (FLANK_ANGLE, FLANK_DIST_MUL) both look unused
// from outside but are not duplicated logic. A gate built on that number
// would be disabled within a week.
//
// The sharp rule that measured exactly 4 hits, one cluster, is this script:
// fail when an identifier is BOTH (a) declared at module top level in
// engine/forest-engine.js AND (b) exported by a lib/game/*.ts module, unless
// it is also (c) imported into the engine from that module (by its original
// export name -- `hasLOS as geoHasLOS` still counts as importing `hasLOS`)
// or explicitly allowlisted below.
//
// Usage:
//   node scripts/check-duplicate-logic.mjs              # gate; exit 1 on any violation
//   node scripts/check-duplicate-logic.mjs --report      # full table of every lib/game export
//                                                         # and whether the engine duplicates it
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENGINE = 'engine/forest-engine.js';
const LIB_GAME_DIR = 'lib/game';

// Deliberate divergences: an identifier legitimately re-declared in the
// engine instead of imported from lib/game. Every entry needs a dated
// reason written down here -- a silent divergence is exactly the failure
// mode this gate exists to catch. (LUL-382's mist-veil divergence, the one
// instance that existed when this gate was written, was closed by LUL-641
// itself rather than allowlisted -- see cover.ts's effectiveDetect/canSee.)
const ALLOWLIST = [
  // { identifier: 'example', module: 'example.ts', date: '2026-01-01',
  //   reason: 'why the engine must keep its own copy' },
];

// Exported function/const/class declarations at the top level of a
// lib/game/*.ts module. Interfaces and type aliases are erased at compile
// time -- they cannot be "duplicated" in a runtime .js file, so they are
// deliberately not collected (that gap is most of the 40-vs-4 over-count
// the loose scan produced).
function extractLibGameExports(dir) {
  const found = []; // { name, module }
  for (const file of fs.readdirSync(path.join(ROOT, dir)).sort()) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const src = fs.readFileSync(path.join(ROOT, dir, file), 'utf8');
    const re = /^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm;
    let m;
    while ((m = re.exec(src))) found.push({ name: m[1], module: file });
  }
  return found;
}

// Module-top-level function/const/let/var declarations in the engine --
// column 0, so a same-named local inside some other function's body (no
// relation to lib/game) never counts. `509 declarations, 76 imports`
// (LUL-641 ticket measurement) came from exactly this pattern.
function extractEngineTopLevelDeclarations(src) {
  const names = new Set();
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s+(\w+)|(?:const|let|var)\s+(\w+))/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1] || m[2]);
  return names;
}

// Every name imported into the engine from any '@/lib/game/...' module,
// keyed by its ORIGINAL export name -- `hasLOS as geoHasLOS` still counts
// as importing `hasLOS`, matching the existing wrapper-function convention
// (hasLOS/findHideSpot, and now effectiveDetect/canSee).
function extractEngineLibGameImports(src) {
  const imported = new Set();
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@\/lib\/game\/[^'"]+['"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const spec of m[1].split(',')) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      imported.add(trimmed.split(/\s+as\s+/)[0].trim());
    }
  }
  return imported;
}

/** Pure check, testable without touching the filesystem: given the engine's
 * source text and the list of lib/game exports, returns every export that
 * is duplicated (declared in the engine, not imported, not allowlisted). */
export function findDuplicates(engineSrc, libGameExports, allowlist = ALLOWLIST) {
  const declared = extractEngineTopLevelDeclarations(engineSrc);
  const imported = extractEngineLibGameImports(engineSrc);
  const allowlisted = new Set(allowlist.map((e) => e.identifier));

  const violations = [];
  for (const { name, module } of libGameExports) {
    if (declared.has(name) && !imported.has(name) && !allowlisted.has(name)) {
      violations.push({ name, module });
    }
  }
  return violations;
}

export function checkDuplicateLogic({ engineSrc, libGameDir = LIB_GAME_DIR, allowlist = ALLOWLIST } = {}) {
  const exports = extractLibGameExports(libGameDir);
  const violations = findDuplicates(engineSrc, exports, allowlist);
  return { exports, violations };
}

function main(argv) {
  const report = argv.includes('--report');
  const engineSrc = fs.readFileSync(path.join(ROOT, ENGINE), 'utf8');
  const { exports, violations } = checkDuplicateLogic({ engineSrc });

  if (report) {
    const declared = extractEngineTopLevelDeclarations(engineSrc);
    const imported = extractEngineLibGameImports(engineSrc);
    console.log(`${exports.length} lib/game export(s) scanned:`);
    for (const { name, module } of exports) {
      const status = !declared.has(name)
        ? 'not duplicated'
        : imported.has(name)
          ? 'duplicated, imported (wrapper pattern -- OK)'
          : 'DUPLICATED, NOT IMPORTED';
      console.log(`  ${module}  ${name}  ${status}`);
    }
    return 0;
  }

  if (!violations.length) {
    console.log(
      `check-duplicate-logic: OK -- ${exports.length} lib/game export(s) scanned, ` +
      `0 duplicated in ${ENGINE}.`);
    return 0;
  }

  console.error(`check-duplicate-logic: FAIL -- ${violations.length} identifier(s) exist twice:\n`);
  for (const { name, module } of violations) {
    console.error(`  \`${name}\` -- declared in ${ENGINE}, exported by lib/game/${module}, not imported`);
  }
  console.error(
    `\nEither delete the engine's local copy and import from lib/game/${violations[0].module}` +
    ` (the extraction pattern hasLOS/findHideSpot/effectiveDetect/canSee already use), or, if the` +
    ` engine must genuinely keep a divergent copy, add a dated entry to ALLOWLIST in` +
    ` scripts/check-duplicate-logic.mjs stating why -- see wiki systems/unit-testing-standard,` +
    ` "an extraction is not finished when the tests pass" (LUL-641).`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
