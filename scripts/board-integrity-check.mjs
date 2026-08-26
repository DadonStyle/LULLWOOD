#!/usr/bin/env node
// LUL-672: this class -- an approved+green PR with no live ticket, and a
// `blocked` issue nothing can ever wake -- has now been hand-swept at least
// three times (wiki playbooks/lul494-tombstone-sweep, process/review-to-land-wake-gap
// 08-20 and 08-26 episodes) and the last recurrence cost the founder's #1
// priority ~4 days. This is the automated check that replaces the sweep.
//
// Unlike scripts/check-review-gap.mjs, this CANNOT run as a GitHub Actions
// workflow: both alarms need to cross-reference live Paperclip issue data,
// and CI must never hold Paperclip credentials (wiki systems/lul523-closed,
// decided under LUL-523). So this is a plain Node script meant to be run by
// an agent that already has PAPERCLIP_API_KEY in its environment -- as part
// of a board sweep, or from a scheduled cloud-agent routine. See the ticket
// comment on LUL-672 for why this PR does not also add that schedule.
//
// Usage:
//   node scripts/board-integrity-check.mjs [--post]
//
// Env:
//   GITHUB_TOKEN           optional; unauthenticated reads work on this
//                          public repo, a token just raises the rate limit
//   GITHUB_REPOSITORY      "owner/repo", defaults to DadonStyle/LULLWOOD
//   PAPERCLIP_API_URL      required (this agent's own env already has it)
//   PAPERCLIP_API_KEY      required
//   PAPERCLIP_COMPANY_ID   required
//
// --post files a new `todo` wake ticket per alarm, NOT a comment on a shared
// "standing" issue. Paperclip's write boundary follows the assignee: an
// agent gets a 403 commenting on (or PATCHing) an issue assigned to someone
// else, even one it created itself (wiki playbooks/paperclip-api-traps,
// systems/issue-authorization-boundary -- hit live building this script,
// see the LUL-672 ticket comment). A NEW issue can be assigned to anyone,
// so a fresh per-alarm ticket is the only --post shape that reliably wakes
// the right agent no matter who runs this. Each wake ticket's title carries
// a stable marker so a repeat run does not refile a duplicate.
//
// Exit 0: ran cleanly, no alarms. Exit 1: alarms found (and filed, if
// --post). Exit 2: the run itself errored (network, auth, ...).
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';

// ---- pure logic (unit-tested against fixtures, no network) ---------------

// A blocker is "live" if it could still plausibly move -- anything not
// done/cancelled. Matches the wiki's LUL-533 lesson (process/review-to-land-wake-gap):
// "an edge is only live if the blocker it points at is still open." A
// `blockedBy` array that is non-empty but every entry is already resolved
// is the same tombstone as an empty one -- nothing left to fire
// `issue_blockers_resolved`.
function isBlockerLive(blocker) {
  return blocker.status !== 'done' && blocker.status !== 'cancelled';
}

// issue: the shape of `GET /api/issues/{id}` (blockedBy/activeRecoveryAction/
// successfulRunHandoff are only present on the per-issue read, not the list
// endpoint -- see wiki systems/recovery-action-wake-path and the ticket's
// own implementation note about blockedBy).
function isTombstone(issue) {
  if (issue.status !== 'blocked') return false;
  const blockedBy = issue.blockedBy ?? [];
  if (blockedBy.some(isBlockerLive)) return false;
  if (issue.activeRecoveryAction) return false;
  if (issue.successfulRunHandoff?.hasLiveContinuation) return false;
  return true;
}

function findTombstones(blockedIssues) {
  return blockedIssues.filter(isTombstone);
}

// Match on the PR number, not the title (wiki: titles drift and duplicate).
// Looks for "#123" as a whole token in the issue's title or description so
// "#1234" does not false-match PR #123.
function issueReferencesPr(issue, prNumber) {
  const re = new RegExp(`(?:^|[^0-9])#${prNumber}(?:[^0-9]|$)`);
  return re.test(issue.title ?? '') || re.test(issue.description ?? '');
}

// requiredCheckNames: array of context strings from the branch ruleset.
// checkRunsByName: Map<name, run[]> for the PR head sha. This repo emits a
// double-run per required check (one `success`, one `skipped` twin) -- a
// name is green if *any* of its runs concluded `success`; never collapse
// the list into a dict keyed by name first, that silently keeps whichever
// run came last.
function isPrMergeReady(pr, reviews, requiredCheckNames, checkRunsByName) {
  if (pr.mergeable_state !== 'clean') return false;
  if (!reviews.some((r) => r.state === 'APPROVED')) return false;
  return requiredCheckNames.every((name) =>
    (checkRunsByName.get(name) ?? []).some((run) => run.conclusion === 'success'),
  );
}

