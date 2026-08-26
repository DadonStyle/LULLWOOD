#!/usr/bin/env node
// LUL-549 (spec: LUL-523): detector for review verdicts that landed on
// Paperclip but never reached GitHub natively. LUL-511/PR #86 shipped with a
// `done` Paperclip review ticket and zero GitHub-native reviews, and nothing
// caught it mechanically -- see wiki playbooks/review-protocol and LUL-519.
//
// This is deliberately a cheap heuristic, not a Paperclip cross-reference:
// CI has no Paperclip credentials and should not be given any (per LUL-523).
// Heuristic the ticket sanctions: any OPEN pull request with ZERO GitHub
// reviews that has been open longer than a threshold (default 60 minutes)
// is a gap worth a human look.
//
// Usage:
//   node scripts/check-review-gap.mjs
//
// Env:
//   GITHUB_TOKEN                  used read-only against the public REST API
//                                  (default Actions token has read access on
//                                  this public repo -- no PAT/secret needed)
//   GITHUB_REPOSITORY             "owner/repo", defaults to DadonStyle/LULLWOOD
//   REVIEW_GAP_THRESHOLD_MINUTES  defaults to 60
//
// Exits non-zero (and prints every offending PR) if any gap is found. Exits
// 0 with a one-line summary otherwise. No `|| true`, no `::warning::`
// downgrade -- a real gap must fail the run visibly (LUL-523 is explicit
// about this; this workflow is a standalone watchdog, not a required check,
// so a red run here means "go look," not "block a merge").
import { pathToFileURL } from 'node:url';
import { ghFetch } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const DEFAULT_THRESHOLD_MINUTES = 60;

function reviewsFor(reviewsByPrNumber, prNumber) {
  if (reviewsByPrNumber instanceof Map) return reviewsByPrNumber.get(prNumber) ?? [];
  return reviewsByPrNumber[prNumber] ?? [];
}

// Pure, unit-testable core. `openPrs` is the shape of GitHub's
// `GET /pulls?state=open` response (needs number/title/html_url/created_at).
// `reviewsByPrNumber` maps a PR number to that PR's `GET /pulls/{n}/reviews`
// array (or is empty/absent for a PR with no reviews at all). Returns the
// list of gap PRs, oldest-first.
function findReviewGaps(openPrs, reviewsByPrNumber, nowMs, thresholdMinutes) {
  const gaps = [];
  for (const pr of openPrs) {
    const reviews = reviewsFor(reviewsByPrNumber, pr.number);
    if (reviews.length > 0) continue;

    const createdMs = Date.parse(pr.created_at);
    const ageMinutes = (nowMs - createdMs) / 60_000;
    if (ageMinutes <= thresholdMinutes) continue;

    gaps.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      createdAt: pr.created_at,
      ageMinutes,
    });
  }
  return gaps.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function fetchOpenPrsAndReviews(repo, token) {
  const openPrs = await ghFetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`,
    token,
  );

  const reviewsByPrNumber = new Map();
  for (const pr of openPrs) {
    const reviews = await ghFetch(
      `https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`,
      token,
    );
    reviewsByPrNumber.set(pr.number, reviews);
  }

  return { openPrs, reviewsByPrNumber };
}

function formatAge(ageMinutes) {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  return `${(ageMinutes / 60).toFixed(1)}h`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const thresholdMinutes = Number(process.env.REVIEW_GAP_THRESHOLD_MINUTES) || DEFAULT_THRESHOLD_MINUTES;

  const { openPrs, reviewsByPrNumber } = await fetchOpenPrsAndReviews(repo, token);
  const gaps = findReviewGaps(openPrs, reviewsByPrNumber, Date.now(), thresholdMinutes);

  if (gaps.length > 0) {
    console.error('review-gap detector: FAILED');
    console.error(
      `found ${gaps.length} open PR(s) on ${repo} with zero GitHub reviews, open longer than ${thresholdMinutes}m:`,
    );
    for (const gap of gaps) {
      console.error(`  - #${gap.number} "${gap.title}" -- open ${formatAge(gap.ageMinutes)} -- ${gap.url}`);
    }
    console.error(
      'A review verdict may have only reached Paperclip and not GitHub natively -- see wiki playbooks/review-protocol.',
    );
    process.exit(1);
  }

  console.log(
    `review-gap detector: OK (checked ${openPrs.length} open PR(s) on ${repo}, threshold ${thresholdMinutes}m, no gaps found)`,
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`review-gap detector: ERROR: ${err.message}`);
    process.exit(2);
  });
}

export { findReviewGaps, fetchOpenPrsAndReviews };
