#!/usr/bin/env node
// LUL-762: a workflow_dispatch (or any non-push/non-pull_request) run's
// check-runs attach to the commit -- visible, name-matched, app-matched,
// `success` on `GET /commits/{sha}/check-runs` -- but they never enter the
// PULL REQUEST's `statusCheckRollup`, which is the thing `PUT
// /pulls/{n}/merge` actually evaluates. That gap made three open PRs
// (#148/#149/#150) permanently unmergeable while every REST view of their
// head commit looked green: `mergeable_state` read `blocked`, not `dirty`
// or `unstable`, so nothing distinguished "still running" from "will never
// run under this event". See wiki playbooks/ci-green-from-workflow-dispatch
// and systems/ci-github-token-blind-spot.
//
// This detector reads the one field that reflects reality --
// `statusCheckRollup` contexts with `isRequired(pullRequestNumber)` -- and
// flags any open PR whose head has ZERO required contexts in that rollup
// once it's had time to appear. A PR mid-CI-run still shows its required
// contexts as PENDING in the rollup within seconds of the triggering push
// (measured); zero contexts after the grace period means no covering event
// ever ran, not that it hasn't finished yet.
//
// This is deliberately a cheap heuristic, not a Paperclip cross-reference:
// CI has no Paperclip credentials and should not be given any (LUL-523).
//
// Usage:
//   node scripts/check-required-check-gap.mjs
//
// Env:
//   GITHUB_TOKEN                      used read-only via the GraphQL API
//                                      (default Actions token has read access
//                                      on this public repo -- no PAT/secret
//                                      needed)
//   GITHUB_REPOSITORY                 "owner/repo", defaults to DadonStyle/LULLWOOD
//   REQUIRED_CHECK_GAP_GRACE_MINUTES  defaults to 5 (accepts 0 -- see note
//                                      on parseThresholdMinutes-alike below)
//
// Exits non-zero (and prints every offending PR) if any gap is found. Exits
// 0 with a one-line summary otherwise. No `|| true`, no `::warning::`
// downgrade -- standalone watchdog, not a required check on any ruleset; a
// red run here means "go look," never "block a merge".
import { pathToFileURL } from 'node:url';
import { ghFetch, ghGraphQL } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';
const DEFAULT_GRACE_MINUTES = 5;

const ROLLUP_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        title
        url
        commits(last: 1) {
          nodes {
            commit {
              committedDate
              statusCheckRollup {
                contexts(first: 50) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      isRequired(pullRequestNumber: $number)
                    }
                    ... on StatusContext {
                      context
                      isRequired(pullRequestNumber: $number)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Pure, unit-testable core. `rollups` is a list of
// { number, title, url, committedDate, requiredContextCount } -- already
// reduced from the GraphQL shape so the predicate doesn't need to know
// CheckRun-vs-StatusContext union details.
function findRequiredCheckGaps(rollups, nowMs, graceMinutes) {
  const gaps = [];
  for (const pr of rollups) {
    if (pr.requiredContextCount > 0) continue;

    const ageMinutes = (nowMs - Date.parse(pr.committedDate)) / 60_000;
    if (ageMinutes <= graceMinutes) continue;

    gaps.push({ number: pr.number, title: pr.title, url: pr.url, ageMinutes });
  }
  return gaps.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

function countRequiredContexts(contextNodes) {
  return contextNodes.filter((node) => node.isRequired).length;
}

function parseGraceMinutes(raw) {
  // Same "explicit 0 must not fall back" rule as check-merge-gap.mjs's
  // parseThresholdMinutes -- workflow_dispatch passes an empty string for an
  // omitted input, and that must mean "use the default", not coerce a real
  // 0 override back to it.
  if (raw === undefined || raw === '') return DEFAULT_GRACE_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_GRACE_MINUTES;
}

async function fetchRollups(repo, token) {
  const [owner, name] = repo.split('/');
  const listUrl = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`;
  const list = await ghFetch(listUrl, token);
  if (!Array.isArray(list)) {
    throw new Error(`GET ${listUrl} did not return an array (got: ${JSON.stringify(list).slice(0, 200)})`);
  }

  const rollups = [];
  for (const pr of list) {
    const data = await ghGraphQL(ROLLUP_QUERY, { owner, repo: name, number: pr.number }, token);
    const commitNode = data.repository.pullRequest.commits.nodes[0];
    const contextNodes = commitNode.commit.statusCheckRollup?.contexts.nodes ?? [];
    rollups.push({
      number: data.repository.pullRequest.number,
      title: data.repository.pullRequest.title,
      url: data.repository.pullRequest.url,
      committedDate: commitNode.commit.committedDate,
      requiredContextCount: countRequiredContexts(contextNodes),
    });
  }
  return rollups;
}

function formatAge(ageMinutes) {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  return `${(ageMinutes / 60).toFixed(1)}h`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const graceMinutes = parseGraceMinutes(process.env.REQUIRED_CHECK_GAP_GRACE_MINUTES);

  const rollups = await fetchRollups(repo, token);
  const gaps = findRequiredCheckGaps(rollups, Date.now(), graceMinutes);

  if (gaps.length > 0) {
    console.error('required-check-gap detector: FAILED');
    console.error(
      `found ${gaps.length} open PR(s) on ${repo} with ZERO required contexts in their statusCheckRollup, ` +
        `head commit older than ${graceMinutes}m -- structurally unmergeable, not just pending:`,
    );
    for (const gap of gaps) {
      console.error(`  - #${gap.number} "${gap.title}" -- head is ${formatAge(gap.ageMinutes)} old -- ${gap.url}`);
    }
    console.error(
      'This is the LUL-762 shape: a workflow_dispatch/other-event check-run can be green on the commit ' +
        'and still never enter the rollup PUT /pulls/{n}/merge evaluates. See wiki ' +
        'playbooks/ci-green-from-workflow-dispatch.',
    );
    process.exit(1);
  }

  console.log(
    `required-check-gap detector: OK (checked ${rollups.length} open PR(s) on ${repo}, ` +
      `grace period ${graceMinutes}m, no gaps found)`,
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`required-check-gap detector: ERROR: ${err.message}`);
    process.exit(2);
  });
}

export { findRequiredCheckGaps, parseGraceMinutes, countRequiredContexts };
