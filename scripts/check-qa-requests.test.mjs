// Run: node --test scripts/check-qa-requests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStep, parseAssertion, parseFrontMatter, validateRequest, resolveViewport } from './qa-request-grammar.mjs';
import { check } from './check-qa-requests.mjs';

const request = ({ steps = ['boot qaHooks', 'enter'], expected = ['no-console-errors'], extra = '', closing = true, viewports = '[desktop-1280x720]' } = {}) =>
  `---\nticket: LUL-1\ntitle: t\nrequested_by: Game Engineer\nbranch: release/next\nviewports: ${viewports}\n${extra}steps:\n${steps.map((s) => `  - ${s}`).join('\n')}\nexpected:\n${expected.map((s) => `  - ${s}`).join('\n')}\n${closing ? '---\n' : ''}\nbody text\n`;

test('the lul-3150 regression: single-quoted hook args never throw, they parse as a JS argument list', () => {
  assert.doesNotThrow(() => parseStep("hook qaOpenVeilOverloadTarget('lion') as idx"));
  assert.deepEqual(parseStep("hook qaOpenVeilOverloadTarget('lion') as idx"), { verb: 'hook', name: 'qaOpenVeilOverloadTarget', argsExpr: "'lion'", as: 'idx' });
  assert.deepEqual(parseStep('hook qaBuildScene({props:[{kind:\'bramble\',x:10,z:0}]}) as scene').argsExpr, "{props:[{kind:'bramble',x:10,z:0}]}");
  assert.deepEqual(parseStep('hook qaProbe(idx)').argsExpr, 'idx');
  assert.match(parseStep('hook qaProbe({{{)').error, /hook arguments do not parse/);
});

test('strict JSON hook args still come back as values', () => {
  assert.deepEqual(parseStep('hook qaSetWindDirection(1, 0)'), { verb: 'hook', name: 'qaSetWindDirection', args: [1, 0], as: undefined });
});

test('boot takes the e2e boot() options in any order', () => {
  assert.deepEqual(parseStep('boot qaHooks qaMissionKind=flush qaRoostIndex=0 seed=20260925'),
    { verb: 'boot', seed: '20260925', full: false, params: { qaMissionKind: 'flush', qaRoostIndex: '0' } });
  assert.equal(parseStep('boot qaHooks=1 seed=5').seed, '5');
  assert.equal(parseStep('boot qaHooks full').full, true);
  assert.match(parseStep('boot qaHooks evil=1').error, /boot option evil=1/);
});

test('agent synonyms map onto the canonical grammar', () => {
  assert.deepEqual(parseStep('wait 300'), { verb: 'sleep', ms: 300 });
  assert.deepEqual(parseStep('key ShiftLeft down'), { verb: 'keydown', code: 'ShiftLeft' });
  assert.deepEqual(parseStep('key-up KeyW'), { verb: 'keyup', code: 'KeyW' });
  assert.deepEqual(parseStep('key-press KeyH'), { verb: 'key', code: 'KeyH', hold: 0 });
  assert.deepEqual(parseStep('dom "#prompt" visible'), { verb: 'dom_wait', sel: '#prompt', state: 'visible' });
  assert.match(parseStep('sleep 20000').error, /over 10000 ms/);
});

test('assertions: dotted var paths, is/==/!= synonyms, literal differs, expression comparisons', () => {
  assert.deepEqual(parseAssertion('var scene.predators = 1'), { kind: 'var', name: 'scene.predators', op: '=', v: 1 });
  assert.deepEqual(parseAssertion('var mission.kind is "ghost"'), { kind: 'var', name: 'mission.kind', op: '=', v: 'ghost' });
  assert.deepEqual(parseAssertion('var a.b == 2'), { kind: 'var', name: 'a.b', op: '=', v: 2 });
  assert.deepEqual(parseAssertion('var x != 0'), { kind: 'var', name: 'x', op: 'differs-literal', v: 0 });
  assert.deepEqual(parseAssertion('var posDay.N differs from posDay.S'), { kind: 'var', name: 'posDay.N', op: 'differs', other: 'posDay.S' });
  assert.deepEqual(parseAssertion('expr during > before'), { kind: 'expr', expr: '(during) > (before)', op: 'is', v: true });
  assert.deepEqual(parseAssertion('expr after == before'), { kind: 'expr', expr: '(after) === (before)', op: 'is', v: true });
  assert.deepEqual(parseAssertion('dom "#hint" text contains "refuge" (at stage-1)'), { kind: 'dom', sel: '#hint', op: 'text', s: 'refuge' });
  assert.equal(parseAssertion('dom "#w" attr class contains "active"').op, 'attr-contains');
  assert.equal(parseAssertion('dom "#p" text does not contain "bush"').op, 'text-not');
  assert.match(parseAssertion('expr a = not json').error, /not JSON/);
  assert.match(parseAssertion('vibes are good').error, /NEEDS-GRAMMAR/);
});

test('front matter with a missing closing --- still parses', () => {
  const fm = parseFrontMatter(request({ closing: false }));
  assert.equal(fm.error, undefined);
  assert.deepEqual(fm.steps, ['boot qaHooks', 'enter']);
});

test('viewport aliases resolve; unknown viewports are reported', () => {
  assert.equal(resolveViewport('pixel5'), 'pixel5-landscape-727x393');
  assert.equal(resolveViewport('mobile-iphone-se-landscape-667x375'), 'iphone-se-landscape-667x375');
  assert.equal(resolveViewport('watch-40mm'), null);
  assert.match(validateRequest(request({ viewports: '[watch-40mm]' })).errors[0], /unknown viewport/);
});

test('validateRequest: OK, done, expired, wrong branch', () => {
  const now = new Date('2026-10-06T00:00:00Z');
  assert.deepEqual(validateRequest(request(), now), { status: 'OK', errors: [] });
  assert.equal(validateRequest(request({ extra: 'status: done\n' }), now).status, 'SKIPPED-DONE');
  assert.equal(validateRequest(request({ extra: 'expires: 2026-10-01\n' }), now).status, 'SKIPPED-EXPIRED');
  assert.equal(validateRequest(request().replace('release/next', 'lul-1-x'), now).status, 'WRONG-BRANCH');
});

test('check() flags only requests the tester cannot run', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-req-'));
  try {
    writeFileSync(path.join(dir, 'good.md'), request());
    writeFileSync(path.join(dir, 'bad.md'), request({ steps: ['dance wildly'] }));
    writeFileSync(path.join(dir, 'done.md'), request({ steps: ['dance wildly'], extra: 'status: done\n' }));
    const bad = check([path.join(dir, 'good.md'), path.join(dir, 'bad.md'), path.join(dir, 'done.md')]);
    assert.deepEqual(bad.map((b) => path.basename(b.file)), ['bad.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
