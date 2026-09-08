#!/usr/bin/env node
// LUL-549 (spec: LUL-523): built to catch review verdicts that landed on
// Paperclip but never reached GitHub natively -- LUL-511/PR #86 shipped with
// a `done` Paperclip review ticket and zero GitHub-native reviews, and
// nothing caught it mechanically (see wiki playbooks/review-protocol and
// LUL-519).
//
// LUL-780 retune: that original defect is now structurally impossible. Both
// `main` and `release/next` carry a branch ruleset with
// `required_approving_review_count: 1` and no bypass actors, so a PR cannot
// merge with zero native reviews at all -- measured 0 of the last 40 merged
// PRs did. The detector stayed useful for a different, real signal: a PR
// that has been open a long time with no first review and nobody owns it
// (the PR #128 shape, 87.8h to first review). It was red 99 of 102 runs
// because the 60-minute threshold sat below normal review turnaround --
// measured 12 of the last 33 merged PRs (36%) took over 60m to their first
// review, and all 12 merged fine. See wiki game/lul685-watchdog-wake-router
// for the measurement and game/lul780-review-gap-retune for this retune.
//
// This is deliberately a cheap heuristic, not a Paperclip cross-reference:
// CI has no Paperclip credentials and should not be given any (per LUL-523).
// Heuristic: any OPEN pull request with ZERO GitHub reviews that has been
// open longer than a threshold (default 360 minutes / 6 hours) is a gap
// worth a human look -- at that threshold, only the genuinely stalled PRs
// in the measured population (#123, #131, #128) would have fired.
//
// LUL-1111: a Tier-A-only PR (docs/**, *.md, e2e/**, *.test.*, comment-only,
// public/, copy -- AGENTS.md's development-first tiers) ships on green with
// no review by studio policy, so it is never a real gap and must not fire
// this detector. PR #240, which landed that policy, was itself Tier A and
// sat unreviewed for 55+ hours specifically because this detector had no
// notion of tier -- exactly the false-positive noise Tier A exists to
// eliminate. Reuses scripts/pr-tier.mjs's tierOf() (the same classifier
// tier-approve.yml uses) rather than re-deriving tier rules here. A PR with
// any non-Tier-A file (Tier B or C) still fires as before.
//
// Usage:
//   node scripts/check-review-gap.mjs
//
// Env:
//   GITHUB_TOKEN                  used read-only against the public REST API
//                                  (default Actions token has read access on
//                                  this public repo -- no PAT/secret needed)
//   GITHUB_REPOSITORY             "owner/repo", defaults to DadonStyle/LULLWOOD
//   REVIEW_GAP_THRESHOLD_MINUTES  defaults to 360
//
// Exits non-zero (and prints every offending PR) if any gap is found. Exits
// 0 with a one-line summary otherwise. No `|| true`, no `::warning::`
// downgrade -- a real gap must fail the run visibly (LUL-523 is explicit
// about this; this workflow is a standalone watchdog, not a required check,
// so a red run here means "go look," not "block a merge").
import { pathToFileURL } from 'node:url';
import { ghFetch } from './lib/github-fetch.mjs';
import { tierOf } from './pr-tier.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const DEFAULT_THRESHOLD_MINUTES = 360;

function reviewsFor(reviewsByPrNumber, prNumber) {
  if (reviewsByPrNumber instanceof Map) return reviewsByPrNumber.get(prNumber) ?? [];
  return reviewsByPrNumber[prNumber] ?? [];
}

// `filesByPrNumber` is optional (existing callers/tests that omit it entirely
// get `null` back here, meaning "unknown" -- never skip on unknown data).
function filesFor(filesByPrNumber, prNumber) {
  if (!filesByPrNumber) return null;
  if (filesByPrNumber instanceof Map) return filesByPrNumber.get(prNumber) ?? null;
  return filesByPrNumber[prNumber] ?? null;
}

// `files` is the shape of GitHub's `GET /pulls/{n}/files` response (needs
// `.filename`). Empty/missing files list is never Tier-A-only -- fail open
// to "still a candidate gap" rather than silently skipping on no data.
function isTierAOnly(files) {
  if (!files || files.length === 0) return false;
  return files.every((f) => tierOf(f.filename) === 'A');
}

// Pure, unit-testable core. `openPrs` is the shape of GitHub's
// `GET /pulls?state=open` response (needs number/title/html_url/created_at).
// `reviewsByPrNumber` maps a PR number to that PR's `GET /pulls/{n}/reviews`
// array (or is empty/absent for a PR with no reviews at all). `filesByPrNumber`
// (optional) maps a PR number to its `GET /pulls/{n}/files` array; a PR whose
// every changed file classifies Tier A is skipped (LUL-1111 -- Tier A ships on
// green with no review by policy, so it's never a real gap). Returns the list
// of gap PRs, oldest-first.
function findReviewGaps(openPrs, reviewsByPrNumber, nowMs, thresholdMinutes, filesByPrNumber) {
  const gaps = [];
  for (const pr of openPrs) {
    const reviews = reviewsFor(reviewsByPrNumber, pr.number);
    if (reviews.length > 0) continue;

    if (isTierAOnly(filesFor(filesByPrNumber, pr.number))) continue;

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
  const filesByPrNumber = new Map();
  for (const pr of openPrs) {
    const reviews = await ghFetch(
      `https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`,
      token,
    );
    reviewsByPrNumber.set(pr.number, reviews);

    const files = await ghFetch(
      `https://api.github.com/repos/${repo}/pulls/${pr.number}/files?per_page=100`,
      token,
    );
    filesByPrNumber.set(pr.number, files);
  }

  return { openPrs, reviewsByPrNumber, filesByPrNumber };
}

function formatAge(ageMinutes) {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  return `${(ageMinutes / 60).toFixed(1)}h`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const thresholdMinutes = Number(process.env.REVIEW_GAP_THRESHOLD_MINUTES) || DEFAULT_THRESHOLD_MINUTES;

  const { openPrs, reviewsByPrNumber, filesByPrNumber } = await fetchOpenPrsAndReviews(repo, token);
  const gaps = findReviewGaps(openPrs, reviewsByPrNumber, Date.now(), thresholdMinutes, filesByPrNumber);

  if (gaps.length > 0) {
    console.error('review-gap detector: FAILED');
    console.error(
      `found ${gaps.length} open PR(s) on ${repo} with zero GitHub reviews, open longer than ${thresholdMinutes}m:`,
    );
    for (const gap of gaps) {
      console.error(`  - #${gap.number} "${gap.title}" -- open ${formatAge(gap.ageMinutes)} -- ${gap.url}`);
    }
    console.error(
      'No first review past the threshold -- the review ticket for this PR is likely missing or unassigned. See wiki game/lul685-watchdog-wake-router.',
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

export { findReviewGaps, fetchOpenPrsAndReviews, DEFAULT_THRESHOLD_MINUTES };
