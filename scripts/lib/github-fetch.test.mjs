import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGithubToken, GITHUB_TOKEN_CHAIN_DESCRIPTION } from './github-fetch.mjs';

// LUL-736: the documented invocation (`node scripts/board-integrity-check.mjs
// --post` with only `PAPERCLIP_*` env) exits 2 because `GITHUB_TOKEN` is not
// actually set anywhere -- these pin the fallback chain's precedence and its
// fail-closed terminal case. Every dependency is injected so this never
// shells out to the real `gh` binary or reads the real filesystem.

function neverReadFile() {
  throw new Error('readGhTokenFile should not have been called');
}

function neverRunGh() {
  throw new Error('runGhAuthToken should not have been called');
}

test('GITHUB_TOKEN wins outright, and nothing else is even consulted', () => {
  const result = resolveGithubToken({
    env: { GITHUB_TOKEN: 'from-env-github-token', GH_TOKEN: 'should-not-be-used' },
    readGhTokenFile: neverReadFile,
    runGhAuthToken: neverRunGh,
  });
  assert.deepEqual(result, { token: 'from-env-github-token', source: 'GITHUB_TOKEN' });
});

test('GH_TOKEN is used when GITHUB_TOKEN is absent', () => {
  const result = resolveGithubToken({
    env: { GH_TOKEN: 'from-env-gh-token' },
    readGhTokenFile: neverReadFile,
    runGhAuthToken: neverRunGh,
  });
  assert.deepEqual(result, { token: 'from-env-gh-token', source: 'GH_TOKEN' });
});

test('falls back to the gh_token file when neither env var is set', () => {
  const result = resolveGithubToken({
    env: {},
    readGhTokenFile: () => 'from-file-token\n',
    runGhAuthToken: neverRunGh,
  });
  assert.deepEqual(result, { token: 'from-file-token', source: '~/.lullwood/gh_token' });
});

test('an unreadable/missing gh_token file falls through to `gh auth token`, not an error', () => {
  const result = resolveGithubToken({
    env: {},
    readGhTokenFile: () => {
      throw new Error('ENOENT: no such file');
    },
    runGhAuthToken: () => 'from-gh-cli\n',
  });
  assert.deepEqual(result, { token: 'from-gh-cli', source: 'gh auth token' });
});

test('a blank gh_token file (whitespace only) is treated as absent, not a real token', () => {
  const result = resolveGithubToken({
    env: {},
    readGhTokenFile: () => '   \n',
    runGhAuthToken: () => 'from-gh-cli',
  });
  assert.deepEqual(result, { token: 'from-gh-cli', source: 'gh auth token' });
});

// The preflight case this whole ticket is about: every link in the chain
// comes up empty, e.g. no env vars, no file, and `gh` is not installed or
// not authenticated. board-integrity-check.mjs's main() must exit 2 on this
// case *before* making any GitHub API call -- verified pinning `null` here,
// not a thrown error, so the caller can distinguish "no token" from "gh_fetch
// blew up" and produce its own clean preflight message.
test('every link in the chain empty -> resolves to null, not a thrown error', () => {
  const result = resolveGithubToken({
    env: {},
    readGhTokenFile: () => {
      throw new Error('ENOENT');
    },
    runGhAuthToken: () => {
      throw new Error('gh: command not found');
    },
  });
  assert.equal(result, null);
});

test('the chain description names all four links, for the preflight error message', () => {
  assert.match(GITHUB_TOKEN_CHAIN_DESCRIPTION, /GITHUB_TOKEN/);
  assert.match(GITHUB_TOKEN_CHAIN_DESCRIPTION, /GH_TOKEN/);
  assert.match(GITHUB_TOKEN_CHAIN_DESCRIPTION, /gh_token/);
  assert.match(GITHUB_TOKEN_CHAIN_DESCRIPTION, /gh auth token/);
});
