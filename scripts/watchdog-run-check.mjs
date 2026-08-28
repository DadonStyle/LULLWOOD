#!/usr/bin/env node
// LUL-685: a scheduled GitHub Actions workflow going red produces no
// Paperclip issue, no assignment, no wake -- it produces a red dot on a page
// nobody opens. Measured live: review-gap-detector.yml was red 99/102
// scheduled runs straight, ~3.5 days, same offender reported every time,
// and nothing routed that to a human or agent. This script is the router.
//
// Unlike scripts/check-review-gap.mjs (a GitHub Actions workflow that reads
// GitHub only), this needs to FILE a Paperclip wake ticket, so it is a plain
// Node script meant to be run by an agent that already has
// PAPERCLIP_API_KEY in its own environment -- never wired into
// .github/workflows/ (CI must never hold Paperclip credentials, LUL-523,
// wiki systems/lul523-closed). Same shape and same reason as
// scripts/board-integrity-check.mjs, whose --post ticket-filing logic this
// reuses rather than reimplementing.
//
// Usage:
//   node scripts/watchdog-run-check.mjs [--post]
//
// Env:
//   GITHUB_TOKEN           optional; unauthenticated reads work on this
//                          public repo, a token just raises the rate limit
//   GITHUB_REPOSITORY      "owner/repo", defaults to DadonStyle/LULLWOOD
//   PAPERCLIP_API_URL      required for --post
//   PAPERCLIP_API_KEY      required for --post
//   PAPERCLIP_COMPANY_ID   required for --post
//
// Two independent alarm classes per watchdog, wiki
// systems/scheduled-workflow-default-branch-trap's "definition of done":
//
//   INERT   -- the workflow file does not resolve on the repo's default
//              branch (schedule: only fires from there). This is the
//              LUL-628/684 failure mode, a different bug from the one below.
//              Reported here for visibility but NOT wake-ticketed by this
//              script -- that trap already has its own owning ticket family;
//              filing a second alarm for the same fact would just be the
//              duplicate-detector problem LUL-672's own build hit.
//
//   RED     -- the workflow resolves and has run, but its most recent
//              *scheduled* run (event=schedule, not pull_request/push) came
//              back `failure`. This is what LUL-685 is actually about, and
//              is the only class this script wake-tickets.
//
//   RECOVERED -- a RED as above, but a later workflow_dispatch run of the
//              same workflow on the default branch succeeded. The cron
//              simply has not run again yet (GitHub throttles `schedule:`
//              hard -- 4-12h gaps measured here, LUL-866), so runs[0] is a
//              dead run whose cause is already fixed. Not wake-ticketed, but
//              always printed. LUL-913, see classifyWatchdog.
//
// The roster of watchdogs is DERIVED from the repo's own workflow files on
// both the default branch and the release-train branch, never hand-listed --
// see deriveWatchdogs below for why.
//
// Dedup has TWO axes, and both are load-bearing.
//
// (1) On the ALARM (one marker per watchdog): 99 consecutive red runs of the
// same workflow must produce one ticket, not 99. Scoped to OPEN issues only
// (same as board-integrity-check.mjs) -- "open" meaning every non-terminal
// status including `blocked` and `in_review`, not just the two active ones,
// see OPEN_STATUSES.
//
// (2) On the RUN ID, which is what LUL-897 added and why. Axis (1) alone
// re-arms on *close*, but the thing that re-arms it -- "a later red run" --
// is not what it actually tests. This cron ticks every 30 minutes while the
// watched crons tick every 1-4 hours, so for hours after a ticket is closed
// the *latest* scheduled run is still the same red one that was already
// ticketed and already handled. Axis (1) sees no open marker, files an
// identical ticket, someone closes it, and the next tick files it again.
// Measured on this exact detector before the fix: nine tickets (LUL-771,
// -821, -832, -849, -861, -871, -881, -889, -897) for FIVE distinct red
// runs -- run 33065636602 alone produced four. Recording the run id we
// ticketed makes re-arm mean what the ticket text promises: a *newer* red
// run than the last one routed.
//
// Axis (2)'s state lives outside the repo (WATCHDOG_STATE_DIR) because the
// cron `reset --hard`s this clone every tick, and it FAILS OPEN: no state
// dir, unreadable file, unwritable dir -> behave exactly as before and file
// the ticket. A duplicate ticket is the old status quo; a red that routes to
// nobody is the bug LUL-685 exists to prevent, and no bookkeeping
// convenience is worth reintroducing it.
//
// No auto-close logic here -- verifying the fix and closing the ticket is a
// human/agent judgment call, same as every other wake ticket in this family.
//
// Exit 0: ran cleanly, no RED alarms (INERT alarms alone do not fail the
// run -- see above). Exit 1: at least one RED alarm found (and filed, if
// --post). Exit 2: the run itself errored (network, auth, ...).
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ghFetch } from './lib/github-fetch.mjs';
import { hasOpenWakeTicket } from './board-integrity-check.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';

