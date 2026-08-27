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
//   GITHUB_TOKEN / GH_TOKEN   NOT optional in practice, despite what earlier
//                             comments here claimed. No script in this repo
//                             runs under GitHub Actions -- the only thing
//                             that sets GITHUB_TOKEN automatically -- so an
//                             agent invoking this by hand goes out fully
//                             unauthenticated, and the studio's shared NAT
//                             egress IP burns through GitHub's 60/hr
//                             unauthenticated budget in a handful of
//                             `/check-runs` calls (LUL-736, measured: the
//                             documented invocation died with a raw 403 rate
//                             -limit body on call #7). If neither var is
//                             set, falls back to `~/.lullwood/gh_token`, then
//                             `gh auth token` (see scripts/lib/github-fetch.mjs
//                             resolveGithubToken). If every link in that
//                             chain comes up empty, exits 2 immediately with
//                             the chain named in the message -- before
//                             burning a single GitHub call.
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
import { fetchJson, ghFetch, resolveGithubToken, GITHUB_TOKEN_CHAIN_DESCRIPTION } from './lib/github-fetch.mjs';

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

// `in_review` has the identical no-wake-path failure mode as `blocked` (wiki
// process/in-review-tombstone-class, LUL-139: status in_review, blockedBy [],
// no reviewer, no interaction -- nothing will ever move it, and a
// blocked-only scan reports it as healthy work-in-flight).
const TOMBSTONE_STATUSES = new Set(['blocked', 'in_review']);

// A recovery action object can persist with a non-"active" status and still
// be truthy -- check the field the platform itself uses, not just presence
// (wiki systems/recovery-action-wake-path documents the real shape, which
// always carries `status: "active"` on a live one).
function hasActiveRecoveryAction(issue) {
  const action = issue.activeRecoveryAction;
  return Boolean(action) && action.status === 'active';
}

// LUL-677/LUL-680: a pending interaction with continuationPolicy
// "wake_assignee" resumes the assignee on response and is a fully live
// fourth wake edge, same as blockedBy/activeRecoveryAction/successfulRunHandoff.
// LUL-399 had exactly this (an ask_user_questions interaction parked on the
// founder) and the detector flagged it as a tombstone anyway -- a real
// false positive. `continuationPolicy: "none"` wakes nobody and is
// indistinguishable from `wake_assignee` at a glance, so check the field.
function hasLiveInteraction(interactions) {
  return (interactions ?? []).some(
    (i) => i.status === 'pending' && i.continuationPolicy === 'wake_assignee',
  );
}

// issue: the shape of `GET /api/issues/{id}` (blockedBy/activeRecoveryAction/
// successfulRunHandoff are only present on the per-issue read, not the list
// endpoint -- see wiki systems/recovery-action-wake-path and the ticket's
// own implementation note about blockedBy), with `interactions` attached
// separately from `GET /api/issues/{id}/interactions` (not part of the
// issue payload itself).
function isTombstone(issue) {
  if (!TOMBSTONE_STATUSES.has(issue.status)) return false;
  const blockedBy = issue.blockedBy ?? [];
  if (blockedBy.some(isBlockerLive)) return false;
  if (hasActiveRecoveryAction(issue)) return false;
  if (issue.successfulRunHandoff?.hasLiveContinuation) return false;
  if (hasLiveInteraction(issue.interactions)) return false;
  return true;
}

function findTombstones(blockedIssues) {
  return blockedIssues.filter(isTombstone);
}

// ---- Alarm B disposition: SHIPPED (already landed) vs STRANDED (real work) -
//
// LUL-736: the LUL-673 hand sweep hit 5 tombstones and found 4 were stale
// status on already-merged work (the owning run merged its PR then died on
// the session limit before the closing PATCH -- wiki
// a-limit-killed-run-may-have-landed-the-work) and only 1 was genuinely
// stranded work. A flat "tombstone" report can't tell those apart, so acting
// on it means either hand-triaging every hit every sweep, or burning a paid
// agent run per false "needs work" ticket. The detector already fetches
// everything needed to resolve this itself.

const PR_NUMBER_RE = /#(\d+)/g;

function extractPrNumbers(text) {
  if (!text) return [];
  return [...text.matchAll(PR_NUMBER_RE)].map((m) => Number(m[1]));
}

