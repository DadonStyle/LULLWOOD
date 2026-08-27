#!/usr/bin/env node
// DAILY_REPORTS generator — LUL-533/LUL-531. Spec: wiki systems/daily-reports.
// Do not re-derive the decisions there; this implements them.
//
// One file per calendar day, DAILY_REPORTS/YYYY-MM-DD.md, day boundary
// 00:00-23:59 Asia/Jerusalem. Source of truth is `git log --first-parent`
// on `release/next` -- see the wiki page for why (LUL-801: the studio ships
// continuously to release/next; main only receives version cuts, so main
// produces empty days while work is actually landing).
//
// Usage:
//   node scripts/daily-report.mjs --backfill
//   node scripts/daily-report.mjs --since=2026-08-18 --until=2026-08-19
//   node scripts/daily-report.mjs --day=2026-08-15
//
// Idempotent by construction: no generation timestamp, no "as of" line,
// deterministic commit ordering (chronological within each day, driven
// entirely by git history). Regenerating any past day must diff clean.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const REPORTS_DIR = path.join(REPO_ROOT, 'DAILY_REPORTS');
const OWNER_REPO = 'DadonStyle/LULLWOOD';
const TZ = 'Asia/Jerusalem';

// The company started 2026-08-13 (wiki decisions/0001-shared-wiki); the repo
// itself was created the next day. See §8 of the spec for why 08-13 gets a
// hand-written note instead of a git-derived file.
export const FIRST_COMPANY_DAY = '2026-08-13';
export const FIRST_REPO_DAY = '2026-08-14';

