import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SECTIONS,
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

// ---- buildEntriesByDay: LUL-801 day-attribution fix ------------------------
//
// The bug: under the release train, `main` receives only periodic version-cut
// merges, so walking `main` attributes a whole day's real work to whatever
// day the *next cut* happens to land on -- see wiki systems/daily-reports.
// Repointing at `release/next` (spec change, this ticket) fixes the
// attribution, but release/next's own first-parent history contains
// empty-diff sync-back merges from `main` (measured on the real repo: `Sync
// release/next after v2026.08.22-1 (#133)`, `Merge pull request #151 from
// DadonStyle/main`, `LUL-572: backmerge main into release/next` -- three
// different title shapes, all empty-diff) that must not themselves render as
// shipped content. This builds a real throwaway repo shaped like that so
// both halves are exercised end-to-end, not just asserted against fixtures.
//
// Before the `paths.length === 0` guard landed, this test failed: the sync
// commit rendered as a spurious entry (section 'other', since its empty path
// list matches no section pattern).

function gitIn(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function commitOn(cwd, { message, date, files = {} }) {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(cwd, file);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    gitIn(cwd, ['add', file]);
  }
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  gitIn(cwd, ['commit', '-q', '--allow-empty', '-m', message], env);
  return gitIn(cwd, ['rev-parse', 'HEAD']).trim();
}

function makeReleaseTrainFixtureRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'lul801-'));
  gitIn(repo, ['init', '-q', '-b', 'release-next']);
  gitIn(repo, ['config', 'user.email', 'test@example.com']);
  gitIn(repo, ['config', 'user.name', 'Test']);

  commitOn(repo, { message: 'init', date: '2026-08-21T10:00:00+03:00', files: { 'README.md': 'x' } });
  commitOn(repo, {
    message: 'LUL-900: add a real feature (#900)',
    date: '2026-08-22T10:00:00+03:00',
    files: { 'engine/thing.js': 'content' },
  });

  // A branch identical to release-next's tip, then merged back with --no-ff:
  // a real 2-parent commit whose diff against its first parent is empty,
  // shaped exactly like a release-train sync-back from `main`.
  gitIn(repo, ['branch', 'main-cut']);
  const mergeEnv = { GIT_AUTHOR_DATE: '2026-08-23T09:00:00+03:00', GIT_COMMITTER_DATE: '2026-08-23T09:00:00+03:00' };
  gitIn(
    repo,
    ['merge', '--no-ff', '-m', 'Sync release/next after v2026.08.22-1 (#133)', 'main-cut'],
    mergeEnv,
  );

  return repo;
}

test('buildEntriesByDay: an empty-diff sync-back merge is excluded, a real commit on the same ref is not', () => {
  const repo = makeReleaseTrainFixtureRepo();
  try {
    const byDay = buildEntriesByDay('release-next', repo);
    const allText = [...byDay.values()].flat().map((e) => e.text);
    assert.ok(
      !allText.some((t) => /Sync release\/next after v/.test(t)),
      `sync-back merge rendered as content: ${JSON.stringify(allText)}`,
    );
    assert.ok(
      allText.some((t) => /add a real feature/.test(t)),
      `real commit missing from output: ${JSON.stringify(allText)}`,
    );
    assert.equal(byDay.get('2026-08-23'), undefined, 'the sync day has no entries at all, not an empty array');
    const featureEntry = byDay.get('2026-08-22')?.find((e) => /add a real feature/.test(e.text));
    assert.equal(featureEntry?.sectionKey, 'game-features');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
