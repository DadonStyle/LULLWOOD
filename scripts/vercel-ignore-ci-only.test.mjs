import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'vercel-ignore-ci-only.sh');

// LUL-854: runs the real script as a subprocess against a throwaway git repo
// -- same approach as check-git-remote-credentials.test.mjs -- so these
// exercise the actual `git diff HEAD~1 HEAD` the Vercel ignoreCommand runs,
// not a reimplementation of its regex.

function makeRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'lul854-'));
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  writeFileSync(path.join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

// Writes `files` (relative path -> content) into `repo` and commits them as
// a single commit on top of whatever HEAD already is, so `git diff HEAD~1
// HEAD --name-only` reports exactly this file list.
function commit(repo, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    execFileSync('git', ['-C', repo, 'add', rel]);
  }
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
}

function runScript(repo) {
  return spawnSync('bash', [SCRIPT_PATH], { cwd: repo, encoding: 'utf8' });
}

// ---- the four real post-LUL-789 previews that should now skip (LUL-848) ---

test('a069f42f shape: NOAM_MDS/ scratch file only -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'NOAM_MDS/lul837-drill-scratch.txt': 'scratch\n' }, 'scratch note');
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('28ab4adf shape: DAILY_REPORTS/*.md only -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'DAILY_REPORTS/2026-08-21.md': '# report\n' }, 'daily report backfill');
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('4ba0df19 shape: .github/ + NOAM_MDS/ -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(
      repo,
      {
        '.github/workflows/foo.yml': 'name: foo\n',
        'NOAM_MDS/bar.txt': 'note\n',
      },
      'workflow tweak + scratch note',
    );
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('f0448084 shape: .github/ + scripts/ + DAILY_REPORTS/*.md -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(
      repo,
      {
        '.github/workflows/foo.yml': 'name: foo\n',
        'scripts/helper.sh': 'echo hi\n',
        'DAILY_REPORTS/2026-08-24.md': '# report\n',
      },
      'ci tweak + daily report',
    );
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---- must still build ------------------------------------------------------

test('bd72134 shape: mixed .github/ + app code -> build (exit 1)', () => {
  const repo = makeRepo();
  try {
    commit(
      repo,
      {
        '.github/workflows/foo.yml': 'name: foo\n',
        'engine/forest-engine.js': 'export const x = 1;\n',
      },
      'ci tweak + engine change',
    );
    const result = runScript(repo);
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('c3ac790 shape: app-code-only commit -> build (exit 1)', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'engine/forest-engine.js': 'export const x = 1;\n' }, 'engine change');
    const result = runScript(repo);
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('empty/missing diff (single commit, no parent) -> build (exit 1)', () => {
  const repo = makeRepo();
  try {
    const result = runScript(repo);
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('docs/-only commit -> build (exit 1) -- pins the deliberate docs/ exclusion', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'docs/notes.md': '# notes\n' }, 'docs update');
    const result = runScript(repo);
    assert.equal(
      result.status,
      1,
      `docs/ must NOT be treated as CI-only (LUL-47 may source /devlog from it) -- stderr: ${result.stderr}`,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---- the other newly-widened paths, not covered by the four real commits --

test('QA_REGRESSION/-only commit -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'QA_REGRESSION/run-42.json': '{}\n' }, 'replay capture');
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('e2e/-only commit -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'e2e/mobile/hide.spec.ts': 'test.skip();\n' }, 'e2e spec tweak');
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('root-level *.md only (AGENTS.md, CLAUDE.md) -> skip (exit 0)', () => {
  const repo = makeRepo();
  try {
    commit(
      repo,
      {
        'AGENTS.md': '# agents\n',
        'CLAUDE.md': '# claude\n',
      },
      'root doc tweak',
    );
    const result = runScript(repo);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('nested *.md (not root-level) still builds (exit 1) -- root-only, not recursive', () => {
  const repo = makeRepo();
  try {
    commit(repo, { 'components/README.md': '# component notes\n' }, 'nested md');
    const result = runScript(repo);
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
