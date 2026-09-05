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
import { execSync } from 'node:child_process';

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
// Diagnosis: detect infrastructure failures
// ---------------------------------------------------------------------------
function analyzeFailures(failures) {
  if (failures.length === 0) {
    return { diagnosis: 'All green', category: 'pass' };
  }

  const timeoutFailures = failures.filter((f) =>
    f.error && /timeout of \d+ms exceeded/i.test(f.error)
  );
  const timeoutPercent = (timeoutFailures.length / failures.length) * 100;

  if (timeoutPercent >= 80) {
    return {
      diagnosis:
        `${Math.round(timeoutPercent)}% of the suite times out (${timeoutFailures.length}/${failures.length} failures). ` +
        `This is a single infrastructure failure — the test suite did not boot or the server is unresponsive. ` +
        `See the test environment and server logs, not individual test names.`,
      category: 'infrastructure',
    };
  }

  return { diagnosis: null, category: 'real' };
}

// ---------------------------------------------------------------------------
// Previous run tracking
// ---------------------------------------------------------------------------
function getPreviousReportDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day - 1);
  const prev = d.toISOString().slice(0, 10);
  return prev;
}

function loadPreviousFailures(date) {
  const prevDate = getPreviousReportDate(date);
  const dir = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports');
  const mdFile = path.join(dir, `${prevDate}.md`);
  try {
    const content = readFileSync(mdFile, 'utf8');
    const failures = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^- `([^`]+)` :: (.+?)(?:\s*\[.+?\])?(?:\s*--.*)?$/);
      if (match) {
        failures.push({ specFile: match[1], title: match[2].trim() });
      }
    }
    return failures;
  } catch {
    return [];
  }
}

function categorizeByStaleness(current, previous) {
  const prevKeys = new Set(previous.map((f) => `${f.specFile}::${f.title}`));
  const currKeys = new Set(current.map((f) => `${f.specFile}::${f.title}`));

  const newFailures = current.filter((f) => !prevKeys.has(`${f.specFile}::${f.title}`));
  const repeatFailures = current.filter((f) => prevKeys.has(`${f.specFile}::${f.title}`));
  const newlyFixed = previous.filter((f) => !currKeys.has(`${f.specFile}::${f.title}`));

  return { newFailures, repeatFailures, newlyFixed };
}

// ---------------------------------------------------------------------------
// Git diff since last run
// ---------------------------------------------------------------------------
function getCommitsSinceLastRun(date) {
  try {
    // Try to get commits on release/next since yesterday
    // Fall back gracefully if git or branch lookup fails
    const res = execSync('git log --oneline -20 release/next 2>/dev/null || echo ""', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
    });
    return res
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Report writers: Markdown and HTML
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

function writeHtmlReport({
  date,
  failures,
  totalTests,
  diagnosis,
  category,
  newFailures,
  repeatFailures,
  newlyFixed,
  commits,
}) {
  const dir = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.html`);

  const bySeverity = { P0: [], P1: [], P2: [], P3: [] };
  for (const f of failures) bySeverity[f.severity].push(f);

  const escapedDiagnosis = (diagnosis || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QA Regression Report — ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #24292e;
      background: #fff;
      padding: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0d1117; color: #c9d1d9; }
      a { color: #58a6ff; }
      .diagnosis { background: #161b22; border-color: #30363d; }
      .section { border-color: #30363d; }
      .failure { background: #0d1117; border-color: #30363d; }
      .new { background: rgba(34, 110, 147, 0.1); border-color: #30363d; }
      .repeat { background: rgba(110, 78, 30, 0.1); border-color: #30363d; }
      .severity-p0 { background: rgba(248, 81, 73, 0.1); }
      .severity-p1 { background: rgba(233, 151, 30, 0.1); }
      .severity-p2 { background: rgba(130, 138, 142, 0.1); }
    }
    h1 { margin: 0 0 0.5rem 0; font-size: 2rem; }
    h2 { margin: 2rem 0 1rem 0; font-size: 1.3rem; font-weight: 600; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.5rem; }
    @media (prefers-color-scheme: dark) {
      h2 { border-bottom-color: #30363d; }
    }
    .header-meta { font-size: 0.9rem; color: #666; margin-bottom: 1.5rem; }
    @media (prefers-color-scheme: dark) {
      .header-meta { color: #8b949e; }
    }
    .diagnosis {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 1rem;
      margin: 1rem 0 2rem 0;
      line-height: 1.6;
    }
    .diagnosis.infrastructure { border-left: 4px solid #e74c3c; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin: 1.5rem 0;
    }
    .stat-box {
      background: #f6f8fa;
      padding: 1rem;
      border-radius: 6px;
      text-align: center;
      border: 1px solid #d0d7de;
    }
    @media (prefers-color-scheme: dark) {
      .stat-box { background: #161b22; border-color: #30363d; }
    }
    .stat-number { font-size: 1.8rem; font-weight: bold; color: #0366d6; margin-bottom: 0.25rem; }
    .stat-label { font-size: 0.85rem; color: #666; }
    @media (prefers-color-scheme: dark) {
      .stat-label { color: #8b949e; }
    }
    .section { border-left: 4px solid #d0d7de; padding-left: 1rem; margin: 2rem 0; }
    .section.new { border-left-color: #226e93; }
    .section.repeat { border-left-color: #6e4e1e; }
    .section.fixed { border-left-color: #1a633b; }
    .commit-list { background: #f6f8fa; padding: 1rem; border-radius: 6px; max-height: 300px; overflow-y: auto; }
    @media (prefers-color-scheme: dark) {
      .commit-list { background: #161b22; }
    }
    .commit-item { font-family: monospace; font-size: 0.9rem; padding: 0.25rem 0; }
    .failure {
      background: #f6f8fa;
      padding: 0.75rem;
      margin: 0.5rem 0;
      border-left: 3px solid #d0d7de;
      border-radius: 3px;
      break-inside: avoid;
    }
    @media (prefers-color-scheme: dark) {
      .failure { background: #0d1117; border-left-color: #30363d; }
    }
    .failure.new { border-left-color: #226e93; background: rgba(34, 110, 147, 0.1); }
    .failure.repeat { border-left-color: #6e4e1e; background: rgba(110, 78, 30, 0.1); }
    .failure-title { font-weight: 600; margin-bottom: 0.25rem; }
    .failure-meta { font-size: 0.85rem; color: #666; font-family: monospace; margin-top: 0.25rem; }
    @media (prefers-color-scheme: dark) {
      .failure-meta { color: #8b949e; }
    }
    .failure-error { font-size: 0.85rem; color: #e74c3c; margin-top: 0.25rem; font-family: monospace; word-break: break-word; }
    .severity-badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.8rem;
      font-weight: 600;
      margin-left: 0.5rem;
    }
    .severity-p0 { background: #fee; color: #c02828; }
    .severity-p1 { background: #fff3cd; color: #856404; }
    .severity-p2 { background: #e9ecef; color: #383d41; }
    .severity-p3 { background: #e2e3e5; color: #383d41; }
    @media (prefers-color-scheme: dark) {
      .severity-p0 { background: rgba(248, 81, 73, 0.2); color: #f85149; }
      .severity-p1 { background: rgba(233, 151, 30, 0.2); color: #d29922; }
      .severity-p2 { background: rgba(130, 138, 142, 0.2); color: #8b949e; }
      .severity-p3 { background: rgba(102, 109, 118, 0.2); color: #8b949e; }
    }
    .no-issues { color: #2c7c2c; font-weight: 600; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e1e4e8; font-size: 0.85rem; color: #666; }
    @media (prefers-color-scheme: dark) {
      .footer { border-top-color: #30363d; color: #8b949e; }
    }
  </style>
</head>
<body>
  <h1>QA Regression Report</h1>
  <div class="header-meta">Run: ${date} · Full \`e2e/\` suite · ${totalTests || '?'} tests total</div>

  ${
    diagnosis
      ? `<div class="diagnosis ${category}"><strong>Diagnosis:</strong> ${escapedDiagnosis}</div>`
      : ''
  }

  <div class="stats">
    <div class="stat-box">
      <div class="stat-number">${failures.length}</div>
      <div class="stat-label">Failing</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${newFailures.length}</div>
      <div class="stat-label">New Today</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${repeatFailures.length}</div>
      <div class="stat-label">Repeat</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${newlyFixed.length}</div>
      <div class="stat-label">Newly Fixed</div>
    </div>
  </div>

  ${
    commits.length > 0
      ? `
  <h2>Changes Since Last Run</h2>
  <div class="commit-list">
    ${commits.map((c) => `<div class="commit-item">${c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`).join('')}
  </div>
  `
      : ''
  }

  ${
    newFailures.length > 0
      ? `
  <div class="section new">
    <h2>New Failures (${newFailures.length})</h2>
    ${newFailures
      .sort((a, b) => b.severity.localeCompare(a.severity))
      .map(
        (f) => `
      <div class="failure new">
        <div class="failure-title">
          ${(f.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          <span class="severity-badge severity-${f.severity.toLowerCase()}">${f.severity}</span>
        </div>
        <div class="failure-meta">${f.specFile}${f.project ? ` · ${f.project}` : ''}</div>
        ${f.error ? `<div class="failure-error">${f.error}</div>` : ''}
      </div>
    `
      )
      .join('')}
  </div>
  `
      : ''
  }

  ${
    repeatFailures.length > 0
      ? `
  <div class="section repeat">
    <h2>Repeat Failures (${repeatFailures.length})</h2>
    <p style="margin-bottom: 1rem; font-size: 0.9rem;">These failed in the previous run too.</p>
    ${repeatFailures
      .sort((a, b) => b.severity.localeCompare(a.severity))
      .map(
        (f) => `
      <div class="failure repeat">
        <div class="failure-title">
          ${(f.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          <span class="severity-badge severity-${f.severity.toLowerCase()}">${f.severity}</span>
        </div>
        <div class="failure-meta">${f.specFile}${f.project ? ` · ${f.project}` : ''}</div>
        ${f.error ? `<div class="failure-error">${f.error}</div>` : ''}
      </div>
    `
      )
      .join('')}
  </div>
  `
      : ''
  }

  ${
    newlyFixed.length > 0
      ? `
  <div class="section fixed">
    <h2>Newly Fixed (${newlyFixed.length})</h2>
    <p style="margin-bottom: 1rem; font-size: 0.9rem;">These failed yesterday but pass today.</p>
    ${newlyFixed
      .map(
        (f) => `
      <div style="background: #f6f8fa; padding: 0.75rem; margin: 0.5rem 0; border-left: 3px solid #1a633b; border-radius: 3px;">
        <div style="font-weight: 600; margin-bottom: 0.25rem;">
          ${(f.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>
        <div style="font-size: 0.85rem; color: #666; font-family: monospace; margin-top: 0.25rem;">${f.specFile}${f.project ? ` · ${f.project}` : ''}</div>
      </div>
    `
      )
      .join('')}
  </div>
  `
      : ''
  }

  ${
    failures.length === 0
      ? `<div style="margin: 2rem 0;"><p class="no-issues">✓ All tests passing.</p></div>`
      : `
  <h2>All Failures by Severity</h2>
  ${['P0', 'P1', 'P2', 'P3']
    .filter((sev) => bySeverity[sev].length > 0)
    .map(
      (sev) => `
    <h3 style="margin: 1.5rem 0 0.75rem 0; font-size: 1.1rem; font-weight: 600; color: ${
        sev === 'P0'
          ? '#c02828'
          : sev === 'P1'
            ? '#856404'
            : '#383d41'
      };">${sev}${sev === 'P0' ? ' — Game-breaking' : ''} (${bySeverity[sev].length})</h3>
    ${bySeverity[sev]
      .map(
        (f) => `
      <div class="failure severity-${sev.toLowerCase()}">
        <div class="failure-title">
          ${(f.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>
        <div class="failure-meta">${f.specFile}${f.project ? ` · ${f.project}` : ''}</div>
        ${f.error ? `<div class="failure-error">${f.error}</div>` : ''}
      </div>
    `
      )
      .join('')}
  `
    )
    .join('')}
  `
  }

  <div class="footer">
    Generated by <code>scripts/qa-regression.mjs</code> · Report only, does not block deployment
  </div>
</body>
</html>`;

  writeFileSync(file, html);
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

  // Analyze failures for diagnosis and categorize by staleness
  const { diagnosis, category } = analyzeFailures(failures);
  const previousFailures = loadPreviousFailures(date);
  const { newFailures, repeatFailures, newlyFixed } = categorizeByStaleness(failures, previousFailures);
  const commits = getCommitsSinceLastRun(date);

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
          `purely so the failure isn't lost. See QA_REGRESSION/reports/${date}.html for the full run.`,
        status: SEVERITY_TO_STATUS[f.severity],
        priority: SEVERITY_TO_PRIORITY[f.severity],
        assigneeAgentId,
      });
      filedCount += 1;
    }
  }

  const mdFile = writeReport({ date, failures, totalTests, filedCount, dryRun: !shouldPost });
  const htmlFile = writeHtmlReport({
    date,
    failures,
    totalTests,
    diagnosis,
    category,
    newFailures,
    repeatFailures,
    newlyFixed,
    commits,
  });

  console.log(`QA regression ${date}: ${failures.length} failing / ${totalTests ?? '?'} total.`);
  if (diagnosis) console.log(`Diagnosis: ${diagnosis}`);
  if (shouldPost) {
    console.log(`Filed ${filedCount} new ticket(s) (${failures.length - filedCount} already had an open ticket).`);
  } else {
    console.log('Dry run (no --post) -- no tickets filed.');
  }
  console.log(`Markdown: ${path.relative(REPO_ROOT, mdFile)}`);
  console.log(`HTML: ${path.relative(REPO_ROOT, htmlFile)}`);
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
