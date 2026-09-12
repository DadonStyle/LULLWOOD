#!/usr/bin/env node
// LUL-2392: one-shot counter for the Economist's LUL-1449 measurement -- median and
// 25th-percentile gap between a chase->roam give-up and the next scentOnto()
// re-acquisition, per difficulty tier. Feeds LUL-1439 (Deeper Lungs veil-tree
// re-pricing): p25 decides whether tiers 2-3 (need 14-16s of quiet) are dead weight.
//
// This is a one-shot counter, not a dashboard: it prints to stdout and exits, same
// contract as scripts/win-rate-by-tier.mjs (LUL-2461).
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=... node scripts/chase-gap-by-tier.mjs [--min-build=<sha>] [--range=24h|7d|30d]
//
// Requires BLOB_READ_WRITE_TOKEN (Vercel Blob read access) in env, same degraded-mode
// contract as lib/dashboard/blob-source.ts: no token means zero events back, not a
// crash. Deploy/env vars are the Founding Engineer's domain, not this script's.
//
// Default --min-build mirrors LUL-1441's build pin (d5e122f) -- same instrumentation
// pass as LUL-1413/win-rate-by-tier.mjs, so the same build-eligibility filter applies.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchEvents, isRange } from '../lib/dashboard/blob-source.ts';
import { computeChaseGapByTier } from '../lib/dashboard/aggregate.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MIN_BUILD = 'd5e122f';
const TIERS = ['lantern', 'night', 'blackout', 'unattributed'];

function argValue(args, flag, fallback) {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
}

// True if `buildSha` is `minSha` or a git descendant of it. Unknown/missing shas (dev
// builds, corrupt rows) are excluded rather than assumed eligible.
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

  const byTier = computeChaseGapByTier(eligible);
  for (const tier of TIERS) {
    const t = byTier[tier];
    if (t.gapMs.n === 0) {
      console.log(`\n${tier}: 0 chase_gap events`);
      continue;
    }
    console.log(`\n${tier}: n=${t.gapMs.n}`);
    console.log(`  gap p50: ${fmtMs(t.gapMs.p50)}`);
    console.log(`  gap p25: ${fmtMs(t.gapMs.p25)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
