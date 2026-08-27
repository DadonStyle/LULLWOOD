#!/usr/bin/env node
// LUL-826. When `bot-approve.yml` refuses because a ruleset-required context
// is ABSENT from the PR's `statusCheckRollup`, this says *why* -- because the
// bare message "absent from the PR rollup" is ambiguous between four causes
// with four different remedies, and the ambiguity is expensive.
//
// It cost two agents ~2h on PR #166 (LUL-796, head `dfca6915`). The rollup
// showed 2 contexts (Vercel only) while REST `GET /commits/{sha}/check-runs`
// showed all 5 completed/success, each carrying `pull_requests: [166]` at both
// run and suite level. That looks exactly like a GitHub GraphQL/REST
// inconsistency, and LUL-826 was originally filed as one, proposing that
// bot-approve.yml fall back to the REST check-runs endpoint.
//
// It is not an inconsistency and that fallback would have been a merge-gate
// bypass. `PUT /pulls/166/merge` answered, at the same moment:
//
//     Repository rule violations found
//     At least 1 approving review is required by reviewers with write access.
//     3 of 3 required status checks are expected.
//
// GitHub's own merge engine agreed with the rollup: the three green check-runs
// did not count. They were produced by `workflow_dispatch` runs (33042966070,
// 33042967322). A non-PR-event check-run attaches to the COMMIT -- visible,
// name-matched, app-matched, `success` on `/commits/{sha}/check-runs`, and even
// carrying a `pull_requests` array -- but it never enters the PULL REQUEST's
// rollup and can never satisfy a required status check. That is LUL-762,
// already documented in `check-required-check-gap.mjs` and wiki
// `systems/ci-github-token-blind-spot`; the missing piece was that nothing
// SAID so at the moment of refusal.
//
// Control (measured, same session): merged PRs #171/#165/#170 all had their
// checks produced by `push` events and all showed `totalCount: 7` in the
// rollup. The discriminator is the producing event, nothing else.
//
// So: this script never grants credit. `bot-approve.yml` still decides purely
// on the rollup -- the REST endpoints are read here for EXPLANATION only.
// Adding a REST fallback to the approval path would record approvals on PRs
// that GitHub will still refuse to merge, which is strictly worse than
// refusing: it converts a loud stop into a silent one.
//
// Usage (from bot-approve.yml, only on the refusal path):
//   REQUIRED_FILE=required.txt PR=166 HEAD_SHA=dfca6915... \
//     node scripts/diagnose-required-check-absence.mjs
//
// Env:
//   GITHUB_REPOSITORY  "owner/repo", defaults to DadonStyle/LULLWOOD
//   REQUIRED_FILE      newline-separated ruleset-required contexts
//   PR                 pull request number
//   HEAD_SHA           the PR head sha the rollup was read from
//   GITHUB_TOKEN       read-only; resolved through the standard chain
//
// Always exits 0. This is a diagnostic printed alongside an already-fatal
// error; it must never be the thing that decides the run's conclusion, and it
// must never mask bot-approve.yml's own non-zero exit.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { ghFetch, ghGraphQL, resolveGithubToken } from './lib/github-fetch.mjs';

const DEFAULT_REPO = 'DadonStyle/LULLWOOD';

// The only events whose check-runs GitHub attaches to a PULL REQUEST rather
// than to the bare commit. Anything outside this set -- workflow_dispatch,
// schedule, workflow_run, repository_dispatch -- produces check-runs that are
// green on `/commits/{sha}/check-runs` and invisible to the merge gate.
const ROLLUP_EVENTS = new Set(['push', 'pull_request', 'pull_request_target', 'merge_group']);

const ROLLUP_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name }
                    ... on StatusContext { context }
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

