import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pr-tier.mjs');
const tier = (...files) =>
  execFileSync('node', [script, ...files], { encoding: 'utf8' }).trim();

test('Tier B: the app surface the directive names', () => {
  assert.equal(tier('app/page.tsx'), 'B');
  assert.equal(tier('lib/site.ts'), 'B');
  assert.equal(tier('components/Hud.tsx'), 'B');
  assert.equal(tier('app/page.tsx', 'lib/site.ts', 'components/Hud.tsx'), 'B');
});

test('Tier A: docs, tests and assets', () => {
  assert.equal(tier('README.md'), 'A');
  assert.equal(tier('docs/HOW_IT_WORKS.md'), 'A');
  assert.equal(tier('e2e/smoke.spec.ts'), 'A');
  assert.equal(tier('lib/game/cover.test.ts'), 'A');
  assert.equal(tier('public/death.mp4'), 'A');
});

test('highest tier wins across a mixed diff', () => {
  assert.equal(tier('README.md', 'app/page.tsx'), 'B', 'A + B -> B');
  assert.equal(tier('app/page.tsx', 'engine/forest-engine.js'), 'C', 'B + C -> C');
  assert.equal(tier('README.md', 'engine/forest-engine.js'), 'C', 'A + C -> C');
});

// These are the cases that decide whether this is a gate or a rubber stamp.
test('Tier C: the automation can never approve a change to the gate itself', () => {
  assert.equal(tier('.github/workflows/tier-approve.yml'), 'C');
  assert.equal(tier('.github/workflows/ci.yml'), 'C');
  assert.equal(tier('scripts/pr-tier.mjs'), 'C');
  assert.equal(tier('scripts/pr-tier.test.mjs'), 'C');
});

test('Tier C: engine, server routes, secrets and dependency manifests', () => {
  assert.equal(tier('engine/forest-engine.js'), 'C');
  assert.equal(tier('app/api/telemetry/route.ts'), 'C', 'app/api reads server env; beats app/**');
  assert.equal(tier('package.json'), 'C');
  assert.equal(tier('package-lock.json'), 'C');
  assert.equal(tier('next.config.ts'), 'C');
  assert.equal(tier('playwright.config.ts'), 'C');
  assert.equal(tier('lib/auth-helper.ts'), 'C', 'path naming a credential beats lib/**');
});

// LUL-1664: lib/game/** is simulation logic imported into engine/forest-engine.js
// (hiding, detection, scent, predator AI, win/lose) -- it must not fall into the
// generic Tier B lib/** bucket, or tier-approve.yml auto-approves engine-grade
// changes with zero Code Reviewer involvement.
test('Tier C: lib/game/** is simulation, not generic lib/** app surface', () => {
  assert.equal(tier('lib/game/cover.ts'), 'C');
  assert.equal(tier('lib/game/predator.ts'), 'C');
  assert.equal(tier('lib/game/outcome.ts'), 'C', 'win/lose conditions');
  assert.equal(tier('lib/site.ts'), 'B', 'lib/** outside lib/game/ is unaffected');
});

test('Tier A still wins for lib/game/*.test.ts (test files stay unreviewed-tier)', () => {
  assert.equal(tier('lib/game/cover.test.ts'), 'A');
});

test('fails closed on anything unrecognised', () => {
  assert.equal(tier('some/unknown/path.rb'), 'C');
  assert.equal(tier('Dockerfile'), 'C');
});

test('an empty diff is never approvable', () => {
  assert.equal(execFileSync('node', [script], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(), 'C');
});

test('--stdin matches argv classification', () => {
  const out = execFileSync('node', [script, '--stdin'], {
    input: 'app/page.tsx\nlib/site.ts\n',
    encoding: 'utf8',
  }).trim();
  assert.equal(out, 'B');
});