// prContexts: [{ pr, reviews, requiredCheckNames, checkRunsByName }]
// openIssues: candidate todo/in_progress issues that might own a PR.
function findUnownedPrs(prContexts, openIssues) {
  const gaps = [];
  for (const ctx of prContexts) {
    if (!isPrMergeReady(ctx.pr, ctx.reviews, ctx.requiredCheckNames, ctx.checkRunsByName)) continue;
    const owner = openIssues.find((issue) => issueReferencesPr(issue, ctx.pr.number));
    if (!owner) gaps.push(ctx.pr);
  }
  return gaps;
}

function formatReport(tombstones, unownedPrs, repo) {
  if (tombstones.length === 0 && unownedPrs.length === 0) return null;
  const lines = ['board-integrity detector: ALARM'];
  if (tombstones.length > 0) {
    lines.push('', `${tombstones.length} tombstoned issue(s) -- blocked, no live blocker, no recovery action:`);
    for (const t of tombstones) {
      lines.push(`  - ${t.identifier ?? t.id}: "${t.title}" (assignee ${t.assigneeAgentId ?? 'none'})`);
    }
  }
  if (unownedPrs.length > 0) {
    lines.push('', `${unownedPrs.length} mergeable, approved PR(s) on ${repo} with no owning ticket:`);
    for (const pr of unownedPrs) {
      lines.push(`  - #${pr.number} "${pr.title}" -- ${pr.html_url}`);
    }
  }
  return lines.join('\n');
}

// A stable, greppable marker in the wake ticket's own title so a repeat run
// can tell "already dispatched" from "needs dispatching" without any extra
// state of its own -- it just searches the open todo/in_progress issues it
// already fetched for the ownership check.
const WAKE_MARKER_PREFIX = 'Board-integrity:';

function tombstoneWakeMarker(issue) {
  return `${WAKE_MARKER_PREFIX} ${issue.identifier ?? issue.id} is a tombstone`;
}

function unownedPrWakeMarker(pr) {
  return `${WAKE_MARKER_PREFIX} PR #${pr.number} has no owning ticket`;
}

function hasOpenWakeTicket(openIssues, marker) {
  return openIssues.some((issue) => (issue.title ?? '').startsWith(marker));
}

// ---- live fetchers ---------------------------------------------------------

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function ghFetch(url, token) {
  return fetchJson(url, {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

function pcFetch(url, apiKey) {
  return fetchJson(url, { Authorization: `Bearer ${apiKey}` });
}

async function fetchRequiredCheckNames(repo, branch, token) {
  const rules = await ghFetch(
    `https://api.github.com/repos/${repo}/rules/branches/${encodeURIComponent(branch)}`,
    token,
  );
  const rule = rules.find((r) => r.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((c) => c.context);
}

async function fetchCheckRunsByName(repo, sha, token) {
  const data = await ghFetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`, token);
  const byName = new Map();
  for (const run of data.check_runs ?? []) {
    const list = byName.get(run.name) ?? [];
    list.push(run);
    byName.set(run.name, list);
  }
  return byName;
}

async function fetchPrContext(repo, prNumber, token) {
  const pr = await ghFetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, token);
  const [reviews, requiredCheckNames, checkRunsByName] = await Promise.all([
    ghFetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`, token),
    fetchRequiredCheckNames(repo, pr.base.ref, token),
    fetchCheckRunsByName(repo, pr.head.sha, token),
  ]);
  return { pr, reviews, requiredCheckNames, checkRunsByName };
}

async function fetchOpenIssuesForOwnershipCheck(apiBase, companyId, apiKey) {
  const [todo, inProgress] = await Promise.all([
    pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=todo&limit=200`, apiKey),
    pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=in_progress&limit=200`, apiKey),
  ]);
  return [...todo, ...inProgress];
}

