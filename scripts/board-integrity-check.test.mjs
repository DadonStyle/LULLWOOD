import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isTombstone,
  hasActiveRecoveryAction,
  hasLiveInteraction,
  hasFreshHeartbeat,
  findTombstones,
  issueReferencesPr,
  isPrMergeReady,
  findUnownedPrs,
  formatReport,
  tombstoneWakeMarker,
  unownedPrWakeMarker,
  zeroPullableWorkWakeMarker,
  staleConfirmationWakeMarker,
  hasOpenWakeTicket,
  extractPrNumbers,
  referencedPrNumbers,
  prTitleReferencesIssue,
  classifyDisposition,
  classifyTombstones,
  sortTombstonesStrandedFirst,
  tombstoneWakeTitle,
  tombstoneWakeDescription,
  isAvailableAgent,
  zeroPullableWorkAlarm,
  findStaleConfirmations,
  isStaleConfirmationSuppressed,
  STALE_CONFIRMATION_DAYS,
  authJsonPath,
  durableToken,
  resolveSelfAgentId,
  fileWakeTickets,
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

// ---- hasFreshHeartbeat / the LUL-482 false positive (LUL-934) --------------
//
// Real board state: LUL-482 (in_review, assigned Founding Engineer) was
// flagged STRANDED while the Founding Engineer had a heartbeat seconds old,
// actively driving its own live in-review PR #199 (wiki
// playbooks/lul494-tombstone-sweep Finding #2). isTombstone()'s existing
// four clauses are all read from a DB snapshot and have no way to see "a run
// is executing against this exact ticket right now" -- a fresh heartbeat on
// the assignee is a fifth, independent live signal. Must fail without it.

test('LUL-482 shape: a tombstone by every other signal, but assignee heartbeat is seconds old -> not a tombstone', () => {
  const nowMs = new Date('2026-08-28T12:00:00.000Z').getTime();
  const issue = {
    identifier: 'LUL-482',
    status: 'in_review',
    blockedBy: [],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
    interactions: [],
    assigneeAgentId: 'founding-engineer',
  };
  const agentsById = new Map([
    ['founding-engineer', { id: 'founding-engineer', status: 'running', lastHeartbeatAt: '2026-08-28T11:59:50.000Z' }],
  ]);
  assert.equal(isTombstone(issue, agentsById, nowMs), false);
});

test('hasFreshHeartbeat is false once the heartbeat is older than the freshness window', () => {
  const nowMs = new Date('2026-08-28T12:00:00.000Z').getTime();
  const issue = { assigneeAgentId: 'agent-1' };
  const agentsById = new Map([
    ['agent-1', { status: 'running', lastHeartbeatAt: '2026-08-28T11:50:00.000Z' }],
  ]);
  assert.equal(hasFreshHeartbeat(issue, agentsById, nowMs), false);
});

test('hasFreshHeartbeat is false for a fresh heartbeat if the agent is not "running" (e.g. paused)', () => {
  const nowMs = new Date('2026-08-28T12:00:00.000Z').getTime();
  const issue = { assigneeAgentId: 'agent-1' };
  const agentsById = new Map([
    ['agent-1', { status: 'paused', lastHeartbeatAt: '2026-08-28T11:59:59.000Z' }],
  ]);
  assert.equal(hasFreshHeartbeat(issue, agentsById, nowMs), false);
});

test('hasFreshHeartbeat is false when the assignee is not in the agents map at all', () => {
  assert.equal(hasFreshHeartbeat({ assigneeAgentId: 'ghost' }, new Map(), Date.now()), false);
});

