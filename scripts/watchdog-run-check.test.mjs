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
  findRecoveredWatchdogs,
  clearingDispatchRun,
  formatReport,
  formatRecoveryNotes,
  watchdogWakeMarker,
  authJsonPath,
  durableToken,
  resolveAssigneeId,
  fetchWorkflowFiles,
  fileWakeTickets,
  readTicketedRuns,
  writeTicketedRuns,
  alreadyTicketedRun,
  recordTicketedRun,
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

// ---- LUL-913: a stale scheduled red cleared by a newer manual dispatch -----
//
// The measured incident these are written from, all real ids on this repo:
// scheduled run 33116516805 went red at 2026-08-27T21:05:51Z naming PR #179;
// #179 was merged at 22:32Z (cause fixed); an agent re-verified by hand with
// workflow_dispatch run 33138009679, success, 2026-08-28T03:08:14Z. The next
// scheduled run had still not happened hours later, so runs[0] was unchanged
// -- and the router filed LUL-897 and then LUL-913 for that same dead run.
const RED_33116516805 = {
  id: 33116516805,
  conclusion: 'failure',
  created_at: '2026-08-27T21:05:51Z',
  html_url: 'https://github.com/DadonStyle/LULLWOOD/actions/runs/33116516805',
};
const DISPATCH_33138009679 = {
  id: 33138009679,
  conclusion: 'success',
  created_at: '2026-08-28T03:08:14Z',
  html_url: 'https://github.com/DadonStyle/LULLWOOD/actions/runs/33138009679',
};

test('LUL-913 regression: a newer successful workflow_dispatch clears a stale scheduled red', () => {
  const result = classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [DISPATCH_33138009679]);
  assert.equal(result.alarm, 'recovered');
  assert.equal(result.clearedByRunId, 33138009679);
  // Still carries the red run's identity, so the run-id ledger and the log
  // line can both name exactly which run was suppressed.
  assert.equal(result.runId, 33116516805);
  assert.equal(findRedWatchdogs([result]).length, 0);
  assert.equal(findRecoveredWatchdogs([result]).length, 1);
});

test('LUL-913: a dispatch OLDER than the red run does not clear it', () => {
  const stale = { ...DISPATCH_33138009679, id: 1, created_at: '2026-08-27T12:57:56Z' };
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [stale]).alarm, 'red');
});

test('LUL-913: a newer dispatch that itself FAILED does not clear the red', () => {
  const failed = { ...DISPATCH_33138009679, conclusion: 'failure' };
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [failed]).alarm, 'red');
});

test('LUL-913: a newer dispatch still in flight (conclusion null) does not clear the red', () => {
  const inFlight = { ...DISPATCH_33138009679, conclusion: null };
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [inFlight]).alarm, 'red');
});

test('LUL-913: no dispatch runs at all leaves the pre-LUL-913 behaviour untouched', () => {
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], []).alarm, 'red');
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805]).alarm, 'red');
});

test('LUL-913: a red run with no created_at cannot be cleared (fails closed, keeps the alarm)', () => {
  const noTimestamp = { ...RED_33116516805, created_at: undefined };
  assert.equal(clearingDispatchRun(noTimestamp, [DISPATCH_33138009679]), null);
  assert.equal(classifyWatchdog(REVIEW_GAP_DETECTOR, true, [noTimestamp], [DISPATCH_33138009679]).alarm, 'red');
});

test('LUL-913: a recovered watchdog is never wake-ticketed but is always logged', async () => {
  const recovered = classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [DISPATCH_33138009679]);
  // fileWakeTickets is only ever handed findRedWatchdogs' output, so the
  // suppression is structural -- assert that, then assert it is not silent.
  const filed = await fileWakeTickets('http://api.invalid', 'co', 'k', findRedWatchdogs([recovered]), [], null);
  assert.deepEqual(filed, []);
  const notes = formatRecoveryNotes([recovered]);
  assert.match(notes, /33116516805/);
  assert.match(notes, /33138009679/);
});

