#!/usr/bin/env node
// LUL-1041: the release train squash-merges in both directions, and a squash
// discards the second parent -- `main` picks up `release/next`'s *content*
// with none of its *commit ids*. That leaves the two branches with no shared
// ancestor newer than the last real merge, so every subsequent version-cut
// PR opens with a spurious conflict on anything both sides touched (measured
// twice: PR #222 and #223, wiki systems/release-train "Squashing a
// version-cut PR ... breaks the automated sync-back").
//
// This is the mechanical guard: a commit that is supposed to be a
// version-cut merge (or the main -> release/next sync-back that follows it)
// must have exactly two parents. One parent means something merged it with
// `--squash` (or fast-forwarded it) instead of `--merge`, silently
// reintroducing the ancestor gap. Checked right after every cut in
// version-cut-finalize.yml so a bad merge is caught within the same workflow
// run that produced it, not discovered at the next cut.
//
// Usage:
//   node scripts/assert-two-parent-merge.mjs <owner/repo> <sha>
//
// Env:
//   GITHUB_TOKEN / GH_TOKEN / ~/.lullwood/gh_token / `gh auth token` -- same
//   resolution chain as every other scripts/*.mjs (scripts/lib/github-fetch.mjs).
//
// Exits 0 and prints the parent count if the commit has >= 2 parents.
// Exits 1 with an actionable message if it does not. Exits 2 on a fetch error.
import { pathToFileURL } from 'node:url';
import { ghFetch, resolveGithubToken } from './lib/github-fetch.mjs';

// Pure, unit-testable core. `commit` is a GET /repos/{repo}/commits/{sha}
// response (or any object shaped like { parents: [...] }).
function hasTwoParents(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length >= 2;
}

async function fetchCommit(repo, sha, token) {
  const url = `https://api.github.com/repos/${repo}/commits/${sha}`;
  return ghFetch(url, token);
}

async function main() {
  const [repo, sha] = process.argv.slice(2);
  if (!repo || !sha) {
    console.error('usage: node scripts/assert-two-parent-merge.mjs <owner/repo> <sha>');
    process.exit(2);
  }

  const resolved = resolveGithubToken();
  const commit = await fetchCommit(repo, sha, resolved?.token);
  const parentCount = commit?.parents?.length ?? 0;

  if (!hasTwoParents(commit)) {
    console.error(`assert-two-parent-merge: FAILED -- ${sha} on ${repo} has ${parentCount} parent(s), expected >= 2.`);
    console.error(
      'This commit was supposed to land via a real merge commit (`gh pr merge --merge`), ' +
        'never `--squash` or a fast-forward. A squash here discards the second parent and ' +
        're-breaks the shared ancestor between main and release/next -- see wiki ' +
        'systems/release-train and LUL-1041.',
    );
    process.exit(1);
  }

  console.log(`assert-two-parent-merge: OK -- ${sha} on ${repo} has ${parentCount} parents.`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`assert-two-parent-merge: ERROR: ${err.message}`);
    process.exit(2);
  });
}

export { hasTwoParents, fetchCommit };
