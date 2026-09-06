#!/usr/bin/env node
// LUL-1630: point git at .githooks/ automatically on `npm ci`/`npm install`
// (via the `prepare` script) so every worktree gets the pre-commit/pre-push
// credential guard without a manual one-time step someone forgets -- a
// forgotten manual step is exactly how LUL-468's fail-open gap happened
// before. Non-fatal on failure: this is convenience wiring for a guard that
// CI already runs independently, not itself the security boundary, so it
// must never break an install in an environment without a writable .git
// (e.g. a read-only deploy checkout).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

if (!existsSync(path.join(repoRoot, '.git'))) {
  // Not a git checkout (e.g. an npm-packed tarball) -- nothing to wire.
  process.exit(0);
}

try {
  execFileSync('git', ['-C', repoRoot, 'config', 'core.hooksPath', '.githooks'], {
    stdio: 'inherit',
  });
  console.log('git hooks path set to .githooks (pre-commit/pre-push credential guard active)');
} catch (err) {
  console.error(`setup-git-hooks: could not set core.hooksPath, continuing without it: ${err.message}`);
}
