import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMatches, parseArgs, CREDENTIAL_PATTERNS } from './check-git-remote-credentials.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'check-git-remote-credentials.mjs');

// ---- findMatches ------------------------------------------------------

test('findMatches flags a fine-grained PAT embedded in a url line', () => {
  const text = '[remote "origin"]\n\turl = https://github_pat_fakeFakeFake@github.com/DadonStyle/LULLWOOD.git\n';
  const matches = findMatches(text);
  assert.equal(matches.length, 1);
  assert.match(matches[0].name, /github_pat_/);
});

test('findMatches flags x-access-token: basic-auth style urls', () => {
  const text = 'url = https://x-access-token:ghp_fakeFakeFake@github.com/DadonStyle/LULLWOOD.git\n';
  const matches = findMatches(text);
  const names = matches.map((m) => m.name);
  assert.ok(names.some((n) => n.includes('x-access-token:')));
  assert.ok(names.some((n) => n.includes('ghp_')));
});

test('findMatches finds nothing in a clean SSH remote config', () => {
  const text = '[remote "origin"]\n\turl = git@github.com:DadonStyle/LULLWOOD.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
  assert.deepEqual(findMatches(text), []);
});

test('every declared credential pattern is independently detectable', () => {
  for (const { name, re } of CREDENTIAL_PATTERNS) {
    const sample = name.startsWith('x-access-token')
      ? 'url = https://x-access-token:@github.com/x/y.git'
      : `url = https://${name.split(' ')[0]}abcdef123@github.com/x/y.git`;
    assert.match(sample, re, `pattern for "${name}" did not match its own sample`);
  }
});

// ---- parseArgs ----------------------------------------------------------

test('parseArgs defaults to scanning this script\'s own repo when no args given', () => {
  const { repos, configs } = parseArgs([]);
  assert.equal(repos.length, 1);
  assert.equal(configs.length, 0);
});

test('parseArgs collects --repo and --config values, and skips the default when any given', () => {
  const { repos, configs } = parseArgs(['--config', '/tmp/a.config', '--repo', '/tmp/repo']);
  assert.deepEqual(configs, ['/tmp/a.config']);
  assert.deepEqual(repos, ['/tmp/repo']);
});

test('parseArgs rejects a flag missing its value', () => {
  assert.throws(() => parseArgs(['--repo']), /requires a path argument/);
  assert.throws(() => parseArgs(['--config']), /requires a file argument/);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--bogus']), /unrecognized argument/);
});

// ---- main(): real git worktree resolution --------------------------------
//
// LUL-468: a worktree still registered in `git worktree list` whose checkout
// directory has been deleted (without `git worktree remove`) used to log a
// warning to stderr and exit 0 anyway -- a fail-open in a security guard.
// These run the script as a real subprocess against a throwaway git repo so
// they exercise actual `git worktree`/`git rev-parse` resolution, not a
// mocked stand-in for it.

function makeRepoWithWorktree() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lul468-'));
  const mainRepo = path.join(base, 'main');
  execFileSync('git', ['init', '-q', mainRepo]);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', mainRepo, 'config', 'user.name', 'Test']);
  writeFileSync(path.join(mainRepo, 'file.txt'), 'x');
  execFileSync('git', ['-C', mainRepo, 'add', 'file.txt']);
  execFileSync('git', ['-C', mainRepo, 'commit', '-q', '-m', 'init']);
  const worktreePath = path.join(base, 'wt');
  execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', '--detach', worktreePath]);
  return { base, mainRepo, worktreePath };
}

test('main() exits 0 for a repo whose worktrees all still exist and are clean', () => {
  const { base, mainRepo } = makeRepoWithWorktree();
  try {
    const result = spawnSync('node', [SCRIPT_PATH, '--repo', mainRepo], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /git-remote-credential guard: OK/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('main() exits non-zero when a registered worktree points at a deleted directory', () => {
  const { base, mainRepo, worktreePath } = makeRepoWithWorktree();
  try {
    // Simulate a Paperclip /tmp run scratch dir being cleaned up out from
    // under a still-registered worktree: delete the directory directly,
    // without `git worktree remove`, so `git worktree list` still reports it.
    rmSync(worktreePath, { recursive: true, force: true });

    const result = spawnSync('node', [SCRIPT_PATH, '--repo', mainRepo], { encoding: 'utf8' });

    assert.notEqual(result.status, 0, `expected a non-zero exit, got 0\nstdout: ${result.stdout}`);
    assert.doesNotMatch(result.stdout, /git-remote-credential guard: OK/);
    assert.match(result.stderr, /could not resolve config for worktree/);
    assert.match(result.stderr, new RegExp(worktreePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
