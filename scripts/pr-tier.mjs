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
//   - `lib/game/{predator,scent,cover,outcome,pack,charge,sightLock,dayNight,
//     veil,fogTide,noise,bog,lake,stamina}.ts` are C by name, not the whole
//     directory. LUL-1664 made all of `lib/game/**` Tier C on the rationale
//     that "every module here is simulation logic" -- true when the directory
//     had 5 files (predator/scent/cover/outcome/pack, decisions/0014
//     Amendment 2's actual list), false at 21: modules like economy.ts
//     (reward math run *after* an outcome is already decided) or chronicle.ts
//     (a post-hoc formatter) have nothing to do with AGENTS.md's Tier C
//     definition ("movement, collision, predator AI, scent, hiding,
//     detection, win/lose conditions") and got dragged along for the ride --
//     confirmed live blocking PR #436/LUL-1640 on exactly this over-reach
//     (LUL-1880). The named list above is every lib/game/ file whose exports
//     feed that definition directly: predator/scent/cover/outcome/pack (the
//     original five); charge.ts (predator charge decision + the "caught"
//     resolution -- a win/lose condition); sightLock.ts (pre-chase sight-lock
//     tell, gates when a chase starts); dayNight.ts/veil.ts/fogTide.ts (each
//     exports a predator detect-radius multiplier consumed directly by
//     canSee()); noise.ts (the hearing detection channel); bog.ts/lake.ts
//     (terrain speed multipliers -- movement); stamina.ts (sprint speed
//     multiplier -- also movement, and the margin between escaping a chase
//     and not). Everything else in lib/game/ (economy, mission, chronicle,
//     eventScheduler, timeOfDay, childGlow, jump -- reward, side-objective
//     tracking, narrative text, a generic phase-cycle timer, and cosmetic
//     glow/camera-arc math with no detection or collision math in them) falls
//     through to the generic `lib/**` -> B rule below, same as any other
//     app-surface module. This rule is listed after the Tier A test/spec rule
//     (so lib/game/*.test.ts stays A, like every other test file) but before
//     the generic `lib/**` -> B rule, since first match wins. A future
//     lib/game/ addition that isn't named here defaults to B -- a conscious
//     choice now that this is a named list, not a fail-closed directory rule
//     -- so classify new simulation files here by hand against the same
//     definition rather than assuming the old blanket rule still applies.
//   - `package.json` / lockfile are C: a dependency bump is arbitrary code.
//   - A spec/test diff (`e2e/**`, `*.test.*`, `*.spec.*`) only stays Tier A
//     when its patch adds new coverage, not just new lines. LUL-5693/PR#971:
//     an existing assertion's numeric budget got retuned behind 3 lines of
//     new explanatory comment per call site, so the diff was net +8 lines
//     (10 added, 2 removed) -- positive by any plain line-count measure --
//     and auto-merged as Tier A with zero review. A line count can't tell
//     "new test" from "old test, new comment", so this counts `expect(`
//     occurrences in the patch's added vs. removed lines instead: a
//     genuinely new assertion or a new `test`/`it`/`describe` block stays A;
//     a diff that doesn't net-add an `expect(` call -- a value-only retune
//     (PR#971: 2 removed, 2 added, net zero) or a pure deletion (weakened/
//     disguised coverage) -- fails closed to C, the same tier this studio's
//     own convention already hand-assigns budget retunes (LUL-5670/LUL-5673,
//     cited on the ticket). Needs the patch text, which GitHub omits for
//     very large/binary diffs (`.../pulls/{n}/files` response, `patch` field
//     absent) -- falls back to the raw additions/deletions count if so
//     (weaker, but strictly better than skipping the check). Callers that
//     only have bare paths (the CLI argv form, this file's own tests) have
//     no diff at all to give it, so the downgrade only fires when a caller
//     supplies one -- both production consumers (tier-approve.yml,
//     check-review-gap.mjs) always do.
//   - OWNED_PAGES below (devlog, guides, faq, press, llms.txt) are pinned to
//     Tier B (merge on green, review after) ahead of every other rule.
//     LUL-6105, founder decision 2026-10-27: these pages now auto-publish
//     after a Brand Reviewer PASS, replacing the founder-merge lane below.
//     They stay pinned (not left to path rules) so `public/llms.txt` can
//     never ride `public/** -> A` to a zero-review merge. History, from when
//     they were pinned to C: `CHANNELS.md` (owner: Growth Lead,
//     founder decision 2026-10-22) carves these website pages into their own
//     merge lane: "the Producer opens a PR without [ship], and the founder
//     merges it. The Reviewer must PASS it first." -- no Code Reviewer step
//     at all, by design. Path classification alone cannot see that: LUL-6074
//     found PR#1147 (branch `lul-6072-fix`) routing `lib/devlog.ts` through
//     this pipeline as a plain Tier B `lib/**` file, and it was stopped only
//     by the coincidence that the approving token's GitHub identity matched
//     the PR author's (guard 2 in tier-approve.yml) -- a PR opened under
//     `auto-pr.yml`'s normal `github-actions[bot]` identity would not have
//     tripped that guard and would have auto-merged a founder-only page with
//     zero review. `lib/faq.ts` gets the same by-name listing as
//     `lib/devlog.ts`: it is the `faq` channel's content source exactly as
//     devlog.ts is the `devlog` channel's (both added together in commit
//     0f23ce5/PR#1114, 2026-10-18), so the same gap applies to it. Listed by
//     page, not as a blanket `app/**` carve-out: `app/how-to-survive/page.tsx`
//     and `app/games-like-slender/page.tsx` are ordinary Tier B app surface,
//     not on this list -- the operative test is "is this one of the five
//     channels CHANNELS.md names" (devlog, guides, faq, press, llms.txt), not
//     when the file was built. Both of those pages and `public/llms.txt`
//     were built in the same 2026-10-18 commit, but llms.txt is on this list
//     and they are not, because llms.txt is a named channel and they aren't.
//     `public/llms.txt` matters here for a second reason: unguarded, it
//     would ride the `public/** -> A` rule below to a zero-review merge,
//     worse than devlog's accidental Tier B.
//
// Usage: node scripts/pr-tier.mjs <file> [file...]
//        node scripts/pr-tier.mjs --stdin
//          accepts either bare paths (one per line) or, to enable the
//          spec/test retune check above, one JSON object per line:
//          `{"filename":"...","additions":N,"deletions":N,"patch":"..."}`
//          -- exactly the fields GitHub's own `.../pulls/{n}/files` response
//          gives for each changed file.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Owned-page channel (CHANNELS.md). Founder-merge lane 2026-10-22, Tier B
// auto-publish after Brand Reviewer PASS since 2026-10-27 (LUL-6105).
// See the OWNED_PAGES bullet in the file-level comment above for why this
// exists and why it is a named list, not a blanket app/**/public/** rule.
// Keep this list in sync with CHANNELS.md's "Website pages" row -- it is
// the only place both documents need to agree.
const OWNED_PAGES = [
  /^lib\/devlog\.ts$/,
  /^lib\/faq\.ts$/,
  /^app\/(devlog|guides|faq|press)\//,
  /^public\/llms\.txt$/,
];