// The branch the release train opens PRs against. A workflow can carry a
// `schedule:` here and not yet exist on the default branch -- that is the
// INERT class, and it is why both refs get scanned rather than just one.
const TRAIN_BRANCH = process.env.WATCHDOG_TRAIN_BRANCH || 'release/next';

// ---- pure logic (unit-tested against fixtures, no network) ---------------

// The set of watchdogs used to be a hand-maintained literal of six names.
// That list rotted immediately: `daily-report.yml` shipped with a `schedule:`
// and was never added, so nothing watched it (measured 2026-08-27 -- it had
// zero scheduled runs ever and no alarm anywhere said so). A watchdog roster
// that has to be edited by hand every time a cron is added is the same
// looks-like-coverage failure LUL-685 exists to close, one level up. So the
// roster is derived from the repo itself on every run.
//
// yaml: the raw text of a .github/workflows/*.yml file. Deliberately not a
// full YAML parse -- this only needs to answer "does the `on:` block contain
// a schedule: key", and the repo's workflows are all conventionally
// formatted. A false positive costs one wasted API read; a false negative is
// caught by the roster diff being visible in the report.
function hasScheduleTrigger(yaml) {
  if (!yaml) return false;
  const lines = yaml.split('\n');
  let inOn = false;
  let onIndent = 0;
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (!inOn) {
      // `on:` at top level, either `on:` or the YAML 1.1 `true:` normalisation.
      if (indent === 0 && /^(on|true|"on"|'on'):/.test(line.trim())) {
        // Inline form: `on: schedule` is not valid for cron, so only block
        // form can carry one -- but `on: [push, schedule]` is, so check it.
        if (/:\s*\[.*\bschedule\b.*\]/.test(line)) return true;
        inOn = true;
        onIndent = indent;
      }
      continue;
    }
    if (indent <= onIndent) break; // left the `on:` block
    if (/^\s*schedule:/.test(line)) return true;
  }
  return false;
}

// Turn a workflow filename into the display name used in the wake-ticket
// marker. Prefers the workflow's own `name:`; falls back to the filename so
// the marker is still stable and greppable.
function workflowDisplayName(file, yaml) {
  const match = (yaml ?? '').match(/^name:\s*(.+?)\s*$/m);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : file;
}

