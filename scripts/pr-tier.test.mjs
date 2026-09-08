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

// LUL-1664: the original 5 lib/game/ simulation files (decisions/0014
// Amendment 2) must not fall into the generic Tier B lib/** bucket, or
// tier-approve.yml auto-approves engine-grade changes with zero Code Reviewer
// involvement.
test('Tier C: the named lib/game/ simulation files, not generic lib/** app surface', () => {
  assert.equal(tier('lib/game/cover.ts'), 'C');
  assert.equal(tier('lib/game/predator.ts'), 'C');
  assert.equal(tier('lib/game/outcome.ts'), 'C', 'win/lose conditions');
  assert.equal(tier('lib/game/scent.ts'), 'C');
  assert.equal(tier('lib/game/pack.ts'), 'C');
  assert.equal(tier('lib/site.ts'), 'B', 'lib/** outside lib/game/ is unaffected');
});

// LUL-1880: lib/game/ grew from 5 files to 21 since Amendment 2; the directory-
// wide rule this replaced silently over-classified all 16 newer modules as C,
// which is what blocked PR #436/LUL-1640 (economy.ts, pure reward math) from
// auto-approving on green as Tier B policy says it should. Each of these 16
// is re-derived per-file against AGENTS.md's Tier C definition (movement,
// collision, predator AI, scent, hiding, detection, win/lose conditions).
test('Tier C: newer lib/game/ files whose exports feed detection/movement/win-lose', () => {
  assert.equal(tier('lib/game/charge.ts'), 'C', 'predator charge decision + the "caught" resolution');
  assert.equal(tier('lib/game/sightLock.ts'), 'C', 'pre-chase sight-lock tell gates when a chase starts');
  assert.equal(tier('lib/game/dayNight.ts'), 'C', 'exports a predator detect-radius multiplier');
  assert.equal(tier('lib/game/veil.ts'), 'C', 'exports a predator detect-radius multiplier');
  assert.equal(tier('lib/game/fogTide.ts'), 'C', 'exports a predator detect-radius multiplier');
  assert.equal(tier('lib/game/noise.ts'), 'C', 'the hearing detection channel');
  assert.equal(tier('lib/game/bog.ts'), 'C', 'terrain speed multiplier -- movement');
  assert.equal(tier('lib/game/lake.ts'), 'C', 'terrain speed multiplier -- movement');
  assert.equal(tier('lib/game/stamina.ts'), 'C', 'sprint speed multiplier -- movement');
});

test('Tier B: lib/game/ reward, side-objective, narrative and cosmetic modules', () => {
  assert.equal(tier('lib/game/economy.ts'), 'B', 'reward math run after an outcome is already decided');
  assert.equal(tier('lib/game/economy.test.ts'), 'A');
  assert.equal(tier('lib/game/economy.ts', 'lib/game/economy.test.ts', 'docs/ELEMENTS.md'), 'B', 'PR #436 must classify B, not C');
  assert.equal(tier('lib/game/mission.ts'), 'B');
  assert.equal(tier('lib/game/chronicle.ts'), 'B');
  assert.equal(tier('lib/game/eventScheduler.ts'), 'B');
  assert.equal(tier('lib/game/timeOfDay.ts'), 'B');
  assert.equal(tier('lib/game/childGlow.ts'), 'B');
  assert.equal(tier('lib/game/jump.ts'), 'B');
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
