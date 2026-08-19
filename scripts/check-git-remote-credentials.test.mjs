import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, parseArgs, CREDENTIAL_PATTERNS } from './check-git-remote-credentials.mjs';

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
