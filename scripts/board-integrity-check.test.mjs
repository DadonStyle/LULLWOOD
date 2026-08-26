import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTombstone,
  hasActiveRecoveryAction,
  hasLiveInteraction,
  findTombstones,
  issueReferencesPr,
  isPrMergeReady,
  findUnownedPrs,
  formatReport,
  tombstoneWakeMarker,
  unownedPrWakeMarker,
  hasOpenWakeTicket,
  extractPrNumbers,
  referencedPrNumbers,
  classifyDisposition,
  classifyTombstones,
  sortTombstonesStrandedFirst,
  tombstoneWakeTitle,
  tombstoneWakeDescription,
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
    activeRecoveryAction: { kind: 'stranded_assigned_issue', status: 'active', wakePolicy: { type: 'wake_owner' } },
  };
  assert.equal(isTombstone(issue), false);
});

// LUL-680: a recovery action object can persist with a non-"active" status
// and still be truthy on the field -- only `status: "active"` counts as a
// live wake path (wiki systems/recovery-action-wake-path documents the real
// shape, which always carries an explicit `status`).
test('activeRecoveryAction present but not status "active" -> tombstone (stale, not live)', () => {
  const issue = {
    status: 'blocked',
    blockedBy: [],
    activeRecoveryAction: { kind: 'stranded_assigned_issue', status: 'resolved' },
  };
  assert.equal(isTombstone(issue), true);
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

test('a status outside {blocked, in_review} is never a tombstone regardless of blockedBy', () => {
  const issue = { status: 'todo', blockedBy: [], activeRecoveryAction: null };
  assert.equal(isTombstone(issue), false);
});

// LUL-680/process/in-review-tombstone-class: `in_review` has the identical
// no-wake-path failure mode as `blocked` and a blocked-only scan misses it
// entirely -- LUL-139 was exactly this shape (status in_review, blockedBy
// [], no reviewer, no interaction).
test('in_review with empty blockedBy and no other live path -> tombstone (LUL-139 shape)', () => {
  const issue = {
    identifier: 'LUL-139',
    status: 'in_review',
    blockedBy: [],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
  };
  assert.equal(isTombstone(issue), true);
});

test('in_review with a live blocker -> not a tombstone', () => {
  const issue = {
    status: 'in_review',
    blockedBy: [{ status: 'todo' }],
    activeRecoveryAction: null,
  };
  assert.equal(isTombstone(issue), false);
});

// ---- hasLiveInteraction / the LUL-399 false positive -----------------------
//
// Real interaction shape, redacted from the actual live pending interaction
// on LUL-399 (id 3f7441f7-fa34-4f32-a5ff-c30654b60b8a, GET
// /api/issues/{id}/interactions -- LUL-677/LUL-680). The detector as first
// built flagged LUL-399 as a tombstone despite this interaction: `blockedBy`
// pointed at an already-done issue, so clause 1 alone doesn't save it -- the
// interaction is the only thing that does.

function lul399Interaction() {
  return {
    id: '3f7441f7-fa34-4f32-a5ff-c30654b60b8a',
    kind: 'ask_user_questions',
    status: 'pending',
    continuationPolicy: 'wake_assignee',
    payload: { version: 1, questions: [{ id: 'q1', prompt: 'pick a number', selectionMode: 'single', options: [] }] },
  };
}

test('LUL-399 shape: blockedBy resolved, but a pending wake_assignee interaction -> not a tombstone', () => {
  const issue = {
    identifier: 'LUL-399',
    status: 'blocked',
    blockedBy: [{ identifier: 'LUL-381', status: 'done' }],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
    interactions: [lul399Interaction()],
  };
  assert.equal(isTombstone(issue), false);
});

test('hasLiveInteraction is true for a pending interaction with continuationPolicy wake_assignee', () => {
  assert.equal(hasLiveInteraction([lul399Interaction()]), true);
});

test('a resolved interaction (status not pending) does not count as live, even with wake_assignee', () => {
  const resolved = { ...lul399Interaction(), status: 'resolved' };
  assert.equal(hasLiveInteraction([resolved]), false);
});

// continuationPolicy: "none" wakes nobody and looks identical to
// wake_assignee at a glance in the raw payload -- the whole point of this
// fix is that the two must not be treated the same.
test('a pending interaction with continuationPolicy "none" does not count as live -- still a tombstone', () => {
  const deadInteraction = { ...lul399Interaction(), continuationPolicy: 'none' };
  assert.equal(hasLiveInteraction([deadInteraction]), false);

  const issue = {
    status: 'blocked',
    blockedBy: [],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
    interactions: [deadInteraction],
  };
  assert.equal(isTombstone(issue), true);
});

test('no interactions field at all -> treated as no live interaction, same as before this fix', () => {
  assert.equal(hasLiveInteraction(undefined), false);
});

// ---- hasActiveRecoveryAction ------------------------------------------------

test('hasActiveRecoveryAction is false when the field is null', () => {
  assert.equal(hasActiveRecoveryAction({ activeRecoveryAction: null }), false);
});

test('hasActiveRecoveryAction is true only when status is exactly "active"', () => {
  assert.equal(hasActiveRecoveryAction({ activeRecoveryAction: { status: 'active' } }), true);
  assert.equal(hasActiveRecoveryAction({ activeRecoveryAction: { status: 'resolved' } }), false);
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
    [{ issue: { identifier: 'LUL-399', title: 'M0 gap', assigneeAgentId: 'abc' }, disposition: 'STRANDED', mergedPrs: [] }],
    [{ number: 126, title: 'fix thing', html_url: 'https://x/126' }],
    'DadonStyle/LULLWOOD',
  );
  assert.match(report, /LUL-399/);
  assert.match(report, /#126/);
  assert.match(report, /fix thing/);
});

test('formatReport marks a SHIPPED tombstone with its merge commit and a close-it action', () => {
  const report = formatReport(
    [
      {
        issue: { identifier: 'LUL-677', title: 'x' },
        disposition: 'SHIPPED',
        mergedPrs: [{ number: 144, merged: true, merge_commit_sha: 'bd72134' }],
      },
    ],
    [],
    'DadonStyle/LULLWOOD',
  );
  assert.match(report, /SHIPPED/);
  assert.match(report, /#144/);
  assert.match(report, /bd72134/);
  assert.match(report, /close the ticket/);
});

test('formatReport sorts STRANDED tombstones before SHIPPED ones', () => {
  const shipped = { issue: { identifier: 'LUL-A' }, disposition: 'SHIPPED', mergedPrs: [{ number: 1, merged: true }] };
  const stranded = { issue: { identifier: 'LUL-B' }, disposition: 'STRANDED', mergedPrs: [] };
  const report = formatReport([shipped, stranded], [], 'DadonStyle/LULLWOOD');
  assert.ok(report.indexOf('LUL-B') < report.indexOf('LUL-A'), 'expected STRANDED (LUL-B) to be listed before SHIPPED (LUL-A)');
});

// ---- extractPrNumbers / referencedPrNumbers --------------------------------

test('extractPrNumbers pulls every #<n> token out of free text', () => {
  assert.deepEqual(extractPrNumbers('shipped in #144, superseded #138 earlier'), [144, 138]);
});

test('extractPrNumbers returns empty for missing/empty text', () => {
  assert.deepEqual(extractPrNumbers(undefined), []);
  assert.deepEqual(extractPrNumbers(''), []);
});

test('referencedPrNumbers scans title, description, and every comment body, deduped and sorted', () => {
  const issue = {
    title: 'LUL-677: something',
    description: 'see #144',
    comments: [{ body: 'merged as #144' }, { body: 'earlier attempt #138' }],
  };
  assert.deepEqual(referencedPrNumbers(issue), [138, 144]);
});

test('referencedPrNumbers handles an issue with no comments field', () => {
  assert.deepEqual(referencedPrNumbers({ title: 'no refs here', description: '' }), []);
});

// ---- classifyDisposition ----------------------------------------------------
//
// LUL-736: the LUL-673 hand sweep found 4 of 5 Alarm B hits were stale status
// on already-merged work, not stranded work -- LUL-677 (PR #144 merged),
// LUL-682 (PR #138 merged), LUL-702 (PR #142 merged) vs. LUL-725 (genuinely
// stranded, no PR could even be approved -- GitHub's self-approval ban).
// These fixtures are that real shape, not invented.

test('LUL-677 shape: references one PR, already merged -> SHIPPED', () => {
  const issue = { identifier: 'LUL-677', title: 'x', description: 'closed via #144' };
  const prByNumber = new Map([[144, { number: 144, merged: true, state: 'closed', merge_commit_sha: 'bd72134' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
  assert.deepEqual(result.mergedPrs, [{ number: 144, merged: true, state: 'closed', merge_commit_sha: 'bd72134' }]);
});

test('LUL-725 shape: references a PR that is still open -> STRANDED', () => {
  const issue = { identifier: 'LUL-725', title: 'x', description: 'blocked on #145' };
  const prByNumber = new Map([[145, { number: 145, merged: false, state: 'open' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
});

test('no PR reference at all -> STRANDED', () => {
  const issue = { identifier: 'LUL-719', title: 'settled in thread', description: '' };
  const result = classifyDisposition(issue, new Map());
  assert.equal(result.disposition, 'STRANDED');
  assert.deepEqual(result.referencedPrs, []);
});

test('every referenced PR closed without merging -> STRANDED, not SHIPPED', () => {
  const issue = { identifier: 'LUL-X', title: 'x', description: 'tried #10, abandoned' };
  const prByNumber = new Map([[10, { number: 10, merged: false, state: 'closed' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
});

// The ambiguous case the ticket calls out explicitly: multiple referenced
// PRs, only some merged -- STRANDED, since something referenced by this same
// ticket is still open and the work as a whole is not done.
test('multiple referenced PRs, only some merged and one still open -> STRANDED', () => {
  const issue = { identifier: 'LUL-Y', title: 'x', description: 'part 1 #20, part 2 #21' };
  const prByNumber = new Map([
    [20, { number: 20, merged: true, state: 'closed' }],
    [21, { number: 21, merged: false, state: 'open' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
});

test('multiple referenced PRs, one merged and the other closed-unmerged (not open) -> SHIPPED', () => {
  const issue = { identifier: 'LUL-Z', title: 'x', description: 'attempt #30, landed as #31' };
  const prByNumber = new Map([
    [30, { number: 30, merged: false, state: 'closed' }],
    [31, { number: 31, merged: true, state: 'closed' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
});

test('a referenced number that does not resolve to any PR (404) is ignored, not treated as open', () => {
  const issue = { identifier: 'LUL-W', title: 'x', description: 'see #999 and #144' };
  const prByNumber = new Map([[144, { number: 144, merged: true, state: 'closed' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
});

test('classifyTombstones maps a list of issues through classifyDisposition', () => {
  const issues = [
    { identifier: 'A', description: '#1' },
    { identifier: 'B', description: 'no refs' },
  ];
  const prByNumber = new Map([[1, { number: 1, merged: true, state: 'closed' }]]);
  const result = classifyTombstones(issues, prByNumber);
  assert.equal(result[0].disposition, 'SHIPPED');
  assert.equal(result[1].disposition, 'STRANDED');
});

test('sortTombstonesStrandedFirst orders STRANDED before SHIPPED, stable within each group', () => {
  const shipped1 = { issue: { identifier: 'S1' }, disposition: 'SHIPPED' };
  const stranded1 = { issue: { identifier: 'T1' }, disposition: 'STRANDED' };
  const shipped2 = { issue: { identifier: 'S2' }, disposition: 'SHIPPED' };
  const stranded2 = { issue: { identifier: 'T2' }, disposition: 'STRANDED' };
  const sorted = sortTombstonesStrandedFirst([shipped1, stranded1, shipped2, stranded2]);
  assert.deepEqual(
    sorted.map((c) => c.issue.identifier),
    ['T1', 'T2', 'S1', 'S2'],
  );
});

// ---- wake-ticket text carries the disposition ------------------------------

test('tombstoneWakeTitle reads "close it" for SHIPPED and "needs work" for STRANDED', () => {
  assert.match(tombstoneWakeTitle('Board-integrity: LUL-677 is a tombstone', 'SHIPPED'), /SHIPPED, close it/);
  assert.match(tombstoneWakeTitle('Board-integrity: LUL-725 is a tombstone', 'STRANDED'), /STRANDED, needs work/);
});

test('tombstoneWakeDescription for SHIPPED names the PR number and merge commit, and says to close', () => {
  const description = tombstoneWakeDescription({
    issue: { identifier: 'LUL-677', title: 'x', status: 'blocked' },
    disposition: 'SHIPPED',
    mergedPrs: [{ number: 144, merged: true, merge_commit_sha: 'bd72134' }],
  });
  assert.match(description, /#144/);
  assert.match(description, /bd72134/);
  assert.match(description, /MERGED/);
  assert.match(description, /Close the ticket/);
  assert.doesNotMatch(description, /stranded/i);
});

test('tombstoneWakeDescription for STRANDED does not claim anything shipped', () => {
  const description = tombstoneWakeDescription({
    issue: { identifier: 'LUL-725', title: 'x', status: 'blocked' },
    disposition: 'STRANDED',
    mergedPrs: [],
  });
  assert.doesNotMatch(description, /MERGED/);
  assert.match(description, /Re-check it/);
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
