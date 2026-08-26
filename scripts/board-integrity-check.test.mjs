import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTombstone,
  findTombstones,
  issueReferencesPr,
  isPrMergeReady,
  findUnownedPrs,
  formatReport,
  tombstoneWakeMarker,
  unownedPrWakeMarker,
  hasOpenWakeTicket,
} from './board-integrity-check.mjs';

// ---- isTombstone / findTombstones ------------------------------------------
//
// LUL-399 and LUL-653 below are real board state, captured live 2026-08-26
// while building this detector (GET /api/issues/{id}) -- not invented. Both
// were sitting `blocked` with nothing that could ever wake them: this is the
// "fail once on purpose against a known-bad fixture" the ticket asks for.

test('LUL-399 fixture: blockedBy non-empty but its only entry is done -> tombstone', () => {
  const issue = {
    identifier: 'LUL-399',
    status: 'blocked',
    blockedBy: [{ identifier: 'LUL-381', status: 'done' }],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
  };
  assert.equal(isTombstone(issue), true);
});

test('LUL-653 fixture: same shape, different blocker -> tombstone', () => {
  const issue = {
    identifier: 'LUL-653',
    status: 'blocked',
    blockedBy: [{ identifier: 'LUL-650', status: 'done' }],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
  };
  assert.equal(isTombstone(issue), true);
});

test('genuinely empty blockedBy, no recovery action -> tombstone', () => {
  const issue = { status: 'blocked', blockedBy: [], activeRecoveryAction: null, successfulRunHandoff: null };
  assert.equal(isTombstone(issue), true);
});

test('a live (non-done, non-cancelled) blocker -> not a tombstone', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [{ identifier: 'LUL-1', status: 'todo' }],
    activeRecoveryAction: null,
  };
  assert.equal(isTombstone(issue), false);
});

test('a cancelled blocker counts the same as done -> tombstone', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [{ identifier: 'LUL-1', status: 'cancelled' }],
    activeRecoveryAction: null,
  };
  assert.equal(isTombstone(issue), true);
});

test('one live blocker among several resolved ones -> not a tombstone', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [
      { identifier: 'LUL-1', status: 'done' },
      { identifier: 'LUL-2', status: 'todo' },
    ],
    activeRecoveryAction: null,
  };
  assert.equal(isTombstone(issue), false);
});

test('empty blockedBy but a live activeRecoveryAction -> not a tombstone (platform already owns the wake)', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [],
    activeRecoveryAction: { kind: 'stranded_assigned_issue', wakePolicy: { type: 'wake_owner' } },
  };
  assert.equal(isTombstone(issue), false);
});

test('empty blockedBy but successfulRunHandoff.hasLiveContinuation -> not a tombstone', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [],
    activeRecoveryAction: null,
    successfulRunHandoff: { hasLiveContinuation: true },
  };
  assert.equal(isTombstone(issue), false);
});

test('non-blocked status is never a tombstone regardless of blockedBy', () => {
  const issue = { status: 'in_review', blockedBy: [], activeRecoveryAction: null };
  assert.equal(isTombstone(issue), false);
});

test('findTombstones filters a mixed list down to the true tombstones, preserving order', () => {
  const healthy = { identifier: 'A', status: 'blocked', blockedBy: [{ status: 'todo' }] };
  const tomb1 = { identifier: 'B', status: 'blocked', blockedBy: [] };
  const notBlocked = { identifier: 'C', status: 'todo', blockedBy: [] };
  const tomb2 = { identifier: 'D', status: 'blocked', blockedBy: [{ status: 'cancelled' }] };
  assert.deepEqual(findTombstones([healthy, tomb1, notBlocked, tomb2]), [tomb1, tomb2]);
});

// ---- issueReferencesPr ------------------------------------------------------

test('matches "#123" as a whole token in the title', () => {
  assert.equal(issueReferencesPr({ title: 'Land PR #123 now', description: '' }, 123), true);
});

test('matches in the description when absent from the title', () => {
  assert.equal(issueReferencesPr({ title: 'Merge lane', description: 'blocked on #123' }, 123), true);
});

test('does not false-match #1234 when looking for #123', () => {
  assert.equal(issueReferencesPr({ title: 'Land PR #1234', description: '' }, 123), false);
});

test('does not false-match #12 when looking for #123', () => {
  assert.equal(issueReferencesPr({ title: 'Land PR #12', description: '' }, 123), false);
});

test('handles a missing description field without throwing', () => {
  assert.equal(issueReferencesPr({ title: 'no mention here' }, 5), false);
});

// ---- isPrMergeReady ----------------------------------------------------------

const requiredChecks = ['build, typecheck, lint', 'playwright smoke suite', 'unit tests'];

function greenRuns() {
  return new Map([
    ['build, typecheck, lint', [{ conclusion: 'skipped' }, { conclusion: 'success' }]],
    ['playwright smoke suite', [{ conclusion: 'success' }]],
    ['unit tests', [{ conclusion: 'success' }]],
  ]);
}

test('clean + approved + all required checks have a success run (even alongside a skipped twin) -> ready', () => {
  const pr = { mergeable_state: 'clean' };
  const reviews = [{ state: 'APPROVED' }];
  assert.equal(isPrMergeReady(pr, reviews, requiredChecks, greenRuns()), true);
});

