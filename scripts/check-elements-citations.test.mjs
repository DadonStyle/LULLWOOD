import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ANCHOR_FLOOR,
  anchorIdentifier,
  baselineKey,
  blankLiterals,
  checkCitations,
  classify,
  declarationSpans,
  diffAgainstBaseline,
  parseCitations,
} from './check-elements-citations.mjs';

// ---- blankLiterals --------------------------------------------------------

test('blanks braces inside strings, comments and template literals, preserving offsets', () => {
  const src = [
    'const a = "} not a closer {";',
    '// } neither is this {',
    'const b = `${x} }`;',
    '/* } block } */',
    'function real(){ }',
  ].join('\n');
  const blanked = blankLiterals(src);
  assert.equal(blanked.length, src.length, 'offsets must be preserved');
  assert.equal(blanked.split('\n').length, src.split('\n').length, 'lines preserved');
  // Only the real function body braces survive.
  assert.equal((blanked.match(/[{}]/g) ?? []).length, 2);
});

test('the engine has no regex literal carrying an unbalanced brace or quote', () => {
  // declarationSpans() does not lex regex literals (see its comment). That is
  // only safe while this holds, so assert it rather than assume it: if a
  // future edit adds such a literal, this fails instead of silently
  // corrupting every span below it.
  const src = fs.readFileSync('engine/forest-engine.js', 'utf8');
  const blanked = blankLiterals(src);
  let depth = 0;
  for (const c of blanked) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    assert.ok(depth >= 0, 'brace depth went negative -- lexer is mis-tracking');
  }
  assert.equal(depth, 0, 'engine braces must balance after blanking literals');
});

// ---- declarationSpans -----------------------------------------------------

test('spans a function declaration from its header to its closing brace', () => {
  const src = ['function foo(a){', '  if(a){', '    return 1;', '  }', '}', 'const after = 1;'].join('\n');
  assert.deepEqual(declarationSpans(src).get('foo'), { start: 1, end: 5 });
});

test('spans a one-line delegating function -- the LUL-593 checkNoise shape', () => {
  const src = ['// c', 'function checkNoise(p){ return isNoiseHeard(p); }'].join('\n');
  assert.deepEqual(declarationSpans(src).get('checkNoise'), { start: 2, end: 2 });
});

test('spans a const statement to its semicolon, and an arrow body to its brace', () => {
  const src = ['const LIGHT = { intensity: 0.7 };', 'const go = (x) => {', '  return x;', '};'].join('\n');
  const spans = declarationSpans(src);
  assert.deepEqual(spans.get('LIGHT'), { start: 1, end: 1 });
  assert.deepEqual(spans.get('go'), { start: 2, end: 4 });
});

test('a name declared twice resolves to null, never to the first definition', () => {
  // ELEMENTS.md documents toggleHidden() as declared twice on purpose;
  // silently picking the first would mis-resolve the exact case it warns about.
  const src = ['function dup(){', '}', 'function dup(){', '}'].join('\n');
  assert.equal(declarationSpans(src).get('dup'), null);
});

// ---- anchorIdentifier -----------------------------------------------------

test('resolves call and bare forms, and records which was used', () => {
  assert.deepEqual(anchorIdentifier('tick()'), { name: 'tick', form: 'call' });
  assert.deepEqual(anchorIdentifier("placePredators()'s"), { name: 'placePredators', form: 'call' });
  assert.deepEqual(anchorIdentifier('PSPEC'), { name: 'PSPEC', form: 'bare' });
});

test('refuses prose, expressions and dotted spans rather than inventing an anchor', () => {
  // Reducing `THREE.Group` to `Group` invented anchors naming three.js
  // classes and object properties, then reported them as missing engine
  // declarations -- a parser artifact that read as a doc bug.
  for (const t of ['THREE.Group', 'p.stuckT', 'CONFIG.home', 'eyeH + bob + jumpY',
                   'Math.min(1, dt*8)', 'roll < 0.4', 'blocked(x,z) = blockedR(x,z,0.6)']) {
    assert.equal(anchorIdentifier(t), null, `${t} must not resolve`);
  }
});

// ---- parseCitations -------------------------------------------------------

test('parses single lines and ranges, including an en-dash range', () => {
  const cites = parseCitations('see `tick()` L100 and `foo()` L200-L210 and `bar()` L300–320');
  assert.deepEqual(cites.map((c) => [c.symbol, c.start, c.end]), [
    ['tick', 100, 100], ['foo', 200, 210], ['bar', 300, 320],
  ]);
});

test('falls back to the previous line for an anchor when markdown wrapped', () => {
  const cites = parseCitations('a `findHideSpot()`\nL908-922, edge distance');
  assert.equal(cites.length, 1);
  assert.equal(cites[0].symbol, 'findHideSpot');
});

test('records position among citations sharing one anchor on a line', () => {
  const cites = parseCitations('`inLake()` L289, used at L393 (cover), L446 (trees)');
  assert.deepEqual(cites.map((c) => c.nthOnLine), [0, 1, 2]);
  assert.deepEqual(cites.map((c) => c.symbol), ['inLake', 'inLake', 'inLake']);
});

test('reserved words are not treated as anchors', () => {
  assert.equal(parseCitations('not `const` L100')[0].symbol, null);
});

// ---- classify -------------------------------------------------------------

const SPANS = new Map([
  ['tick', { start: 2740, end: 3051 }],
  ['depositScent', { start: 1033, end: 1036 }],
  ['dup', null],
]);
const cite = (o) => ({ docLine: 1, raw: 'L?', context: '', form: 'call', ...o });

test('a cited range inside the symbol body is ok', () => {
  assert.equal(classify(cite({ symbol: 'tick', start: 2800, end: 2810 }), SPANS).status, 'ok');
});