// ---------------------------------------------------------------------------
// Section taxonomy -- the one config array the spec requires. Order here is
// both render order and (for path patterns) classification priority: a
// section listed earlier does not need to exclude a later section's paths,
// because each section's own patterns are already scoped narrowly (e.g. the
// game-features app/ pattern excludes the SEO files that SEO's own patterns
// claim). Adding an eleventh section is one entry in this array.
export const SECTIONS = [
  {
    key: 'game-features',
    title: 'Game features & content',
    conventionalPrefixes: [],
    subjectKeywords: [],
    pathPatterns: [
      /^engine\//,
      /^lib\/game\//,
      /^components\//,
      /^app\/(?!sitemap\.ts$|robots\.ts$|.*opengraph)/i,
    ],
  },
  {
    key: 'bug-fixes',
    title: 'Bug fixes',
    conventionalPrefixes: [/^fix(\(|:)/i],
    subjectKeywords: [/\b(fix|bug|regression|revert|broken)\b/i],
    pathPatterns: [],
  },
  {
    key: 'infra',
    title: 'Infrastructure & CI/CD',
    conventionalPrefixes: [/^chore\(ci\)/i],
    subjectKeywords: [],
    pathPatterns: [/^\.github\//, /^scripts\//, /^next\.config\.ts$/, /^package(-lock)?\.json$/],
  },
  {
    key: 'testing',
    title: 'Testing & QA',
    conventionalPrefixes: [],
    subjectKeywords: [],
    pathPatterns: [/^e2e\//, /\.spec\.ts$/, /^playwright\.config\.ts$/],
  },
  {
    key: 'perf-refactor',
    title: 'Performance & refactors',
    conventionalPrefixes: [/^(perf|refactor)(\(|:)/i],
    subjectKeywords: [],
    pathPatterns: [],
  },
  {
    key: 'security',
    title: 'Security',
    conventionalPrefixes: [/^feat\(security\)/i, /^security(\(|:)/i],
    subjectKeywords: [/\b(credential|secret|token|security)\b/i],
    pathPatterns: [],
  },
  {
    key: 'seo',
    title: 'SEO & discovery',
    conventionalPrefixes: [],
    subjectKeywords: [],
    pathPatterns: [/^app\/sitemap\.ts$/, /^app\/robots\.ts$/, /opengraph/i],
  },
  {
    key: 'analytics',
    title: 'Analytics & telemetry',
    conventionalPrefixes: [],
    subjectKeywords: [],
    pathPatterns: [/^lib\/analytics/],
  },
  {
    key: 'docs',
    title: 'Docs & process',
    conventionalPrefixes: [/^docs(\(|:)/i],
    subjectKeywords: [],
    pathPatterns: [/\.md$/i, /^docs\//],
  },
  {
    key: 'other',
    title: 'Other',
    conventionalPrefixes: [],
    subjectKeywords: [],
    pathPatterns: [],
  },
];

const SECTION_BY_TITLE = new Map(SECTIONS.map((s) => [s.title.toLowerCase(), s]));

// ---------------------------------------------------------------------------
// git plumbing

function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// One record per first-parent commit on `ref`. Uses \x1f/\x1e as field/record
// separators so commit bodies (which may contain anything but those bytes)
// don't break parsing.
export function listFirstParentCommits(ref, cwd = REPO_ROOT) {
  const FIELD = '\x1f';
  const RECORD = '\x1e';
  const format = ['%H', '%P', '%aI', '%s', '%b'].join(FIELD) + RECORD;
  const raw = git(['log', '--first-parent', `--pretty=format:${format}`, ref], cwd);
  if (!raw) return [];
  return raw
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.length > 0)
    .map((record) => {
      const [sha, parentsRaw, authorDate, subject, body] = record.split(FIELD);
      return {
        sha,
        parents: parentsRaw.split(' ').filter(Boolean),
        authorDate,
        subject,
        body: body ?? '',
      };
    });
}

export function changedPaths(commit, cwd = REPO_ROOT) {
  const parent1 = commit.parents[0] ?? EMPTY_TREE_SHA;
  const raw = git(['diff', '--name-only', parent1, commit.sha], cwd);
  return raw.split('\n').filter(Boolean);
}

function secondParentSubject(commit, cwd = REPO_ROOT) {
  if (commit.parents.length < 2) return null;
  try {
    return git(['log', '-1', '--format=%s', commit.parents[1]], cwd).trim();
  } catch {
    // Unresolvable second parent (e.g. a shallow fetch) -- fall through to
    // the merge commit's own subject rather than crashing the whole run.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Day bucketing

export function dayKeyInTz(isoDate, timeZone = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(isoDate));
}

// ---------------------------------------------------------------------------
// Commit shape (spec §3) -> excluded | {text, prNumber}

const BACKMERGE_RE = /^Merge branch\b/i;
const MERGE_PR_RE = /^Merge pull request #(\d+) from/i;
const TRAILING_PR_RE = /\(#(\d+)\)\s*$/;
const LEADING_TICKET_PREFIX_RE = /^LUL-\d+(?:\s*[/,]\s*LUL-\d+)*:\s*/;

// Commit bodies in this repo are hand-wrapped prose (~72 cols/line), not one
// logical line per paragraph -- e.g. a body like "The founder's repo was\ncreated
// with an initial commit, so the\nremote main and this..." is one sentence split
// across three raw lines. "Body first line" (spec §3) means the first *paragraph*
// in that authoring style, not the first raw newline-delimited fragment.
function bodyFirstParagraph(body) {
  const paragraph = body.split(/\n\s*\n/)[0] ?? '';
  const joined = paragraph.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  return joined || null;
}

// The ticket id is already rendered as a bold badge ahead of the entry text
// (see renderDay), and the PR number is already rendered as a link -- strip
// both from the raw text so they aren't duplicated inline.
function stripRedundantRefs(text, prNumber) {
  let out = text.replace(LEADING_TICKET_PREFIX_RE, '');
  if (prNumber != null) {
    const trailing = new RegExp(`\\s*\\(#${prNumber}\\)\\s*$`);
    out = out.replace(trailing, '');
  }
  return out.trim();
}

const TICKET_RE = /LUL-\d+/g;

export function extractTicketIds(text) {
  return [...new Set(text.match(TICKET_RE) ?? [])];
}

export function classifyShape(commit) {
  if (commit.parents.length >= 2) {
    if (BACKMERGE_RE.test(commit.subject)) {
      return { excluded: true };
    }
    const raw = bodyFirstParagraph(commit.body) || secondParentSubject(commit) || commit.subject;
    const prMatch = commit.subject.match(MERGE_PR_RE) || commit.subject.match(TRAILING_PR_RE);
    const prNumber = prMatch ? Number(prMatch[1]) : null;
    return {
      excluded: false,
      text: stripRedundantRefs(raw, prNumber),
      prNumber,
      ticketIds: extractTicketIds(`${commit.subject}\n${raw}`),
    };
  }
  const prMatch = commit.subject.match(TRAILING_PR_RE);
  const prNumber = prMatch ? Number(prMatch[1]) : null;
  return {
    excluded: false,
    text: stripRedundantRefs(commit.subject, prNumber),
    prNumber,
    ticketIds: extractTicketIds(commit.subject),
  };
}

// ---------------------------------------------------------------------------
// Classification (spec §5, stop at first match)

const REPORT_SECTION_TRAILER_RE = /^Report-Section:\s*(.+)\s*$/m;

export function classifySection(commit, paths) {
  const fullMessage = `${commit.subject}\n\n${commit.body}`;

  const trailerMatch = fullMessage.match(REPORT_SECTION_TRAILER_RE);
  if (trailerMatch) {
    const section = SECTION_BY_TITLE.get(trailerMatch[1].trim().toLowerCase());
    if (section) return section.key;
  }

  for (const section of SECTIONS) {
    if (section.conventionalPrefixes.some((re) => re.test(commit.subject))) {
      return section.key;
    }
  }

  for (const section of SECTIONS) {
    if (section.subjectKeywords.some((re) => re.test(commit.subject))) {
      return section.key;
    }
  }

  for (const section of SECTIONS) {
    if (section.pathPatterns.some((re) => paths.some((p) => re.test(p)))) {
      return section.key;
    }
  }

  return 'other';
}

// ---------------------------------------------------------------------------
// Rendering

function shortSha(sha) {
  return sha.slice(0, 7);
}

function prLink(prNumber) {
  return `[#${prNumber}](https://github.com/${OWNER_REPO}/pull/${prNumber})`;
}

export function renderDay(dateStr, entries) {
  const lines = [];
  lines.push(`# Daily Report — ${dateStr}`, '');

  if (dateStr === FIRST_COMPANY_DAY) {
    lines.push(`_Asia/Jerusalem, 00:00–23:59 · pre-repo day, no git history_`, '');
    lines.push(
      '**Reconstructed note.** The company started this day (wiki `decisions/0001-shared-wiki`); ' +
        `the LULLWOOD repository itself was not created until ${FIRST_REPO_DAY}. There is no git data ` +
        'for this day, so this file does not synthesize commit-shaped activity for it — pre-repo setup ' +
        'is recorded in the shared wiki, not here.',
      '',
    );
    return lines.join('\n');
  }

  lines.push(`_Asia/Jerusalem, 00:00–23:59 · ${entries.length} changes landed on \`release/next\`_`, '');

  if (entries.length === 0) {
    lines.push('No changes landed on `release/next` this day.', '');
    return lines.join('\n');
  }

  const allTickets = new Set();
  const allPrs = new Set();
  const bySection = new Map();
  for (const entry of entries) {
    for (const t of entry.ticketIds) allTickets.add(t);
    if (entry.prNumber) allPrs.add(entry.prNumber);
    if (!bySection.has(entry.sectionKey)) bySection.set(entry.sectionKey, []);
    bySection.get(entry.sectionKey).push(entry);
  }

  const ticketsStr = [...allTickets].join(', ');
  const prsStr = [...allPrs].map((n) => `#${n}`).join(', ');
  const headerParts = [];
  if (ticketsStr) headerParts.push(`**Tickets:** ${ticketsStr}`);
  if (prsStr) headerParts.push(`**PRs:** ${prsStr}`);
  if (headerParts.length) lines.push(headerParts.join(' · '), '');

  for (const section of SECTIONS) {
    const sectionEntries = bySection.get(section.key);
    if (!sectionEntries || sectionEntries.length === 0) continue;
    lines.push(`## ${section.title}`, '');
    for (const entry of sectionEntries) {
      const bits = [];
      if (entry.ticketIds.length > 0) bits.push(`**${entry.ticketIds[0]}** —`);
      bits.push(entry.text);
      const tail = [];
      if (entry.prNumber) tail.push(prLink(entry.prNumber));
      tail.push(`\`${shortSha(entry.sha)}\``);
      lines.push(`- ${bits.join(' ')} — ${tail.join(' · ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}

// ---------------------------------------------------------------------------
// Building the entry set for a real (post-repo) day

export function buildEntriesByDay(ref, cwd = REPO_ROOT) {
  const commits = listFirstParentCommits(ref, cwd);
  const byDay = new Map();
  // git log is newest-first; walk oldest-first so entries render chronologically.
  for (const commit of [...commits].reverse()) {
    const day = dayKeyInTz(commit.authorDate);
    const shape = classifyShape(commit);
    if (shape.excluded) continue;
    const paths = changedPaths(commit, cwd);
    const sectionKey = classifySection(commit, paths);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({
      sha: commit.sha,
      text: shape.text,
      prNumber: shape.prNumber,
      ticketIds: shape.ticketIds,
      sectionKey,
    });
  }
  return byDay;
}

// ---------------------------------------------------------------------------
// CLI

function addDaysToDateStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function enumerateDays(since, until) {
  const days = [];
  let cur = since;
  while (cur <= until) {
    days.push(cur);
    cur = addDaysToDateStr(cur, 1);
  }
  return days;
}

function yesterdayInTz() {
  const todayStr = dayKeyInTz(new Date().toISOString());
  return addDaysToDateStr(todayStr, -1);
}

// SOURCE_BRANCH is the integration branch whose first-parent history is the
// daily source of truth. Under the release train, delivery flows through
// release/next; main only receives version cuts. (LUL-801)
export const SOURCE_BRANCH = 'origin/release/next';

export function generateRange(since, until, { cwd = REPO_ROOT, outputDir = REPORTS_DIR } = {}) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const byDay = buildEntriesByDay(SOURCE_BRANCH, cwd);
  const written = [];
  for (const day of enumerateDays(since, until)) {
    const entries = byDay.get(day) ?? [];
    const md = renderDay(day, entries);
    const filePath = path.join(outputDir, `${day}.md`);
    writeFileSync(filePath, md);
    written.push(filePath);
  }
  return written;
}

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (arg === '--backfill') opts.backfill = true;
    else if (arg.startsWith('--since=')) opts.since = arg.slice('--since='.length);
    else if (arg.startsWith('--until=')) opts.until = arg.slice('--until='.length);
    else if (arg.startsWith('--day=')) opts.day = arg.slice('--day='.length);
    else throw new Error(`unrecognized argument: ${arg}`);
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  let since;
  let until;
  if (opts.day) {
    since = until = opts.day;
  } else if (opts.backfill) {
    since = FIRST_COMPANY_DAY;
    until = opts.until || yesterdayInTz();
  } else {
    since = opts.since || FIRST_COMPANY_DAY;
    until = opts.until || yesterdayInTz();
  }
  const written = generateRange(since, until);
  for (const f of written) console.log(`wrote ${path.relative(REPO_ROOT, f)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
