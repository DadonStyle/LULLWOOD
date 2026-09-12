#!/usr/bin/env node
// LUL-2461: lightweight counter for the Economist's LUL-1413 blackout-multiplier
// pricing -- win rate per difficulty tier (lantern/night/blackout), plus median
// run length (win vs loss) and median distance-from-home-at-death, restricted to
// events from a build at or after a given commit (default d5e122f, the
// pickup-freeze cut -- earlier builds had an 11.3s pickup invulnerability window
// vs the current 2.5s, a 4-5x difference in predator reach during pickup that
// would otherwise contaminate the count).
//
// This is a one-shot counter, not a dashboard: it prints to stdout and exits.
// No report file, no UI -- see LUL-2461, "no report needed, drop counts as a
// comment".
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=... node scripts/win-rate-by-tier.mjs [--min-build=<sha>] [--range=24h|7d|30d]
//
// Requires BLOB_READ_WRITE_TOKEN (Vercel Blob read access) in env, same
// degraded-mode contract as lib/dashboard/blob-source.ts: no token means zero
// events back, not a crash. This agent does not hold that token -- deploy/env
// vars are the Founding Engineer's domain (AGENTS.md "Hard boundaries") -- so
// whoever runs this for real needs it themselves.
//
// The build filter needs git ancestry (`git merge-base --is-ancestor`), which
// is why it lives here and not in lib/dashboard/aggregate.ts -- that module is
// deliberately pure/no-I/O (see its file header) so the four dashboard views
// stay trivially unit-testable.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchEvents, isRange } from '../lib/dashboard/blob-source.ts';
import { computeOutcomesByTier } from '../lib/dashboard/aggregate.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MIN_BUILD = 'd5e122f';
const TIERS = ['lantern', 'night', 'blackout', 'unattributed'];

function argValue(args, flag, fallback) {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
}

// True if `buildSha` is `minSha` or a git descendant of it. Unknown/missing
// shas (dev builds, corrupt rows) are excluded rather than assumed eligible --
// silently including them would make "build >= X" mean "build >= X, or who
// knows" without saying so.
function isAtOrAfter(buildSha, minSha) {
  if (typeof buildSha !== 'string' || buildSha.length === 0 || buildSha === 'dev') return false;
  if (buildSha === minSha) return true;
  try {
    execSync(`git merge-base --is-ancestor ${minSha} ${buildSha}`, { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fmtMs(n) {
  if (n === null) return '—';
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

async function main() {
  const args = process.argv.slice(2);
  const minBuild = argValue(args, '--min-build', DEFAULT_MIN_BUILD);
  const range = argValue(args, '--range', '30d');
  if (!isRange(range)) throw new Error(`--range must be one of 24h|7d|30d, got ${range}`);

  const events = await fetchEvents(range);
  console.log(`${events.length} event(s) fetched (range=${range}).`);
  if (events.length === 0) {
    console.log('No events -- either no traffic in range, or BLOB_READ_WRITE_TOKEN is unset in this environment.');
    return;
  }

  const buildEligibility = new Map();
  const eligible = events.filter((e) => {
    const sha = e.build_sha;
    if (!buildEligibility.has(sha)) buildEligibility.set(sha, isAtOrAfter(sha, minBuild));
    return buildEligibility.get(sha);
  });
  console.log(`${eligible.length} event(s) on build >= ${minBuild} (${buildEligibility.size} distinct build_sha seen).`);

  const byTier = computeOutcomesByTier(eligible);
  for (const tier of TIERS) {
    const t = byTier[tier];
    if (t.winCount === 0 && t.lossCount === 0) {
      console.log(`\n${tier}: 0 runs`);
      continue;
    }
    console.log(`\n${tier}: ${t.winCount} win / ${t.lossCount} loss (win rate ${t.winRatePct === null ? '—' : t.winRatePct.toFixed(1) + '%'})`);
    console.log(`  run length p50 -- win: ${fmtMs(t.runLengthMs.win.p50)} (n=${t.runLengthMs.win.n}), loss: ${fmtMs(t.runLengthMs.loss.p50)} (n=${t.runLengthMs.loss.n})`);
    console.log(`  distance from home at death, p50: ${t.distanceFromHomeAtDeathM.p50 === null ? '—' : t.distanceFromHomeAtDeathM.p50 + 'm'} (n=${t.distanceFromHomeAtDeathM.n})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
