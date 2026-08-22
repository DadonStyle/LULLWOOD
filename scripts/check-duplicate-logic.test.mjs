import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicates, checkDuplicateLogic } from './check-duplicate-logic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- findDuplicates (pure, synthetic sources) ------------------------------

test('findDuplicates: flags an identifier declared at engine top level, exported by lib/game, not imported', () => {
  const engineSrc = `const STILL_RAMP = 1.2;\nfunction tick(){}\n`;
  const exports = [{ name: 'STILL_RAMP', module: 'cover.ts' }];
  const violations = findDuplicates(engineSrc, exports, []);
  assert.deepEqual(violations, [{ name: 'STILL_RAMP', module: 'cover.ts' }]);
});

test('findDuplicates: a wrapper-imported identifier (declared locally under its own name AND imported under an alias) is not flagged -- the hasLOS/findHideSpot pattern', () => {
  const engineSrc =
    `import { hasLOS as geoHasLOS } from '@/lib/game/cover';\n` +
    `function hasLOS(x0,z0,x1,z1){ return geoHasLOS(x0,z0,x1,z1,coverGrid); }\n`;
  const exports = [{ name: 'hasLOS', module: 'cover.ts' }];
  assert.deepEqual(findDuplicates(engineSrc, exports, []), []);
});

test('findDuplicates: an export never declared in the engine at all is not flagged', () => {
  const engineSrc = `function tick(){}\n`;
  const exports = [{ name: 'JUMP_DURATION', module: 'jump.ts' }];
  assert.deepEqual(findDuplicates(engineSrc, exports, []), []);
});

test('findDuplicates: an identifier declared only inside another function\'s body (not module top level) is not flagged', () => {
  const engineSrc = `function tick(){\n  const STILL_RAMP = 1.2;\n  return STILL_RAMP;\n}\n`;
  const exports = [{ name: 'STILL_RAMP', module: 'cover.ts' }];
  assert.deepEqual(findDuplicates(engineSrc, exports, []), [],
    'a same-named local inside a function body is unrelated shadowing, not the lib/game export');
});

test('findDuplicates: an allowlisted identifier is not flagged even when declared and not imported', () => {
  const engineSrc = `const STILL_RAMP = 1.2;\n`;
  const exports = [{ name: 'STILL_RAMP', module: 'cover.ts' }];
  const allowlist = [{ identifier: 'STILL_RAMP', module: 'cover.ts', date: '2026-08-22', reason: 'test' }];
  assert.deepEqual(findDuplicates(engineSrc, exports, allowlist), []);
});

test('findDuplicates: multiple lib/game imports in separate statements are all recognised, aliased or not', () => {
  const engineSrc =
    `import { effectiveDetect as geoEffectiveDetect } from '@/lib/game/cover';\n` +
    `import { veilDetectMul } from '@/lib/game/veil';\n` +
    `function effectiveDetect(p){ return geoEffectiveDetect(p, veilDetectMul(0)); }\n`;
  const exports = [
    { name: 'effectiveDetect', module: 'cover.ts' },
    { name: 'veilDetectMul', module: 'veil.ts' },
  ];
  assert.deepEqual(findDuplicates(engineSrc, exports, []), []);
});

// ---- end-to-end against the real, post-LUL-641 tree ------------------------

test('the gate is 0 on the fixed tree -- LUL-641 left no duplicated identifier behind', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'engine/forest-engine.js'), 'utf8');
  const { exports, violations } = checkDuplicateLogic({ engineSrc });
  assert.ok(exports.length > 20, `expected >20 lib/game exports scanned, got ${exports.length}`);
  assert.deepEqual(violations, [],
    `expected 0 duplicated identifiers, got: ${violations.map((v) => v.name).join(', ')}`);
});

test('effectiveDetect/canSee/STILL_RAMP/STILL_DETECT_CUT specifically are gone from the engine\'s own declarations (acceptance criterion 1)', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'engine/forest-engine.js'), 'utf8');
  for (const name of ['STILL_RAMP', 'STILL_DETECT_CUT']) {
    assert.doesNotMatch(engineSrc, new RegExp(`^const ${name}\\s*=`, 'm'),
      `${name} must not be locally declared in the engine -- it must come from lib/game/cover`);
  }
  assert.match(engineSrc, /effectiveDetect as geoEffectiveDetect/, 'effectiveDetect must be imported from lib/game/cover');
  assert.match(engineSrc, /canSee as geoCanSee/, 'canSee must be imported from lib/game/cover');
});

// ---- fail-on-purpose proof (LUL-641 deliverable 2: "must fail once on a --
// fault injected into the measured population, not a synthetic file the
// scanner would skip") -----------------------------------------------------

test('fail on purpose: injecting a real, currently-clean lib/game export as a duplicate declaration in the engine is caught', () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, 'engine/forest-engine.js'), 'utf8');
  const { exports, violations: before } = checkDuplicateLogic({ engineSrc });
  assert.deepEqual(before, [], 'precondition: the real tree must be clean before injecting the fault');

  // BOG_SPEED_MULTIPLIER (lib/game/bog.ts) is real, currently exported, and
  // has zero engine consumer -- bogSpeedMultiplier() is the only thing the
  // engine imports from bog.ts, and it wraps the constant internally. That
  // makes it a live member of the "measured population" this gate scans,
  // not a synthetic name the scanner would never have looked at.
  const victim = exports.find((e) => e.name === 'BOG_SPEED_MULTIPLIER' && e.module === 'bog.ts');
  assert.ok(victim, 'expected BOG_SPEED_MULTIPLIER to be part of the scanned lib/game export population');

  const faulted = engineSrc + '\nconst BOG_SPEED_MULTIPLIER = 0.5; // injected duplicate, LUL-641 self-test\n';
  const { violations: after } = checkDuplicateLogic({ engineSrc: faulted });
  assert.equal(after.length, 1);
  assert.deepEqual(after[0], { name: 'BOG_SPEED_MULTIPLIER', module: 'bog.ts' });
});