test('mergeable_state "blocked" (a check still running) -> not ready', () => {
  const pr = { mergeable_state: 'blocked' };
  const reviews = [{ state: 'APPROVED' }];
  assert.equal(isPrMergeReady(pr, reviews, requiredChecks, greenRuns()), false);
});

test('no APPROVED review -> not ready even if clean and green', () => {
  const pr = { mergeable_state: 'clean' };
  const reviews = [{ state: 'CHANGES_REQUESTED' }];
  assert.equal(isPrMergeReady(pr, reviews, requiredChecks, greenRuns()), false);
});

test('a required check with only a skipped run (no success anywhere) -> not ready', () => {
  const pr = { mergeable_state: 'clean' };
  const reviews = [{ state: 'APPROVED' }];
  const runs = greenRuns();
  runs.set('unit tests', [{ conclusion: 'skipped' }]);
  assert.equal(isPrMergeReady(pr, reviews, requiredChecks, runs), false);
});

test('a required check with no runs at all -> not ready', () => {
  const pr = { mergeable_state: 'clean' };
  const reviews = [{ state: 'APPROVED' }];
  const runs = greenRuns();
  runs.delete('unit tests');
  assert.equal(isPrMergeReady(pr, reviews, requiredChecks, runs), false);
});

// ---- findUnownedPrs -----------------------------------------------------------

test('a ready PR with a todo ticket mentioning its number is owned, not a gap', () => {
  const ctx = {
    pr: { number: 126, title: 'fix', mergeable_state: 'clean' },
    reviews: [{ state: 'APPROVED' }],
    requiredCheckNames: requiredChecks,
    checkRunsByName: greenRuns(),
  };
  const owner = { status: 'todo', title: 'Land PR #126', description: '' };
  assert.deepEqual(findUnownedPrs([ctx], [owner]), []);
});

test('a ready PR with no referencing ticket anywhere is a gap', () => {
  const ctx = {
    pr: { number: 999, title: 'orphaned', mergeable_state: 'clean' },
    reviews: [{ state: 'APPROVED' }],
    requiredCheckNames: requiredChecks,
    checkRunsByName: greenRuns(),
  };
  const unrelated = { status: 'todo', title: 'Something else', description: 'no mention' };
  assert.deepEqual(findUnownedPrs([ctx], [unrelated]), [ctx.pr]);
});

test('a not-yet-ready PR (still pending checks) is never a gap, even unowned', () => {
  const ctx = {
    pr: { number: 999, title: 'pending' },
    reviews: [],
    requiredCheckNames: requiredChecks,
    checkRunsByName: new Map(),
  };
  assert.deepEqual(findUnownedPrs([ctx], []), []);
});

// ---- formatReport ---------------------------------------------------------

test('formatReport returns null when both lists are empty (silence on a healthy board)', () => {
  assert.equal(formatReport([], [], 'DadonStyle/LULLWOOD'), null);
});

test('formatReport names every tombstone and every unowned PR', () => {
  const report = formatReport(
    [{ identifier: 'LUL-399', title: 'M0 gap', assigneeAgentId: 'abc' }],
    [{ number: 126, title: 'fix thing', html_url: 'https://x/126' }],
    'DadonStyle/LULLWOOD',
  );
  assert.match(report, /LUL-399/);
  assert.match(report, /#126/);
  assert.match(report, /fix thing/);
});

// ---- wake-ticket dedup (the authorization-boundary redesign) --------------
//
// Found live building this: --post cannot comment on a shared "standing"
// issue assigned to someone else -- POST /comments 403s the moment the
// issue's assigneeAgentId is not the caller's own id (wiki
// systems/issue-authorization-boundary). A fresh per-alarm issue sidesteps
// it (creation is not boundary-restricted) but then needs its own dedup so
// a repeat run does not refile the same wake ticket forever.

test('tombstoneWakeMarker and unownedPrWakeMarker are stable and distinguishable', () => {
  const marker = tombstoneWakeMarker({ identifier: 'LUL-399', title: 'x' });
  assert.equal(marker, 'Board-integrity: LUL-399 is a tombstone');
  const prMarker = unownedPrWakeMarker({ number: 126, title: 'x' });
  assert.equal(prMarker, 'Board-integrity: PR #126 has no owning ticket');
  assert.notEqual(marker, prMarker);
});

test('hasOpenWakeTicket finds a previously-filed wake ticket by its marker prefix', () => {
  const marker = tombstoneWakeMarker({ identifier: 'LUL-399' });
  const openIssues = [{ title: `${marker} (LUL-672 detector)` }];
  assert.equal(hasOpenWakeTicket(openIssues, marker), true);
});

test('hasOpenWakeTicket is false when no open issue carries the marker', () => {
  assert.equal(hasOpenWakeTicket([{ title: 'unrelated' }], tombstoneWakeMarker({ identifier: 'LUL-399' })), false);
});

test('hasOpenWakeTicket does not cross-match a different identifier\'s marker', () => {
  const markerA = tombstoneWakeMarker({ identifier: 'LUL-399' });
  const markerB = tombstoneWakeMarker({ identifier: 'LUL-653' });
  const openIssues = [{ title: `${markerB} (LUL-672 detector)` }];
  assert.equal(hasOpenWakeTicket(openIssues, markerA), false);
});