// Pure. `checkRuns` and `workflowRuns` are the REST shapes narrowed to what
// matters; `rollupNames` is what the PR's rollup actually reported.
function diagnoseAbsences({ required, rollupNames, checkRuns, workflowRuns }) {
  const present = new Set(rollupNames);
  const eventBySuite = new Map(workflowRuns.map((r) => [r.checkSuiteId, r]));

  return required
    .filter((context) => !present.has(context))
    .map((context) => {
      const runs = checkRuns.filter((r) => r.name === context);
      if (runs.length === 0) {
        return {
          context,
          cause: 'never-ran',
          detail: `no check-run named '${context}' exists on this head at all`,
          remedy:
            'CI never ran on this head. Push a real commit to the head branch (with the studio PAT / deploy key, not GITHUB_TOKEN) and wait for the push run.',
        };
      }

      // Resolve the producing event per run. A check-run whose workflow run
      // isn't in the window is treated as unknown, never as eligible -- an
      // unknown must not be reported as the benign case.
      const events = runs.map((r) => eventBySuite.get(r.checkSuiteId)?.event ?? null);
      const sources = runs
        .map((r, i) => {
          const wr = eventBySuite.get(r.checkSuiteId);
          return wr ? `${wr.name} run ${wr.id} (event=${events[i]})` : `check-suite ${r.checkSuiteId} (event unknown)`;
        })
        .join(', ');

      const pending = runs.filter((r) => r.status !== 'completed');
      if (pending.length > 0) {
        return {
          context,
          cause: 'pending',
          detail: `${pending.length} of ${runs.length} run(s) still ${pending[0].status}: ${sources}`,
          remedy: 'Still running. Re-dispatch bot-approve.yml once the check reports; nothing is broken.',
        };
      }

      const failed = runs.filter((r) => r.conclusion !== 'success');
      if (failed.length > 0) {
        return {
          context,
          cause: 'failed',
          detail: `conclusion=${failed.map((r) => r.conclusion).join('/')}: ${sources}`,
          remedy: 'The check is red on this head. Fix the failure; do not re-dispatch bot-approve.yml.',
        };
      }

      // Green on the commit, absent from the rollup. The discriminator is
      // whether a rollup-eligible event produced it.
      if (events.every((e) => e !== null && !ROLLUP_EVENTS.has(e))) {
        return {
          context,
          cause: 'non-pr-event',
          detail: `green on the COMMIT but produced by a non-PR event -- ${sources}`,
          remedy:
            "LUL-762: a check-run from workflow_dispatch/schedule/workflow_run attaches to the commit, not to the PR, so it can NEVER satisfy a required status check no matter how green it looks. Re-dispatching this workflow cannot help. The usual root cause is a backmerge committed through the GitHub API with GITHUB_TOKEN, whose recursion guard suppresses the push run. Remedy: push a commit to the head branch with the studio PAT / deploy key so a real push-event run exists on the head the ruleset evaluates.",
        };
      }

      return {
        context,
        cause: 'unexplained',
        detail: `green on the commit from a rollup-eligible event, yet absent from the rollup -- ${sources}`,
        remedy:
          'This is the shape LUL-826 was originally filed as and did NOT turn out to be. If you actually see it, re-measure `PUT /pulls/{n}/merge` and quote its rule-violation body before proposing any change to the approval path.',
      };
    });
}

function readRequired(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function formatReport(findings) {
  if (findings.length === 0) {
    return ['::notice::no ruleset-required context is missing from the rollup; the refusal is about a non-SUCCESS state, not an absence.'];
  }
  return findings.flatMap((f) => [
    `::error::required check '${f.context}' is ABSENT from the PR rollup -- cause: ${f.cause}`,
    `  what was measured: ${f.detail}`,
    `  remedy: ${f.remedy}`,
  ]);
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const [owner, name] = repo.split('/');
  const number = Number(process.env.PR);
  const headSha = process.env.HEAD_SHA;
  const required = readRequired(process.env.REQUIRED_FILE || 'required.txt');

  const resolved = resolveGithubToken();
  const token = resolved?.token;

  const [rollupData, checkRunsBody, runsBody] = await Promise.all([
    ghGraphQL(ROLLUP_QUERY, { owner, repo: name, number }, token),
    ghFetch(`https://api.github.com/repos/${repo}/commits/${headSha}/check-runs?per_page=100`, token),
    ghFetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${headSha}&per_page=100`, token),
  ]);

  const contexts =
    rollupData.repository.pullRequest.commits.nodes[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const rollupNames = contexts.map((c) => c.name ?? c.context).filter(Boolean);

  const checkRuns = (checkRunsBody.check_runs ?? []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    checkSuiteId: r.check_suite?.id,
  }));
  const workflowRuns = (runsBody.workflow_runs ?? []).map((r) => ({
    checkSuiteId: r.check_suite_id,
    event: r.event,
    name: r.name,
    id: r.id,
  }));

  console.log(`rollup reported ${rollupNames.length} context(s): ${rollupNames.join(', ') || '(none)'}`);
  for (const line of formatReport(diagnoseAbsences({ required, rollupNames, checkRuns, workflowRuns }))) {
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Diagnostic-only: never let a failure here change the run's conclusion or
  // bury the real refusal that bot-approve.yml already emitted.
  main().catch((err) => {
    console.log(`::warning::could not diagnose the rollup absence: ${err.message}`);
  });
}

export { diagnoseAbsences, formatReport, ROLLUP_EVENTS };
