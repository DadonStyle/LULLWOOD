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
// The roster of watchdogs is DERIVED from the repo's own workflow files on
// both the default branch and the release-train branch, never hand-listed --
// see deriveWatchdogs below for why.
//
// Dedup is on the ALARM (one marker per watchdog), not the run: 99
// consecutive red runs of the same workflow must produce one ticket, not 99.
// Re-arm is a property of scoping the dedup check to OPEN issues only (same
// as board-integrity-check.mjs): once a wake ticket is closed by whoever
// fixes the underlying workflow, the next red run finds no open ticket
// carrying the marker and files a fresh one. "Open" there means every
// non-terminal status including `blocked` and `in_review`, not just the two
// active ones -- see OPEN_STATUSES. No auto-close logic here --
// verifying the fix and closing the ticket is a human/agent judgment call,
// same as every other wake ticket in this family.
//
// Exit 0: ran cleanly, no RED alarms (INERT alarms alone do not fail the
// run -- see above). Exit 1: at least one RED alarm found (and filed, if
// --post). Exit 2: the run itself errored (network, auth, ...).
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

// watchdog: one entry from deriveWatchdogs. resolvesOnDefault: bool (contents
// API 200/404 on the default branch). runs: workflow_runs array as above.
function classifyWatchdog(watchdog, resolvesOnDefault, runs) {
  if (!resolvesOnDefault) {
    return { ...watchdog, alarm: 'inert' };
  }
  const conclusion = latestScheduledConclusion(runs);
  if (conclusion === null) {
    return { ...watchdog, alarm: 'no-runs' };
  }
  if (conclusion === 'failure') {
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
    results.push(classifyWatchdog(watchdog, watchdog.onDefaultBranch, runs));
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

async function fileWakeTickets(apiBase, companyId, apiKey, redWatchdogs, openIssues) {
  // Resolve the assignee lazily — after the dedup check — so quiet runs never
  // touch /api/agents/me at all (LUL-770).
  let assigneeId;
  let resolved = false;
  const filed = [];

  for (const watchdog of redWatchdogs) {
    const marker = watchdogWakeMarker(watchdog);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
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
        `once it's addressed. Closing it re-arms this detector: a later red run of the same ` +
        `workflow will file a fresh ticket only after this one is no longer open. See wiki ` +
        `game/lul685-watchdog-wake-router.`,
      assigneeAgentId: assigneeId,
    });
    filed.push({ kind: 'watchdog-red', name: watchdog.name, assigneeAgentId: assigneeId });
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
    const openIssues = await fetchOpenIssuesForDedup(apiBase, companyId, apiKey);
    const filed = await fileWakeTickets(apiBase, companyId, apiKey, red, openIssues);
    if (filed.length === 0) {
      console.error('--post: every red watchdog already has an open wake ticket, filed nothing new.');
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
  formatReport,
  watchdogWakeMarker,
  authJsonPath,
  durableToken,
  resolveAssigneeId,
  fetchWorkflowFiles,
  fileWakeTickets,
};