// issue.comments: array of { body }, the shape of GET /api/issues/{id}/comments
// -- attached the same way LUL-677/LUL-680 attached .interactions, i.e. not
// part of the base issue payload.
function referencedPrNumbers(issue) {
  const texts = [issue.title, issue.description, ...(issue.comments ?? []).map((c) => c.body)];
  const nums = new Set();
  for (const text of texts) for (const n of extractPrNumbers(text)) nums.add(n);
  return [...nums].sort((a, b) => a - b);
}

// prByNumber: Map<number, pr> where pr is the shape of
// GET /repos/{repo}/pulls/{number} (needs `merged`, `state`, `merge_commit_sha`).
// A referenced number absent from the map (the lookup 404'd, or was never
// attempted) resolves to neither merged nor open -- it can't manufacture a
// SHIPPED verdict, but a genuinely merged sibling reference still can.
//
// A mix of "one merged, one still open" stays STRANDED: something referenced
// by this same ticket has not landed yet, so the work as a whole is not done
// (this is the one non-obvious case LUL-736 calls out explicitly).
function classifyDisposition(issue, prByNumber) {
  const referencedPrs = referencedPrNumbers(issue);
  const resolved = referencedPrs.map((n) => prByNumber.get(n)).filter(Boolean);
  const mergedPrs = resolved.filter((pr) => pr.merged);
  const stillOpenPrs = resolved.filter((pr) => pr.state === 'open');
  if (mergedPrs.length > 0 && stillOpenPrs.length === 0) {
    return { issue, disposition: 'SHIPPED', referencedPrs, mergedPrs };
  }
  return { issue, disposition: 'STRANDED', referencedPrs, mergedPrs };
}

function classifyTombstones(tombstones, prByNumber) {
  return tombstones.map((issue) => classifyDisposition(issue, prByNumber));
}

// STRANDED first: that is the half of the report that actually needs a human
// or an agent to do work. SHIPPED entries are three-line PATCHes.
function sortTombstonesStrandedFirst(classified) {
  const rank = { STRANDED: 0, SHIPPED: 1 };
  return [...classified].sort((a, b) => rank[a.disposition] - rank[b.disposition]);
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

// ---- Alarm C: zero pullable work -------------------------------------------
//
// LUL-810: the studio stalled for ~4 hours on 2026-08-27 with 0 issues in
// todo/in_progress and 6 agents capable of running -- no alarm fired. This is
// the cheapest possible signal: if no agent can pull work, the whole studio is
// stopped, regardless of what else is happening on the board.

// "available" = not paused; running agents are already active, idle ones can
// pull new work. A "paused" agent is explicitly suspended and does not count.
function isAvailableAgent(agent) {
  return agent.status !== 'paused';
}

// openIssues: array from fetchOpenIssuesForOwnershipCheck (todo + in_progress).
// agents: array from GET /api/companies/{id}/agents.
// Returns { alarm: boolean, availableAgentCount, openCount }.
function zeroPullableWorkAlarm(openIssues, agents) {
  const availableAgentCount = agents.filter(isAvailableAgent).length;
  const openCount = openIssues.length;
  return { alarm: openCount === 0 && availableAgentCount > 0, availableAgentCount, openCount };
}

// ---- Alarm D: stale request_confirmation -----------------------------------
//
// LUL-810: LUL-438 had a pending request_confirmation since 2026-08-19 (8
// days). Nothing surfaced it. A confirmation that sits for more than
// STALE_CONFIRMATION_DAYS with no response is a board gap: either the
// founder/user never saw it, or the issue needs to be re-routed.

const STALE_CONFIRMATION_DAYS = 7;

// LUL-827 defect 1: a re-ask (a second, fresh `request_confirmation` on the
// same issue) never cleared the alarm, because each pending confirmation on
// an issue was aged and reported independently. Live case: LUL-438 had one
// pending since 2026-08-19 (8d) *and* a fresh re-ask created 2026-08-27 --
// someone had already done the remedy the alarm asks for, and the alarm
// still fired on the stale first one. An older pending confirmation
// superseded by a newer pending confirmation on the same issue is not
// independently stale -- age each issue by its NEWEST pending confirmation
// only.
//
// candidates: array of issues with `.interactions` attached (from
// fetchTombstoneCandidates, which now covers blocked + in_review + in_progress).
// nowMs: Date.now() -- injected so tests don't depend on wall clock.
// staleDays: threshold in days (default STALE_CONFIRMATION_DAYS).
// Returns: [{ issue, interaction, ageDays }], sorted oldest first.
function findStaleConfirmations(candidates, nowMs, staleDays = STALE_CONFIRMATION_DAYS) {
  const result = [];
  for (const issue of candidates) {
    const pending = (issue.interactions ?? []).filter(
      (ix) => ix.kind === 'request_confirmation' && ix.status === 'pending',
    );
    if (pending.length === 0) continue;
    const newest = pending.reduce((a, b) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a));
    const ageMs = nowMs - new Date(newest.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= staleDays) {
      result.push({ issue, interaction: newest, ageDays });
    }
  }
  result.sort((a, b) => b.ageDays - a.ageDays);
  return result;
}

