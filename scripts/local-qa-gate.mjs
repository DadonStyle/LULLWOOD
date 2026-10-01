#!/usr/bin/env node
// LUL-5620: the founder's GitHub-queue rule ("local-qa tester comments
// PASS|FAIL before a version-cut PR merges", decisions/lul-5616-...) was
// enforced by nothing mechanical -- PR #947 merged 9s after human approval
// with zero local-qa comments and a cancelled combined-suite run (LUL-5612
// production outage). This script is the enforcement: it drives a
// required-status-check context named `local-qa` on version-cut PRs
// (release/next -> main) via the commit Statuses API.
//
// Two modes, selected by GITHUB_EVENT_NAME (set by the calling workflow):
//
//   pull_request (opened/reopened/synchronize, base=main): set `local-qa`
//   to pending on the PR's current head sha. Every push to release/next
//   re-fires `synchronize` on the open cut PR (same head branch), which
//   re-arms this to pending for the new sha -- a stale PASS for an old sha
//   can never carry a new sha across the gate.
//
//   issue_comment (created): parse the comment body for
//   `local-qa: PASS|FAIL @<sha>` (exact format posted by
//   shared/local-qa/bin/pr-e2e-watch.mjs). Confirm the issue is a PR whose
//   base is `main` and whose CURRENT head sha starts with the comment's
//   sha before setting success/failure -- a comment against an old sha
//   (superseded by a later push) must not move the gate.
//
// Required ruleset wiring (a one-time ruleset PATCH, see LUL-5620 ticket):
// main's required_status_checks must list {"context": "local-qa"} so
// GitHub blocks the merge button until this context is "success" for the
// PR's head sha. Land this file first, confirm it on release/next, THEN
// patch the ruleset -- patching first blocks any cut PR before this can
// ever report anything.
//
// Usage: node scripts/local-qa-gate.mjs
// Env: GITHUB_TOKEN (needs `statuses:write`, set via workflow `permissions:`),
//      GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH (standard
//      Actions env -- this only runs inside a workflow, unlike the other
//      scripts/*-check.mjs detectors which run against ambient `gh auth`).
import { readFileSync } from 'node:fs';
import { ghFetch, ghPost } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const VERDICT_RE = /local-qa:\s*(PASS|FAIL)\s*@([0-9a-f]{7,40})/i;

function loadEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH not set -- this script only runs inside a GitHub Actions workflow');
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

async function setStatus(repo, token, sha, state, description, targetUrl) {
  await ghPost(`https://api.github.com/repos/${repo}/statuses/${sha}`, token, {
    state,
    context: 'local-qa',
    description: description.slice(0, 140),
    ...(targetUrl ? { target_url: targetUrl } : {}),
  });
  console.log(`set local-qa=${state} on ${sha}: ${description}`);
}

async function handlePullRequest(repo, token, event) {
  const pr = event.pull_request;
  if (!pr) throw new Error('pull_request event with no pull_request payload');
  if (pr.base.ref !== 'main') {
    console.log(`PR #${pr.number} base is ${pr.base.ref}, not main -- local-qa gate does not apply, skipping`);
    return;
  }
  await setStatus(repo, token, pr.head.sha, 'pending', 'awaiting local-qa PASS|FAIL comment for this sha');
}

async function handleIssueComment(repo, token, event) {
  const { comment, issue } = event;
  if (!issue?.pull_request) {
    console.log('comment is on an issue, not a PR -- skipping');
    return;
  }
  if (comment?.author_association !== 'OWNER') {
    console.log(`comment author_association is ${comment?.author_association}, not OWNER -- this repo is public and the local-qa tester posts as the repo owner, so an untrusted commenter cannot flip the required status check -- ignoring`);
    return;
  }
  const match = (comment?.body || '').match(VERDICT_RE);
  if (!match) {
    console.log('comment does not match the local-qa verdict pattern -- skipping');
    return;
  }
  const [, verdictRaw, shaPrefix] = match;
  const pr = await ghFetch(`https://api.github.com/repos/${repo}/pulls/${issue.number}`, token);
  if (pr.base.ref !== 'main') {
    console.log(`PR #${issue.number} base is ${pr.base.ref}, not main -- local-qa gate does not apply, skipping`);
    return;
  }
  if (!pr.head.sha.startsWith(shaPrefix)) {
    console.log(`comment verdict is for ${shaPrefix}, PR head is now ${pr.head.sha} -- stale verdict for a superseded push, leaving gate as-is`);
    return;
  }
  const verdict = verdictRaw.toUpperCase();
  await setStatus(repo, token, pr.head.sha, verdict === 'PASS' ? 'success' : 'failure', comment.body, comment.html_url);
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = loadEvent();

  if (eventName === 'pull_request') {
    await handlePullRequest(repo, token, event);
  } else if (eventName === 'issue_comment') {
    await handleIssueComment(repo, token, event);
  } else {
    throw new Error(`unsupported GITHUB_EVENT_NAME: ${eventName}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
