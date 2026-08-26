#!/usr/bin/env node
// LUL-729 (spec: LUL-719, parent LUL-610). Detector for the required-status-
// check bypass measured live on PR #137 (head b07aa589, wiki
// systems/ci-double-run "MEASURED 2026-08-26"): branch protection resolves a
// required check by its LATEST instance per context name and treats
// `skipped` as satisfying it. A workflow that publishes two check-runs under
// the same name for one head SHA -- a real instance, then a later `skipped`
// one -- lets the skip silently supersede the real result, including a real
// `failure`. LUL-729's root-cause fix removed the `pull_request` trigger
// that produced this shape from ci.yml and workflow-guard-check.yml, but
// this script exists as the regression guard: any workflow file (present or
// future) that reintroduces the pattern should get caught here rather than
// rediscovered live on a PR.
//
// Usage:
//   node scripts/check-check-run-collisions.mjs
//
// Env:
//   GITHUB_TOKEN              used read-only against the public REST API
//                              (default Actions token has read access on
//                              this public repo -- no PAT/secret needed)
//   GITHUB_REPOSITORY         "owner/repo", defaults to DadonStyle/LULLWOOD
//   CHECK_RUN_COLLISION_SHA   the head commit SHA to inspect. Required --
//                              no default, since there is no sha that is
//                              always correct to fall back to.
//
// Fetches the actual required-status-checks contexts from both main's and
// release/next's rulesets and only fails on a collision in that set -- a
// context that collides the same way but was never required (e.g.
// automerge.yml's "merge if green and shipped", which self-skips by design
// for non-push CI completions and cannot bypass any gate) is logged as
// informational, not a failure. Exits non-zero if any REQUIRED context's
// latest instance at the given SHA is `skipped` while an earlier instance of
// that same name already completed with a real conclusion. Exits 0
// otherwise. This is a standalone watchdog, not (yet) a required check
// itself -- see the matching workflow file's header for why.
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';

// Pure, unit-testable core. `checkRuns` is the shape of GitHub's
// `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` response's
// `check_runs` array (needs name/status/conclusion/started_at).
// `requiredNames` is an optional Set/array of context names that are
// actually required by branch protection -- when given, each returned
// collision is annotated `required: true/false` so a caller can choose to
// fail only on the ones that can actually bypass a merge gate. When omitted,
// every collision is treated as required (matches the ticket's literal
// wording, and is the safe default for a caller that hasn't fetched the
// ruleset). Returns the list of colliding context names, each with the
// earlier real instance and the later skip that masks it.
function findCollisions(checkRuns, requiredNames) {
  const required = requiredNames ? new Set(requiredNames) : null;

  const byName = new Map();
  for (const run of checkRuns) {
    if (!byName.has(run.name)) byName.set(run.name, []);
    byName.get(run.name).push(run);
  }

  const collisions = [];
  for (const [name, runs] of byName) {
    if (runs.length < 2) continue;

    const sorted = [...runs].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    const latest = sorted[sorted.length - 1];
    if (latest.status !== 'completed' || latest.conclusion !== 'skipped') continue;

    const earlierReal = sorted
      .slice(0, -1)
      .filter((r) => r.status === 'completed' && r.conclusion && r.conclusion !== 'skipped');
    if (earlierReal.length === 0) continue;

    // The most recent real instance is the most relevant to report -- it is
    // the one the later skip actually supersedes for merge purposes.
    const maskedInstance = earlierReal[earlierReal.length - 1];
    collisions.push({
      name,
      maskedConclusion: maskedInstance.conclusion,
      maskedAt: maskedInstance.started_at,
      laterSkippedAt: latest.started_at,
      required: required ? required.has(name) : true,
    });
  }

  return collisions.sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchRequiredContexts(repo, branch, token) {
  const url = `https://api.github.com/repos/${repo}/rules/branches/${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  const rules = await res.json();
  const names = new Set();
  for (const rule of rules) {
    if (rule.type !== 'required_status_checks') continue;
    for (const check of rule.parameters?.required_status_checks ?? []) {
      names.add(check.context);
    }
  }
  return names;
}

async function fetchAllCheckRuns(repo, sha, token) {
  const runs = [];
  let page = 1;
  for (;;) {
    const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count || body.check_runs.length === 0) break;
    page += 1;
  }
  return runs;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.CHECK_RUN_COLLISION_SHA;

  if (!sha) {
    console.error('check-run-collision detector: ERROR: CHECK_RUN_COLLISION_SHA is not set.');
    process.exit(2);
  }

  // Union of both rulesets a head could be merging toward -- a collision on
  // a context required by either branch can bypass that branch's gate.
  const [mainRequired, releaseRequired, checkRuns] = await Promise.all([
    fetchRequiredContexts(repo, 'main', token),
    fetchRequiredContexts(repo, 'release/next', token),
    fetchAllCheckRuns(repo, sha, token),
  ]);
  const requiredNames = new Set([...mainRequired, ...releaseRequired]);

  const collisions = findCollisions(checkRuns, requiredNames);
  const blocking = collisions.filter((c) => c.required);
  const informational = collisions.filter((c) => !c.required);

  const describe = (c) =>
    `  - "${c.name}": real "${c.maskedConclusion}" @ ${c.maskedAt}, then "skipped" @ ${c.laterSkippedAt}`;

  if (informational.length > 0) {
    console.log(
      `check-run-collision detector: ${informational.length} non-required context(s) show the same ` +
        `shape but cannot bypass a merge gate (not in either branch's required-status-checks list):`,
    );
    for (const c of informational) console.log(describe(c));
  }

  if (blocking.length > 0) {
    console.error('check-run-collision detector: FAILED');
    console.error(
      `${repo}@${sha}: found ${blocking.length} REQUIRED context(s) where a later 'skipped' ` +
        `instance landed on top of an earlier real result:`,
    );
    for (const c of blocking) console.error(describe(c));
    console.error(
      'Branch protection resolves a required check by its LATEST instance and treats skipped ' +
        'as passing -- this masks the real result. See wiki systems/ci-double-run (LUL-719/LUL-729).',
    );
    process.exit(1);
  }

  console.log(
    `check-run-collision detector: OK (checked ${checkRuns.length} check-run(s) on ${repo}@${sha}, ` +
      `${requiredNames.size} required context(s), no blocking collisions found)`,
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`check-run-collision detector: ERROR: ${err.message}`);
    process.exit(2);
  });
}

export { findCollisions, fetchAllCheckRuns, fetchRequiredContexts };
