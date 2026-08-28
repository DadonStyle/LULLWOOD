#!/usr/bin/env node
// Founder directive (2026-08-28): per-PR smoke testing was too expensive
// relative to the pace of shipping. The full `e2e/` suite (every project in
// playwright.config.ts except `replay`, which is recording-only) now runs
// once a day instead of on every push, driven by a host cron
// (`~/.local/bin/qa-regression`), never by a GitHub Actions workflow -- CI
// must never hold Paperclip credentials (LUL-523, same reason
// scripts/board-integrity-check.mjs and scripts/watchdog-run-check.mjs are
// plain Node scripts run by something with PAPERCLIP_API_KEY in its own
// environment, not wired into .github/workflows/).
//
// This script does three things, in order:
//   1. Parse a Playwright JSON-reporter run (see below for how to produce one).
//   2. For each failing test, classify it by severity (see SEVERITY_MAP) and
//      file a Paperclip ticket -- `--post` only, dry-run otherwise. Dedup is
//      by an exact marker in the issue title, scoped to open issues, same
//      pattern as scripts/board-integrity-check.mjs's hasOpenWakeTicket: a
//      failure that already has an open ticket does not get a second one
//      every day it keeps failing.
//   3. Write a dated report to QA_REGRESSION/reports/<date>.md.
//
// This never touches PR/merge gating -- it has no opinion on required
// checks, does not comment on PRs, and does not fail its own exit code on a
// game-breaking regression (only on a script/infra error). It is a record
// and a ticket source, nothing else.
//
// Usage:
//   npx playwright test --reporter=json > /tmp/qa-regression-results.json
//   node scripts/qa-regression.mjs /tmp/qa-regression-results.json [--post]
//
// Env:
//   PAPERCLIP_API_URL      required for --post
//   PAPERCLIP_COMPANY_ID   required for --post
//   PAPERCLIP_API_KEY      optional; falls back to the durable CLI token at
//                          ~/.paperclip/auth.json so an unattended host cron
//                          works without a live agent session (same fallback
//                          as board-integrity-check.mjs/watchdog-run-check.mjs)
//   QA_REGRESSION_ASSIGNEE_AGENT_ID   optional; who non-P0 backlog tickets and
//                          P0 tickets get assigned to. Unset means unassigned
//                          (visible on the board, nobody woken) -- reasonable
//                          while QA/reviewer agents are paused.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Severity classification
//
// A judgement call, not a derived fact -- tune this table as the suite grows
// or as false-severity reports show up in practice. P0 is reserved for the
// core loop: if these break, the game is unplayable. Everything else is a
// real bug but does not justify an urgent/critical ticket.
// ---------------------------------------------------------------------------
const SEVERITY_MAP = [
  // [regex against the spec file path, severity]
  [/e2e\/smoke\.spec\.ts$/, 'P0'],
  [/e2e\/lifecycle\.spec\.ts$/, 'P0'],
  [/e2e\/hide\.spec\.ts$/, 'P0'],
  [/e2e\/win-persist\.spec\.ts$/, 'P0'],
  [/e2e\/charge-dodge\.spec\.ts$/, 'P0'],
  [/e2e\/blind-chase-cover\.spec\.ts$/, 'P0'],
  [/e2e\/scent\.spec\.ts$/, 'P1'],
  [/e2e\/cover-feedback\.spec\.ts$/, 'P1'],
  [/e2e\/positional-hiding\.spec\.ts$/, 'P1'],
  [/e2e\/input-mode\.spec\.ts$/, 'P1'],
  [/e2e\/mobile\/.*\.spec\.ts$/, 'P1'],
  [/e2e\/admin-mode\.spec\.ts$/, 'P2'],
  [/e2e\/layout\.spec\.ts$/, 'P2'],
  [/e2e\/map-seed\.spec\.ts$/, 'P2'],
  [/e2e\/lul211-founder-report\.spec\.ts$/, 'P3'],
  [/e2e\/seo\.spec\.ts$/, 'P3'],
];
const DEFAULT_SEVERITY = 'P2';

