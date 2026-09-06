import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  SECTIONS,
  SOURCE_BRANCH,
  classifyShape,
  classifySection,
  dayKeyInTz,
  extractTicketIds,
  renderDay,
  buildEntriesByDay,
  FIRST_COMPANY_DAY,
} from './daily-report.mjs';

function commit({ parents = ['p1'], subject = '', body = '' } = {}) {
  return { sha: 'abc1234deadbeef', parents, subject, body };
}

// ---- classifyShape: the three commit shapes (spec §3) ---------------------

test('shape 1: squash merge -- subject is the entry, trailing (#N) becomes the PR number and is stripped from the text', () => {
  const c = commit({ parents: ['p1'], subject: 'LUL-485: add timeout-minutes to CI jobs (#80)' });
  const shape = classifyShape(c);
  assert.equal(shape.excluded, false);
  assert.equal(shape.prNumber, 80);
  assert.equal(shape.text, 'add timeout-minutes to CI jobs');
  assert.deepEqual(shape.ticketIds, ['LUL-485']);
});

test('shape 2: real merge of a PR -- useless subject, body first paragraph used instead', () => {
  const c = commit({
    parents: ['p1', 'p2'],
    subject: 'Merge pull request #2 from DadonStyle/lul-22-positional-hiding',
    body: 'LUL-22/LUL-43: positional hiding — cover volumes + line-of-sight\n',
  });
  const shape = classifyShape(c);
  assert.equal(shape.excluded, false);
  assert.equal(shape.prNumber, 2);
  assert.equal(shape.text, 'positional hiding — cover volumes + line-of-sight');
  assert.deepEqual(shape.ticketIds, ['LUL-22', 'LUL-43']);
});