// LIST omits blockedBy/activeRecoveryAction/successfulRunHandoff, so a
// list-based tombstone count over-counts -- fetch each blocked issue
// individually (see the ticket's own implementation note; only ever a
// handful of issues are `blocked` at once, so this is cheap).
async function fetchBlockedIssuesFull(apiBase, companyId, apiKey) {
  const summaries = await pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=blocked&limit=200`, apiKey);
  const full = [];
  for (const s of summaries) {
    full.push(await pcFetch(`${apiBase}/api/issues/${s.id}`, apiKey));
  }
  return full;
}

async function fetchSelfAgentId(apiBase, apiKey) {
  const me = await pcFetch(`${apiBase}/api/agents/me`, apiKey);
  return me.id;
}

async function createWakeIssue(apiBase, companyId, apiKey, { title, description, assigneeAgentId, priority }) {
  const res = await fetch(`${apiBase}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ title, description, status: 'todo', priority, assigneeAgentId }),
  });
  if (!res.ok) {
    throw new Error(`POST issue -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fileWakeTickets(apiBase, companyId, apiKey, tombstones, unownedPrs, openIssues) {
  const selfId = await fetchSelfAgentId(apiBase, apiKey);
  const filed = [];

  for (const issue of tombstones) {
    const marker = tombstoneWakeMarker(issue);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    const assigneeAgentId = issue.assigneeAgentId ?? selfId;
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: `${marker} (LUL-672 detector)`,
      description:
        `Detected by scripts/board-integrity-check.mjs: ${issue.identifier ?? issue.id} ` +
        `("${issue.title}") is status \`blocked\` with no live blocker and no recovery ` +
        `action -- nothing will ever wake it automatically. Re-check it: advance/close it, ` +
        `or record why it is genuinely still blocked (and give it a real blockedBy edge or ` +
        `recovery path if so). See wiki process/review-to-land-wake-gap.`,
      assigneeAgentId,
      priority: 'high',
    });
    filed.push({ kind: 'tombstone', identifier: issue.identifier ?? issue.id, assigneeAgentId });
  }

  for (const pr of unownedPrs) {
    const marker = unownedPrWakeMarker(pr);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: `${marker} (LUL-672 detector)`,
      description:
        `Detected by scripts/board-integrity-check.mjs: PR #${pr.number} "${pr.title}" ` +
        `(${pr.html_url}) is mergeable_state \`clean\`, has an APPROVED review, and every ` +
        `required check has a success run -- but no open todo/in_progress ticket references ` +
        `it. Land it, or file/attach the ticket that should own it.`,
      assigneeAgentId: selfId,
      priority: 'high',
    });
    filed.push({ kind: 'unowned-pr', number: pr.number, assigneeAgentId: selfId });
  }

  return filed;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const ghToken = process.env.GITHUB_TOKEN;
  const apiBase = (process.env.PAPERCLIP_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const shouldPost = process.argv.includes('--post');

  if (!apiBase || !apiKey || !companyId) {
    throw new Error(
      'PAPERCLIP_API_URL, PAPERCLIP_API_KEY and PAPERCLIP_COMPANY_ID must all be set -- ' +
        'this detector needs live Paperclip issue data for both alarms, it cannot run ' +
        'GitHub-only (see the file header and wiki systems/lul523-closed).',
    );
  }

  const [openPrs, blockedIssuesFull, openIssuesForOwnership] = await Promise.all([
    ghFetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, ghToken),
    fetchBlockedIssuesFull(apiBase, companyId, apiKey),
    fetchOpenIssuesForOwnershipCheck(apiBase, companyId, apiKey),
  ]);

  const prContexts = [];
  for (const prSummary of openPrs) {
    prContexts.push(await fetchPrContext(repo, prSummary.number, ghToken));
  }

  const tombstones = findTombstones(blockedIssuesFull);
  const unownedPrs = findUnownedPrs(prContexts, openIssuesForOwnership);
  const report = formatReport(tombstones, unownedPrs, repo);

  if (!report) {
    console.log(
      `board-integrity detector: OK (${blockedIssuesFull.length} blocked issue(s), ${openPrs.length} open PR(s) on ${repo}, no alarms)`,
    );
    return;
  }

  console.error(report);

  if (shouldPost) {
    const filed = await fileWakeTickets(apiBase, companyId, apiKey, tombstones, unownedPrs, openIssuesForOwnership);
    if (filed.length === 0) {
      console.error('--post: every alarm already has an open wake ticket, filed nothing new.');
    } else {
      for (const f of filed) console.error(`filed wake ticket: ${JSON.stringify(f)}`);
    }
  }

  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`board-integrity detector: ERROR: ${err.message}`);
    process.exitCode = 2;
  });
}

export {
  isTombstone,
  findTombstones,
  issueReferencesPr,
  isPrMergeReady,
  findUnownedPrs,
  formatReport,
  tombstoneWakeMarker,
  unownedPrWakeMarker,
  hasOpenWakeTicket,
};