const SEVERITY_TO_PRIORITY = { P0: 'critical', P1: 'high', P2: 'medium', P3: 'low' };
// P0 goes to `todo` -- it's the "critical, game-breaking" case the founder
// asked to see immediately. Everything else goes to `backlog`, by severity,
// same as the founder asked: "open critical ... or backlog tickets by
// severity". Never `in_progress` -- filing does not claim the work.
const SEVERITY_TO_STATUS = { P0: 'todo', P1: 'backlog', P2: 'backlog', P3: 'backlog' };

function classify(specFile) {
  for (const [re, sev] of SEVERITY_MAP) {
    if (re.test(specFile)) return sev;
  }
  return DEFAULT_SEVERITY;
}

// ---------------------------------------------------------------------------
// Playwright JSON reporter parsing
// ---------------------------------------------------------------------------
function collectFailures(report) {
  const failures = [];
  function walk(suite, filePath) {
    const thisFile = suite.file ? path.posix.join(...suite.file.split(path.sep)) : filePath;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const lastResult = test.results?.[test.results.length - 1];
        const ok = test.status === 'expected' || test.status === 'passed' || lastResult?.status === 'passed';
        if (!ok) {
          failures.push({
            specFile: thisFile,
            title: [...(spec.titlePath ?? []), spec.title].filter(Boolean).join(' > ') || spec.title,
            project: test.projectName,
            error: (lastResult?.error?.message || lastResult?.errors?.[0]?.message || '').split('\n')[0].slice(0, 300),
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, thisFile);
  }
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return failures;
}

// ---------------------------------------------------------------------------
// Paperclip API (mirrors scripts/board-integrity-check.mjs's conventions --
// duplicated rather than imported so this detector's diff and test scope
// stay self-contained, same reasoning as that file's own header)
// ---------------------------------------------------------------------------
function authJsonPath() {
  return new URL('file://' + homedir() + '/.paperclip/auth.json');
}

function durableToken(apiBase) {
  try {
    const raw = readFileSync(authJsonPath());
    const creds = JSON.parse(raw).credentials || {};
    const entry =
      creds[apiBase] ||
      creds[apiBase.replace(/\/$/, '')] ||
      creds[apiBase + '/'] ||
      (Object.keys(creds).length === 1 ? Object.values(creds)[0] : null);
    return (entry || {}).token || null;
  } catch {
    return null;
  }
}

async function pcFetch(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchOpenIssues(apiBase, companyId, apiKey) {
  const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'];
  const all = [];
  for (const status of statuses) {
    const list = await pcFetch(`${apiBase}/api/companies/${companyId}/issues?status=${status}`, apiKey);
    all.push(...(Array.isArray(list) ? list : (list.issues ?? [])));
  }
  return all;
}

function hasOpenTicket(openIssues, marker) {
  return openIssues.some((issue) => (issue.title ?? '').startsWith(marker));
}

async function createIssue(apiBase, companyId, apiKey, { title, description, status, priority, assigneeAgentId }) {
  const res = await fetch(`${apiBase}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ title, description, status, priority, assigneeAgentId: assigneeAgentId || undefined }),
  });
  if (!res.ok) throw new Error(`POST issue -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function ticketMarker(failure) {
  return `QA_REGRESSION_FAIL: ${failure.specFile} :: ${failure.title}`;
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------
function writeReport({ date, failures, totalTests, filedCount, dryRun }) {
  const dir = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.md`);

  const bySeverity = { P0: [], P1: [], P2: [], P3: [] };
  for (const f of failures) bySeverity[f.severity].push(f);

  const lines = [
    `# QA Regression -- ${date}`,
    '',
    `Full \`e2e/\` suite against \`release/next\`. ${totalTests} tests, ${failures.length} failing.`,
    dryRun ? '' : `${filedCount} new ticket(s) filed to the Paperclip board (severities below); repeat failures already have an open ticket and were not re-filed.`,
    '',
  ].filter((l) => l !== undefined);

  for (const sev of ['P0', 'P1', 'P2', 'P3']) {
    if (bySeverity[sev].length === 0) continue;
    lines.push(`## ${sev}${sev === 'P0' ? ' -- game-breaking' : ''} (${bySeverity[sev].length})`, '');
    for (const f of bySeverity[sev]) {
      lines.push(`- \`${f.specFile}\` :: ${f.title}${f.project ? ` [${f.project}]` : ''}${f.error ? ` -- ${f.error}` : ''}`);
    }
    lines.push('');
  }

  if (failures.length === 0) {
    lines.push('All green.', '');
  }

  writeFileSync(file, lines.join('\n'));
  return file;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const shouldPost = args.includes('--post');
  const reportPath = args.find((a) => !a.startsWith('--'));
  if (!reportPath) {
    throw new Error('usage: node scripts/qa-regression.mjs <playwright-json-report> [--post]');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const rawFailures = collectFailures(report);
  const failures = rawFailures.map((f) => ({ ...f, severity: classify(f.specFile) }));
  const totalTests = report.stats?.expected + report.stats?.unexpected + report.stats?.flaky || undefined;

  const date = new Date().toISOString().slice(0, 10);
  let filedCount = 0;

  if (shouldPost && failures.length > 0) {
    const apiBase = (process.env.PAPERCLIP_API_URL || '').replace(/\/api\/?$/, '').replace(/\/$/, '');
    const apiKey = process.env.PAPERCLIP_API_KEY || durableToken(apiBase);
    const companyId = process.env.PAPERCLIP_COMPANY_ID;
    if (!apiBase || !apiKey || !companyId) {
      throw new Error('PAPERCLIP_API_URL, PAPERCLIP_COMPANY_ID, and a Paperclip token (PAPERCLIP_API_KEY or ~/.paperclip/auth.json) are required for --post.');
    }
    const assigneeAgentId = process.env.QA_REGRESSION_ASSIGNEE_AGENT_ID || undefined;
    const openIssues = await fetchOpenIssues(apiBase, companyId, apiKey);

    for (const f of failures) {
      const marker = ticketMarker(f);
      if (hasOpenTicket(openIssues, marker)) continue;
      await createIssue(apiBase, companyId, apiKey, {
        title: `${marker} (${f.severity})`,
        description:
          `Filed by scripts/qa-regression.mjs (daily QA regression, ${date}).\n\n` +
          `Spec: \`${f.specFile}\`\nTest: ${f.title}\n` +
          (f.project ? `Project: ${f.project}\n` : '') +
          (f.error ? `\nFirst error line:\n\`\`\`\n${f.error}\n\`\`\`\n` : '') +
          `\nSeverity ${f.severity} assigned by scripts/qa-regression.mjs's SEVERITY_MAP -- re-triage if this ` +
          `doesn't match the actual player impact. This ticket does not block any PR or merge; it exists ` +
          `purely so the failure isn't lost. See QA_REGRESSION/reports/${date}.md for the full run.`,
        status: SEVERITY_TO_STATUS[f.severity],
        priority: SEVERITY_TO_PRIORITY[f.severity],
        assigneeAgentId,
      });
      filedCount += 1;
    }
  }

  const file = writeReport({ date, failures, totalTests, filedCount, dryRun: !shouldPost });

  console.log(`QA regression ${date}: ${failures.length} failing / ${totalTests ?? '?'} total.`);
  if (shouldPost) {
    console.log(`Filed ${filedCount} new ticket(s) (${failures.length - filedCount} already had an open ticket).`);
  } else {
    console.log('Dry run (no --post) -- no tickets filed.');
  }
  console.log(`Report: ${path.relative(REPO_ROOT, file)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURLSafe(process.argv[1]);
function pathToFileURLSafe(p) {
  try {
    return new URL('file://' + path.resolve(p)).href;
  } catch {
    return null;
  }
}
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { classify, collectFailures, ticketMarker, SEVERITY_MAP };
