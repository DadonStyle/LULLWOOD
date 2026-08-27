import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  authJsonPath,
  durableToken,
  resolveAssigneeId,
  fetchWorkflowFiles,
  fileWakeTickets,
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

test('formatReport surfaces failed file downloads even when every classified watchdog is healthy', () => {
  const classified = WATCHDOGS.map((w) => classifyWatchdog(w, true, [greenRun()]));
  const report = formatReport(classified, 'DadonStyle/LULLWOOD', ['flaky-workflow.yml']);
  assert.match(report, /1 workflow file\(s\) could not be read this run, roster may be incomplete/);
  assert.match(report, /flaky-workflow\.yml/);
});

test('formatReport omits the failed-file line entirely when nothing failed (no false alarm)', () => {
  const classified = WATCHDOGS.map((w) => classifyWatchdog(w, true, [greenRun()]));
  assert.equal(formatReport(classified, 'DadonStyle/LULLWOOD', []), null);
});

// ---- fetchWorkflowFiles: a failed per-file download must not be silently ---
// coerced to yaml: '' (LUL-776) -- hasScheduleTrigger('') is indistinguishable
// from "this workflow genuinely has no schedule:", so a transient GET failure
// would otherwise drop a real cron watchdog off the roster with no trace.

test('fetchWorkflowFiles reports a failed per-file download in failedFiles, not as an empty-yaml entry', async () => {
  const prevFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/contents/.github/workflows')) {
        return {
          ok: true,
          json: async () => [
            { type: 'file', name: 'good.yml', download_url: 'https://example.invalid/good.yml' },
            { type: 'file', name: 'flaky.yml', download_url: 'https://example.invalid/flaky.yml' },
          ],
        };
      }
      if (String(url).endsWith('/good.yml')) {
        return { ok: true, text: async () => cronWorkflow('Good') };
      }
      if (String(url).endsWith('/flaky.yml')) {
        return { ok: false, status: 502 };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const { files, failedFiles } = await fetchWorkflowFiles('DadonStyle/LULLWOOD', 'main', 'token');
    assert.deepEqual(
      files.map((f) => f.file),
      ['good.yml'],
    );
    assert.deepEqual(failedFiles, ['flaky.yml']);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('fetchWorkflowFiles: a ref with no workflows dir is an empty result, not a failure (fork/fresh-clone shape)', async () => {
  const prevFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const { files, failedFiles } = await fetchWorkflowFiles('DadonStyle/LULLWOOD', 'some-fork', 'token');
    assert.deepEqual(files, []);
    assert.deepEqual(failedFiles, []);
  } finally {
    globalThis.fetch = prevFetch;
  }
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

// ---- durableToken (LUL-770 credential trap, LUL-781 regression) -----------
//
// os.homedir() honours $HOME on POSIX (unlike raw process.env.HOME, which
// string-concatenates to the literal "undefined" when unset), so these tests
// point HOME at a scratch auth.json rather than touching the real one.

function withFakeHome(authJsonContents, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lul770-home-'));
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
    // Mirrors the real fleet shape (LUL-781): exactly one entry in the map,
    // under a different apiBase than the one the caller passes.
    assert.equal(durableToken('http://100.85.231.17:3100'), 'sole-entry-token');
  });
});

test('durableToken returns null (not a throw) when auth.json is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lul770-home-empty-'));
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

// The LUL-781 regression itself: under `env -i` (the shape cron actually
// runs under) HOME is absent from the environment entirely. The old code
// read `process.env.HOME` directly, which is `undefined`, string-concatenated
// into the literal path `file://undefined/.paperclip/auth.json`. That throw
// was invisible from the outside -- durableToken's own try/catch swallows it
// either way, on both the broken and fixed code -- so this asserts on the
// constructed path itself (authJsonPath), not on whether durableToken threw.
test('authJsonPath does not degrade to the literal "undefined" segment when HOME is absent (env -i shape)', () => {
  const prevHome = process.env.HOME;
  try {
    delete process.env.HOME;
    const p = authJsonPath();
    // The literal string lands in the URL's hostname, not its pathname, when
    // homedir() is bypassed -- assert on href so that mistake can't hide.
    assert.doesNotMatch(p.href, /undefined/);
    assert.match(p.pathname, /\/\.paperclip\/auth\.json$/);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  }
});

// ---- resolveAssigneeId (LUL-770 credential scope trap) --------------------

test('resolveAssigneeId honours WATCHDOG_ASSIGNEE_AGENT_ID before ever calling fetch', async () => {
  const prevEnv = process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    process.env.WATCHDOG_ASSIGNEE_AGENT_ID = 'env-pinned-agent-id';
    globalThis.fetch = async () => {
      throw new Error('resolveAssigneeId must not call fetch when the env override is set');
    };
    const id = await resolveAssigneeId('http://api.invalid', 'company-1', 'token');
    assert.equal(id, 'env-pinned-agent-id');
  } finally {
    if (prevEnv === undefined) delete process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
    else process.env.WATCHDOG_ASSIGNEE_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

test('resolveAssigneeId tolerates a 401 from /api/agents/me (durable token) and falls through to the company agents list', async () => {
  const prevEnv = process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/agents/me')) {
        return { ok: false, status: 401 };
      }
      if (String(url).includes('/agents')) {
        return { ok: true, json: async () => [{ id: 'vp-agent-id', name: 'VP R&D' }] };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const id = await resolveAssigneeId('http://api.invalid', 'company-1', 'durable-token');
    assert.equal(id, 'vp-agent-id');
  } finally {
    if (prevEnv === undefined) delete process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
    else process.env.WATCHDOG_ASSIGNEE_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});

// ---- fileWakeTickets (LUL-779: cache a resolved-to-null assignee too) -----

test('fileWakeTickets resolves the assignee once per run, not once per red watchdog, even when resolution legitimately returns null', async () => {
  const prevEnv = process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
  const prevFetch = globalThis.fetch;
  try {
    delete process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
    let resolutionCalls = 0;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/api/agents/me')) {
        resolutionCalls += 1;
        return { ok: false, status: 401 };
      }
      if (u.endsWith('/agents')) {
        resolutionCalls += 1;
        return { ok: true, json: async () => [] }; // no name match -> null is legitimate
      }
      if (u.includes('/issues') && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'issue-1' }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    const two = [
      { ...REVIEW_GAP_DETECTOR, name: 'Review gap detector' },
      { ...WATCHDOGS.find((w) => w.file === 'base-branch-guard.yml'), name: 'Base branch guard' },
    ];
    const filed = await fileWakeTickets('http://api.invalid', 'company-1', 'durable-token', two, []);
    assert.equal(filed.length, 2);
    assert.ok(filed.every((f) => f.assigneeAgentId === null));
    // One /api/agents/me + one /agents fallback = 2 calls total, not 4 (one pair per watchdog).
    assert.equal(resolutionCalls, 2);
  } finally {
    if (prevEnv === undefined) delete process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
    else process.env.WATCHDOG_ASSIGNEE_AGENT_ID = prevEnv;
    globalThis.fetch = prevFetch;
  }
});
