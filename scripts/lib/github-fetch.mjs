// Shared authed-GitHub-GET helper. Extracted from board-integrity-check.mjs
// and check-review-gap.mjs, which each hand-rolled the same fetch-and-throw
// wrapper (flagged as a DRY hit on LUL-672's review, wiki
// game/lul672-board-integrity-detector). Every scripts/*-check.mjs detector
// that only needs a read-only GitHub REST call should use this instead of a
// fourth copy.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function ghFetch(url, token) {
  return fetchJson(url, {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

// LUL-736: `GITHUB_TOKEN` is not actually in any agent's environment -- no
// script here runs under GitHub Actions, which is the only thing that sets
// it automatically -- so every "optional token, unauthenticated reads still
// work" detector was silently going out unauthenticated against a public
// repo whose 60/hr rate limit is shared, from one NAT egress IP, across every
// agent in the fleet. A handful of `/check-runs` calls per open PR burns that
// budget fast. Resolve a real token through the chain the studio actually
// has before giving up:
//
//   GITHUB_TOKEN -> GH_TOKEN -> ~/.lullwood/gh_token -> `gh auth token`
//
// `gh` is authenticated as `DadonStyle` in the shared home for every agent
// (wiki systems/github-access, "shared-home-means-fleet-wide-fixes"), so the
// last link almost always resolves even with zero env vars set.
//
// The file-read and `gh` invocation are injectable so a test can exercise
// every branch -- including the terminal "nothing resolved" case -- without
// ever shelling out to `gh` or touching the real filesystem (LUL-736's own
// instruction: "do not shell out to gh inside a test").
const GITHUB_TOKEN_CHAIN_DESCRIPTION = 'GITHUB_TOKEN -> GH_TOKEN -> ~/.lullwood/gh_token -> `gh auth token`';

function defaultReadGhTokenFile() {
  return readFileSync(path.join(homedir(), '.lullwood', 'gh_token'), 'utf8');
}

function defaultRunGhAuthToken() {
  // stdio: pipe stderr too, so a failed `gh` (not installed, not
  // authenticated) doesn't spill its own raw CLI error onto this script's
  // console -- tryResolve() already turns that failure into a clean
  // fall-through, and main()'s own preflight message names the chain.
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function tryResolve(fn) {
  try {
    const value = (fn() ?? '').trim();
    return value || null;
  } catch {
    // Missing file, unreadable file, `gh` not installed, `gh` not
    // authenticated -- any of these just means this link is a dead end, not
    // a hard failure. Fall through to the next one.
    return null;
  }
}

function resolveGithubToken({
  env = process.env,
  readGhTokenFile = defaultReadGhTokenFile,
  runGhAuthToken = defaultRunGhAuthToken,
} = {}) {
  if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN, source: 'GITHUB_TOKEN' };
  if (env.GH_TOKEN) return { token: env.GH_TOKEN, source: 'GH_TOKEN' };

  const fromFile = tryResolve(readGhTokenFile);
  if (fromFile) return { token: fromFile, source: '~/.lullwood/gh_token' };

  const fromGh = tryResolve(runGhAuthToken);
  if (fromGh) return { token: fromGh, source: 'gh auth token' };

  return null;
}

export { fetchJson, ghFetch, resolveGithubToken, GITHUB_TOKEN_CHAIN_DESCRIPTION };
