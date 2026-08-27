import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_STATUSES,
  hasScheduleTrigger,
  workflowDisplayName,
  deriveWatchdogs,
  latestScheduledConclusion,
  classifyWatchdog,
  findRedWatchdogs,
  findInertWatchdogs,
  findNoRunWatchdogs,
  formatReport,
  watchdogWakeMarker,
} from './watchdog-run-check.mjs';
import { hasOpenWakeTicket } from './board-integrity-check.mjs';

function cronWorkflow(name, extraTriggers = '') {
  return `name: ${name}\n\non:\n  schedule:\n    - cron: '*/30 * * * *'\n${extraTriggers}\njobs:\n  check:\n    runs-on: ubuntu-latest\n`;
}

// The roster is derived, not hand-listed, so the tests derive theirs too --
// from fixture yaml shaped like the repo's real workflows.
const WATCHDOGS = deriveWatchdogs(
  [
    { file: 'base-branch-guard.yml', yaml: cronWorkflow('Base branch guard', '  pull_request:\n') },
    { file: 'review-gap-detector.yml', yaml: cronWorkflow('Review gap detector') },
    { file: 'version-cut.yml', yaml: cronWorkflow('Version cut', '  push:\n    branches: [main]\n') },
  ],
  [{ file: 'merge-gap-detector.yml', yaml: cronWorkflow('Merge gap detector') }],
);

// LUL-685's own measured shape, live 2026-08-26: review-gap-detector.yml red
// 99/102 scheduled runs straight, same offender (PR #128) every time. This
// is the fixture the ticket's acceptance criteria is built around.
const REVIEW_GAP_DETECTOR = WATCHDOGS.find((w) => w.file === 'review-gap-detector.yml');

function redRun(id = 987654321) {
  return { id, conclusion: 'failure', html_url: `https://github.com/DadonStyle/LULLWOOD/actions/runs/${id}` };
}

function greenRun(id = 111111) {
  return { id, conclusion: 'success', html_url: `https://github.com/DadonStyle/LULLWOOD/actions/runs/${id}` };
}

// ---- latestScheduledConclusion --------------------------------------------

test('latestScheduledConclusion reads the first (most recent) run', () => {
  assert.equal(latestScheduledConclusion([redRun(), greenRun()]), 'failure');
});

test('latestScheduledConclusion is null with no runs at all', () => {
  assert.equal(latestScheduledConclusion([]), null);
  assert.equal(latestScheduledConclusion(undefined), null);
});

// ---- classifyWatchdog -------------------------------------------------------

test('LUL-685 fixture: review-gap-detector red on its latest scheduled run -> alarm "red"', () => {
  const result = classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(999)]);
  assert.equal(result.alarm, 'red');
  assert.equal(result.runId, 999);
  assert.match(result.runUrl, /runs\/999$/);
});

test('a healthy watchdog (latest scheduled run succeeded) -> no alarm', () => {
  const result = classifyWatchdog(REVIEW_GAP_DETECTOR, true, [greenRun()]);
  assert.equal(result.alarm, null);
});

test('99 red runs in the array only look at runs[0] -- still one alarm, not counted per-run', () => {
  const ninetyNineRed = Array.from({ length: 99 }, (_, i) => redRun(i));
  const result = classifyWatchdog(REVIEW_GAP_DETECTOR, true, ninetyNineRed);
  assert.equal(result.alarm, 'red');
});

test('a workflow that does not resolve on the default branch -> "inert", not "red" (LUL-684 shape)', () => {
  const mergeGapDetector = WATCHDOGS.find((w) => w.file === 'merge-gap-detector.yml');
  const result = classifyWatchdog(mergeGapDetector, false, []);
  assert.equal(result.alarm, 'inert');
});

test('resolves on default branch but has never run -> "no-runs", not "red"', () => {
  const result = classifyWatchdog(REVIEW_GAP_DETECTOR, true, []);
  assert.equal(result.alarm, 'no-runs');
});

