#!/usr/bin/env node
// LUL-588 (supersedes LUL-474): mechanical gate for the `L<n>` source
// citations in docs/ELEMENTS.md.
//
// WHY THIS EXISTS
//
// docs/ELEMENTS.md carries ~118 `L<n>` line references into
// engine/forest-engine.js. They have been re-derived by hand at least three
// times (LUL-400 -> LUL-411, LUL-434 -> LUL-426, and again on this ticket)
// because any edit to the engine shifts every citation below it and nothing
// ever failed when they drifted. A fourth manual pass without a check just
// resets the clock, so the check is the deliverable.
//
// WHAT LUL-588 MEASURED, AND WHY THE APPROACH CHANGED
//
// Measured on release/next @ af0c995: of 118 citations, 82 resolve to a
// symbol and **0 of those 82 were correct**. Re-checking each citation
// against the engine as it stood at the doc commit that introduced it
// (`git blame` -> `git show <sha>:engine/forest-engine.js`) showed 0 were
// correct *then* either: 65 were already wrong the day they were written.
// So this is not drift from a once-good state. The citations have never been
// right, and "re-derive them once more" has no reason to stick.
//
// That also rules out a bulk auto-fix. The doc's convention is inconsistent:
// some citations point at a symbol's declaration, others at an interior use
// site (`generateCover()` L416 means "the roll<0.4 branch inside it", not
// line 416 of the declaration). A rewriter cannot tell those apart, and an
// early version of this script proved it -- it collapsed `generateCover()
// L418, L420` to `L490, L490` and three distinct `inLake()` use sites to the
// same declaration line. Confidently wrong is worse than stale, so --fix now
// rewrites ONLY where there is a per-item content proof (see FIX RULES).
//
// HOW IT GATES WITHOUT A FLAG DAY
//
// 82 hand-derivations is not a change that can be reviewed safely in one PR,
// and a check that cannot pass is a check someone will disable. So the gate
// runs against a checked-in baseline of the known-bad citations
// (scripts/elements-citations-baseline.json): any bad citation NOT in the
// baseline fails the build. Existing debt is explicit and can only shrink.
// There is no `|| true` and no ::warning:: downgrade anywhere in this path --
// a new drifted citation is a hard failure.
//
// The baseline is keyed on (doc line, anchor symbol), deliberately not on the
// cited line number: an engine edit moves the correct target for a citation
// that is already known-bad, and that must not read as a new defect and turn
// CI red on an unrelated PR.
//
// Usage:
//   node scripts/check-elements-citations.mjs              # gate; exit 1 on NEW bad citations
//   node scripts/check-elements-citations.mjs --report      # full table, always exit 0
//   node scripts/check-elements-citations.mjs --fix         # rewrite only what is provable
//   node scripts/check-elements-citations.mjs --update-baseline
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOC = 'docs/ELEMENTS.md';
const ENGINE = 'engine/forest-engine.js';
const BASELINE = 'scripts/elements-citations-baseline.json';

// ANCHOR FLOOR. A green run must never be able to mean "nothing was checked".
// If the count of citations that resolve to a symbol falls below this, the
// gate fails and asks for a deliberate decision, on the assumption that the
// doc or the engine was restructured rather than that the debt evaporated.
// Set from the 82 measured on release/next @ af0c995, with slack for
// citations legitimately removed by an edit.
export const ANCHOR_FLOOR = 60;

// ---- engine lexing --------------------------------------------------------

// Blank strings, template literals and comments to spaces so brace matching
// cannot be fooled by a brace inside a string or a commented-out block.
// Length and line structure are preserved, so every offset in the blanked
// text still maps to the same line in the original.
//
// Regex literals are NOT handled: telling `/` division from a regex start
// needs real parse context. forest-engine.js contains no regex literal
// carrying an unbalanced brace or quote -- asserted by a unit test, so this
// shortcut fails loudly if that ever stops being true.
export function blankLiterals(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out[i] = ' '; i++;
      while (i < n) {
        if (src[i] === '\\') {
          out[i] = ' ';
          if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === quote) { out[i] = ' '; i++; break; }
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1; // 1-indexed
}

function matchBrace(blanked, open) {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const c = blanked[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Resolve every declaration in the engine to a 1-indexed [start, end] line
// span, for the three forms forest-engine.js actually uses:
//   function name(...) { ... }        -> whole body
//   const/let/var name = (...) => {}  -> whole body
//   const/let/var name = <expr>;      -> the statement's lines
//
// A name declared more than once maps to `null` (ambiguous) rather than to
// its first definition. ELEMENTS.md documents `toggleHidden()` as declared
// twice in one scope on purpose, so picking the first would quietly
// mis-resolve exactly the case the doc is warning about.
// Names the engine imports rather than declares (`track` from
// '@/lib/analytics', the geo* helpers from lib/game/*). They are real
// functions the doc may legitimately cite, but their bodies live in another
// file, so this script can neither span them nor call them missing.
export function importedNames(src) {
  const names = new Set();
  const re = /\bimport\s+([^;]+?)\s+from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(blankComments(src)))) {
    const clause = m[1];
    const braced = /\{([^}]*)\}/.exec(clause);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    const bare = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (bare) names.add(bare[1]);
  }
  return names;
}

