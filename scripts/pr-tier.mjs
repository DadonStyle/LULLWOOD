#!/usr/bin/env node
// Classifies a PR's changed files into a review tier under the
// development-first directive (2026-08-29, AGENTS.md § Review tiers).
//
// Contract: print exactly one of A, B or C to stdout. Highest tier wins when a
// diff spans tiers, and ANY path that does not match a rule is C.
//
// WHY THIS FAILS CLOSED
//
// The consumer is tier-approve.yml, which submits a GitHub-native approving
// review with no human in the loop. A misclassification here does not produce
// a warning -- it silently merges unreviewed code. So the rules are written
// tighter than the prose directive:
//
//   - `.github/**` is C even though "non-security CI" is nominally Tier B. A
//     workflow edit can change the merge gate itself, and this script's own
//     consumer lives there. Self-modifying automation is not Tier B.
//   - `app/api/**` is C even though `app/**` is Tier B. Route Handlers read
//     BLOB_READ_WRITE_TOKEN and other server env; "touches secrets" wins.
//   - `engine/**` is C in full. The directive carves out "tuning constants in
//     engine/", but nothing mechanical can tell a tuning constant from a
//     change to the collision solver, and guessing wrong here ships a broken
//     game. A human can still approve those normally.
//   - `package.json` / lockfile are C: a dependency bump is arbitrary code.
//
// Usage: node scripts/pr-tier.mjs <file> [file...]
//        node scripts/pr-tier.mjs --stdin   (newline-separated paths)

import { readFileSync } from 'node:fs';

const rules = [
  // --- Tier C: never auto-approved. Checked first; first match wins. ---
  [/^\.github\//, 'C'],
  [/^scripts\//, 'C'],
  [/^engine\//, 'C'],
  [/^app\/api\//, 'C'],
  [/^(package\.json|package-lock\.json|next\.config\.[a-z]+|tsconfig[^/]*\.json|eslint\.config\.[a-z]+|playwright\.config\.ts|vercel\.json)$/, 'C'],
  [/(^|\/)\.env/, 'C'],
  [/(auth|secret|token|credential)/i, 'C'],

  // --- Tier A: docs, tests, assets. No review, no play verdict. ---
  [/^docs\//, 'A'],
  [/^NOAM_MDS\//, 'A'],
  [/^DAILY_REPORTS\//, 'A'],
  [/^QA_REGRESSION\//, 'A'],
  [/^GAMES_REPLAY\//, 'A'],
  [/^e2e\//, 'A'],
  [/\.(test|spec)\.[jt]sx?$/, 'A'],
  [/^public\//, 'A'],
  [/\.md$/, 'A'],

  // --- Tier B: app surface. Merge on green, review after. ---
  [/^app\//, 'B'],
  [/^lib\//, 'B'],
  [/^components\//, 'B'],
];

function tierOf(file) {
  for (const [re, tier] of rules) if (re.test(file)) return tier;
  return 'C'; // unrecognised path -> fail closed
}

const rank = { A: 0, B: 1, C: 2 };

let files = process.argv.slice(2);
if (files[0] === '--stdin') {
  files = readFileSync(0, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

if (files.length === 0) {
  // An empty diff is not a safe thing to rubber-stamp.
  console.error('pr-tier: no files given; refusing to classify an empty diff');
  console.log('C');
  process.exit(0);
}

let worst = 'A';
for (const f of files) {
  const t = tierOf(f);
  if (rank[t] > rank[worst]) worst = t;
  if (process.env.PR_TIER_VERBOSE) console.error(`  ${t}  ${f}`);
}
console.log(worst);