test('shape 2: real merge with an empty body falls back to the subject (no second parent to inspect in this fixture)', () => {
  const c = commit({
    parents: ['p1', 'p2'],
    subject: 'Merge pull request #9 from DadonStyle/lul-73-ship-path-guard',
    body: '',
  });
  const shape = classifyShape(c);
  assert.equal(shape.excluded, false);
  assert.equal(shape.prNumber, 9);
  // Falls through to git-log-ing the second parent's subject, which this
  // fixture can't provide (no real repo) -- so it lands on the raw subject.
  assert.match(shape.text, /Merge pull request #9/);
});

test('shape 2: hand-wrapped body paragraph is joined into one line, not truncated at the first newline', () => {
  const c = commit({
    parents: ['p1', 'p2'],
    subject: 'Merge GitHub repo initial commit (LICENSE + README) into the ported tree',
    body:
      "The founder's DadonStyle/LULLWOOD was created with an initial commit, so the\n" +
      'remote main and this local history were unrelated. Merging rather than\n' +
      'force-pushing keeps their MIT LICENSE and avoids the history-rewrite gate.\n' +
      '\n' +
      'README resolved in favour of the local one (theirs was a bare title).\n',
  });
  const shape = classifyShape(c);
  assert.equal(
    shape.text,
    "The founder's DadonStyle/LULLWOOD was created with an initial commit, so the remote main " +
      'and this local history were unrelated. Merging rather than force-pushing keeps their MIT ' +
      'LICENSE and avoids the history-rewrite gate.',
  );
});

test('shape 3: backmerge is excluded entirely', () => {
  const c = commit({
    parents: ['p1', 'p2'],
    subject: "Merge branch 'main' into lul-34-hud-react",
    body: 'some diff summary that must never be rendered',
  });
  const shape = classifyShape(c);
  assert.equal(shape.excluded, true);
});

// ---- extractTicketIds ------------------------------------------------------

test('extractTicketIds dedupes and preserves first-seen order', () => {
  assert.deepEqual(extractTicketIds('LUL-1 stuff LUL-2 more LUL-1 again'), ['LUL-1', 'LUL-2']);
  assert.deepEqual(extractTicketIds('no tickets here'), []);
});

// ---- dayKeyInTz -------------------------------------------------------------

test('dayKeyInTz buckets by Asia/Jerusalem, not UTC', () => {
  // 22:30 UTC on the 15th is 01:30 on the 16th in Asia/Jerusalem (+03:00 in August).
  assert.equal(dayKeyInTz('2026-08-15T22:30:00Z'), '2026-08-16');
  assert.equal(dayKeyInTz('2026-08-15T20:00:00Z'), '2026-08-15');
});

// ---- classifySection: one test per section (spec's §4 taxonomy) -----------

test('classifySection: Report-Section trailer wins over every other signal', () => {
  const c = commit({
    subject: 'fix: something that looks like a bug fix',
    body: 'Report-Section: Docs & process\n',
  });
  assert.equal(classifySection(c, ['engine/forest-engine.js']), 'docs');
});

test('classifySection: game features & content, by path', () => {
  const c = commit({ subject: 'LUL-1: tweak predator roam radius' });
  assert.equal(classifySection(c, ['engine/forest-engine.js']), 'game-features');
});

test('classifySection: bug fixes, by subject keyword', () => {
  const c = commit({ subject: 'LUL-2: fix flake in the win-path spec' });
  assert.equal(classifySection(c, ['lib/game/predator.ts']), 'bug-fixes');
});

test('classifySection: infrastructure & CI/CD, by path', () => {
  const c = commit({ subject: 'LUL-3: dedupe CI runs' });
  assert.equal(classifySection(c, ['.github/workflows/ci.yml']), 'infra');
});

test('classifySection: testing & QA, by path', () => {
  const c = commit({ subject: 'LUL-4: add a smoke spec' });
  assert.equal(classifySection(c, ['e2e/hide.spec.ts']), 'testing');
});

test('classifySection: performance & refactors, by conventional prefix', () => {
  const c = commit({ subject: 'refactor: extract predator state-machine helpers' });
  assert.equal(classifySection(c, ['lib/game/predator.ts']), 'perf-refactor');
});

test('classifySection: security, by subject keyword', () => {
  const c = commit({ subject: 'LUL-5: rotate the leaked deploy credential' });
  assert.equal(classifySection(c, ['scripts/rotate.mjs']), 'security');
});

test('classifySection: SEO & discovery, by path', () => {
  const c = commit({ subject: 'LUL-6: add sitemap entries' });
  assert.equal(classifySection(c, ['app/sitemap.ts']), 'seo');
});

test('classifySection: analytics & telemetry, by path', () => {
  const c = commit({ subject: 'LUL-7: track hide events' });
  assert.equal(classifySection(c, ['lib/analytics.ts']), 'analytics');
});

test('classifySection: docs & process, by path', () => {
  const c = commit({ subject: 'LUL-8: document the merge lane' });
  assert.equal(classifySection(c, ['NOAM_MDS/PROCESS.md']), 'docs');
});

test('classifySection: unmatched falls through to Other', () => {
  const c = commit({ subject: 'bump a dependency nobody categorized' });
  assert.equal(classifySection(c, ['some/unrelated/path.txt']), 'other');
});

test('classifySection: a one-line engine fix is a bug fix, not a feature (subject keyword outranks path)', () => {
  const c = commit({ subject: 'LUL-9: fix regression in hide detection' });
  assert.equal(classifySection(c, ['engine/forest-engine.js']), 'bug-fixes');
});

test('every section in the taxonomy is reachable and titled', () => {
  const keys = SECTIONS.map((s) => s.key);
  assert.ok(keys.includes('game-features'));
  assert.ok(keys.includes('other'));
  for (const s of SECTIONS) assert.ok(s.title.length > 0);
});

// ---- renderDay: empty day + the FIRST_COMPANY_DAY reconstructed note ------

test('renderDay: a day with zero entries still gets a file with the fixed empty-day body', () => {
  const md = renderDay('2026-09-01', []);
  assert.match(md, /^# Daily Report — 2026-09-01/);
  assert.match(md, /No changes landed on `release\/next` this day\./);
  assert.doesNotMatch(md, /\*\*Tickets:\*\*/);
});

test('renderDay: FIRST_COMPANY_DAY renders the reconstructed note, not a git-derived list', () => {
  const md = renderDay(FIRST_COMPANY_DAY, []);
  assert.match(md, /Reconstructed note/);
  assert.match(md, /2026-08-14/);
  assert.doesNotMatch(md, /No changes landed/);
});

test('renderDay: sections render only when non-empty, in SECTIONS config order', () => {
  const entries = [
    { sha: '1111111', text: 'a docs change', prNumber: null, ticketIds: ['LUL-1'], sectionKey: 'docs' },
    { sha: '2222222', text: 'a feature', prNumber: 5, ticketIds: ['LUL-2'], sectionKey: 'game-features' },
  ];
  const md = renderDay('2026-08-16', entries);
  const gameIdx = md.indexOf('## Game features & content');
  const docsIdx = md.indexOf('## Docs & process');
  assert.ok(gameIdx >= 0 && docsIdx >= 0);
  assert.ok(gameIdx < docsIdx, 'render order should follow SECTIONS array order, not entry order');
  assert.doesNotMatch(md, /## Bug fixes/);
  assert.match(md, /\*\*Tickets:\*\* LUL-1, LUL-2/);
  assert.match(md, /\*\*PRs:\*\* #5/);
});

// ---- SOURCE_BRANCH and integration: synthetic git repo --------------------

test('SOURCE_BRANCH is origin/release/next, not origin/main (LUL-801)', () => {
  assert.equal(SOURCE_BRANCH, 'origin/release/next');
});

// Build a minimal synthetic git repo so we can drive buildEntriesByDay and
// generateRange against real git output without touching the studio repo.
function makeSyntheticRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lul-801-test-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_AUTHOR_DATE: '2026-08-22T10:00:00+03:00',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test', GIT_COMMITTER_DATE: '2026-08-22T10:00:00+03:00',
  }});
  const gAt = (isoDate, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test', GIT_COMMITTER_DATE: isoDate,
  }});
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'README.md'), 'init');
  g('add', '.');
  g('commit', '-q', '-m', 'initial commit');
  // Create release/next from main
  g('checkout', '-q', '-b', 'release/next');
  return { dir, g, gAt };
}

