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
// Dedup is on the ALARM (one marker per watchdog), not the run: 99
// consecutive red runs of the same workflow must produce one ticket, not 99.
// Re-arm is a property of scoping the dedup check to OPEN issues only (same
// as board-integrity-check.mjs): once a wake ticket is closed by whoever
// fixes the underlying workflow, the next red run finds no open ticket
// carrying the marker and files a fresh one. No auto-close logic here --
// verifying the fix and closing the ticket is a human/agent judgment call,
// same as every other wake ticket in this family.
//
// Exit 0: ran cleanly, no RED alarms (INERT alarms alone do not fail the
// run -- see above). Exit 1: at least one RED alarm found (and filed, if
// --post). Exit 2: the run itself errored (network, auth, ...).
import { pathToFileURL } from 'node:url';
import { ghFetch } from './lib/github-fetch.mjs';
import { hasOpenWakeTicket } from './board-integrity-check.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';

// Every scheduled watchdog this studio runs, per LUL-685's own list ("the
// five named above" plus review-gap-detector itself). `mixedTrigger: true`
// means the runs endpoint must be filtered to event=schedule -- a
// pull_request-triggered run of that same workflow already has its own wake
// path (it blocks that PR's checks) and is not this ticket's gap.
const WATCHDOGS = [
  { name: 'Review gap detector', file: 'review-gap-detector.yml', mixedTrigger: false },
  { name: 'Base branch guard', file: 'base-branch-guard.yml', mixedTrigger: true },
  { name: 'Deployment budget', file: 'deployment-budget.yml', mixedTrigger: false },
  { name: 'PR freshness', file: 'pr-freshness.yml', mixedTrigger: true },
  { name: 'Version cut', file: 'version-cut.yml', mixedTrigger: false },
  { name: 'Merge gap detector', file: 'merge-gap-detector.yml', mixedTrigger: false },
];

// ---- pure logic (unit-tested against fixtures, no network) ---------------

// runs: the `workflow_runs` array from GET .../runs?event=schedule&per_page=1
// (already filtered/paged by the caller -- this just reads the first entry).
function latestScheduledConclusion(runs) {
  if (!runs || runs.length === 0) return null;
  return runs[0].conclusion;
}

// watchdog: one entry of WATCHDOGS. resolvesOnDefault: bool (contents API
// 200/404 on the default branch). runs: workflow_runs array as above.
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

function formatReport(classified, repo) {
  const red = findRedWatchdogs(classified);
  const inert = findInertWatchdogs(classified);
  const noRuns = findNoRunWatchdogs(classified);
  if (red.length === 0 && inert.length === 0 && noRuns.length === 0) return null;

  const lines = ['watchdog-run-check: ALARM'];
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

async function fetchResolvesOnDefault(repo, defaultBranch, file, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/.github/workflows/${file}?ref=${encodeURIComponent(defaultBranch)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  return res.ok;
}

async function fetchLatestScheduledRuns(repo, file, mixedTrigger, token) {
  const eventFilter = mixedTrigger ? '&event=schedule' : '';
  const data = await ghFetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=1${eventFilter}`,
    token,
  );
  return data.workflow_runs ?? [];
}

async function classifyAllWatchdogs(repo, defaultBranch, token) {
  const results = [];
  for (const watchdog of WATCHDOGS) {
    const resolvesOnDefault = await fetchResolvesOnDefault(repo, defaultBranch, watchdog.file, token);
    const runs = resolvesOnDefault
      ? await fetchLatestScheduledRuns(repo, watchdog.file, watchdog.mixedTrigger, token)
      : [];
    results.push(classifyWatchdog(watchdog, resolvesOnDefault, runs));
  }
  return results;
}

async function fetchOpenIssuesForDedup(apiBase, companyId, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const get = async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const [todo, inProgress] = await Promise.all([
    get(`${apiBase}/api/companies/${companyId}/issues?status=todo&limit=200`),
    get(`${apiBase}/api/companies/${companyId}/issues?status=in_progress&limit=200`),
  ]);
  return [...todo, ...inProgress];
}

async function fetchSelfAgentId(apiBase, apiKey) {
  const res = await fetch(`${apiBase}/api/agents/me`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`GET /api/agents/me -> HTTP ${res.status}: ${await res.text()}`);
  const me = await res.json();
  return me.id;
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
  const selfId = await fetchSelfAgentId(apiBase, apiKey);
  const filed = [];

  for (const watchdog of redWatchdogs) {
    const marker = watchdogWakeMarker(watchdog);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: `${marker} (LUL-685 detector)`,
      description:
        `Detected by scripts/watchdog-run-check.mjs: the scheduled workflow "${watchdog.name}" ` +
        `(.github/workflows/${watchdog.file}) most recently ran red on its cron trigger -- ` +
        `${watchdog.runUrl}. Read the run log, fix the underlying cause, and close this ticket ` +
        `once it's addressed. Closing it re-arms this detector: a later red run of the same ` +
        `workflow will file a fresh ticket only after this one is no longer open. See wiki ` +
        `game/lul685-watchdog-wake-router.`,
      assigneeAgentId: selfId,
    });
    filed.push({ kind: 'watchdog-red', name: watchdog.name, assigneeAgentId: selfId });
  }

  return filed;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const ghToken = process.env.GITHUB_TOKEN;
  const shouldPost = process.argv.includes('--post');

  const repoInfo = await ghFetch(`https://api.github.com/repos/${repo}`, ghToken);
  const defaultBranch = repoInfo.default_branch;

  const classified = await classifyAllWatchdogs(repo, defaultBranch, ghToken);
  const red = findRedWatchdogs(classified);
  const report = formatReport(classified, repo);

  if (!report) {
    console.log(`watchdog-run-check: OK (${classified.length} watchdog(s) checked on ${repo}, no alarms)`);
    return;
  }

  console.error(report);

  if (shouldPost && red.length > 0) {
    const apiBase = (process.env.PAPERCLIP_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
    const apiKey = process.env.PAPERCLIP_API_KEY;
    const companyId = process.env.PAPERCLIP_COMPANY_ID;
    if (!apiBase || !apiKey || !companyId) {
      throw new Error(
        'PAPERCLIP_API_URL, PAPERCLIP_API_KEY and PAPERCLIP_COMPANY_ID must all be set for --post.',
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
  WATCHDOGS,
  latestScheduledConclusion,
  classifyWatchdog,
  findRedWatchdogs,
  findInertWatchdogs,
  findNoRunWatchdogs,
  formatReport,
  watchdogWakeMarker,
};
