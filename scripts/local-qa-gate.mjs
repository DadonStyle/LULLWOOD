#!/usr/bin/env node
// LUL-5620: the founder's GitHub-queue rule ("local-qa tester comments
// PASS|FAIL before a version-cut PR merges", decisions/lul-5616-...) was
// enforced by nothing mechanical -- PR #947 merged 9s after human approval
// with zero local-qa comments and a cancelled combined-suite run (LUL-5612
// production outage). This script is the enforcement: it drives a
// required-status-check context named `local-qa` on version-cut PRs
// (release/next -> main) via the commit Statuses API.
//
// Three modes, selected by GITHUB_EVENT_NAME (set by the calling workflow):
//
//   pull_request (opened/reopened/synchronize, base=main): set `local-qa`
//   to pending on the PR's current head sha. Every push to release/next
//   re-fires `synchronize` on the open cut PR (same head branch), which
//   re-arms this to pending for the new sha -- a stale PASS for an old sha
//   can never carry a new sha across the gate.
//
//   LUL-6086: a `pull_request` run queued by GitHub Actions can execute
//   *after* an `issue_comment` run for the SAME sha has already landed the
//   real success/failure verdict -- e.g. version-cut.yml refreshes the cut
//   PR, queuing a `pull_request` run that a slow runner delays by 15+
//   minutes, while the tester's PASS|FAIL comment lands and is processed in
//   the meantime. Unconditionally re-arming to pending in that window
//   clobbers the real verdict back to pending with no new sha to justify it,
//   and nothing ever re-fires to set it back. handlePullRequest() guards
//   this by reading the current `local-qa` status for the sha first and
//   no-op'ing if it is already success/failure -- only a genuinely new or
//   still-pending sha gets (re-)armed.
//
//   LUL-5775: a direct-to-main PR (any head branch other than release/next)
//   carrying the `emergency-hotfix` label auto-passes instead of arming
//   pending. The nightly tester (shared/local-qa/bin/pr-e2e-watch.mjs,
//   founder-owned, outside this repo) only ever watches the
//   release/next->main version-cut pattern, so a direct hotfix's `pending`
//   has no path to `success` -- without this, the required `local-qa`
//   context (ruleset 20886790, bypass_actors=[]) makes every such PR
//   permanently unmergeable regardless of review/CI state. The explicit
//   head-ref guard keeps this from ever firing on the real version-cut PR
//   even if someone mislabels it; the label is reviewed trust (Code
//   Reviewer approval + all required CI checks still gate the merge) in
//   place of the tester, which this PR shape can never reach.
//
//   issue_comment (created): parse the comment body for
//   `local-qa: PASS|FAIL @<sha>` (exact format posted by
//   shared/local-qa/bin/pr-e2e-watch.mjs). Confirm the issue is a PR whose
//   base is `main` and whose CURRENT head sha starts with the comment's
//   sha before setting success/failure -- a comment against an old sha
//   (superseded by a later push) must not move the gate.
//
//   workflow_dispatch: manual admin trigger, two independent uses selected
//   by which inputs are set --
//     - inputs.sha + inputs.verdict (PASS|FAIL): set `local-qa` directly to
//       success/failure on that sha, the same effect issue_comment would
//       have. LUL-5660: GitHub resolves repo-level-event triggers like
//       issue_comment from the DEFAULT BRANCH's copy of the workflow file,
//       not the PR's head/base ref -- so the very first version-cut PR that
//       lands this workflow on main has no issue_comment listener for its
//       own sha and the tester's real PASS|FAIL comment is a structural
//       no-op. This input lets an admin manually replay that comment's
//       verdict once the gate is bootstrapped. No PR-head-match check (the
//       issue_comment path's staleness guard) applies here -- it's a
//       deliberate one-sha admin write, not an automatic listener.
//     - inputs.pr_number (no sha/verdict): back-fill a pending status for a
//       PR's current head, e.g. right after this workflow first lands, or
//       (LUL-5775) re-arm an already-open direct-to-main PR to the
//       emergency-hotfix auto-pass after the label is added post-hoc --
//       the label alone does nothing until the next real push re-fires
//       `synchronize`, so this path re-checks it the same way.
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
import { pathToFileURL } from 'node:url';
import { ghFetch, ghPost } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const VERDICT_RE = /local-qa:\s*(PASS|FAIL)\s*@([0-9a-f]{7,40})/i;
const EMERGENCY_HOTFIX_LABEL = 'emergency-hotfix';

function loadEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH not set -- this script only runs inside a GitHub Actions workflow');
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

function isEmergencyHotfix(pr) {
  return pr.base.ref === 'main' && pr.head.ref !== 'release/next' && (pr.labels || []).some((l) => l.name === EMERGENCY_HOTFIX_LABEL);
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

// LUL-6086: the combined-status endpoint dedupes to the latest status per
// context, which is exactly "what does `local-qa` currently say for this
// sha" -- the same question cut-merge.yml's required check answers off.
async function getLatestLocalQaState(repo, token, sha) {
  const combined = await ghFetch(`https://api.github.com/repos/${repo}/commits/${sha}/status`, token);
  const match = (combined.statuses || []).find((s) => s.context === 'local-qa');
  return match ? match.state : null;
}

async function handlePullRequest(repo, token, event) {
  const pr = event.pull_request;
  if (!pr) throw new Error('pull_request event with no pull_request payload');
  if (pr.base.ref !== 'main') {
    console.log(`PR #${pr.number} base is ${pr.base.ref}, not main -- local-qa gate does not apply, skipping`);
    return;
  }
  if (isEmergencyHotfix(pr)) {
    await setStatus(repo, token, pr.head.sha, 'success', `local-qa: auto-pass -- emergency-hotfix label, gated by Code Reviewer approval + required CI checks instead of the tester`);
    return;
  }
  const existingState = await getLatestLocalQaState(repo, token, pr.head.sha);
  if (existingState === 'success' || existingState === 'failure') {
    console.log(`local-qa is already ${existingState} for ${pr.head.sha} (a newer issue_comment verdict already landed) -- this pull_request run was delayed in the Actions queue, not re-arming to pending`);
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

async function handleWorkflowDispatch(repo, token, event) {
  const inputs = event.inputs || {};
  if (inputs.sha && inputs.verdict) {
    const verdict = inputs.verdict.toUpperCase();
    if (verdict !== 'PASS' && verdict !== 'FAIL') {
      throw new Error(`verdict input must be PASS or FAIL, got: ${inputs.verdict}`);
    }
    await setStatus(
      repo,
      token,
      inputs.sha,
      verdict === 'PASS' ? 'success' : 'failure',
      `manual workflow_dispatch replay: local-qa: ${verdict} @${inputs.sha}`,
    );
    return;
  }
  if (inputs.pr_number) {
    const pr = await ghFetch(`https://api.github.com/repos/${repo}/pulls/${inputs.pr_number}`, token);
    if (isEmergencyHotfix(pr)) {
      await setStatus(repo, token, pr.head.sha, 'success', `local-qa: auto-pass -- emergency-hotfix label, gated by Code Reviewer approval + required CI checks instead of the tester`);
      return;
    }
    await setStatus(repo, token, pr.head.sha, 'pending', 'awaiting local-qa PASS|FAIL comment for this sha');
    return;
  }
  console.log('workflow_dispatch with no sha+verdict and no pr_number -- nothing to do');
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
  } else if (eventName === 'workflow_dispatch') {
    await handleWorkflowDispatch(repo, token, event);
  } else {
    throw new Error(`unsupported GITHUB_EVENT_NAME: ${eventName}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

export { handlePullRequest, handleIssueComment, handleWorkflowDispatch, getLatestLocalQaState, isEmergencyHotfix };
