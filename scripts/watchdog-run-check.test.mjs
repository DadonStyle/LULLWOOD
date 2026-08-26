import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHDOGS,
  latestScheduledConclusion,
  classifyWatchdog,
  findRedWatchdogs,
  findInertWatchdogs,
  findNoRunWatchdogs,
  formatReport,
  watchdogWakeMarker,
} from './watchdog-run-check.mjs';
import { hasOpenWakeTicket } from './board-integrity-check.mjs';

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
  assert.equal(baseBranchGuard.mixedTrigger, true);
  const result = classifyWatchdog(baseBranchGuard, true, [redRun()]);
  assert.equal(result.alarm, 'red');
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
  // The open-issues fetch only ever pulls status=todo/in_progress (see
  // fetchOpenIssuesForDedup), so a `done` ticket is absent from this list --
  // that absence IS the re-arm, no separate mechanism needed.
  const openIssuesAfterTicketClosed = [];
  assert.equal(hasOpenWakeTicket(openIssuesAfterTicketClosed, marker), false);
});

test('dedup does not cross-match a different watchdog\'s marker', () => {
  const reviewGapMarker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
  const versionCutMarker = watchdogWakeMarker(WATCHDOGS.find((w) => w.file === 'version-cut.yml'));
  const openIssues = [{ title: `${versionCutMarker} (LUL-685 detector)`, status: 'todo' }];
  assert.equal(hasOpenWakeTicket(openIssues, reviewGapMarker), false);
});
