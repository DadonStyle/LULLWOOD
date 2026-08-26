#!/usr/bin/env node
// LUL-684 (spec: LUL-628 part 2): sibling to scripts/check-review-gap.mjs.
// That detector catches a review verdict that never reached GitHub. This one
// catches the opposite failure: a review verdict that DID reach GitHub, the
// PR is clean, and nobody ever merged it.
//
// This is deliberately a cheap heuristic, not a Paperclip cross-reference:
// CI has no Paperclip credentials and should not be given any (per LUL-523).
//
// An open PR is a merge gap when ALL of:
//   1. pr.mergeable_state === 'clean' (never 'blocked' -- on this repo that
//      means a required check is still running/skipping, not "safe to
//      merge"; misreading it caused a false alarm on 2026-08-20).
//   2. At least one reviewer's LATEST review (resolved per user.login, most
//      recent submitted_at) is APPROVED. A later CHANGES_REQUESTED or
//      DISMISSED from the same login overrides an earlier approval -- do
//      not scan for "any APPROVED anywhere in the list".
//   3. That approval's commit_id equals pr.head.sha. An APPROVED review on a
//      stale commit is not an approval of what would actually merge.
//   4. The (most recent qualifying) approval is older than
//      MERGE_GAP_THRESHOLD_MINUTES (default 60). Age is measured from the
//      approval, not from PR creation -- "nobody reviewed it" and "nobody
//      merged it" are different problems.
//
// Usage:
//   node scripts/check-merge-gap.mjs
//
// Env:
//   GITHUB_TOKEN                 used read-only against the public REST API
//                                 (default Actions token has read access on
//                                 this public repo -- no PAT/secret needed)
//   GITHUB_REPOSITORY            "owner/repo", defaults to DadonStyle/LULLWOOD
//   MERGE_GAP_THRESHOLD_MINUTES  defaults to 60 (accepts 0 -- see note below)
//
// Exits non-zero (and prints every offending PR) if any gap is found. Exits
// 0 with a one-line summary otherwise. No `|| true`, no `::warning::`
// downgrade -- standalone watchdog, not a required check on any ruleset; a
// red run here means "go look," never "block a merge".
import { pathToFileURL } from 'node:url';
import { ghFetch } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const DEFAULT_THRESHOLD_MINUTES = 60;

function reviewsFor(reviewsByPrNumber, prNumber) {
  if (reviewsByPrNumber instanceof Map) return reviewsByPrNumber.get(prNumber) ?? [];
  return reviewsByPrNumber[prNumber] ?? [];
}

// Resolve one review per user.login: the review with the latest submitted_at
// wins, so a later CHANGES_REQUESTED/DISMISSED overrides an earlier APPROVED
// from the same person (the #115 shape).
function latestReviewPerLogin(reviews) {
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user && review.user.login;
    if (!login) continue;
    const existing = latest.get(login);
    if (!existing || Date.parse(review.submitted_at) > Date.parse(existing.submitted_at)) {
      latest.set(login, review);
    }
  }
  return [...latest.values()];
}

// Pure, unit-testable core. `openPrs` is a list of GitHub single-PR objects
// (GET /pulls/{number} shape -- needs number/title/html_url/mergeable_state/
// head.sha; the list endpoint does NOT carry mergeable_state, so the CLI
// wrapper fetches each PR individually). `reviewsByPrNumber` maps a PR
// number to that PR's GET /pulls/{n}/reviews array. Returns the list of gap
// PRs, oldest-approval-first.
function findMergeGaps(openPrs, reviewsByPrNumber, nowMs, thresholdMinutes) {
  const gaps = [];
  for (const pr of openPrs) {
    if (pr.mergeable_state !== 'clean') continue;

    const reviews = reviewsFor(reviewsByPrNumber, pr.number);
    const headSha = pr.head && pr.head.sha;
    const approvalsAtHead = latestReviewPerLogin(reviews).filter(
      (review) => review.state === 'APPROVED' && review.commit_id === headSha,
    );
    if (approvalsAtHead.length === 0) continue;

    const approvedAtMs = Math.max(
      ...approvalsAtHead.map((review) => Date.parse(review.submitted_at)),
    );
    const ageMinutes = (nowMs - approvedAtMs) / 60_000;
    if (ageMinutes <= thresholdMinutes) continue;

    gaps.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      approvedAt: new Date(approvedAtMs).toISOString(),
      ageMinutes,
    });
  }
  return gaps.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

// A rate-limited or error reply can still parse as valid JSON that is not an
// array (e.g. a message object), and an unguarded `for` loop over that
// reports success on an empty body -- a green run that checked nothing.
function assertArray(data, url) {
  if (!Array.isArray(data)) {
    const preview = JSON.stringify(data).slice(0, 200);
    throw new Error(`GET ${url} did not return an array (got: ${preview})`);
  }
  return data;
}

async function fetchOpenPrsWithDetail(repo, token) {
  const listUrl = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`;
  const list = assertArray(await ghFetch(listUrl, token), listUrl);

  const detailed = [];
  for (const pr of list) {
    // The list endpoint does not include mergeable_state; only the
    // single-PR endpoint computes and returns it.
    detailed.push(await ghFetch(`https://api.github.com/repos/${repo}/pulls/${pr.number}`, token));
  }
  return detailed;
}

async function fetchMergeGapData(repo, token) {
  const openPrs = await fetchOpenPrsWithDetail(repo, token);

  const reviewsByPrNumber = new Map();
  for (const pr of openPrs) {
    const url = `https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`;
    reviewsByPrNumber.set(pr.number, assertArray(await ghFetch(url, token), url));
  }

  return { openPrs, reviewsByPrNumber };
}

function formatAge(ageMinutes) {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  return `${(ageMinutes / 60).toFixed(1)}h`;
}

function parseThresholdMinutes(raw) {
  // Unset (undefined) and "not provided" (workflow_dispatch passes an empty
  // string for an omitted input) both mean "use the default". An explicit
  // '0' must NOT fall back, though -- `Number(raw) || DEFAULT` would
  // silently coerce an intentional 0 back to 60, which specifically breaks
  // the "prove it fails in situ" workflow_dispatch override.
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_THRESHOLD_MINUTES;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const thresholdMinutes = parseThresholdMinutes(process.env.MERGE_GAP_THRESHOLD_MINUTES);

  const { openPrs, reviewsByPrNumber } = await fetchMergeGapData(repo, token);
  const gaps = findMergeGaps(openPrs, reviewsByPrNumber, Date.now(), thresholdMinutes);

  if (gaps.length > 0) {
    console.error('merge-gap detector: FAILED');
    console.error(
      `found ${gaps.length} open PR(s) on ${repo}, clean and approved at head, unmerged longer than ${thresholdMinutes}m:`,
    );
    for (const gap of gaps) {
      console.error(`  - #${gap.number} "${gap.title}" -- approved ${formatAge(gap.ageMinutes)} ago -- ${gap.url}`);
    }
    console.error('A clean, approved PR is sitting unmerged -- see wiki systems/lul549-review-gap-detector.');
    process.exit(1);
  }

  console.log(
    `merge-gap detector: OK (checked ${openPrs.length} open PR(s) on ${repo}, threshold ${thresholdMinutes}m, no gaps found)`,
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`merge-gap detector: ERROR: ${err.message}`);
    process.exit(2);
  });
}

export { findMergeGaps, fetchMergeGapData, parseThresholdMinutes };
