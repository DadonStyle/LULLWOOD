import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseAbsences, formatReport, ROLLUP_EVENTS } from './diagnose-required-check-absence.mjs';

const REQUIRED = ['build, typecheck, lint', 'unit tests', 'playwright smoke suite'];

// The literal PR #166 measurement (LUL-826), head dfca691563784695ced3cf11384bf6595976c7ec:
// two workflow_dispatch runs produced five completed/success check-runs; the
// rollup reported only the two Vercel contexts.
const PR166 = {
  required: REQUIRED,
  rollupNames: ['Vercel', 'Vercel Preview Comments'],
  checkRuns: [
    { name: 'build, typecheck, lint', status: 'completed', conclusion: 'success', checkSuiteId: 89521639625 },
    { name: 'unit tests', status: 'completed', conclusion: 'success', checkSuiteId: 89521639625 },
    { name: 'playwright smoke suite', status: 'completed', conclusion: 'success', checkSuiteId: 89521639625 },
    { name: 'workflow guard check', status: 'completed', conclusion: 'success', checkSuiteId: 89521642991 },
    { name: 'Vercel Preview Comments', status: 'completed', conclusion: 'success', checkSuiteId: 89521638749 },
  ],
  workflowRuns: [
    { checkSuiteId: 89521639625, event: 'workflow_dispatch', name: 'CI', id: 33042966070 },
    { checkSuiteId: 89521642991, event: 'workflow_dispatch', name: 'Workflow guard check', id: 33042967322 },
  ],
};

test('the PR #166 shape: all three required contexts green on the commit via workflow_dispatch -- every one is non-pr-event', () => {
  const findings = diagnoseAbsences(PR166);
  assert.equal(findings.length, 3);
  assert.deepEqual([...new Set(findings.map((f) => f.cause))], ['non-pr-event']);
  assert.deepEqual(findings.map((f) => f.context).sort(), [...REQUIRED].sort());
  // The remedy must name the actual lever, not "retry" -- retrying was what
  // burned two hours on #166.
  for (const f of findings) {
    assert.match(f.remedy, /push a commit to the head branch/i);
    assert.doesNotMatch(f.remedy, /re-?dispatch this workflow (and|to) (fix|resolve)/i);
  }
});

test('the #171/#165/#170 control: push-produced checks present in the rollup yield no findings at all', () => {
  const findings = diagnoseAbsences({
    required: REQUIRED,
    rollupNames: [...REQUIRED, 'workflow guard check', 'Vercel', 'Vercel Preview Comments', 'open or refresh the PR'],
    checkRuns: PR166.checkRuns,
    workflowRuns: [{ checkSuiteId: 89521639625, event: 'push', name: 'CI', id: 1 }],
  });
  assert.deepEqual(findings, []);
});

test('CI never ran on this head: no check-run of that name at all', () => {
  const findings = diagnoseAbsences({
    required: ['unit tests'],
    rollupNames: ['Vercel'],
    checkRuns: [],
    workflowRuns: [],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cause, 'never-ran');
});

test('the LUL-822/#171 in-progress case stays distinct from the workflow_dispatch case', () => {
  const findings = diagnoseAbsences({
    required: ['playwright smoke suite'],
    rollupNames: [],
    checkRuns: [{ name: 'playwright smoke suite', status: 'in_progress', conclusion: null, checkSuiteId: 7 }],
    workflowRuns: [{ checkSuiteId: 7, event: 'push', name: 'CI', id: 33051161806 }],
  });
  assert.equal(findings[0].cause, 'pending');
  assert.match(findings[0].remedy, /nothing is broken/i);
});

test('a red check is reported as failed, and the remedy explicitly says not to re-dispatch', () => {
  const findings = diagnoseAbsences({
    required: ['unit tests'],
    rollupNames: [],
    checkRuns: [{ name: 'unit tests', status: 'completed', conclusion: 'failure', checkSuiteId: 7 }],
    workflowRuns: [{ checkSuiteId: 7, event: 'push', name: 'CI', id: 1 }],
  });
  assert.equal(findings[0].cause, 'failed');
  assert.match(findings[0].remedy, /do not re-dispatch/i);
});

test('pending wins over non-pr-event when a rerun is mid-flight alongside a green dispatch run', () => {
  const findings = diagnoseAbsences({
    required: ['unit tests'],
    rollupNames: [],
    checkRuns: [
      { name: 'unit tests', status: 'completed', conclusion: 'success', checkSuiteId: 7 },
      { name: 'unit tests', status: 'in_progress', conclusion: null, checkSuiteId: 8 },
    ],
    workflowRuns: [
      { checkSuiteId: 7, event: 'workflow_dispatch', name: 'CI', id: 1 },
      { checkSuiteId: 8, event: 'push', name: 'CI', id: 2 },
    ],
  });
  assert.equal(findings[0].cause, 'pending');
});

test('an unresolvable check-suite is never reported as the benign non-pr-event case', () => {
  // `actions/runs?head_sha=` is a windowed list; a check-suite that falls
  // outside it must not be silently treated as "produced by a bad event",
  // which would hand out a confidently wrong remedy.
  const findings = diagnoseAbsences({
    required: ['unit tests'],
    rollupNames: [],
    checkRuns: [{ name: 'unit tests', status: 'completed', conclusion: 'success', checkSuiteId: 999 }],
    workflowRuns: [],
  });
  assert.equal(findings[0].cause, 'unexplained');
  assert.match(findings[0].detail, /event unknown/);
});

test('a green push-produced check that is somehow still absent is "unexplained", not silently excused', () => {
  const findings = diagnoseAbsences({
    required: ['unit tests'],
    rollupNames: [],
    checkRuns: [{ name: 'unit tests', status: 'completed', conclusion: 'success', checkSuiteId: 7 }],
    workflowRuns: [{ checkSuiteId: 7, event: 'push', name: 'CI', id: 1 }],
  });
  assert.equal(findings[0].cause, 'unexplained');
  assert.match(findings[0].remedy, /PUT \/pulls\/\{n\}\/merge/);
});

test('merge_group and pull_request are rollup-eligible; workflow_dispatch and schedule are not', () => {
  assert.ok(ROLLUP_EVENTS.has('push'));
  assert.ok(ROLLUP_EVENTS.has('pull_request'));
  assert.ok(ROLLUP_EVENTS.has('merge_group'));
  assert.ok(!ROLLUP_EVENTS.has('workflow_dispatch'));
  assert.ok(!ROLLUP_EVENTS.has('schedule'));
  assert.ok(!ROLLUP_EVENTS.has('workflow_run'));
});

test('formatReport emits one ::error:: per finding so the refusal is visible in the run log', () => {
  const lines = formatReport(diagnoseAbsences(PR166));
  assert.equal(lines.filter((l) => l.startsWith('::error::')).length, 3);
  assert.ok(lines.some((l) => l.includes('LUL-762')));
});

test('formatReport says so when the refusal is NOT about an absence', () => {
  const lines = formatReport([]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::notice::/);
});