// defaultBranchFiles / trainBranchFiles: arrays of { file, yaml } for every
// .github/workflows/* on that ref. Returns one watchdog per file that carries
// a schedule: on either ref, sorted for stable output, flagged with whether
// it exists on the default branch (schedule: only fires from there).
function deriveWatchdogs(defaultBranchFiles, trainBranchFiles) {
  const byFile = new Map();
  const add = (entry, onDefaultBranch) => {
    if (!hasScheduleTrigger(entry.yaml)) return;
    const existing = byFile.get(entry.file);
    if (existing) {
      existing.onDefaultBranch = existing.onDefaultBranch || onDefaultBranch;
      return;
    }
    byFile.set(entry.file, {
      name: workflowDisplayName(entry.file, entry.yaml),
      file: entry.file,
      onDefaultBranch,
    });
  };
  for (const entry of defaultBranchFiles ?? []) add(entry, true);
  for (const entry of trainBranchFiles ?? []) add(entry, false);
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

// runs: the `workflow_runs` array from GET .../runs?event=schedule&per_page=1
// (already filtered/paged by the caller -- this just reads the first entry).
// A run that has not finished yet carries `conclusion: null`; that is
// "nothing concluded to judge", which is deliberately the same answer as "no
// runs at all" for the caller, but must not be mistaken for a green run.
function latestScheduledConclusion(runs) {
  if (!runs || runs.length === 0) return null;
  return runs[0].conclusion ?? null;
}

// LUL-913: a red *scheduled* run stays runs[0] until the next cron tick, and
// GitHub throttles `schedule:` hard -- measured gaps of 4-12h on this repo
// (LUL-866). So "the latest scheduled run is red" keeps reporting an alarm
// for hours after the underlying cause is already fixed, and the fixer's
// natural proof-of-fix -- re-running the watchdog by hand -- is invisible to
// this script, which only ever looks at event=schedule.
//
// That is not a cosmetic lag. It filed real tickets: run 33116516805 (red,
// 21:05Z, offender PR #179) was fixed at 22:32Z by merging #179 and
// re-verified by a successful workflow_dispatch at 03:08Z -- and the router
// still filed LUL-897 and LUL-913 for that same dead run afterwards. The
// LUL-897 run-id ledger suppresses the *duplicate*; this suppresses the
// *false alarm*, which is the better place to fix it (the ledger only helps
// once a run has already cost one ticket).
//
// Only `workflow_dispatch` on the default branch counts as clearing, not any
// green run:
//   - a `pull_request`/`push` run of a mixed-trigger watchdog (base-branch-
//     guard) checks one PR, not the repo-wide scan the cron path does --
//     green there proves nothing about the scheduled predicate;
//   - a manual dispatch on the default branch runs byte-identical code with
//     byte-identical inputs to the cron run (these workflows carry no
//     per-event guard inside the job -- `on:` is not the trigger condition,
//     the job body is, so this was checked, not assumed).
// A dispatch that is still in flight (conclusion null) or itself failed does
// NOT clear: only a concluded `success` strictly newer than the red run does.
function clearingDispatchRun(redRun, dispatchRuns) {
  if (!redRun?.created_at) return null;
  const redAt = Date.parse(redRun.created_at);
  if (Number.isNaN(redAt)) return null;
  for (const run of dispatchRuns ?? []) {
    if (run?.conclusion !== 'success' || !run.created_at) continue;
    const at = Date.parse(run.created_at);
    if (!Number.isNaN(at) && at > redAt) return run;
  }
  return null;
}

// watchdog: one entry from deriveWatchdogs. resolvesOnDefault: bool (contents
// API 200/404 on the default branch). runs: workflow_runs array as above.
// dispatchRuns: workflow_runs from the same workflow filtered to
// event=workflow_dispatch on the default branch, only fetched when `runs`
// is red (see classifyAllWatchdogs) -- empty is always a safe default and
// preserves the pre-LUL-913 behaviour.
function classifyWatchdog(watchdog, resolvesOnDefault, runs, dispatchRuns = []) {
  if (!resolvesOnDefault) {
    return { ...watchdog, alarm: 'inert' };
  }
  const conclusion = latestScheduledConclusion(runs);
  if (conclusion === null) {
    return { ...watchdog, alarm: 'no-runs' };
  }
  if (conclusion === 'failure') {
    const clearedBy = clearingDispatchRun(runs[0], dispatchRuns);
    if (clearedBy) {
      return {
        ...watchdog,
        alarm: 'recovered',
        runUrl: runs[0].html_url,
        runId: runs[0].id,
        clearedByUrl: clearedBy.html_url,
        clearedByRunId: clearedBy.id,
      };
    }
    return { ...watchdog, alarm: 'red', runUrl: runs[0].html_url, runId: runs[0].id };
  }
  return { ...watchdog, alarm: null };
}

function findRedWatchdogs(classified) {
  return classified.filter((w) => w.alarm === 'red');
}

function findInertWatchdogs(classified) {
  return classified.filter((w) => w.alarm === 'inert');
}

function findNoRunWatchdogs(classified) {
  return classified.filter((w) => w.alarm === 'no-runs');
}

// Deliberately NOT folded into `alarm: null`. A suppression nobody can see is
// how a real jam hides: if this logic ever clears a red it should not have,
// the only way anyone finds out is a line in the log naming both run ids.
function findRecoveredWatchdogs(classified) {
  return classified.filter((w) => w.alarm === 'recovered');
}

function formatReport(classified, repo, failedFiles = []) {
  const red = findRedWatchdogs(classified);
  const inert = findInertWatchdogs(classified);
  const noRuns = findNoRunWatchdogs(classified);
  if (red.length === 0 && inert.length === 0 && noRuns.length === 0 && failedFiles.length === 0) return null;

  const lines = ['watchdog-run-check: ALARM'];
  if (failedFiles.length > 0) {
    lines.push(
      '',
      `${failedFiles.length} workflow file(s) could not be read this run, roster may be incomplete: ` +
        failedFiles.join(', '),
    );
  }
  if (red.length > 0) {
    lines.push('', `${red.length} scheduled watchdog(s) on ${repo} with a RED latest scheduled run:`);
    for (const w of red) {
      lines.push(`  - ${w.name} (${w.file}) -- ${w.runUrl}`);
    }
  }
  if (inert.length > 0) {
    lines.push(
      '',
      `${inert.length} watchdog(s) do not resolve on the default branch (schedule: is dead there, ` +
        'a different bug -- see wiki systems/scheduled-workflow-default-branch-trap, not wake-ticketed by this script):',
    );
    for (const w of inert) {
      lines.push(`  - ${w.name} (${w.file})`);
    }
  }
  if (noRuns.length > 0) {
    lines.push('', `${noRuns.length} watchdog(s) resolve on the default branch but have no scheduled runs yet:`);
    for (const w of noRuns) {
      lines.push(`  - ${w.name} (${w.file})`);
    }
  }
  return lines.join('\n');
}

// Separate from formatReport on purpose: a recovered watchdog is NOT an
// alarm (it must not push the process to exit 1 or add an "ALARM" banner to
// a clean tick), but it must still be printed every tick, because it is the
// only record that this script chose not to file a ticket it otherwise would
// have. Returns null when nothing was suppressed, so a quiet board stays
// quiet.
function formatRecoveryNotes(classified) {
  const recovered = findRecoveredWatchdogs(classified);
  if (recovered.length === 0) return null;
  return recovered
    .map(
      (w) =>
        `watchdog-run-check: "${w.name}" (${w.file}) latest SCHEDULED run ${w.runId} is red ` +
        `(${w.runUrl}), but workflow_dispatch run ${w.clearedByRunId} on the default branch ` +
        `succeeded afterwards (${w.clearedByUrl}). Treating as recovered, not filing a wake ` +
        'ticket -- the cron has simply not run again yet (LUL-913).',
    )
    .join('\n');
}

// A stable, greppable marker in the wake ticket's own title, one per
// watchdog (not per run) -- exactly board-integrity-check.mjs's pattern.
const WAKE_MARKER_PREFIX = 'Watchdog red:';

function watchdogWakeMarker(watchdog) {
  return `${WAKE_MARKER_PREFIX} ${watchdog.name}`;
}

// ---- live fetchers ---------------------------------------------------------

// Every .github/workflows/* on one ref, as { file, yaml }. A ref that does
// not exist (or has no workflows dir) is an empty list, not an error --
// TRAIN_BRANCH is allowed to be absent on a fork or a fresh clone.
//
// A failed per-file download is NOT folded into yaml: '' -- that would be
// indistinguishable from "this workflow genuinely has no schedule:" and
// silently narrow the derived roster (LUL-776). Instead the file is left out
// of the returned list entirely and its name collected in `failedFiles`, so
// the caller can surface it as a loud "roster may be incomplete" line rather
// than a silent miss.
async function fetchWorkflowFiles(repo, ref, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const listRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`,
    { headers },
  );
  if (!listRes.ok) return { files: [], failedFiles: [] };
  const entries = await listRes.json();
  const files = [];
  const failedFiles = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.type !== 'file' || !/\.ya?ml$/.test(entry.name)) continue;
    const res = await fetch(entry.download_url, { headers });
    if (!res.ok) {
      failedFiles.push(entry.name);
      continue;
    }
    files.push({ file: entry.name, yaml: await res.text() });
  }
  return { files, failedFiles };
}

// Always filtered to event=schedule. The old code carried a hand-maintained
// `mixedTrigger` flag deciding whether to apply that filter, and it was
// already wrong: version-cut.yml was marked `mixedTrigger: false` but is
// pushed to constantly, so the unfiltered per_page=1 returned an in-progress
// *push* run and the watchdog was reported as "never ran on schedule" while
// it had six green scheduled runs. Unfiltered is never what this script
// wants -- a red push/pull_request run already gates its own PR and is not
// LUL-685's gap -- so the flag is gone and the filter is unconditional.
async function fetchLatestScheduledRuns(repo, file, token) {
  const data = await ghFetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=1&event=schedule`,
    token,
  );
  return data.workflow_runs ?? [];
}