test('buildEntriesByDay: reads from release/next (LUL-801 day-attribution fix)', () => {
  const { dir, g, gAt } = makeSyntheticRepo();
  // Add a feature commit on 2026-08-22 to release/next
  writeFileSync(path.join(dir, 'feature.txt'), 'hello');
  g('add', '.');
  gAt('2026-08-22T11:00:00+03:00', 'commit', '-q', '-m', 'LUL-99: add feature (#5)');

  // Nothing on main since the initial commit (simulates the real repo state)
  // Rename release/next to origin/release/next via a bare-clone trick
  const bareDir = mkdtempSync(path.join(os.tmpdir(), 'lul-801-bare-'));
  execFileSync('git', ['clone', '--bare', dir, bareDir], { encoding: 'utf8' });

  // In a bare clone the branch is available as 'release/next' (no remote prefix).
  // We pass it directly to prove the function reads the right history.
  const byDay = buildEntriesByDay('release/next', bareDir);
  // The feature must appear on 08-22
  const entries22 = byDay.get('2026-08-22') ?? [];
  assert.ok(entries22.length > 0, 'expected at least one entry for 2026-08-22 from release/next');
  assert.ok(entries22.some((e) => e.text.includes('add feature')), 'expected the feature commit');
});

test('generateRange: backmerges from main into release/next are excluded (merge commit shape)', () => {
  const { dir, g, gAt } = makeSyntheticRepo();
  // We are on release/next. Add a feature commit.
  writeFileSync(path.join(dir, 'real.txt'), 'real work');
  g('add', '.');
  gAt('2026-08-22T12:00:00+03:00', 'commit', '-q', '-m', 'LUL-100: real feature (#6)');

  // Switch to main and add a commit so main diverges, then merge it back into
  // release/next — producing a real 2-parent backmerge commit.
  g('checkout', '-q', 'main');
  writeFileSync(path.join(dir, 'main-only.txt'), 'main hotfix');
  g('add', '.');
  gAt('2026-08-22T12:30:00+03:00', 'commit', '-q', '-m', 'main-only hotfix');
  g('checkout', '-q', 'release/next');
  // Merge main in (this is a real 2-parent merge, which is what the studio produces).
  execFileSync('git', ['merge', '--no-edit', 'main'], { cwd: dir, encoding: 'utf8', env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_AUTHOR_DATE: '2026-08-22T13:00:00+03:00',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test', GIT_COMMITTER_DATE: '2026-08-22T13:00:00+03:00',
  }});

  const bareDir = mkdtempSync(path.join(os.tmpdir(), 'lul-801-bare2-'));
  execFileSync('git', ['clone', '--bare', dir, bareDir], { encoding: 'utf8' });

  const byDay = buildEntriesByDay('release/next', bareDir);
  const entries22 = byDay.get('2026-08-22') ?? [];
  // The backmerge subject must NOT appear
  assert.ok(
    !entries22.some((e) => e.text && e.text.includes("Merge branch 'main'")),
    'backmerge commit must be excluded',
  );
  // But the real feature must still show
  assert.ok(entries22.some((e) => e.text.includes('real feature')), 'real feature commit must be present');
});