// Comments only -- import clauses contain quotes, so blankLiterals would
// erase the module specifier we need to match on.
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (s, p) => p + ' '.repeat(s.length - p.length));
}

export function declarationSpans(src) {
  const blanked = blankLiterals(src);
  const starts = lineStarts(src);
  const spans = new Map();
  const seen = new Set();

  const record = (name, startLine, endLine) => {
    if (seen.has(name)) { spans.set(name, null); return; }
    seen.add(name);
    spans.set(name, { start: startLine, end: endLine });
  };

  const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = fnRe.exec(blanked))) {
    const open = blanked.indexOf('{', fnRe.lastIndex);
    if (open === -1) continue;
    const close = matchBrace(blanked, open);
    if (close === -1) continue;
    record(m[1], lineOf(starts, m.index), lineOf(starts, close));
  }

  const varRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = varRe.exec(blanked))) {
    const startLine = lineOf(starts, m.index);
    const rest = blanked.slice(m.index);
    const semi = rest.indexOf(';');
    const brace = rest.indexOf('{');
    let endLine;
    if (brace !== -1 && (semi === -1 || brace < semi)) {
      const close = matchBrace(blanked, m.index + brace);
      endLine = close === -1 ? startLine : lineOf(starts, close);
    } else {
      endLine = semi === -1 ? startLine : lineOf(starts, m.index + semi);
    }
    record(m[1], startLine, endLine);
  }

  return spans;
}

// ---- citation parsing -----------------------------------------------------

const CITATION_RE = /\bL(\d+)(?:\s*[-–]\s*L?(\d+))?\b/g;
const BACKTICK_RE = /`([^`]+)`/g;

// Reduce a backticked span to the identifier it names, plus how strongly it
// claims to live in the engine. Returns null for prose or an expression.
//
//   `foo()`  -> { name: 'foo', form: 'call' }   asserts a function in ENGINE
//   `FOO`    -> { name: 'FOO', form: 'bare' }   may be a local, a property,
//                                               or an imported/three.js symbol
//
// Dotted spans (`THREE.Group`, `p.stuckT`, `CONFIG.home`) are deliberately
// NOT reduced to a last segment. Doing so invented anchors naming a three.js
// class or an object-literal property and then reported them as missing
// declarations -- a parser artifact dressed up as a doc bug.
export function anchorIdentifier(text) {
  if (text == null) return null;
  const t = text.trim().replace(/'s$/, '');
  const call = /^([A-Za-z_$][\w$]*)\(\s*\)$/.exec(t);
  if (call) return { name: call[1], form: 'call' };
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return { name: t, form: 'bare' };
  return null;
}

// Reserved words and generic nouns that parse as identifiers but never name a
// declaration -- picking them up produces confident nonsense (`const`, `main`).
const NOT_A_SYMBOL = new Set([
  'const', 'let', 'var', 'function', 'return', 'main', 'true', 'false', 'null',
  'if', 'else', 'for', 'while', 'new', 'this', 'class', 'default',
]);

// Pull every citation out of the doc with the nearest preceding backticked
// anchor: same line first, then the line above, because markdown wraps
// mid-sentence and the anchor is regularly on the previous line.
export function parseCitations(docText) {
  const lines = docText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    CITATION_RE.lastIndex = 0;
    let m;
    let nthOnLine = 0;
    while ((m = CITATION_RE.exec(line))) {
      const before = line.slice(0, m.index);
      const spans = [...before.matchAll(BACKTICK_RE)].map((x) => x[1]);
      let anchorText = spans.length ? spans[spans.length - 1] : null;
      if (anchorText == null && i > 0) {
        const prev = [...lines[i - 1].matchAll(BACKTICK_RE)].map((x) => x[1]);
        anchorText = prev.length ? prev[prev.length - 1] : null;
      }
      let anchor = anchorIdentifier(anchorText);
      if (anchor && NOT_A_SYMBOL.has(anchor.name)) anchor = null;
      out.push({
        docLine: i + 1,
        raw: m[0],
        start: Number(m[1]),
        end: m[2] ? Number(m[2]) : Number(m[1]),
        anchorText,
        symbol: anchor?.name ?? null,
        form: anchor?.form ?? null,
        // Position among citations sharing this line. `inLake() L289, used at
        // L393 (cover), L446 (trees)` gives three citations one anchor, and
        // only the first plausibly refers to the declaration.
        nthOnLine: nthOnLine++,
        context: line.trim(),
      });
    }
  }
  return out;
}