const rules = [
  // --- Owned pages: pinned to B ahead of every other rule, so public/** ->
  // A can never auto-merge llms.txt with zero review (LUL-6105). ---
  ...OWNED_PAGES.map((re) => [re, 'B']),

  // --- Tier C: never auto-approved. Checked first; first match wins. ---
  [/^\.github\//, 'C'],
  [/^scripts\//, 'C'],
  [/^engine\//, 'C'],
  [/^app\/api\//, 'C'],
  [/^(package\.json|package-lock\.json|next\.config\.[a-z]+|tsconfig[^/]*\.json|eslint\.config\.[a-z]+|playwright\.config\.ts|vercel\.json)$/, 'C'],
  [/(^|\/)\.env/, 'C'],
  [/(auth|secret|token|credential)/i, 'C'],

  // --- Tier A: docs, tests, assets. No review, no play verdict. ---
  // Checked before lib/game/ -> C below so a lib/game/*.test.ts stays A, same
  // as every other test file -- only the simulation source itself is C.
  [/^docs\//, 'A'],
  [/^NOAM_MDS\//, 'A'],
  [/^DAILY_REPORTS\//, 'A'],
  [/^QA_REGRESSION\//, 'A'],
  [/^GAMES_REPLAY\//, 'A'],
  [/^e2e\//, 'A'],
  [/\.(test|spec)\.[jt]sx?$/, 'A'],
  [/^public\//, 'A'],
  [/\.md$/, 'A'],

  [/^lib\/game\/(predator|scent|cover|outcome|pack|charge|sightLock|dayNight|veil|fogTide|noise|bog|lake|stamina)\.ts$/, 'C'],

  // --- Tier B: app surface. Merge on green, review after. ---
  [/^app\//, 'B'],
  [/^lib\//, 'B'],
  [/^components\//, 'B'],
];

// The two Tier A rules above that cover spec/test files specifically (not
// docs/public/md, which have no "assertion value" concept to retune).
const SPEC_TEST_RULES = [/^e2e\//, /\.(test|spec)\.[jt]sx?$/];

function isSpecOrTestPath(file) {
  return SPEC_TEST_RULES.some((re) => re.test(file));
}

// Strips a trailing `//...` line comment so matching below only sees real
// code. Not airtight (block comments, `//` inside a string literal), but a
// prose comment quoting `expect(`/`test(` -- the natural way to explain a
// retune in English -- is the realistic case this closes (LUL-5697).
function stripLineComment(code) {
  return code.replace(/\/\/.*$/, '');
}

// Counts `expect(` occurrences among a unified diff's added/removed content
// lines (never the `+++`/`---` file-header lines), ignoring their comment
// text, and reports whether a new `test`/`it`/`describe` registration was
// added in real code. Padding a retune with explanatory comments (PR#971's
// exact shape, and the comment-text variants in LUL-5697) doesn't change the
// verdict.
function patchAddsNewCoverage(patch) {
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      const code = stripLineComment(line.slice(1));
      if (/\b(test|it|describe)\s*\(/.test(code)) return true;
      if (/\bexpect\s*\(/.test(code)) added++;
    } else if (line.startsWith('-')) {
      const code = stripLineComment(line.slice(1));
      if (/\bexpect\s*\(/.test(code)) removed++;
    }
  }
  return added > removed;
}

// `meta` is optional: GitHub's own per-file `{ additions, deletions, patch }`
// from `.../pulls/{n}/files`. See the "spec/test diff" bullet above for why
// this is the signal, when it fires, and the additions/deletions fallback
// for when `patch` isn't available.
function tierOf(file, meta) {
  for (const [re, tier] of rules) {
    if (!re.test(file)) continue;
    if (tier === 'A' && isSpecOrTestPath(file) && meta) {
      const newCoverage =
        typeof meta.patch === 'string'
          ? patchAddsNewCoverage(meta.patch)
          : Number.isFinite(meta.additions) && Number.isFinite(meta.deletions) && meta.additions > meta.deletions;
      if (!newCoverage) return 'C';
    }
    return tier;
  }
  return 'C'; // unrecognised path -> fail closed
}

const rank = { A: 0, B: 1, C: 2 };

// Parses one `--stdin` line into a path plus optional meta. A line that
// parses as a JSON object with a `filename` string is the real consumers'
// `{filename, additions, deletions, patch}` form; anything else (including
// every bare path, which is not valid JSON) comes back with
// `meta: undefined`, matching tierOf's "no signal, no downgrade" contract.
function parseEntry(line) {
  try {
    const obj = JSON.parse(line);
    if (obj && typeof obj === 'object' && typeof obj.filename === 'string') {
      return { file: obj.filename, meta: obj };
    }
  } catch {
    // not JSON -- bare path line, meta stays undefined
  }
  return { file: line, meta: undefined };
}

// Classifies a whole file list to the single worst tier. Shared with
// check-review-gap.mjs (LUL-1111) so it doesn't re-derive tier rules to
// decide whether a zero-review PR is Tier-A-only and can be skipped.
function classify(lines) {
  let worst = 'A';
  for (const line of lines) {
    const { file, meta } = parseEntry(line);
    const t = tierOf(file, meta);
    if (rank[t] > rank[worst]) worst = t;
    if (process.env.PR_TIER_VERBOSE) console.error(`  ${t}  ${file}`);
  }
  return worst;
}

function main() {
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

  console.log(classify(files));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { tierOf, classify };
