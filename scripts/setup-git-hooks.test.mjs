import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'setup-git-hooks.mjs');

function makeFakeRepo() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lul1630-'));
  execFileSync('git', ['init', '-q', base]);
  // The script resolves its own repo root as `<script dir>/..`, so give the
  // throwaway repo the same scripts/setup-git-hooks.mjs layout rather than
  // invoking the real one in place (which would mutate this checkout's config).
  mkdirSync(path.join(base, 'scripts'));
  copyFileSync(SCRIPT_PATH, path.join(base, 'scripts', 'setup-git-hooks.mjs'));
  return base;
}

test('setup-git-hooks sets core.hooksPath to .githooks in a real git checkout', () => {
  const base = makeFakeRepo();
  try {
    const result = spawnSync('node', [path.join(base, 'scripts', 'setup-git-hooks.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const hooksPath = execFileSync('git', ['-C', base, 'config', 'core.hooksPath'], {
      encoding: 'utf8',
    }).trim();
    assert.equal(hooksPath, '.githooks');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('setup-git-hooks exits 0 without touching git config when there is no .git', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'lul1630-nogit-'));
  try {
    mkdirSync(path.join(base, 'scripts'));
    copyFileSync(SCRIPT_PATH, path.join(base, 'scripts', 'setup-git-hooks.mjs'));
    const result = spawnSync('node', [path.join(base, 'scripts', 'setup-git-hooks.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
