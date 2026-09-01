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
// Diagnosis and analysis
// ---------------------------------------------------------------------------
function diagnoseFailures(failures) {
  if (failures.length === 0) {
    return { headline: 'All tests passed.', isCritical: false };
  }

  // Check if >80% of failures are timeouts with same timeout value
  const timeoutFailures = failures.filter((f) => f.error && f.error.includes('timeout'));
  if (timeoutFailures.length / failures.length > 0.8) {
    const timeouts = [...new Set(timeoutFailures.map((f) => f.error.match(/(\d+)ms/)?.[1]).filter(Boolean))];
    return {
      headline: `Infrastructure failure detected: ${timeoutFailures.length}/${failures.length} failures are timeouts. This is a single infrastructure issue (likely suite bootstrap or server connectivity), not ${timeoutFailures.length} independent regressions.`,
      isCritical: true,
      variants: timeouts.length > 0 ? `All timeouts with variants: [${timeouts.join(', ')}ms]` : null,
    };
  }

  // Check if most failures are in the same file
  const byFile = {};
  for (const f of failures) {
    byFile[f.specFile] = (byFile[f.specFile] || 0) + 1;
  }
  const topFile = Object.entries(byFile).sort((a, b) => b[1] - a[1])[0];
  if (topFile && topFile[1] / failures.length > 0.5) {
    return {
      headline: `Most failures are in a single spec: \`${topFile[0]}\` (${topFile[1]}/${failures.length}). This suggests the issue is localized, not a systemic regression.`,
      isCritical: false,
    };
  }

  // Check by severity
  const p0Count = failures.filter((f) => f.severity === 'P0').length;
  if (p0Count > 0) {
    return {
      headline: `${p0Count} P0 (game-breaking) failure(s) detected. The core game loop is affected.`,
      isCritical: true,
    };
  }

  return {
    headline: `${failures.length} test(s) failing, no P0 severity. Check below for details.`,
    isCritical: false,
  };
}

// ---------------------------------------------------------------------------
// Report readers
// ---------------------------------------------------------------------------
function getLastReportDate() {
  const dir = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports');
  try {
    const files = require('fs').readdirSync(dir);
    const mdFiles = files.filter((f) => f.endsWith('.md')).sort().reverse();
    if (mdFiles.length > 1) {
      return mdFiles[1].replace('.md', ''); // Return second-most-recent (previous to today)
    }
  } catch {
    // Directory doesn't exist or read error
  }
  return null;
}