test('LUL-913: formatRecoveryNotes is null when nothing was suppressed (a quiet board stays quiet)', () => {
  assert.equal(formatRecoveryNotes(WATCHDOGS.map((w) => classifyWatchdog(w, true, [greenRun()]))), null);
  assert.equal(formatRecoveryNotes([classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805])]), null);
});

// A recovered watchdog is NOT an alarm: it must not add an ALARM banner or
// push main() to exit 1, or the router's cron pages on a healthy board.
test('LUL-913: a recovered watchdog does not make formatReport produce an ALARM', () => {
  const recovered = classifyWatchdog(REVIEW_GAP_DETECTOR, true, [RED_33116516805], [DISPATCH_33138009679]);
  assert.equal(formatReport([recovered], 'DadonStyle/LULLWOOD'), null);
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

// ---- LUL-897: dedup axis (2), on the run id --------------------------------
//
// Axis (1) re-arms on the ticket being CLOSED, but the promise in the ticket
// text is "a later red run files a fresh ticket". Those are not the same
// thing while the router cron (every 30min) ticks faster than the watched
// cron (every 1-4h): for hours after a close, the latest scheduled run is
// still the same red one that was already routed. Measured on
// review-gap-detector before this fix -- nine tickets for five distinct runs,
// with run 33065636602 alone producing LUL-849, -861, -871 and -881.

// A --post harness: counts POSTs to /issues so "filed nothing new" is proven
// by the absence of a call, not by a return value that could lie.
function postHarness() {
  const posts = [];
  return {
    posts,
    fetch: async (url, opts = {}) => {
      const u = String(url);
      if (u.endsWith('/issues') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return { ok: true, status: 201, json: async () => ({ id: `issue-${posts.length}` }) };
      }
      if (u.includes('/agents/me')) {
        return { ok: true, json: async () => ({ id: 'agent-vp' }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    },
  };
}

function withStateDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-state-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RED_RUN_ID = 33065636602;

test('LUL-897 regression: a closed ticket does NOT re-file while the latest red run is the same one already routed', async () => {
  await withStateDir(async (stateDir) => {
    const harness = postHarness();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;
    try {
      const red = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID)])];

      // Tick 1: nothing open, nothing recorded -> files the ticket.
      const first = await fileWakeTickets('https://api.invalid', 'co', 'key', red, [], stateDir);
      assert.equal(first.length, 1);
      assert.equal(harness.posts.length, 1);

      // An agent reads it, fixes/triages, closes it. `done` is not in
      // OPEN_STATUSES, so axis (1) sees an empty open-issues list again --
      // exactly the state that produced the duplicate before this fix.
      // The workflow's own cron has not ticked yet, so the run id is unchanged.
      const second = await fileWakeTickets('https://api.invalid', 'co', 'key', red, [], stateDir);
      assert.deepEqual(second, [], 'must not re-file a run id that was already ticketed');
      assert.equal(harness.posts.length, 1, 'a second POST here is the nine-tickets bug');
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

test('LUL-897: re-arm still works -- a NEWER red run of the same watchdog files a fresh ticket', async () => {
  await withStateDir(async (stateDir) => {
    const harness = postHarness();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;
    try {
      const older = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID)])];
      await fileWakeTickets('https://api.invalid', 'co', 'key', older, [], stateDir);

      // The watched cron ticks again and goes red again: a different run id.
      const newer = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID + 1)])];
      const filed = await fileWakeTickets('https://api.invalid', 'co', 'key', newer, [], stateDir);
      assert.equal(filed.length, 1, 'suppressing a genuinely new red is worse than a duplicate');
      assert.equal(harness.posts.length, 2);
      assert.match(harness.posts[1].description, new RegExp(String(RED_RUN_ID + 1)));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

test('LUL-897: axis (2) never overrides axis (1) -- an open ticket still suppresses, even for a new run id', async () => {
  await withStateDir(async (stateDir) => {
    const harness = postHarness();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;
    try {
      const marker = watchdogWakeMarker(REVIEW_GAP_DETECTOR);
      const openIssues = [{ title: `${marker} (LUL-685 detector)`, status: 'todo' }];
      const red = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID + 7)])];
      const filed = await fileWakeTickets('https://api.invalid', 'co', 'key', red, openIssues, stateDir);
      assert.deepEqual(filed, [], '99 red runs must still produce one open ticket, not 99');
      assert.equal(harness.posts.length, 0);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

test('LUL-897: fails OPEN -- with no state dir the run-id check is skipped and the red still routes', async () => {
  const harness = postHarness();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = harness.fetch;
  try {
    const red = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID)])];
    // stateDir null is what an ad-hoc invocation without WATCHDOG_STATE_DIR
    // gets. A red that routes to nobody is the bug LUL-685 exists to prevent;
    // a duplicate ticket is merely the old status quo. Prefer the duplicate.
    await fileWakeTickets('https://api.invalid', 'co', 'key', red, [], null);
    await fileWakeTickets('https://api.invalid', 'co', 'key', red, [], null);
    assert.equal(harness.posts.length, 2);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('LUL-897: the filed ticket names the run id it recorded, so the next reader can see why a close will not re-file', async () => {
  await withStateDir(async (stateDir) => {
    const harness = postHarness();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;
    try {
      const red = [classifyWatchdog(REVIEW_GAP_DETECTOR, true, [redRun(RED_RUN_ID)])];
      await fileWakeTickets('https://api.invalid', 'co', 'key', red, [], stateDir);
      assert.match(harness.posts[0].description, new RegExp(String(RED_RUN_ID)));
      assert.equal(readTicketedRuns(stateDir)['review-gap-detector.yml'], String(RED_RUN_ID));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

test('alreadyTicketedRun compares as strings -- a number/string mismatch must not silently re-file', () => {
  const w = { file: 'review-gap-detector.yml', runId: RED_RUN_ID };
  assert.equal(alreadyTicketedRun({ 'review-gap-detector.yml': String(RED_RUN_ID) }, w), true);
  assert.equal(alreadyTicketedRun({ 'review-gap-detector.yml': RED_RUN_ID }, w), true);
  assert.equal(alreadyTicketedRun({ 'review-gap-detector.yml': String(RED_RUN_ID + 1) }, w), false);
  assert.equal(alreadyTicketedRun({}, w), false, 'an empty map must never suppress');
});

test('run-id state is keyed per watchdog file -- routing one does not suppress another', () => {
  const reviewGap = { file: 'review-gap-detector.yml', runId: 1 };
  const versionCut = { file: 'version-cut.yml', runId: 1 };
  const state = recordTicketedRun({}, reviewGap);
  assert.equal(alreadyTicketedRun(state, reviewGap), true);
  assert.equal(alreadyTicketedRun(state, versionCut), false, 'same run id, different workflow');
});

test('readTicketedRuns returns {} (never throws, never suppresses) for missing, malformed and wrong-shaped state', () => {
  withStateDir((dir) => {
    assert.deepEqual(readTicketedRuns(dir), {}, 'missing file');
    assert.deepEqual(readTicketedRuns(null), {}, 'no state dir configured');
    assert.deepEqual(readTicketedRuns(path.join(dir, 'nope')), {}, 'missing dir');

    writeFileSync(path.join(dir, 'ticketed-runs.json'), '{not json');
    assert.deepEqual(readTicketedRuns(dir), {}, 'malformed JSON must fail open, not throw');

    // An array parses as JSON but `state[file]` on it is always undefined --
    // harmless here, but normalising keeps the type honest for writers.
    writeFileSync(path.join(dir, 'ticketed-runs.json'), '["33065636602"]');
    assert.deepEqual(readTicketedRuns(dir), {}, 'wrong top-level shape');
  });
});

test('writeTicketedRuns round-trips and survives being called for a dir that does not exist yet', () => {
  withStateDir((dir) => {
    const nested = path.join(dir, 'state');
    assert.equal(writeTicketedRuns(nested, { 'a.yml': '1' }), true);
    assert.deepEqual(readTicketedRuns(nested), { 'a.yml': '1' });
    assert.equal(writeTicketedRuns(null, { 'a.yml': '1' }), false, 'no dir configured is a no-op, not a throw');
  });
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
