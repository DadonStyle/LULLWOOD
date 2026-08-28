import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, collectFailures, ticketMarker } from './qa-regression.mjs';

test('classify: core-loop specs are P0', () => {
  assert.equal(classify('e2e/hide.spec.ts'), 'P0');
  assert.equal(classify('e2e/win-persist.spec.ts'), 'P0');
  assert.equal(classify('e2e/smoke.spec.ts'), 'P0');
});

test('classify: mobile specs are P1', () => {
  assert.equal(classify('e2e/mobile/input-mode.spec.ts'), 'P1');
});

test('classify: unmapped specs default to P2, not silently P0/P3', () => {
  assert.equal(classify('e2e/some-new-spec.spec.ts'), 'P2');
});

test('collectFailures: walks nested suites and reports only non-passing tests', () => {
  const report = {
    suites: [
      {
        file: 'e2e/hide.spec.ts',
        specs: [
          {
            title: 'hides behind a rock',
            titlePath: ['hide.spec.ts'],
            tests: [{ status: 'expected', projectName: 'chromium', results: [{ status: 'passed' }] }],
          },
          {
            title: 'stays hidden while a predator passes',
            titlePath: ['hide.spec.ts'],
            tests: [
              {
                status: 'unexpected',
                projectName: 'chromium',
                results: [{ status: 'failed', error: { message: 'Timed out waiting for #hideState' } }],
              },
            ],
          },
        ],
        suites: [],
      },
    ],
  };
  const failures = collectFailures(report);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].specFile, 'e2e/hide.spec.ts');
  assert.match(failures[0].title, /stays hidden while a predator passes/);
  assert.match(failures[0].error, /Timed out waiting for #hideState/);
});

test('ticketMarker: stable, unique per spec+title (used for open-ticket dedup)', () => {
  const a = { specFile: 'e2e/hide.spec.ts', title: 'stays hidden' };
  const b = { specFile: 'e2e/hide.spec.ts', title: 'stays hidden' };
  const c = { specFile: 'e2e/hide.spec.ts', title: 'different test' };
  assert.equal(ticketMarker(a), ticketMarker(b));
  assert.notEqual(ticketMarker(a), ticketMarker(c));
});