function parseMarkdownReport(date) {
  const file = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports', `${date}.md`);
  try {
    const content = require('fs').readFileSync(file, 'utf8');
    const failures = [];
    const lines = content.split('\n');
    let currentSeverity = null;

    for (const line of lines) {
      if (/^## (P[0-3])/.test(line)) {
        currentSeverity = line.match(/^## (P[0-3])/)[1];
      } else if (currentSeverity && line.startsWith('- `')) {
        // Parse: - `file.ts` :: title [project] -- error
        const specMatch = line.match(/^- `([^`]+)`/);
        if (specMatch) {
          failures.push({
            specFile: specMatch[1],
            severity: currentSeverity,
            title: 'unknown', // We don't store full title in md
          });
        }
      }
    }
    return failures;
  } catch {
    return [];
  }
}

async function getCommitDelta() {
  const { execSync } = await import('child_process');
  try {
    // Get commits on release/next since yesterday
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const commits = execSync(
      `git log --oneline --since="${oneDayAgo}" origin/release/next 2>/dev/null | head -20`,
      { cwd: REPO_ROOT, encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ...rest] = line.split(' ');
        return { hash: hash.slice(0, 7), message: rest.join(' ') };
      });
    return commits;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HTML Report Writer
// ---------------------------------------------------------------------------
function writeHtmlReport({ date, failures, totalTests, filedCount, dryRun, diagnosis, newFailures, repeatFailures, commits }) {
  const dir = path.join(REPO_ROOT, 'QA_REGRESSION', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.html`);

  const bySeverity = { P0: [], P1: [], P2: [], P3: [] };
  for (const f of failures) bySeverity[f.severity].push(f);

  const escapedHtml = (str) => {
    const div = new Map([
      ['&', '&amp;'],
      ['<', '&lt;'],
      ['>', '&gt;'],
      ['"', '&quot;'],
      ["'", '&#39;'],
    ]);
    return String(str).replace(/[&<>"']/g, (c) => div.get(c) || c);
  };

  const diagnosisClass = diagnosis.isCritical ? 'critical' : '';
  const diagnosisText = escapedHtml(diagnosis.headline);
  const diagnosisVariants = diagnosis.variants ? `<div style="margin-top: 8px; font-size: 14px; color: inherit;">${escapedHtml(diagnosis.variants)}</div>` : '';

  const statBoxes = [
    { label: 'Total Tests', value: totalTests ?? '?', severity: 'p0' },
    { label: 'Failing', value: failures.length, severity: failures.some((f) => f.severity === 'P0') ? 'p0' : 'p2' },
  ];
  if (!dryRun) {
    statBoxes.push({ label: 'New Tickets', value: filedCount, severity: 'p1' });
  }
  for (const sev of ['P0', 'P1', 'P2', 'P3']) {
    if (bySeverity[sev].length > 0) {
      statBoxes.push({ label: `${sev} Failures`, value: bySeverity[sev].length, severity: sev.toLowerCase() });
    }
  }

  const commitSection = commits.length > 0
    ? `
    <div class="commit-delta">
      <h3>Recent Commits on release/next (last 24h)</h3>
      <div class="commit-list">
        ${commits.map((c) => `<div class="commit-item"><span class="commit-hash">${escapedHtml(c.hash)}</span>${escapedHtml(c.message)}</div>`).join('')}
      </div>
    </div>
    `
    : '';

  const failureSections = ['P0', 'P1', 'P2', 'P3']
    .filter((sev) => bySeverity[sev].length > 0)
    .map((sev) => {
      const severityLabel = sev === 'P0' ? 'P0 — Game-Breaking' : sev === 'P1' ? 'P1 — High' : sev === 'P2' ? 'P2 — Medium' : 'P3 — Low';
      return `
    <div class="section">
      <div class="section-title">${severityLabel} (${bySeverity[sev].length})</div>
      <div class="failure-list">
        ${bySeverity[sev]
          .map((f) => {
            const marker = ticketMarker(f);
            const isNew = newFailures.has(marker);
            const isRepeat = repeatFailures.has(marker);
            const css = isNew ? 'new' : isRepeat ? 'repeat' : '';
            return `
        <div class="failure-item ${css}">
          <div class="failure-spec">${escapedHtml(f.specFile)}</div>
          <div class="failure-title">${escapedHtml(f.title)}</div>
          ${f.project ? `<div class="failure-project">Project: ${escapedHtml(f.project)}</div>` : ''}
          ${f.error ? `<div class="failure-error">${escapedHtml(f.error)}</div>` : ''}
          ${isNew ? '<div style="margin-top: 4px; font-size: 11px; color: #d32f2f; font-weight: 600;">⚠ NEW FAILURE</div>' : ''}
          ${isRepeat ? '<div style="margin-top: 4px; font-size: 11px; color: #f9a825; font-weight: 600;">↻ REPEAT (has open ticket)</div>' : ''}
        </div>
        `;
          })
          .join('')}
      </div>
    </div>
    `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Regression Report — ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 32px; margin-bottom: 10px; color: #222; }
    .meta { font-size: 14px; color: #666; margin-bottom: 30px; }
    .diagnosis {
      background: #fff8e1;
      border-left: 4px solid #f9a825;
      padding: 16px;
      margin-bottom: 30px;
      border-radius: 4px;
      font-size: 16px;
      line-height: 1.5;
    }
    .diagnosis.critical { background: #ffebee; border-left-color: #d32f2f; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 30px; }
    .stat-box {
      background: #f9f9f9;
      padding: 16px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      text-align: center;
    }
    .stat-number { font-size: 28px; font-weight: bold; color: #1976d2; }
    .stat-label { font-size: 14px; color: #666; margin-top: 8px; }
    .stat-box.critical .stat-number { color: #d32f2f; }
    .stat-box.warning .stat-number { color: #f9a825; }
    .commit-delta {
      background: #f0f7ff;
      border: 1px solid #90caf9;
      padding: 16px;
      margin-bottom: 30px;
      border-radius: 4px;
    }
    .commit-delta h3 { font-size: 16px; margin-bottom: 12px; color: #1565c0; }
    .commit-list { font-family: 'Courier New', monospace; font-size: 13px; }
    .commit-item { padding: 4px 0; color: #333; }
    .commit-hash { color: #1976d2; font-weight: 600; margin-right: 8px; }
    .section { margin-bottom: 40px; }
    .section-title { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #222; padding-bottom: 8px; border-bottom: 2px solid #e0e0e0; }
    .failure-group { margin-bottom: 20px; }
    .failure-group-title { font-size: 14px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .failure-list { margin-left: 16px; }
    .failure-item {
      padding: 12px;
      background: #fafafa;
      border-left: 3px solid #ddd;
      margin-bottom: 8px;
      border-radius: 2px;
      font-size: 13px;
    }
    .failure-item.new { border-left-color: #d32f2f; background: #ffebee; }
    .failure-item.repeat { border-left-color: #f9a825; background: #fff8e1; }
    .failure-spec { font-family: 'Courier New', monospace; color: #1565c0; font-weight: 600; }
    .failure-title { margin: 4px 0; color: #333; }
    .failure-project { font-size: 12px; color: #999; margin-top: 4px; }
    .failure-error {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #d32f2f;
      margin-top: 4px;
      background: rgba(211, 47, 47, 0.05);
      padding: 8px;
      border-radius: 2px;
    }
    .p0 .stat-number { color: #d32f2f; }
    .p1 .stat-number { color: #f9a825; }
    .p2 .stat-number { color: #1976d2; }
    .p3 .stat-number { color: #388e3c; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #999; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>QA Regression Report</h1>
    <div class="meta">${date} — Full \`e2e/\` suite against \`release/next\`</div>

    <div class="diagnosis ${diagnosisClass}">
      <strong>Diagnosis:</strong> ${diagnosisText}
      ${diagnosisVariants}
    </div>

    <div class="stats">
      ${statBoxes.map((box) => `<div class="stat-box ${box.severity}"><div class="stat-number">${box.value}</div><div class="stat-label">${box.label}</div></div>`).join('')}
    </div>

    ${commitSection}

    ${failureSections}

    <div class="footer">
      <p>Report generated by \`scripts/qa-regression.mjs\` — daily QA regression run against \`release/next\`.</p>
      <p>See \`QA_REGRESSION/reports/${date}.md\` for the raw list. File a bug if the diagnosis is wrong.</p>
    </div>
  </div>
</body>
</html>
`;

  writeFileSync(file, html);
  return file;
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

  // Collect new and repeat failures for HTML report
  const newFailures = new Set();
  const repeatFailures = new Set();

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
      if (hasOpenTicket(openIssues, marker)) {
        repeatFailures.add(marker);
      } else {
        newFailures.add(marker);
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
  } else if (!shouldPost) {
    // In dry-run, estimate which are new by comparing to previous report
    const lastDate = getLastReportDate();
    if (lastDate) {
      const lastFailures = parseMarkdownReport(lastDate);
      const lastMarkers = new Set(lastFailures.map(ticketMarker));
      for (const f of failures) {
        const marker = ticketMarker(f);
        if (lastMarkers.has(marker)) {
          repeatFailures.add(marker);
        } else {
          newFailures.add(marker);
        }
      }
    }
  }

  // Generate diagnosis
  const diagnosis = diagnoseFailures(failures);

  // Get recent commits
  let commits = [];
  try {
    commits = await getCommitDelta();
  } catch {
    // Silently fail if git is not available
  }

  // Write both Markdown and HTML reports
  const mdFile = writeReport({ date, failures, totalTests, filedCount, dryRun: !shouldPost });
  const htmlFile = writeHtmlReport({ date, failures, totalTests, filedCount, dryRun: !shouldPost, diagnosis, newFailures, repeatFailures, commits });

  console.log(`QA regression ${date}: ${failures.length} failing / ${totalTests ?? '?'} total.`);
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