// LUL-913's clearing signal. Pinned to the default branch because that is the
// ref `schedule:` fires from -- a dispatch someone ran against a feature
// branch proves nothing about the cron path. Only issued for watchdogs
// already classified red, so a green board still costs exactly the same
// number of API reads it did before.
async function fetchLatestDispatchRuns(repo, file, token, defaultBranch) {
  const data = await ghFetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs` +
      `?per_page=1&event=workflow_dispatch&branch=${encodeURIComponent(defaultBranch)}`,
    token,
  );
  return data.workflow_runs ?? [];
}

async function classifyAllWatchdogs(repo, defaultBranch, token) {
  const [defaultResult, trainResult] = await Promise.all([
    fetchWorkflowFiles(repo, defaultBranch, token),
    defaultBranch === TRAIN_BRANCH
      ? Promise.resolve({ files: [], failedFiles: [] })
      : fetchWorkflowFiles(repo, TRAIN_BRANCH, token),
  ]);
  const watchdogs = deriveWatchdogs(defaultResult.files, trainResult.files);
  const failedFiles = [...defaultResult.failedFiles, ...trainResult.failedFiles];

  const results = [];
  for (const watchdog of watchdogs) {
    // onDefaultBranch already answers what a per-file contents probe used to
    // cost an extra request each to find out.
    const runs = watchdog.onDefaultBranch
      ? await fetchLatestScheduledRuns(repo, watchdog.file, token)
      : [];
    // Classify once with no clearing evidence; only pay for the extra read
    // on the watchdogs that actually came back red.
    const first = classifyWatchdog(watchdog, watchdog.onDefaultBranch, runs);
    if (first.alarm !== 'red') {
      results.push(first);
      continue;
    }
    const dispatchRuns = await fetchLatestDispatchRuns(repo, watchdog.file, token, defaultBranch);
    results.push(classifyWatchdog(watchdog, watchdog.onDefaultBranch, runs, dispatchRuns));
  }
  return { results, failedFiles };
}

// Every status that means "this alarm still has a ticket someone could act
// on". `blocked` and `in_review` were missing and that is a live ticket-flood
// bug, not a theoretical one: LUL-721 -- the very wake ticket this detector
// filed -- was moved to `blocked` by terminal-run recovery on 2026-08-26,
// and for that whole window the 30-minute cron saw no open ticket carrying
// the marker and would have filed a duplicate on every tick. Dedup must
// track "not closed", not "actively being worked".
const OPEN_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review'];

async function fetchOpenIssuesForDedup(apiBase, companyId, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const get = async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    // Bare array today (verified 2026-08-27 against ?status=todo). Tolerating
    // the { issues } envelope too is cheap insurance: if this endpoint ever
    // gains one, the array assumption fails open -- zero issues means zero
    // dedup matches, which refiles every ticket every 30 minutes.
    return Array.isArray(body) ? body : (body.issues ?? []);
  };
  const pages = await Promise.all(
    OPEN_STATUSES.map((status) =>
      get(`${apiBase}/api/companies/${companyId}/issues?status=${status}&limit=200`),
    ),
  );
  return pages.flat();
}

// ---- axis (2): which run id we last filed a ticket for --------------------
//
// Keyed by workflow FILE, not display name: the file is the stable identity
// (`name:` is editable prose, and formatReport already treats them as
// separate things). Value is the run id as a string -- GitHub run ids exceed
// 2^32 and JSON round-trips them fine as strings, whereas mixing number and
// string forms would make the `===` below silently false and re-file.
const TICKETED_RUNS_FILE = 'ticketed-runs.json';

function ticketedRunsDir() {
  return process.env.WATCHDOG_STATE_DIR || null;
}

// Every failure mode returns {} -- see the FAILS OPEN note in the header.
function readTicketedRuns(dir) {
  if (!dir) return {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, TICKETED_RUNS_FILE), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Best-effort: a write failure must not lose the ticket we just filed, so the
// caller ignores the return value. Written via tmp+rename so a torn write
// (cron killed mid-tick) leaves the previous map intact rather than a
// half-file that parses as {} and re-files everything.
function writeTicketedRuns(dir, map) {
  if (!dir) return false;
  try {
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, TICKETED_RUNS_FILE);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
    renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

// Pure, so the nine-tickets-for-five-runs regression is directly testable.
function alreadyTicketedRun(ticketedRuns, watchdog) {
  const seen = ticketedRuns[watchdog.file];
  return seen != null && String(seen) === String(watchdog.runId);
}

function recordTicketedRun(ticketedRuns, watchdog) {
  return { ...ticketedRuns, [watchdog.file]: String(watchdog.runId) };
}

// Split out from durableToken so a regression like LUL-781 (process.env.HOME
// used directly, which is `undefined` under `env -i` and string-concatenates
// into the literal path ".../undefined/.paperclip/auth.json") is directly
// unit-testable without touching the real filesystem or the real credential
// file. os.homedir() -- unlike a raw process.env.HOME read -- falls back to
// the OS user database when HOME is absent from the environment, which is
// exactly the shape cron runs under.
function authJsonPath() {
  return new URL('file://' + homedir() + '/.paperclip/auth.json');
}

// Read the durable CLI token from ~/.paperclip/auth.json when PAPERCLIP_API_KEY
// is absent or expired (LUL-770). Under cron the run JWT is dead; this token is
// what the watchdog family uses for all unattended Paperclip API calls.
function durableToken(apiBase) {
  try {
    const raw = readFileSync(authJsonPath());
    const creds = JSON.parse(raw).credentials || {};
    // Try the exact base, then with/without trailing slash, then fallback to sole entry
    const entry =
      creds[apiBase] ||
      creds[apiBase.replace(/\/$/, '')] ||
      creds[apiBase + '/'] ||
      (Object.keys(creds).length === 1 ? Object.values(creds)[0] : null);
    return (entry || {}).token || null;
  } catch {
    return null;
  }
}

// Try /api/agents/me (works with a run JWT); tolerate a 401 under the durable
// token (LUL-770 credential scope trap). Falls back to WATCHDOG_ASSIGNEE_AGENT_ID
// or a lookup by name from /api/companies/{id}/agents.
async function resolveAssigneeId(apiBase, companyId, apiKey) {
  if (process.env.WATCHDOG_ASSIGNEE_AGENT_ID) {
    return process.env.WATCHDOG_ASSIGNEE_AGENT_ID;
  }
  const res = await fetch(`${apiBase}/api/agents/me`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.ok) {
    const me = await res.json();
    return me.id;
  }
  // /api/agents/me returned 401 (durable token) — fall back to company agents list
  // and look for VP R&D or Ops by name, or return null (unassigned ticket is fine).
  try {
    const r2 = await fetch(`${apiBase}/api/companies/${companyId}/agents`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r2.ok) {
      const agents = await r2.json();
      const list = Array.isArray(agents) ? agents : (agents.agents || []);
      const vp = list.find((a) => /vp r&d|ops|watchdog/i.test(a.name || ''));
      return vp ? vp.id : null;
    }
  } catch { /* ignore */ }
  return null;
}

async function createWakeIssue(apiBase, companyId, apiKey, { title, description, assigneeAgentId }) {
  const res = await fetch(`${apiBase}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ title, description, status: 'todo', priority: 'high', assigneeAgentId }),
  });
  if (!res.ok) {
    throw new Error(`POST issue -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fileWakeTickets(apiBase, companyId, apiKey, redWatchdogs, openIssues, stateDir) {
  // Resolve the assignee lazily — after the dedup check — so quiet runs never
  // touch /api/agents/me at all (LUL-770).
  let assigneeId;
  let resolved = false;
  const filed = [];
  let ticketedRuns = readTicketedRuns(stateDir);

  for (const watchdog of redWatchdogs) {
    const marker = watchdogWakeMarker(watchdog);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    // Axis (2). Ordered after axis (1) deliberately: the open-ticket check is
    // the cheaper, stronger signal, and this one only has to catch the window
    // where the ticket is already closed but the run has not advanced yet.
    if (alreadyTicketedRun(ticketedRuns, watchdog)) {
      console.error(
        `dedup: "${watchdog.name}" is still red on run ${watchdog.runId}, which already had a ` +
        `wake ticket filed and closed. Not re-filing -- re-arm waits for a NEWER red run (LUL-897).`,
      );
      continue;
    }
    if (!resolved) {
      // null is a legitimate outcome (unassigned is acceptable) — cache it too,
      // so a run with 2+ red watchdogs doesn't re-run the resolution chain.
      assigneeId = await resolveAssigneeId(apiBase, companyId, apiKey);
      resolved = true;
    }
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: `${marker} (LUL-685 detector)`,
      description:
        `Detected by scripts/watchdog-run-check.mjs: the scheduled workflow "${watchdog.name}" ` +
        `(.github/workflows/${watchdog.file}) most recently ran red on its cron trigger -- ` +
        `${watchdog.runUrl}. Read the run log, fix the underlying cause, and close this ticket ` +
        `once it's addressed. Closing it re-arms this detector, but only for a NEWER red run: ` +
        `this run (${watchdog.runId}) is now recorded as routed, so closing this ticket will not ` +
        `produce another copy of it on the next tick. See wiki game/lul685-watchdog-wake-router.`,
      assigneeAgentId: assigneeId,
    });
    // Record only after the POST succeeded — createWakeIssue throws on a
    // non-ok response, and marking a run "routed" when no ticket exists would
    // suppress the alarm entirely.
    ticketedRuns = recordTicketedRun(ticketedRuns, watchdog);
    writeTicketedRuns(stateDir, ticketedRuns);
    filed.push({ kind: 'watchdog-red', name: watchdog.name, runId: watchdog.runId, assigneeAgentId: assigneeId });
  }

  return filed;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const ghToken = process.env.GITHUB_TOKEN;
  const shouldPost = process.argv.includes('--post');

  const repoInfo = await ghFetch(`https://api.github.com/repos/${repo}`, ghToken);
  const defaultBranch = repoInfo.default_branch;

  const { results: classified, failedFiles } = await classifyAllWatchdogs(repo, defaultBranch, ghToken);
  const red = findRedWatchdogs(classified);
  const report = formatReport(classified, repo, failedFiles);

  // Printed before the report and regardless of it: a suppressed alarm is the
  // one line that explains why an obviously-red workflow produced no ticket.
  const recoveryNotes = formatRecoveryNotes(classified);
  if (recoveryNotes) console.log(recoveryNotes);

  if (!report) {
    console.log(`watchdog-run-check: OK (${classified.length} watchdog(s) checked on ${repo}, no alarms)`);
    return;
  }

  console.error(report);

  if (shouldPost && red.length > 0) {
    const apiBase = (process.env.PAPERCLIP_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
    const companyId = process.env.PAPERCLIP_COMPANY_ID;
    // Accept the run JWT when present; fall back to the durable CLI token so
    // cron can file tickets after all agent sessions are dead (LUL-770).
    const apiKey = process.env.PAPERCLIP_API_KEY || durableToken(apiBase);
    if (!apiBase || !apiKey || !companyId) {
      throw new Error(
        'Cannot resolve Paperclip credentials for --post. ' +
        'Need PAPERCLIP_API_URL + PAPERCLIP_COMPANY_ID + (PAPERCLIP_API_KEY or ~/.paperclip/auth.json).',
      );
    }
    const stateDir = ticketedRunsDir();
    if (!stateDir) {
      console.error(
        'WATCHDOG_STATE_DIR is unset -- run-id dedup (LUL-897) is disabled for this invocation, ' +
        'so a red run that was already ticketed and closed can be re-filed. Expected for ad-hoc ' +
        'runs; the cron sets it.',
      );
    }
    const openIssues = await fetchOpenIssuesForDedup(apiBase, companyId, apiKey);
    const filed = await fileWakeTickets(apiBase, companyId, apiKey, red, openIssues, stateDir);
    if (filed.length === 0) {
      console.error('--post: every red watchdog is already routed (open ticket, or this run id already filed), filed nothing new.');
    } else {
      for (const f of filed) console.error(`filed wake ticket: ${JSON.stringify(f)}`);
    }
  }

  process.exitCode = red.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`watchdog-run-check: ERROR: ${err.message}`);
    process.exitCode = 2;
  });
}

export {
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
  ticketedRunsDir,
  readTicketedRuns,
  writeTicketedRuns,
  alreadyTicketedRun,
  recordTicketedRun,
};