// LUL-827 defect 2: closing the wake ticket does not clear the underlying
// pending confirmation -- if a human genuinely hasn't answered, the very
// next sweep re-files the identical ticket, forever. Give the alarm a
// suppression path: if the most recently closed wake ticket for this exact
// confirmation (matched by marker, and only counted if it was closed AFTER
// the confirmation started -- i.e. it was closed with this confirmation
// already in view, not a stale leftover from a since-superseded one) is
// still within the re-alarm cooldown, don't refile yet.
//
// closedWakeIssues: done/cancelled issues (title + updatedAt is all this needs).
// nowMs: Date.now() -- injected so tests don't depend on wall clock.
// reAlarmDays: cooldown after a close before the same confirmation can be
// refiled (default STALE_CONFIRMATION_DAYS, i.e. "another 7 days").
function isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, nowMs, reAlarmDays = STALE_CONFIRMATION_DAYS) {
  const marker = staleConfirmationWakeMarker(issue);
  const confirmationCreatedMs = new Date(interaction.createdAt).getTime();
  let mostRecentCloseMs = -Infinity;
  for (const closed of closedWakeIssues ?? []) {
    if (!(closed.title ?? '').startsWith(marker)) continue;
    const closedMs = new Date(closed.updatedAt).getTime();
    if (closedMs > mostRecentCloseMs) mostRecentCloseMs = closedMs;
  }
  if (mostRecentCloseMs < confirmationCreatedMs) return false;
  const daysSinceClose = (nowMs - mostRecentCloseMs) / (1000 * 60 * 60 * 24);
  return daysSinceClose < reAlarmDays;
}