test('a mixed-trigger watchdog (base-branch-guard) classifies the same way once runs are pre-filtered', () => {
  const baseBranchGuard = WATCHDOGS.find((w) => w.file === 'base-branch-guard.yml');
  const result = classifyWatchdog(baseBranchGuard, true, [redRun()]);
  assert.equal(result.alarm, 'red');
});

// version-cut.yml was hand-flagged `mixedTrigger: false`, so its runs were
// fetched unfiltered and the newest one was an unfinished *push* run. A null
// conclusion must not read as green, and must not read as red either.
test('an unfinished latest run (conclusion: null) is not green and not red', () => {
  const inProgress = { id: 7, conclusion: null, html_url: 'https://example.invalid/runs/7' };
  assert.equal(latestScheduledConclusion([inProgress]), null);
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [inProgress]).alarm, 'no-runs');
});

// ---- findRedWatchdogs / findInertWatchdogs / findNoRunWatchdogs ------------

test('find* helpers partition a classified list correctly', () => {
  const classified = [
    classifyWatchdog(WATCHDOGS[0], true, [redRun()]),
    classifyWatchdog(WATCHDOGS[1], false, []),
    classifyWatchdog(WATCHDOGS[2], true, []),
    classifyWatchdog(WATCHDOGS[3], true, [greenRun()]),
  ];
  assert.equal(findRedWatchdogs(classified).length, 1);
  assert.equal(findInertWatchdogs(classified).length, 1);
  assert.equal(findNoRunWatchdogs(classified).length, 1);
});

// ---- formatReport ------------------------------------------------------------

test('formatReport returns null when every watchdog is healthy (silence on a green board)', () => {
  const classified = WATCHDOGS.map((w) => classifyWatchdog(w, true, [greenRun()]));
  assert.equal(formatReport(classified, 'DadonStyle/LULLWOOD'), null);
});

test('formatReport names the red watchdog and its run URL, and separates inert from red', () => {
  const classified = [
    classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(42)]),
    classifyWatchdog(WATCHDOGS.find((w) => w.file === 'merge-gap-detector.yml'), false, []),
  ];
  const report = formatReport(classified, 'DadonStyle/LULLWOOD');
  assert.match(report, /RED latest scheduled run/);
  assert.match(report, /Review gap detector/);
  assert.match(report, /runs\/42/);
  assert.match(report, /do not resolve on the default branch/);
  assert.match(report, /Merge gap detector/);
});

// ---- dedup marker + re-arm (reusing board-integrity-check.mjs's own dedup) -

test('watchdogWakeMarker is stable per watchdog name, distinguishable across watchdogs', () => {
  const a = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  const b = watchdogWakeMarker(WATCHDOGS.find((w) => w.file === 'version-cut.yml'));
  assert.notEqual(a, b);
  assert.match(a, /^Watchdog red: Review gap detector$/);
});

test('dedup: 99 consecutive red runs -> hasOpenWakeTicket is true after the first ticket is filed, so a re-run files nothing new', () => {
  const marker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  const openIssuesAfterFirstFile = [
    { title: `${marker} (LUL-685 detector)`, status: 'todo' },
  ];
  assert.equal(hasOpenWakeTicket(openIssuesAfterFirstFile, marker), true);
});

test('re-arm: once the wake ticket is done (no longer in the open-issues list), a fresh red run can file again', () => {
  const marker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  // The open-issues fetch only pulls the non-terminal statuses (see
  // OPEN_STATUSES), so a `done` ticket is absent from this list -- that
  // absence IS the re-arm, no separate mechanism needed.
  const openIssuesAfterTicketClosed = [];
  assert.equal(hasOpenWakeTicket(openIssuesAfterTicketClosed, marker), false);
});

test('dedup does not cross-match a different watchdog\'s marker', () => {
  const reviewGapMarker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  const versionCutMarker = watchdogWakeMarker(WATCHDOGS.find((w) => w.file === 'version-cut.yml'));
  const openIssues = [{ title: `${versionCutMarker} (LUL-685 detector)`, status: 'todo' }];
  assert.equal(hasOpenWakeTicket(openIssues, reviewGapMarker), false);
});