test('a cited range outside the symbol body is drift', () => {
  assert.equal(classify(cite({ symbol: 'tick', start: 2296, end: 2327 }), SPANS).status, 'drift');
});

test('a missing call-form symbol is a doc defect; a missing bare symbol is not', () => {
  assert.equal(classify(cite({ symbol: 'gone', form: 'call', start: 1, end: 1 }), SPANS).status, 'unknown');
  assert.equal(classify(cite({ symbol: 'gone', form: 'bare', start: 1, end: 1 }), SPANS).status, 'unverifiable');
});

test('an ambiguous symbol is refused, not judged', () => {
  assert.equal(classify(cite({ symbol: 'dup', start: 1, end: 1 }), SPANS).status, 'ambiguous');
});

// ---- the fix rule ---------------------------------------------------------

test('only an exact body-length range is fixable', () => {
  // 4 lines cited, depositScent is 4 lines -> whole-body reference that moved.
  const exact = classify(cite({ symbol: 'depositScent', start: 771, end: 774 }), SPANS);
  assert.equal(exact.fixKind, 'span');
});

test('refuses single-line citations -- the doc uses them for interior lines too', () => {
  // The regression this encodes: `generateCover() L418, L420` are two distinct
  // interior use sites. An earlier rule rewrote both to the declaration line,
  // producing `L490, L490` -- confidently wrong, and worse than stale.
  const point = classify(cite({ symbol: 'tick', start: 2299, end: 2299 }), SPANS);
  assert.equal(point.status, 'drift');
  assert.equal(point.fixKind, null, 'a single-line citation carries no proof of intent');
});

test('refuses an interior range and a range longer than the body', () => {
  assert.equal(classify(cite({ symbol: 'depositScent', start: 500, end: 502 }), SPANS).fixKind, null);
  assert.equal(classify(cite({ symbol: 'depositScent', start: 500, end: 599 }), SPANS).fixKind, null);
});

// ---- baseline ratchet -----------------------------------------------------

test('a bad citation absent from the baseline is fresh; a known one is not', () => {
  const bad = [
    { docLine: 40, symbol: 'tick' },
    { docLine: 99, symbol: 'newlyBroken' },
  ];
  const { fresh } = diffAgainstBaseline(bad, ['40:tick']);
  assert.deepEqual(fresh.map(baselineKey), ['99:newlyBroken']);
});

test('the baseline key ignores the cited line number', () => {
  // An unrelated engine edit changes what the correct number would be for an
  // already-known-bad citation. Keying on it would turn CI red on a PR that
  // touched nothing to do with the doc.
  assert.equal(baselineKey({ docLine: 40, symbol: 'tick', start: 1 }),
               baselineKey({ docLine: 40, symbol: 'tick', start: 999 }));
});

test('a baselined citation that no longer reproduces is reported stale, not failed', () => {
  const { fresh, stale } = diffAgainstBaseline([], ['40:tick']);
  assert.deepEqual(fresh, []);
  assert.deepEqual(stale, ['40:tick']);
});

// ---- end-to-end against the real files ------------------------------------

test('the gate actually asserts something on the real doc -- it is not vacuously green', () => {
  // "Green can mean nothing ran": if the anchor resolution ever silently
  // breaks, every citation becomes unverifiable and the gate passes while
  // checking nothing. This is the assertion that catches that.
  const doc = fs.readFileSync('docs/ELEMENTS.md', 'utf8');
  const engine = fs.readFileSync('engine/forest-engine.js', 'utf8');
  const r = checkCitations(doc, engine);
  assert.ok(r.total > 100, `expected >100 citations, got ${r.total}`);
  assert.ok(r.anchored >= ANCHOR_FLOOR,
    `only ${r.anchored} citations resolve to a symbol (floor ${ANCHOR_FLOOR})`);
  assert.ok(r.ok.length > 0, 'no citation verified -- resolution is broken');
});

test('injecting drift into a verified citation is caught', () => {
  // The fail-on-purpose proof, run every CI pass rather than once by hand:
  // take a citation the gate currently accepts, move it off the symbol, and
  // assert the gate notices.
  const doc = fs.readFileSync('docs/ELEMENTS.md', 'utf8');
  const engine = fs.readFileSync('engine/forest-engine.js', 'utf8');
  const before = checkCitations(doc, engine);
  const victim = before.ok.find((c) => c.start !== c.end);
  assert.ok(victim, 'expected at least one verified range citation to perturb');

  const lines = doc.split('\n');
  const idx = lines[victim.docLine - 1].indexOf(victim.raw);
  lines[victim.docLine - 1] =
    lines[victim.docLine - 1].slice(0, idx) + 'L9001-9002' +
    lines[victim.docLine - 1].slice(idx + victim.raw.length);

  const after = checkCitations(lines.join('\n'), engine);
  assert.equal(after.drift.length, before.drift.length + 1,
    'a citation moved off its symbol must register as drift');
  assert.equal(after.ok.length, before.ok.length - 1);
});

test('renaming a cited function in the engine is caught as an unknown symbol', () => {
  const doc = fs.readFileSync('docs/ELEMENTS.md', 'utf8');
  const engine = fs.readFileSync('engine/forest-engine.js', 'utf8');
  const before = checkCitations(doc, engine);
  const renamed = engine.replace(/\bfunction depositScent\b/, 'function depositScentRenamed');
  assert.notEqual(renamed, engine, 'expected depositScent to exist in the engine');

  const after = checkCitations(doc, renamed);
  assert.ok(after.unknown.length > before.unknown.length,
    'a cited function that no longer exists must be reported');
});