// classifiedTombstones: [{ issue, disposition, referencedPrs, mergedPrs }],
// the shape classifyTombstones() produces.
// zeroPullable: the result of zeroPullableWorkAlarm(), or null to skip Alarm C.
// staleConfirmations: the result of findStaleConfirmations(), or [] to skip Alarm D.
function formatReport(classifiedTombstones, unownedPrs, repo, zeroPullable = null, staleConfirmations = []) {
  const hasAlarms =
    classifiedTombstones.length > 0 ||
    unownedPrs.length > 0 ||
    zeroPullable?.alarm ||
    staleConfirmations.length > 0;
  if (!hasAlarms) return null;
  const lines = ['board-integrity detector: ALARM'];
  if (zeroPullable?.alarm) {
    lines.push(
      '',
      `ALARM C: board has 0 todo/in_progress issues with ${zeroPullable.availableAgentCount} available agent(s) -- studio is stopped`,
    );
  }
  if (classifiedTombstones.length > 0) {
    lines.push(
      '',
      `${classifiedTombstones.length} tombstoned issue(s) -- blocked/in_review, no live blocker, no active ` +
        'recovery action, no pending wake_assignee interaction:',
    );
    for (const { issue: t, disposition, mergedPrs } of sortTombstonesStrandedFirst(classifiedTombstones)) {
      const suffix =
        disposition === 'SHIPPED'
          ? ` -- SHIPPED, PR #${mergedPrs[0].number} merged${
              mergedPrs[0].merge_commit_sha ? ` (${mergedPrs[0].merge_commit_sha})` : ''
            }, close the ticket`
          : ' -- STRANDED, needs work';
      lines.push(`  - ${t.identifier ?? t.id}: "${t.title}" (assignee ${t.assigneeAgentId ?? 'none'})${suffix}`);
    }
  }
  if (unownedPrs.length > 0) {
    lines.push('', `${unownedPrs.length} mergeable, approved PR(s) on ${repo} with no owning ticket:`);
    for (const pr of unownedPrs) {
      lines.push(`  - #${pr.number} "${pr.title}" -- ${pr.html_url}`);
    }
  }
  if (staleConfirmations.length > 0) {
    lines.push(
      '',
      `${staleConfirmations.length} stale request_confirmation(s) -- pending for >${STALE_CONFIRMATION_DAYS} days with no response:`,
    );
    for (const { issue, interaction, ageDays } of staleConfirmations) {
      lines.push(
        `  - ${issue.identifier ?? issue.id}: "${issue.title}" -- confirmation pending ${Math.floor(ageDays)}d (since ${interaction.createdAt.slice(0, 10)}, assignee ${issue.assigneeAgentId ?? 'none'})`,
      );
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

function zeroPullableWorkWakeMarker() {
  return `${WAKE_MARKER_PREFIX} board has zero pullable work`;
}

function staleConfirmationWakeMarker(issue) {
  return `${WAKE_MARKER_PREFIX} ${issue.identifier ?? issue.id} has a stale request_confirmation`;
}

function hasOpenWakeTicket(openIssues, marker) {
  return openIssues.some((issue) => (issue.title ?? '').startsWith(marker));
}

// ---- live fetchers ---------------------------------------------------------

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
// list-based tombstone count over-counts -- fetch each candidate issue
// individually (see the ticket's own implementation note; only ever a
// handful of issues are `blocked`/`in_review` at once, so this is cheap).
async function fetchIssuesFullByStatus(apiBase, companyId, apiKey, status) {
  const summaries = await pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=${status}&limit=200`, apiKey);
  const full = [];
  for (const s of summaries) {
    full.push(await pcFetch(`${apiBase}/api/issues/${s.id}`, apiKey));
  }
  return full;
}

async function fetchAgents(apiBase, companyId, apiKey) {
  return pcFetch(`${apiBase}/api/companies/${companyId}/agents`, apiKey);
}

// LUL-827: closed (done/cancelled) issues, so Alarm D can tell "this wake
// ticket was closed while the confirmation was still pending" (a human-gated
// item, suppress for the re-alarm cooldown) from "never filed one" (file it).
async function fetchClosedIssuesForSuppressionCheck(apiBase, companyId, apiKey) {
  const [done, cancelled] = await Promise.all([
    pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=done&limit=200`, apiKey),
    pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=cancelled&limit=200`, apiKey),
  ]);
  return [...done, ...cancelled];
}

// LUL-677/LUL-680: pending interactions are not on the issue payload at all
// -- a separate `GET /api/issues/{id}/interactions` per candidate, attached
// as `.interactions` so isTombstone stays a pure function of one object.
// LUL-736: comments are fetched the same way, attached as `.comments`, so
// classifyDisposition() can scan them for `#<n>` PR references alongside the
// title/description -- LUL-677/682/702's PR references were in a comment,
// not the issue body.
// LUL-810: in_progress issues are included so findStaleConfirmations (Alarm D)
// also covers stale confirmations on active issues, not only blocked/in_review.
async function fetchTombstoneCandidates(apiBase, companyId, apiKey) {
  const [blocked, inReview, inProgress] = await Promise.all([
    fetchIssuesFullByStatus(apiBase, companyId, apiKey, 'blocked'),
    fetchIssuesFullByStatus(apiBase, companyId, apiKey, 'in_review'),
    fetchIssuesFullByStatus(apiBase, companyId, apiKey, 'in_progress'),
  ]);
  const tombstoneCandidates = [...blocked, ...inReview];
  const allCandidates = [...tombstoneCandidates, ...inProgress];
  await Promise.all(
    allCandidates.map(async (issue) => {
      const [interactions, comments] = await Promise.all([
        pcFetch(`${apiBase}/api/issues/${issue.id}/interactions`, apiKey),
        pcFetch(`${apiBase}/api/issues/${issue.id}/comments`, apiKey),
      ]);
      issue.interactions = interactions;
      issue.comments = comments;
    }),
  );
  return { tombstoneCandidates, allCandidates };
}

// LUL-736: resolves every PR number referenced by any tombstone candidate in
// one deduped batch. A referenced number that isn't really a PR (typo, wrong
// repo) 404s -- logged and left out of the map rather than aborting the
// whole run, since classifyDisposition() already treats an unresolved
// reference as neither merged nor open.
async function fetchPrLookup(repo, prNumbers, token) {
  const map = new Map();
  await Promise.all(
    [...new Set(prNumbers)].map(async (number) => {
      try {
        map.set(number, await ghFetch(`https://api.github.com/repos/${repo}/pulls/${number}`, token));
      } catch (err) {
        console.error(`board-integrity detector: could not resolve #${number} as a PR: ${err.message}`);
      }
    }),
  );
  return map;
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

// LUL-736: the wake ticket text itself must say which disposition fired --
// "close this, here is the merge commit" for SHIPPED, not the generic
// "this is stranded" text every tombstone got before.
function tombstoneWakeTitle(marker, disposition) {
  return disposition === 'SHIPPED' ? `${marker} (LUL-672 detector) -- SHIPPED, close it` : `${marker} (LUL-672 detector) -- STRANDED, needs work`;
}

function tombstoneWakeDescription({ issue, disposition, mergedPrs }) {
  if (disposition === 'SHIPPED') {
    const pr = mergedPrs[0];
    return (
      `Detected by scripts/board-integrity-check.mjs: ${issue.identifier ?? issue.id} ` +
      `("${issue.title}") is status \`${issue.status}\` with no live blocker, no active ` +
      `recovery action, and no pending wake_assignee interaction -- but it references PR ` +
      `#${pr.number}, which is already MERGED` +
      (pr.merge_commit_sha ? ` (merge commit ${pr.merge_commit_sha})` : '') +
      `. This looks like stale status on already-landed work (LUL-736 -- the owning run likely ` +
      `merged and died before the closing PATCH). Close the ticket; no implementation is needed. ` +
      `See wiki game/lul672-board-integrity-detector.`
    );
  }
  return (
    `Detected by scripts/board-integrity-check.mjs: ${issue.identifier ?? issue.id} ` +
    `("${issue.title}") is status \`${issue.status}\` with no live blocker, no active ` +
    `recovery action, and no pending wake_assignee interaction -- nothing will ever wake ` +
    `it automatically, and no referenced PR has merged. Re-check it: advance/close it, or ` +
    `record why it is genuinely still stuck (and give it a real blockedBy edge, recovery ` +
    `path, or interaction if so). See wiki process/review-to-land-wake-gap and ` +
    `game/lul672-board-integrity-detector.`
  );
}

// classifiedTombstones: [{ issue, disposition, referencedPrs, mergedPrs }]
// zeroPullable: result of zeroPullableWorkAlarm() -- { alarm, availableAgentCount, openCount }
// staleConfirmations: result of findStaleConfirmations()
// closedWakeIssues: done/cancelled issues, for Alarm D's re-alarm cooldown (LUL-827)
async function fileWakeTickets(
  apiBase,
  companyId,
  apiKey,
  classifiedTombstones,
  unownedPrs,
  openIssues,
  zeroPullable,
  staleConfirmations,
  closedWakeIssues = [],
  nowMs = Date.now(),
) {
  const selfId = await fetchSelfAgentId(apiBase, apiKey);
  const filed = [];

  if (zeroPullable?.alarm) {
    const marker = zeroPullableWorkWakeMarker();
    if (!hasOpenWakeTicket(openIssues, marker)) {
      await createWakeIssue(apiBase, companyId, apiKey, {
        title: `${marker} (LUL-810 detector)`,
        description:
          `Detected by scripts/board-integrity-check.mjs: the board has 0 issues in ` +
          `todo/in_progress while ${zeroPullable.availableAgentCount} agent(s) are available ` +
          `(not paused). The studio is stopped. Common causes: all work is blocked/in_review ` +
          `with no resolution path, or runs died on the session limit after landing their PRs ` +
          `without closing their tickets. Run the board sweep (node scripts/board-integrity-check.mjs --post) ` +
          `and check for tombstones. See wiki playbooks/session-limit-issue-recovery.`,
        assigneeAgentId: selfId,
        priority: 'critical',
      });
      filed.push({ kind: 'zero-pullable-work', availableAgentCount: zeroPullable.availableAgentCount, assigneeAgentId: selfId });
    }
  }

  for (const { issue, interaction, ageDays } of staleConfirmations ?? []) {
    const marker = staleConfirmationWakeMarker(issue);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    if (isStaleConfirmationSuppressed(closedWakeIssues, issue, interaction, nowMs)) continue;
    const assigneeAgentId = issue.assigneeAgentId ?? selfId;
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: `${marker} (LUL-810 detector)`,
      description:
        `Detected by scripts/board-integrity-check.mjs: ${issue.identifier ?? issue.id} ` +
        `("${issue.title}") has a \`request_confirmation\` (id ${interaction.id}) that has ` +
        `been \`pending\` for ${Math.floor(ageDays)} days (since ${interaction.createdAt.slice(0, 10)}). ` +
        `Either the founder/user has not seen it, or the issue needs to be re-routed or closed. ` +
        `Re-check the issue and either advance it or cancel the stale confirmation.`,
      assigneeAgentId,
      priority: 'high',
    });
    filed.push({ kind: 'stale-confirmation', identifier: issue.identifier ?? issue.id, ageDays: Math.floor(ageDays), assigneeAgentId });
  }

  for (const classified of classifiedTombstones) {
    const { issue, disposition } = classified;
    const marker = tombstoneWakeMarker(issue);
    if (hasOpenWakeTicket(openIssues, marker)) continue;
    const assigneeAgentId = issue.assigneeAgentId ?? selfId;
    await createWakeIssue(apiBase, companyId, apiKey, {
      title: tombstoneWakeTitle(marker, disposition),
      description: tombstoneWakeDescription(classified),
      assigneeAgentId,
      priority: 'high',
    });
    filed.push({ kind: 'tombstone', identifier: issue.identifier ?? issue.id, disposition, assigneeAgentId });
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

  // LUL-736 preflight: fail before burning a single GitHub call, not after
  // call #7 comes back a raw 403 rate-limit body that looks like a GitHub
  // outage rather than a config gap (which is exactly what happened running
  // this undocumented).
  const resolvedToken = resolveGithubToken();
  if (!resolvedToken) {
    throw new Error(
      `no GitHub token found -- checked ${GITHUB_TOKEN_CHAIN_DESCRIPTION} in order and none ` +
        'resolved. This detector needs an authenticated GitHub read: the studio shares one NAT ' +
        "egress IP, and unauthenticated reads exhaust GitHub's 60/hr budget in a handful of " +
        'PRs worth of /check-runs calls. See scripts/lib/github-fetch.mjs resolveGithubToken.',
    );
  }
  const ghToken = resolvedToken.token;

  const [openPrs, { tombstoneCandidates, allCandidates }, openIssuesForOwnership, agents, closedWakeIssues] =
    await Promise.all([
      ghFetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, ghToken),
      fetchTombstoneCandidates(apiBase, companyId, apiKey),
      fetchOpenIssuesForOwnershipCheck(apiBase, companyId, apiKey),
      fetchAgents(apiBase, companyId, apiKey),
      fetchClosedIssuesForSuppressionCheck(apiBase, companyId, apiKey),
    ]);

  const prContexts = [];
  for (const prSummary of openPrs) {
    prContexts.push(await fetchPrContext(repo, prSummary.number, ghToken));
  }

  const nowMs = Date.now();
  const tombstones = findTombstones(tombstoneCandidates);
  const referencedNumbers = tombstones.flatMap((issue) => referencedPrNumbers(issue));
  const prByNumber = await fetchPrLookup(repo, referencedNumbers, ghToken);
  const classifiedTombstones = classifyTombstones(tombstones, prByNumber);
  const unownedPrs = findUnownedPrs(prContexts, openIssuesForOwnership);
  const zeroPullable = zeroPullableWorkAlarm(openIssuesForOwnership, agents);
  const staleConfirmations = findStaleConfirmations(allCandidates, nowMs);
  const report = formatReport(classifiedTombstones, unownedPrs, repo, zeroPullable, staleConfirmations);

  if (!report) {
    console.log(
      `board-integrity detector: OK (${tombstoneCandidates.length} blocked/in_review candidate(s), ${openPrs.length} open PR(s) on ${repo}, no alarms)`,
    );
    return;
  }

  console.error(report);

  if (shouldPost) {
    const filed = await fileWakeTickets(
      apiBase,
      companyId,
      apiKey,
      classifiedTombstones,
      unownedPrs,
      openIssuesForOwnership,
      zeroPullable,
      staleConfirmations,
      closedWakeIssues,
      nowMs,
    );
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
  hasActiveRecoveryAction,
  hasLiveInteraction,
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
};