// ---- classification -------------------------------------------------------

// FIX RULES. --fix may rewrite a citation only with a per-item content proof:
//
//   'span'  a RANGE whose length exactly equals the anchor symbol's current
//           body length. Same symbol, identical line count: the citation was
//           the whole function and the function only moved. Exact equality is
//           the proof -- not a tolerance, not a nearest match.
//
// Everything else is refused, including every single-line citation. A bare
// `foo() L416` is as likely to mean an interior branch as the declaration,
// and the doc uses both conventions; there is no evidence in the file that
// separates them. This is the rule an earlier version got wrong.
export function classify(citation, spans, imported = new Set()) {
  if (!citation.symbol) return { ...citation, status: 'unverifiable' };
  if (!spans.has(citation.symbol)) {
    // An imported name is a real function whose body is in another file --
    // it can be neither spanned nor called missing.
    if (imported.has(citation.symbol)) return { ...citation, status: 'unverifiable' };
    // A `foo()` anchor asserts a function declared in ENGINE, so a missing one
    // is a real doc defect (renamed, or moved out to lib/). A bare `foo`
    // anchor may name a property or a block-local, where absence proves
    // nothing, so it is not failed.
    return { ...citation, status: citation.form === 'call' ? 'unknown' : 'unverifiable' };
  }
  const span = spans.get(citation.symbol);
  if (span === null) return { ...citation, status: 'ambiguous' };

  const inside = citation.start >= span.start && citation.end <= span.end;
  const citedLen = citation.end - citation.start + 1;
  const spanLen = span.end - span.start + 1;
  const fixKind =
    citation.start !== citation.end && citedLen === spanLen ? 'span' : null;

  return { ...citation, status: inside ? 'ok' : 'drift', span, fixKind };
}

export function checkCitations(docText, engineText) {
  const spans = declarationSpans(engineText);
  const imported = importedNames(engineText);
  const results = parseCitations(docText).map((c) => classify(c, spans, imported));
  const by = (s) => results.filter((r) => r.status === s);
  return {
    results,
    ok: by('ok'),
    drift: by('drift'),
    ambiguous: by('ambiguous'),
    unknown: by('unknown'),
    unverifiable: by('unverifiable'),
    anchored: results.filter((r) => r.status !== 'unverifiable').length,
    total: results.length,
  };
}

// ---- baseline -------------------------------------------------------------

// Keyed on doc line + symbol, NOT on the cited line number. An unrelated
// engine edit changes what the correct number would be for an
// already-known-bad citation; that must not present as a new defect.
export function baselineKey(r) {
  return `${r.docLine}:${r.symbol}`;
}

export function diffAgainstBaseline(bad, baselineKeys) {
  const known = new Set(baselineKeys);
  const seen = new Set();
  const fresh = [];
  for (const r of bad) {
    const key = baselineKey(r);
    seen.add(key);
    if (!known.has(key)) fresh.push(r);
  }
  // Entries that no longer reproduce: the citation was fixed, or the doc line
  // moved. Reported so the baseline can shrink; never a failure, because
  // there is no defect being hidden.
  const stale = [...known].filter((k) => !seen.has(k));
  return { fresh, stale };
}

// ---- cli ------------------------------------------------------------------

function fmt(r) {
  const where = r.span ? ` (${r.symbol} is L${r.span.start}-${r.span.end})` : '';
  return `  ${DOC}:${r.docLine}  ${r.raw} -> \`${r.anchorText ?? '(no anchor)'}\`${where}\n      ${r.context.slice(0, 100)}`;
}

