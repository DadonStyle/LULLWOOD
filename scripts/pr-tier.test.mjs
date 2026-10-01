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

// LUL-5693/PR#971: tier-approve.yml auto-merged a spec file whose diff only
// retuned an existing assertion's numeric budget -- padded with 3 lines of
// new explanatory comment per call site, so plain added/removed line counts
// (10 added, 2 removed, confirmed live via `gh api .../pulls/971/files`)
// read as net-positive and would have missed this -- with zero review,
// because tierOf() only ever saw the file path. These drive the real
// stdin form: one JSON object per line, `{filename, additions, deletions,
// patch}`, exactly GitHub's `.../pulls/{n}/files` shape.
const ndjson = (entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
const tierStdin = (input) => execFileSync('node', [script, '--stdin'], { input, encoding: 'utf8' }).trim();

// PR#971's actual shape: one `expect(` line removed, one `expect(` line
// added (with a different literal), plus 3 pure-comment lines of
// explanation -- net +2 lines, net 0 assertions.
const RETUNE_PATCH = [
  '@@ -123,3 +123,7 @@',
  "-    expect(afterFreeze.dist, 'must have resumed closing distance').toBeLessThan(triggered.dist - 0.1);",
  '+    // re-tuned per LUL-5686 to the real measured value',
  '+    // (margin stays safely below it)',
  '+    // see PR#968 for why the old margin stopped holding',
  "+    expect(afterFreeze.dist, 'must have resumed closing distance').toBeLessThan(triggered.dist - 0.02);",
].join('\n');

test('Tier C: a spec/test diff that retunes an assertion value behind added comments (PR#971 exact shape)', () => {
  assert.equal(
    tierStdin(ndjson([{ filename: 'e2e/wind-pulse.spec.ts', additions: 10, deletions: 2, patch: RETUNE_PATCH }])),
    'C',
  );
});

// LUL-5697: the comment lines in RETUNE_PATCH above happen not to contain
// `expect(`/`test(`, so they never exercised the real bypass -- a comment
// that *quotes* the old assertion call (a completely natural way to phrase
// a retune, matching this same PR's own commit message and PR#971's real
// comments) counted as a second `expect(` and flipped added > removed.
test('Tier C: a retune whose explanatory comment quotes an expect( call (comment-text bypass)', () => {
  const patch = [
    '@@ -10,1 +10,2 @@',
    '-    expect(afterFreeze.dist).toBeLessThan(140);',
    '+    // previously expect(afterFreeze.dist) compared against 140; real measurement is 152',
    '+    expect(afterFreeze.dist).toBeLessThan(152);',
  ].join('\n');
  assert.equal(
    tierStdin(ndjson([{ filename: 'e2e/wind-pulse.spec.ts', additions: 2, deletions: 1, patch }])),
    'C',
  );
});

// LUL-5697: a comment merely mentioning `test(`/`it(`/`describe(` must not
// short-circuit to Tier A -- only a real `test(`/`it(`/`describe(` call in
// added code counts as a new registration.
test('Tier C: a retune whose comment mentions test(/it(/describe( by name (comment-text bypass)', () => {
  const patch = [
    '@@ -10,1 +10,2 @@',
    '-    expect(afterFreeze.dist).toBeLessThan(140);',
    "+    // retuned, matches the behavior covered by test('resumes closing') elsewhere",
    '+    expect(afterFreeze.dist).toBeLessThan(152);',
  ].join('\n');
  assert.equal(
    tierStdin(ndjson([{ filename: 'e2e/wind-pulse.spec.ts', additions: 2, deletions: 1, patch }])),
    'C',
  );
});

test('Tier C: a spec/test diff that only deletes an assertion (weakened/disguised coverage)', () => {
  const patch = ['@@ -10,2 +10,1 @@', '-    expect(x).toBeLessThan(5);', '-    expect(y).toBeLessThan(5);', '+    expect(x).toBeLessThan(5);'].join('\n');
  assert.equal(
    tierStdin(ndjson([{ filename: 'e2e/smoke.spec.ts', additions: 1, deletions: 2, patch }])),
    'C',
  );
});

test('Tier A: a spec/test diff that adds a net-new assertion is new coverage', () => {
  const patch = ['@@ -10,1 +10,2 @@', '     const x = 1;', '+    expect(x).toBe(1);'].join('\n');
  assert.equal(
    tierStdin(ndjson([{ filename: 'e2e/wind-pulse.spec.ts', additions: 1, deletions: 0, patch }])),
    'A',
  );
});

test('Tier A: a spec/test diff that registers a brand-new test block is new coverage', () => {
  const patch = ["+test('new behavior', async () => {", '+  expect(1).toBe(1);', '+});'].join('\n');
  assert.equal(
    tierStdin(ndjson([{ filename: 'lib/game/cover.test.ts', additions: 3, deletions: 0, patch }])),
    'A',
  );
});

test('Tier C: falls back to additions<=deletions when GitHub omits patch (large/binary diff)', () => {
  assert.equal(tierStdin(ndjson([{ filename: 'e2e/wind-pulse.spec.ts', additions: 2, deletions: 2 }])), 'C');
  assert.equal(tierStdin(ndjson([{ filename: 'lib/game/cover.test.ts', additions: 6, deletions: 2 }])), 'A');
});

test('Tier A: a spec/test path with no meta at all keeps the original path-only behavior', () => {
  assert.equal(tierStdin('e2e/wind-pulse.spec.ts\n'), 'A', 'a bare path is not valid JSON, so meta stays undefined');
  assert.equal(tier('e2e/wind-pulse.spec.ts'), 'A', 'bare argv form never carries a diff');
});

test('the retune downgrade never applies to non-spec Tier A paths', () => {
  assert.equal(tierStdin(ndjson([{ filename: 'README.md', additions: 0, deletions: 5 }])), 'A');
  assert.equal(tierStdin(ndjson([{ filename: 'public/death.mp4', additions: 0, deletions: 3 }])), 'A');
});
