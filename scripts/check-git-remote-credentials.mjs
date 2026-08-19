#!/usr/bin/env node
// LUL-445: guard against a repeat of LUL-221/LUL-238/LUL-438 -- a git remote
// URL with a GitHub credential embedded in plaintext, which then gets echoed
// into a run transcript by an innocent `git remote -v`. See wiki
// decisions/0011-pat-leaked-via-remote-url for the incident history.
//
// Usage:
//   node scripts/check-git-remote-credentials.mjs [--repo <path>]... [--config <file>]...
//
// With no arguments, checks the repo this script lives in plus every
// worktree `git worktree list` reports for it (the shared checkout and every
// worktree hanging off it, per the ticket). `--repo` adds another repo (and
// its worktrees) to the scan; `--config` checks an arbitrary config file
// directly, bypassing git entirely -- used for the "fail on purpose" self
// test against a throwaway file.
//
// Exits 0 if clean, 1 if any remote URL contains a credential pattern, 2 on
// a usage/setup error. Never prints the matched credential -- only the file
// path and which pattern name matched.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(__dirname, '..');

// Order matters only for readability; every pattern is checked independently.
const CREDENTIAL_PATTERNS = [
  { name: 'github_pat_ (fine-grained PAT)', re: /github_pat_[A-Za-z0-9_]+/ },
  { name: 'ghp_ (classic PAT)', re: /ghp_[A-Za-z0-9]+/ },
  { name: 'gho_ (OAuth token)', re: /gho_[A-Za-z0-9]+/ },
  { name: 'ghs_ (server-to-server token)', re: /ghs_[A-Za-z0-9]+/ },
  { name: 'x-access-token: (embedded basic-auth credential)', re: /x-access-token:/ },
];

function parseArgs(argv) {
  const repos = [];
  const configs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') {
      const value = argv[++i];
      if (!value) throw new Error('--repo requires a path argument');
      repos.push(value);
    } else if (arg === '--config') {
      const value = argv[++i];
      if (!value) throw new Error('--config requires a file argument');
      configs.push(value);
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }
  if (repos.length === 0 && configs.length === 0) repos.push(DEFAULT_REPO);
  return { repos, configs };
}

function worktreePaths(repoPath) {
  let out;
  try {
    out = execFileSync('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(`could not list worktrees for ${repoPath}: ${err.message}`);
  }
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

function configPathFor(worktreePath) {
  // Worktrees share the parent repo's config, but resolve it per-worktree
  // via git itself rather than assuming `.git/config` -- a worktree's `.git`
  // is a text file pointing elsewhere, and asking git avoids hardcoding that
  // layout.
  const commonDir = execFileSync(
    'git',
    ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  return path.join(commonDir, 'config');
}

function findMatches(text) {
  return CREDENTIAL_PATTERNS.filter((p) => p.re.test(text));
}

function main() {
  let repos, configs;
  try {
    ({ repos, configs } = parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`usage error: ${err.message}`);
    process.exit(2);
  }

  // path -> Set(pattern names)
  const filesToCheck = new Map();

  for (const configFile of configs) {
    filesToCheck.set(path.resolve(configFile), null);
  }

  for (const repoPath of repos) {
    if (!existsSync(repoPath)) {
      console.error(`usage error: repo path does not exist: ${repoPath}`);
      process.exit(2);
    }
    let worktrees;
    try {
      worktrees = worktreePaths(repoPath);
    } catch (err) {
      console.error(`usage error: ${err.message}`);
      process.exit(2);
    }
    for (const wt of worktrees) {
      try {
        filesToCheck.set(configPathFor(wt), null);
      } catch (err) {
        console.error(`warning: could not resolve config for worktree ${wt}: ${err.message}`);
      }
    }
  }

  const offenders = [];
  for (const configFile of filesToCheck.keys()) {
    if (!existsSync(configFile)) {
      console.error(`warning: config file not found, skipping: ${configFile}`);
      continue;
    }
    const text = readFileSync(configFile, 'utf8');
    const matches = findMatches(text);
    if (matches.length > 0) {
      offenders.push({ file: configFile, patterns: matches.map((m) => m.name) });
    }
  }

  if (offenders.length > 0) {
    console.error('git-remote-credential guard: FAILED');
    console.error(
      `found ${offenders.length} git config file(s) with an embedded credential pattern in a remote URL:`,
    );
    for (const { file, patterns } of offenders) {
      console.error(`  - ${file}`);
      for (const p of patterns) console.error(`      matched pattern: ${p}`);
    }
    console.error(
      'Never print or commit the matched value. Fix with: git remote set-url origin git@github.com:DadonStyle/LULLWOOD.git',
    );
    process.exit(1);
  }

  console.log(
    `git-remote-credential guard: OK (checked ${filesToCheck.size} config file(s), no embedded credentials found)`,
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { findMatches, parseArgs, CREDENTIAL_PATTERNS };