function main(argv) {
  const report = argv.includes('--report');
  const fix = argv.includes('--fix');
  const updateBaseline = argv.includes('--update-baseline');
  const root = process.cwd();
  const docPath = path.join(root, DOC);
  const enginePath = path.join(root, ENGINE);
  const baselinePath = path.join(root, BASELINE);

  for (const p of [docPath, enginePath]) {
    if (!fs.existsSync(p)) {
      console.error(`check-elements-citations: missing ${path.relative(root, p)}`);
      return 1;
    }
  }

  let docText = fs.readFileSync(docPath, 'utf8');
  const engineText = fs.readFileSync(enginePath, 'utf8');
  let r = checkCitations(docText, engineText);

  if (fix) {
    const fixable = r.drift.filter((d) => d.fixKind === 'span');
    if (fixable.length) {
      const lines = docText.split('\n');
      for (const d of [...fixable].sort((a, b) => b.docLine - a.docLine)) {
        const line = lines[d.docLine - 1];
        const idx = line.indexOf(d.raw);
        if (idx === -1) continue;
        lines[d.docLine - 1] =
          line.slice(0, idx) + `L${d.span.start}-${d.span.end}` +
          line.slice(idx + d.raw.length);
      }
      docText = lines.join('\n');
      fs.writeFileSync(docPath, docText);
      r = checkCitations(docText, engineText);
    }
    const refused = r.drift.length;
    console.log(
      `--fix: rewrote ${fixable.length} whole-body range citation(s) on an exact length match; ` +
      `refused ${refused} (no content proof -- fix by hand, see --report).`);
  }

  const bad = [...r.drift, ...r.unknown];

  if (updateBaseline) {
    const payload = {
      _comment:
        'LUL-588. Known-bad ELEMENTS.md citations, keyed "<docLine>:<symbol>". ' +
        'Any bad citation absent from this list fails CI. This list may shrink, ' +
        'never grow: regenerate with `node scripts/check-elements-citations.mjs --update-baseline` ' +
        'ONLY when removing entries. See the header of check-elements-citations.mjs.',
      generatedAgainst: 'docs/ELEMENTS.md + engine/forest-engine.js',
      count: bad.length,
      known: bad.map(baselineKey).sort(),
    };
    fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`--update-baseline: wrote ${bad.length} known-bad citation(s) to ${BASELINE}`);
    return 0;
  }

  console.log(
    `check-elements-citations: ${r.total} citations in ${DOC}; ` +
    `${r.anchored} anchored to a resolvable symbol; ` +
    `${r.ok.length} ok, ${r.drift.length} drifted, ${r.unknown.length} unknown symbol, ` +
    `${r.ambiguous.length} ambiguous, ${r.unverifiable.length} unverifiable.`);

  if (report) {
    for (const status of ['drift', 'unknown', 'ambiguous', 'unverifiable']) {
      if (!r[status].length) continue;
      console.log(`\n${status.toUpperCase()} (${r[status].length}):`);
      for (const row of r[status]) console.log(fmt(row));
    }
    return 0;
  }

  if (r.anchored < ANCHOR_FLOOR) {
    console.error(
      `\ncheck-elements-citations: FAIL -- only ${r.anchored} citations resolve to a symbol,\n` +
      `below the floor of ${ANCHOR_FLOOR}. Either ${DOC} lost its source citations or the\n` +
      `anchor format changed; a run that asserts nothing must not report green. If this is\n` +
      `real, re-measure and lower ANCHOR_FLOOR deliberately.`);
    return 1;
  }

  let baselineKeys = [];
  if (fs.existsSync(baselinePath)) {
    baselineKeys = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).known ?? [];
  }
  const { fresh, stale } = diffAgainstBaseline(bad, baselineKeys);

  if (stale.length) {
    console.log(
      `\n${stale.length} baselined citation(s) no longer reproduce. Shrink the baseline:\n` +
      `  node scripts/check-elements-citations.mjs --update-baseline\n  ` +
      stale.slice(0, 10).join('\n  '));
  }

  if (fresh.length) {
    console.error(`\ncheck-elements-citations: FAIL -- ${fresh.length} NEW bad citation(s):`);
    for (const row of fresh) {
      if (row.status === 'unknown') {
        console.error(`  ${DOC}:${row.docLine}  ${row.raw} -> \`${row.anchorText}\` is not declared in ${ENGINE}\n      ${row.context.slice(0, 100)}`);
      } else {
        console.error(fmt(row));
      }
    }
    console.error(
      `\nThe cited lines do not fall inside the anchor symbol's body. Fix the numbers\n` +
      `(\`--report\` prints the full table; \`--fix\` handles whole-body ranges only).\n` +
      `${bad.length - fresh.length} pre-existing bad citation(s) are baselined in ${BASELINE};\n` +
      `that list may shrink, never grow.`);
    return 1;
  }

  console.log(
    `check-elements-citations: OK -- ${r.ok.length} verified, ` +
    `${bad.length} known-bad (baselined), 0 new.`);
  return 0;
}

// `process.argv[1]` is undefined under `node --eval`, where pathToFileURL
// would throw before anything ran.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
