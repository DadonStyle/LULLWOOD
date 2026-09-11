// LUL-2377 (founder rule 2026-09-11): the QA rig never boots the full 480u map.
//
// Static policy over e2e/**/*.spec.ts, run by `npm test` (node --test) so it
// gates every PR through the existing "unit tests" check without touching CI:
//
//   1. A spec may boot the full map (`qaWorld: 'full'`, or a bare `page.goto('/')`
//      without `qaWorld=micro`) ONLY inside a file that carries the `@fullmap`
//      tag in a test title AND a `// fullmap-reason:` line saying why the micro
//      world cannot express the case.
//   2. The set of @fullmap files is an explicit allowlist below. Adding a file
//      means adding it here, in the same PR, with its reason -- visible in review.
//      Removing one (migrating it to qaBuildScene) is always allowed.
//   3. Every spec file must boot through `boot()` from e2e/helpers.ts or pass
//      `qaWorld=micro` itself; the default world is micro (helpers.ts).
//
// Why static: the rule is about what a spec ASKS the engine for, which is
// visible in its source; a runtime check would need the very full-map boot it
// forbids. Pure Node, no DOM, no timers, no randomness -- AGENTS.md § Tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const E2E = join(ROOT, 'e2e');

// Files allowed to load the full map, and why. Keep this list SHRINKING.
export const FULLMAP_ALLOWLIST: Record<string, string> = {
  'e2e/bog-zone.spec.ts': 'bog is zeroed in the micro preset',
  'e2e/map-seed.spec.ts': 'seeded generator reproduces the real layout',
  'e2e/lul211-founder-report.spec.ts': "founder's walk-into-cover replays on the pinned full layout",
  'e2e/prop-density.spec.ts': 'per-chunk caps over the full 8x8 grid',
  'e2e/layout.spec.ts': 'canvas-fills-viewport on the shipped default boot',
  'e2e/qa-world-micro-budget.spec.ts': 'the full-map memory budget itself',
  'e2e/minimap.spec.ts': 'w2m clamping past the forest/bog seam',
  'e2e/predator-determinism.spec.ts': 'byte-identical traces across two full-map boots',
  'e2e/qa-probe-perf.spec.ts': 'boot-cost probe of the real map',
  'e2e/tree-pathing.spec.ts': "go-around against the pinned seed's trunk clusters",
  'e2e/mobile/bog-zone.spec.ts': 'bog is zeroed in the micro preset (phone viewport)',
  'e2e/mobile/prop-density.spec.ts': 'per-chunk caps over the full grid (phone viewport)',
  'e2e/mobile/minimap.spec.ts': 'w2m clamping past the forest/bog seam (phone viewport)',
};

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...specFiles(p));
    else if (name.endsWith('.spec.ts')) out.push(p);
  }
  return out.sort();
}

const files = specFiles(E2E).map((abs) => ({ rel: relative(ROOT, abs), src: readFileSync(abs, 'utf8') }));

const bootsFull = (src: string) =>
  /qaWorld:\s*'full'/.test(src) ||
  /qaWorld=full/.test(src) ||
  // a bare goto to the game page without asking for the micro world
  /page\.goto\(\s*['"`]\/(?:\?(?![^'"`]*qaWorld=micro)[^'"`]*)?['"`]/.test(src);

test('e2e specs exist and are readable', () => {
  assert.ok(files.length > 50, `expected the e2e suite, found ${files.length} spec files`);
});

test('every spec that boots the full map is tagged @fullmap, gives a reason, and is on the allowlist', () => {
  const offenders: string[] = [];
  for (const { rel, src } of files) {
    if (!bootsFull(src)) continue;
    const problems: string[] = [];
    if (!/@fullmap/.test(src)) problems.push('missing @fullmap in a test title');
    if (!/\/\/\s*fullmap-reason:/.test(src)) problems.push('missing a `// fullmap-reason:` line');
    if (!(rel in FULLMAP_ALLOWLIST)) problems.push('not on FULLMAP_ALLOWLIST in lib/e2e-policy/world-policy.test.ts');
    if (problems.length) offenders.push(`${rel}: ${problems.join('; ')}`);
  }
  assert.deepEqual(offenders, [], `full-map boots outside the rule:\n  ${offenders.join('\n  ')}`);
});

test('@fullmap files carry a reason and boot full explicitly (no accidental micro tag)', () => {
  const offenders: string[] = [];
  for (const { rel, src } of files) {
    if (!/@fullmap/.test(src)) continue;
    if (!/\/\/\s*fullmap-reason:/.test(src)) offenders.push(`${rel}: @fullmap without fullmap-reason`);
    if (!bootsFull(src)) offenders.push(`${rel}: tagged @fullmap but never boots the full map -- drop the tag`);
  }
  assert.deepEqual(offenders, []);
});

test('the allowlist only shrinks: no stale entries, nothing added without a reason', () => {
  const present = new Set(files.map((f) => f.rel));
  for (const [rel, reason] of Object.entries(FULLMAP_ALLOWLIST)) {
    assert.ok(present.has(rel), `allowlist names a spec that no longer exists: ${rel}`);
    assert.ok(reason.trim().length > 10, `allowlist entry needs a real reason: ${rel}`);
  }
  assert.ok(Object.keys(FULLMAP_ALLOWLIST).length <= 13, 'the @fullmap allowlist may only shrink (13 on 2026-09-11)');
});

test('boot() defaults to the micro world', () => {
  const helpers = readFileSync(join(E2E, 'helpers.ts'), 'utf8');
  assert.match(helpers, /qaWorld = 'micro'/, "e2e/helpers.ts boot() must default qaWorld to 'micro'");
});