test('isTombstone with no agentsById/nowMs args (default params) behaves exactly as before this fix', () => {
  const issue = {
    identifier: 'LUL-653',
    status: 'blocked',
    blockedBy: [],
    activeRecoveryAction: null,
    successfulRunHandoff: null,
  };
  assert.equal(isTombstone(issue), true);
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
  const prByNumber = new Map([
    [144, { number: 144, title: 'LUL-677: fix', merged: true, state: 'closed', merge_commit_sha: 'bd72134' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
  assert.deepEqual(result.mergedPrs, [
    { number: 144, title: 'LUL-677: fix', merged: true, state: 'closed', merge_commit_sha: 'bd72134' },
  ]);
});

test('LUL-725 shape: references a PR that is still open -> STRANDED', () => {
  const issue = { identifier: 'LUL-725', title: 'x', description: 'blocked on #145' };
  const prByNumber = new Map([[145, { number: 145, title: 'LUL-725: work', merged: false, state: 'open' }]]);
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
  const prByNumber = new Map([[10, { number: 10, title: 'LUL-X: attempt', merged: false, state: 'closed' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
});

// The ambiguous case the ticket calls out explicitly: multiple referenced
// PRs, only some merged -- STRANDED, since something referenced by this same
// ticket is still open and the work as a whole is not done.
test('multiple referenced PRs, only some merged and one still open -> STRANDED', () => {
  const issue = { identifier: 'LUL-Y', title: 'x', description: 'part 1 #20, part 2 #21' };
  const prByNumber = new Map([
    [20, { number: 20, title: 'LUL-Y: part 1', merged: true, state: 'closed' }],
    [21, { number: 21, title: 'LUL-Y: part 2', merged: false, state: 'open' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
});

test('multiple referenced PRs, one merged and the other closed-unmerged (not open) -> SHIPPED', () => {
  const issue = { identifier: 'LUL-Z', title: 'x', description: 'attempt #30, landed as #31' };
  const prByNumber = new Map([
    [30, { number: 30, title: 'LUL-Z: attempt', merged: false, state: 'closed' }],
    [31, { number: 31, title: 'LUL-Z: landed', merged: true, state: 'closed' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
});

test('a referenced number that does not resolve to any PR (404) is ignored, not treated as open', () => {
  const issue = { identifier: 'LUL-W', title: 'x', description: 'see #999 and #144' };
  const prByNumber = new Map([[144, { number: 144, title: 'LUL-W: fix', merged: true, state: 'closed' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
});

test('classifyTombstones maps a list of issues through classifyDisposition', () => {
  const issues = [
    { identifier: 'A', description: '#1' },
    { identifier: 'B', description: 'no refs' },
  ];
  const prByNumber = new Map([[1, { number: 1, title: 'A: fix', merged: true, state: 'closed' }]]);
  const result = classifyTombstones(issues, prByNumber);
  assert.equal(result[0].disposition, 'SHIPPED');
  assert.equal(result[1].disposition, 'STRANDED');
});

// ---- LUL-934: attribution bug ----------------------------------------------
//
// Real board state, 2026-08-28: the detector flagged LUL-27 as SHIPPED and
// cited merge commit `ee956c52` -- which actually belongs to PR #179
// (LUL-83, "session-varied map seed"). LUL-27's own dispatch comment had
// mentioned "#179" only in passing ("LUL-83 just landed ... in PR #179, use
// it rather than adding a second seed source"), never claiming #179 shipped
// LUL-27. Sorting referenced numbers (#179 < #190, LUL-27's real PR) and
// taking mergedPrs[0] cited the wrong commit as evidence. This must fail
// without the prTitleReferencesIssue() attribution filter in
// classifyDisposition.

test('LUL-27 fixture: a merged PR mentioned only in passing is not evidence -- SHIPPED cites the PR that actually names the ticket', () => {
  const issue = {
    identifier: 'LUL-27',
    title: 'Event system + the first recurring event: the Fog Tide',
    description: '',
    comments: [
      { body: 'note LUL-83 just landed resolveInitialSeed() / ?seed= in PR #179, use it rather than adding a second seed source' },
      { body: '**PR opened: https://github.com/DadonStyle/LULLWOOD/pull/190** (`lul-27-fog-tide-event` -> `release/next`)' },
      { body: 'Backmerge complete and pushed. PR #190 all green.' },
    ],
  };
  const prByNumber = new Map([
    [179, { number: 179, title: 'LUL-83: session-varied map seed, pinned via ?seed= for QA', merged: true, state: 'closed', merge_commit_sha: 'ee956c52' }],
    [190, { number: 190, title: 'LUL-27: event scheduler infra + Fog Tide, the first recurring event', merged: true, state: 'closed', merge_commit_sha: 'a7e3d412' }],
  ]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'SHIPPED');
  assert.equal(result.mergedPrs.length, 1);
  assert.equal(result.mergedPrs[0].number, 190);
  assert.equal(result.mergedPrs[0].merge_commit_sha, 'a7e3d412');
});

test('prTitleReferencesIssue anchors on word boundaries: LUL-27 does not match inside LUL-271/LUL-279 titles', () => {
  assert.equal(
    prTitleReferencesIssue({ title: 'LUL-271: unrelated fix' }, { identifier: 'LUL-27' }),
    false,
  );
  assert.equal(
    prTitleReferencesIssue({ title: 'LUL-279: another unrelated fix' }, { identifier: 'LUL-27' }),
    false,
  );
  assert.equal(prTitleReferencesIssue({ title: 'LUL-27: the real one' }, { identifier: 'LUL-27' }), true);
});

test('an issue with no identifier can never attribute a merged PR (avoids a false SHIPPED on missing data)', () => {
  const issue = { title: 'x', description: 'closed via #144' };
  const prByNumber = new Map([[144, { number: 144, title: 'LUL-677: fix', merged: true, state: 'closed' }]]);
  const result = classifyDisposition(issue, prByNumber);
  assert.equal(result.disposition, 'STRANDED');
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

// ---- Alarm C: zero pullable work (LUL-810) ----------------------------------
//
// The studio stalled 2026-08-27 with 0 todo/in_progress and 6 available agents.
// These tests confirm the check fires on that state and stays silent when the
// board has work or no available agents.

test('isAvailableAgent: running and idle agents are available, paused are not', () => {
  assert.equal(isAvailableAgent({ status: 'running' }), true);
  assert.equal(isAvailableAgent({ status: 'idle' }), true);
  assert.equal(isAvailableAgent({ status: 'paused' }), false);
});

test('zeroPullableWorkAlarm fires when todo+in_progress is empty and agents are available', () => {
  const agents = [{ status: 'running' }, { status: 'idle' }, { status: 'paused' }];
  const result = zeroPullableWorkAlarm([], agents);
  assert.equal(result.alarm, true);
  assert.equal(result.availableAgentCount, 2);
  assert.equal(result.openCount, 0);
});

test('zeroPullableWorkAlarm does not fire when there is open work', () => {
  const agents = [{ status: 'running' }];
  const result = zeroPullableWorkAlarm([{ status: 'todo' }], agents);
  assert.equal(result.alarm, false);
});

test('zeroPullableWorkAlarm does not fire when all agents are paused (nobody to pull work)', () => {
  const result = zeroPullableWorkAlarm([], [{ status: 'paused' }]);
  assert.equal(result.alarm, false);
});

test('zeroPullableWorkAlarm does not fire when agent list is empty', () => {
  assert.equal(zeroPullableWorkAlarm([], []).alarm, false);
});

test('formatReport includes Alarm C text when zeroPullableWorkAlarm fires', () => {
  const alarm = { alarm: true, availableAgentCount: 6, openCount: 0 };
  const report = formatReport([], [], 'DadonStyle/LULLWOOD', alarm, []);
  assert.match(report, /ALARM C/);
  assert.match(report, /6 available agent/);
  assert.match(report, /studio is stopped/);
});

test('formatReport still returns null when zeroPullableWorkAlarm is false and no other alarms', () => {
  const alarm = { alarm: false, availableAgentCount: 6, openCount: 3 };
  assert.equal(formatReport([], [], 'DadonStyle/LULLWOOD', alarm, []), null);
});

test('zeroPullableWorkWakeMarker is stable and starts with Board-integrity:', () => {
  const marker = zeroPullableWorkWakeMarker();
  assert.equal(marker, 'Board-integrity: board has zero pullable work');
});

// ---- Alarm D: stale request_confirmation (LUL-810) --------------------------
//
// LUL-438 had a pending request_confirmation since 2026-08-19 (8 days) with
// no surface in any alarm. These fixtures use a pinned nowMs so the age is
// deterministic.

const NOW_MS = new Date('2026-08-27T07:00:00Z').getTime();

function confirmationInteraction(createdAt, kind = 'request_confirmation') {
  return { id: 'ix-1', kind, status: 'pending', continuationPolicy: 'wake_assignee', createdAt };
}

test('findStaleConfirmations returns a request_confirmation older than the threshold', () => {
  const issue = {
    identifier: 'LUL-438',
    title: 'SECURITY: PAT leaked',
    assigneeAgentId: 'agent-1',
    interactions: [confirmationInteraction('2026-08-19T01:07:47.862Z')],
  };
  const hits = findStaleConfirmations([issue], NOW_MS, 7);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].issue.identifier, 'LUL-438');
  assert.ok(hits[0].ageDays >= 7, 'expected ageDays >= 7');
});

test('findStaleConfirmations ignores a fresh confirmation (under threshold)', () => {
  const issue = {
    identifier: 'LUL-500',
    interactions: [confirmationInteraction('2026-08-26T12:00:00Z')],
  };
  assert.deepEqual(findStaleConfirmations([issue], NOW_MS, 7), []);
});

test('findStaleConfirmations ignores non-request_confirmation interactions', () => {
  const issue = {
    identifier: 'LUL-501',
    interactions: [{ ...confirmationInteraction('2026-08-01T00:00:00Z'), kind: 'ask_user_questions' }],
  };
  assert.deepEqual(findStaleConfirmations([issue], NOW_MS, 7), []);
});

test('findStaleConfirmations ignores a resolved confirmation', () => {
  const issue = {
    identifier: 'LUL-502',
    interactions: [{ ...confirmationInteraction('2026-08-01T00:00:00Z'), status: 'resolved' }],
  };
  assert.deepEqual(findStaleConfirmations([issue], NOW_MS, 7), []);
});

test('findStaleConfirmations sorts oldest first', () => {
  const issueA = { identifier: 'A', interactions: [confirmationInteraction('2026-08-10T00:00:00Z')] };
  const issueB = { identifier: 'B', interactions: [confirmationInteraction('2026-08-15T00:00:00Z')] };
  const hits = findStaleConfirmations([issueA, issueB], NOW_MS, 7);
  assert.equal(hits[0].issue.identifier, 'A', 'oldest should be first');
});

test('findStaleConfirmations with no interactions field on an issue does not throw', () => {
  assert.deepEqual(findStaleConfirmations([{ identifier: 'X' }], NOW_MS, 7), []);
});

test('formatReport includes Alarm D text when stale confirmations exist', () => {
  const stale = [
    {
      issue: { identifier: 'LUL-438', title: 'PAT leak', assigneeAgentId: 'agent-1' },
      interaction: { id: 'ix-1', createdAt: '2026-08-19T01:07:47.862Z' },
      ageDays: 8.2,
    },
  ];
  const report = formatReport([], [], 'DadonStyle/LULLWOOD', null, stale);
  assert.match(report, /LUL-438/);
  assert.match(report, /stale request_confirmation/);
  assert.match(report, /8d/);
  assert.match(report, /2026-08-19/);
});

test('staleConfirmationWakeMarker is stable', () => {
  const marker = staleConfirmationWakeMarker({ identifier: 'LUL-438' });
  assert.equal(marker, 'Board-integrity: LUL-438 has a stale request_confirmation');
});

test('STALE_CONFIRMATION_DAYS is exported and equals 7', () => {
  assert.equal(STALE_CONFIRMATION_DAYS, 7);
});

// ---- LUL-827 defect 1: a re-ask must clear the alarm -----------------------
//
// Live case: LUL-438 had a confirmation pending since 2026-08-19 (8d) *and*
// a fresh re-ask created 2026-08-27T07:09:11Z, 9 minutes before this sweep's
// pinned NOW_MS. Someone had already done the remedy the alarm asks for --
// the detector must age the issue by the newest pending confirmation, not
// the oldest, so the re-ask actually silences it.

test('findStaleConfirmations: a fresh re-ask silences an older stale confirmation on the same issue', () => {
  const issue = {
    identifier: 'LUL-438',
    interactions: [
      { id: 'ix-old', kind: 'request_confirmation', status: 'pending', createdAt: '2026-08-19T01:07:47.862Z' },
      { id: 'ix-new', kind: 'request_confirmation', status: 'pending', createdAt: '2026-08-27T06:51:00.000Z' },
    ],
  };
  assert.deepEqual(findStaleConfirmations([issue], NOW_MS, 7), []);
});

test('findStaleConfirmations: two pending confirmations, both stale -- reports the newest one, once', () => {
  const issue = {
    identifier: 'LUL-438',
    interactions: [
      { id: 'ix-old', kind: 'request_confirmation', status: 'pending', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'ix-newer', kind: 'request_confirmation', status: 'pending', createdAt: '2026-08-15T00:00:00.000Z' },
    ],
  };
  const hits = findStaleConfirmations([issue], NOW_MS, 7);
  assert.equal(hits.length, 1, 'one issue should produce exactly one hit, not one per pending confirmation');
  assert.equal(hits[0].interaction.id, 'ix-newer');
  assert.ok(hits[0].ageDays < 13, `expected age from the newer confirmation, got ${hits[0].ageDays}`);
});

// ---- LUL-827 defect 2: a closed wake ticket must not re-file on the very ---
// ---- next sweep for a confirmation still genuinely pending on a human ------
//
// Live case: a wake ticket closed while the confirmation it was about is
// still `pending` (the founder simply hasn't answered -- a legitimate human
// gate) must not be refiled on the next sweep. It should come back only
// after a re-alarm cooldown.

test('isStaleConfirmationSuppressed: no closed wake ticket at all -> not suppressed', () => {
  const issue = { identifier: 'LUL-481' };
  const interaction = { createdAt: '2026-08-19T00:00:00.000Z' };
  assert.equal(isStaleConfirmationSuppressed([], issue, interaction, NOW_MS), false);
});

test('isStaleConfirmationSuppressed: closed wake ticket predates the confirmation -- stale leftover, not suppressed', () => {
  const issue = { identifier: 'LUL-481' };
  const interaction = { createdAt: '2026-08-19T00:00:00.000Z' };
  const closedWakeIssues = [
    { title: 'Board-integrity: LUL-481 has a stale request_confirmation (LUL-810 detector)', updatedAt: '2026-08-10T00:00:00.000Z' },
  ];
  assert.equal(isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, NOW_MS), false);
});

test('isStaleConfirmationSuppressed: closed just after the confirmation, within cooldown -> suppressed', () => {
  const issue = { identifier: 'LUL-481' };
  const interaction = { createdAt: '2026-08-19T00:00:00.000Z' };
  const closedWakeIssues = [
    { title: 'Board-integrity: LUL-481 has a stale request_confirmation (LUL-810 detector)', updatedAt: '2026-08-25T00:00:00.000Z' },
  ];
  assert.equal(isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, NOW_MS, 7), true);
});

test('isStaleConfirmationSuppressed: closed after the confirmation but the re-alarm cooldown has elapsed -> refiles', () => {
  const issue = { identifier: 'LUL-481' };
  const interaction = { createdAt: '2026-08-19T00:00:00.000Z' };
  const closedWakeIssues = [
    { title: 'Board-integrity: LUL-481 has a stale request_confirmation (LUL-810 detector)', updatedAt: '2026-08-19T12:00:00.000Z' },
  ];
  // NOW_MS is 2026-08-27T07:00:00Z, well over 7 days past the 08-19 close.
  assert.equal(isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, NOW_MS, 7), false);
});

test('isStaleConfirmationSuppressed: does not cross-match a different issue\'s marker', () => {
  const issue = { identifier: 'LUL-481' };
  const interaction = { createdAt: '2026-08-19T00:00:00.000Z' };
  const closedWakeIssues = [
    { title: 'Board-integrity: LUL-438 has a stale request_confirmation (LUL-810 detector)', updatedAt: '2026-08-26T00:00:00.000Z' },
  ];
  assert.equal(isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, NOW_MS), false);
});

// ---- durableToken / authJsonPath (LUL-770 credential trap, mirrored from ---
// ---- scripts/watchdog-run-check.mjs) ---------------------------------------
//
// os.homedir() honours $HOME on POSIX (unlike raw process.env.HOME, which
// string-concatenates to the literal "undefined" when unset), so these tests
// point HOME at a scratch auth.json rather than touching the real one.

function withFakeHome(authJsonContents, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lul879-home-'));
  const prevHome = process.env.HOME;
  try {
    mkdirSync(path.join(dir, '.paperclip'));
    writeFileSync(path.join(dir, '.paperclip', 'auth.json'), authJsonContents);
    process.env.HOME = dir;
    return fn();
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('durableToken resolves an exact apiBase match', () => {
  const creds = JSON.stringify({
    credentials: { 'http://100.85.231.17:3100': { token: 'exact-match-token' } },
  });
  withFakeHome(creds, () => {
    assert.equal(durableToken('http://100.85.231.17:3100'), 'exact-match-token');
  });
});

test('durableToken falls back to the sole credential entry when the apiBase key does not match', () => {
  const creds = JSON.stringify({
    credentials: { 'http://some-other-host:9999': { token: 'sole-entry-token' } },
  });
  withFakeHome(creds, () => {
    assert.equal(durableToken('http://100.85.231.17:3100'), 'sole-entry-token');
  });
});

test('durableToken returns null (not a throw) when auth.json is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lul879-home-empty-'));
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = dir; // no auth.json written
    assert.equal(durableToken('http://100.85.231.17:3100'), null);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('durableToken returns null (not a throw) when auth.json is malformed JSON', () => {
  withFakeHome('not valid json{{{', () => {
    assert.equal(durableToken('http://100.85.231.17:3100'), null);
  });
});

test('authJsonPath does not degrade to the literal "undefined" segment when HOME is absent (env -i shape)', () => {
  const prevHome = process.env.HOME;
  try {
    delete process.env.HOME;
    const p = authJsonPath();
    assert.doesNotMatch(p.href, /undefined/);
    assert.match(p.pathname, /\/\.paperclip\/auth\.json$/);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

// ---- resolveSelfAgentId (LUL-879: fetchSelfAgentId used to throw on a -----
// ---- non-ok /api/agents/me, which took --post down with it) ---------------
//
// Verified live against the real API before writing this fix (2026-08-27/28):
//   curl -H "Authorization: Bearer <durable>" $PAPERCLIP_API_URL/api/agents/me
//   -> HTTP 401 {"error":"Agent authentication required"}
// These tests fake that exact shape rather than re-hitting the real API.

test('resolveSelfAgentId honours BOARD_INTEGRITY_SELF_AGENT_ID before ever calling fetch', async () => {
  const prevEnv = process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    process.env.BOARD_INTEGRITY_SELF_AGENT_ID = 'env-pinned-agent-id';
    globalThis.fetch = async () => {
      throw new Error('resolveSelfAgentId must not call fetch when the env override is set');
    };
    const id = await resolveSelfAgentId('http://api.invalid', 'company-1', 'token');
    assert.equal(id, 'env-pinned-agent-id');
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    else process.env.BOARD_INTEGRITY_SELF_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

test('resolveSelfAgentId returns the id straight from /api/agents/me when it is ok (run JWT case)', async () => {
  const prevEnv = process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    globalThis.fetch = async (url) => {
      assert.ok(String(url).endsWith('/api/agents/me'));
      return { ok: true, json: async () => ({ id: 'run-jwt-agent-id' }) };
    };
    const id = await resolveSelfAgentId('http://api.invalid', 'company-1', 'run-jwt');
    assert.equal(id, 'run-jwt-agent-id');
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    else process.env.BOARD_INTEGRITY_SELF_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

test('resolveSelfAgentId tolerates a 401 from /api/agents/me (durable token) and falls through to the company agents list, matched by name', async () => {
  const prevEnv = process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/agents/me')) {
        return { ok: false, status: 401 };
      }
      if (String(url).endsWith('/agents')) {
        return { ok: true, json: async () => [{ id: 'other-agent-id', name: 'Game Tester' }, { id: 'vp-agent-id', name: 'VP R&D' }] };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const id = await resolveSelfAgentId('http://api.invalid', 'company-1', 'durable-token');
    assert.equal(id, 'vp-agent-id');
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    else process.env.BOARD_INTEGRITY_SELF_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

test('resolveSelfAgentId returns null (not a throw) when the 401 fallback finds no name match', async () => {
  const prevEnv = process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/agents/me')) return { ok: false, status: 401 };
      if (String(url).endsWith('/agents')) return { ok: true, json: async () => [{ id: 'x', name: 'Founding Engineer' }] };
      throw new Error(`unexpected fetch: ${url}`);
    };
    const id = await resolveSelfAgentId('http://api.invalid', 'company-1', 'durable-token');
    assert.equal(id, null);
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    else process.env.BOARD_INTEGRITY_SELF_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

test('resolveSelfAgentId returns null (not a throw) when the company-agents fallback request itself errors', async () => {
  const prevEnv = process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/agents/me')) return { ok: false, status: 401 };
      // pcFetch (via fetchJson) throws on a non-ok response -- resolveSelfAgentId
      // must swallow that, not let it propagate and take --post down again.
      return { ok: false, status: 500, text: async () => 'server error' };
    };
    const id = await resolveSelfAgentId('http://api.invalid', 'company-1', 'durable-token');
    assert.equal(id, null);
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_INTEGRITY_SELF_AGENT_ID;
    else process.env.BOARD_INTEGRITY_SELF_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

// ---- fileWakeTickets under the durable-token 401 (the actual --post repro) -

test('fileWakeTickets does not throw on a 401 from /api/agents/me -- files the tombstone wake ticket unassigned instead of exiting 2', async () => {
  const prevFetch = globalThis.fetch;
  try {
    let postedIssue = null;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/api/agents/me')) return { ok: false, status: 401 };
      if (u.endsWith('/agents')) return { ok: true, json: async () => [] }; // no name match -> null, and that's fine
      if (u.includes('/api/companies/') && u.endsWith('/issues') && opts?.method === 'POST') {
        postedIssue = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ id: 'wake-issue-1' }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const classifiedTombstones = [
      {
        issue: { id: 'issue-1', identifier: 'LUL-999', title: 'stranded ticket', status: 'blocked', assigneeAgentId: null },
        disposition: 'STRANDED',
        referencedPrs: [],
        mergedPrs: [],
      },
    ];

    const filed = await fileWakeTickets(
      'http://api.invalid',
      'company-1',
      'durable-token',
      classifiedTombstones,
      [],
      [],
      { alarm: false },
      [],
    );

    assert.equal(filed.length, 1);
    assert.equal(filed[0].kind, 'tombstone');
    assert.equal(filed[0].assigneeAgentId, null);
    assert.ok(postedIssue, 'expected a POST to /issues');
    assert.equal(postedIssue.assigneeAgentId, null);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fileWakeTickets resolves the self id once per run, not once per alarm, even when resolution legitimately returns null', async () => {
  const prevFetch = globalThis.fetch;
  try {
    let meCalls = 0;
    let agentsCalls = 0;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/api/agents/me')) {
        meCalls += 1;
        return { ok: false, status: 401 };
      }
      if (u.endsWith('/agents')) {
        agentsCalls += 1;
        return { ok: true, json: async () => [] };
      }
      if (u.includes('/issues') && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'wake-issue' }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const classifiedTombstones = [
      { issue: { id: 'i1', identifier: 'LUL-1', title: 't1', status: 'blocked', assigneeAgentId: null }, disposition: 'STRANDED', referencedPrs: [], mergedPrs: [] },
      { issue: { id: 'i2', identifier: 'LUL-2', title: 't2', status: 'blocked', assigneeAgentId: null }, disposition: 'STRANDED', referencedPrs: [], mergedPrs: [] },
    ];
    const unownedPrs = [{ number: 42, title: 'unowned', html_url: 'https://example.invalid/42' }];

    const filed = await fileWakeTickets(
      'http://api.invalid',
      'company-1',
      'durable-token',
      classifiedTombstones,
      unownedPrs,
      [],
      { alarm: true, availableAgentCount: 1 },
      [],
    );

    // zero-pullable-work + 2 tombstones + 1 unowned-pr = 4 filed tickets, all
    // sharing the one cached (null) resolution.
    assert.equal(filed.length, 4);
    assert.ok(filed.every((f) => f.assigneeAgentId === null));
    assert.equal(meCalls, 1);
    assert.equal(agentsCalls, 1);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fileWakeTickets never touches /api/agents/me when every alarm already has an open wake ticket (quiet-run laziness)', async () => {
  const prevFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      throw new Error(`fileWakeTickets must not call fetch at all when nothing new needs filing: ${url}`);
    };
    const issue = { id: 'i1', identifier: 'LUL-1', title: 't1', status: 'blocked', assigneeAgentId: null };
    const marker = tombstoneWakeMarker(issue);
    const openIssues = [{ title: `${marker} (LUL-672 detector) -- STRANDED, needs work` }];
    const classifiedTombstones = [{ issue, disposition: 'STRANDED', referencedPrs: [], mergedPrs: [] }];

    const filed = await fileWakeTickets(
      'http://api.invalid',
      'company-1',
      'durable-token',
      classifiedTombstones,
      [],
      openIssues,
      { alarm: false },
      [],
    );
    assert.equal(filed.length, 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