// The dedup fetch used to pull status=todo and status=in_progress only.
// LUL-721 -- this detector's own first wake ticket -- was moved to `blocked`
// by terminal-run recovery, which made it invisible to that query while it
// was still very much open, so the 30-minute cron would refile it forever.
test('dedup counts a ticket parked in `blocked` or `in_review` as still open (LUL-721 flood shape)', () => {
  // hasOpenWakeTicket matches on title alone, so the status filter that
  // actually decides this lives in the fetch: whatever OPEN_STATUSES does
  // not name is invisible to dedup and gets refiled on the next tick.
  for (const status of ['todo', 'in_progress', 'blocked', 'in_review']) {
    assert.ok(OPEN_STATUSES.includes(status), `${status} must be fetched for dedup, or the alarm refiles`);
  }
  // Terminal statuses must stay out -- that absence is what re-arms the alarm.
  for (const status of ['done', 'cancelled']) {
    assert.equal(OPEN_STATUSES.includes(status), false, `${status} must not suppress a refile`);
  }

  const marker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  const parked = [{ title: `${marker} (LUL-685 detector)`, status: 'blocked' }];
  assert.equal(hasOpenWakeTicket(parked, marker), true);
});

// ---- deriving the roster from the repo (replaces the hand-listed WATCHDOGS) -

test('hasScheduleTrigger finds a cron in the on: block, block form and inline list', () => {
  assert.equal(hasScheduleTrigger(cronWorkflow('Review gap detector')), true);
  assert.equal(hasScheduleTrigger('name: X\non: [push, schedule]\njobs: {}\n'), true);
});

test('hasScheduleTrigger does not fire on a workflow with no cron', () => {
  assert.equal(hasScheduleTrigger('name: CI\n\non:\n  pull_request:\n  push:\n\njobs: {}\n'), false);
  assert.equal(hasScheduleTrigger(''), false);
});

test('hasScheduleTrigger ignores a `schedule:` that is not a trigger', () => {
  // A job step or env key called schedule sits below the on: block and must
  // not enrol a non-cron workflow into the roster.
  const yaml = 'name: CI\n\non:\n  push:\n\njobs:\n  build:\n    env:\n      schedule: nightly\n';
  assert.equal(hasScheduleTrigger(yaml), false);
});

test('workflowDisplayName prefers the workflow name:, falling back to the filename', () => {
  assert.equal(workflowDisplayName('daily-report.yml', 'name: Daily report\non: {}\n'), 'Daily report');
  assert.equal(workflowDisplayName('daily-report.yml', 'on: {}\n'), 'daily-report.yml');
});

// The regression this whole change exists for: daily-report.yml shipped with
// a schedule: and was never added to the hand-maintained list, so nothing
// watched it. Deriving the roster picks it up with no edit at all.
test('deriveWatchdogs enrols a newly-added cron workflow with no hand edit (daily-report shape)', () => {
  const roster = deriveWatchdogs(
    [
      { file: 'ci.yml', yaml: 'name: CI\non:\n  pull_request:\njobs: {}\n' },
      { file: 'daily-report.yml', yaml: cronWorkflow('Daily report') },
    ],
    [],
  );
  assert.deepEqual(
    roster.map((w) => w.file),
    ['daily-report.yml'],
  );
  assert.equal(roster[0].name, 'Daily report');
  assert.equal(roster[0].onDefaultBranch, true);
});

test('deriveWatchdogs flags a train-branch-only cron as not on the default branch (LUL-628 inert shape)', () => {
  const roster = deriveWatchdogs([], [{ file: 'merge-gap-detector.yml', yaml: cronWorkflow('Merge gap detector') }]);
  assert.equal(roster[0].onDefaultBranch, false);
  assert.equal(classifyWatchdog(roster[0], roster[0].onDefaultBranch, []).alarm, 'inert');
});

test('deriveWatchdogs does not double-count a workflow present on both refs', () => {
  const onBoth = { file: 'review-gap-detector.yml', yaml: cronWorkflow('Review gap detector') };
  const roster = deriveWatchdogs([onBoth], [onBoth]);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].onDefaultBranch, true);
});
