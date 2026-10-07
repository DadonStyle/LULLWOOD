// The grammar of local-QA request files (shared/local-qa/requests/*.md), as one pure module.
//
// The founder's local QA tester (request-runner.mjs on the server) executes these files every night.
// It used to carry its own copy of this parser, and nothing checked a request when it was written:
// a single malformed step (single-quoted hook args in lul-3150) crashed the runner and silently
// skipped every request sorted after it, 47 of 68, from 2026-09-23 to 2026-10-06; another 42 used
// step forms the runner did not know and never tested anything (LUL-3295 investigation).
//
// Now: this module is the single parser. scripts/check-qa-requests.mjs runs it in CI so a malformed
// request fails its own PR, and the server runner imports it from its release/next checkout.
// Grammar reference: shared/local-qa/REQUESTING-A-TEST.md ("Mechanism 1"); the synonyms accepted in
// normStep/normAssertion are the forms agents actually wrote.

export const VIEWPORTS = ['desktop-1280x720', 'desktop-1920x1080', 'pixel5-landscape-727x393', 'iphone-se-landscape-667x375'];
export const VIEWPORT_ALIASES = {
  desktop: 'desktop-1280x720',
  pixel5: 'pixel5-landscape-727x393',
  'pixel5-landscape': 'pixel5-landscape-727x393',
  'mobile-727x393-landscape': 'pixel5-landscape-727x393',
  'mobile-pixel5-landscape-727x393': 'pixel5-landscape-727x393',
  'iphone-se': 'iphone-se-landscape-667x375',
  'iphone-se-landscape': 'iphone-se-landscape-667x375',
  'mobile-iphone-se-landscape-667x375': 'iphone-se-landscape-667x375',
};
export const MAX_SLEEP_MS = 10_000;
const BOOT_OPTIONS = /^(seed|qaMissionKind|qaRoostIndex|qaHour|qaWorld|qaNoRender)=([\w.-]+)$/;
const JSON_LITERAL = /^(true|false|null|-?[\d.]+|".*")$/;

/** Minimal YAML front matter: top-level scalars, lists as "- item" or [a, b]. Returns the fields or { error }. */
export function parseFrontMatter(text) {
  let m = text.match(/^---\n([\s\S]*?)\n---/);
  // Also accept a block whose closing '---' is missing: it ends at the first line that is not YAML-shaped.
  if (!m && text.startsWith('---\n')) {
    const body = [];
    for (const l of text.slice(4).split('\n')) {
      if (/^([A-Za-z_]+:|\s+-\s|\s*#|\s*$)/.test(l)) body.push(l);
      else break;
    }
    m = [null, body.join('\n')];
  }
  if (!m) return { error: 'NEEDS-GRAMMAR no front matter' };
  const fm = {};
  let key = null;
  for (const raw of m[1].split('\n')) {
    // Comments need TWO+ spaces before '#': a single space + '#' is a CSS id selector (`click #deathScreen .restartBtn`).
    const line = raw.replace(/\s{2,}#.*$/, '').replace(/^\s*#.*$/, '');
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      const v = top[2].trim();
      if (v === '') fm[key] = [];
      else if (v.startsWith('[')) fm[key] = v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      else fm[key] = v.replace(/^"|"$/g, '');
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key && Array.isArray(fm[key])) { fm[key].push(item[1].trim()); continue; }
    return { error: `NEEDS-GRAMMAR front matter line: ${raw}` };
  }
  for (const k of ['ticket', 'title', 'requested_by', 'branch', 'viewports', 'steps', 'expected']) {
    if (fm[k] == null) return { error: `NEEDS-GRAMMAR missing key ${k}` };
  }
  return fm;
}

/** Synonyms agents write, rewritten to the canonical step grammar. */
export function normStep(s) {
  return s
    .replace(/^wait (\d+)$/, 'sleep $1')
    .replace(/^key-press (\w+)$/, 'key $1')
    .replace(/^key-(down|up) (\w+)$/, 'key $2 $1')
    .replace(/^boot qaHooks=1\b/, 'boot qaHooks')
    .replace(/^dom (.+?) not-visible$/, 'dom $1 hidden');
}

/** Synonyms agents write, rewritten to the canonical assertion grammar. */
export function normAssertion(s) {
  return s
    .replace(/\s+\(at [\w-]+\)$/, '')
    .replace(/^dom (.+?) not-visible$/, 'dom $1 hidden')
    .replace(/^expr (.+?) == (?!(?:true|false|null|-?[\d.]+|".*")$)(.+)$/, 'expr ($1) === ($2) is true')
    .replace(/^(var|expr) (.+?) == (.+)$/, '$1 $2 = $3')
    .replace(/^expr (.+?) (>=|<=|>|<) (?!-?[\d.]+$)(.+)$/, 'expr ($1) $2 ($3) is true')
    .replace(/^var ([\w.]+) != (.+)$/, 'var $1 differs from $2')
    .replace(/^expr (.+?) != (.+)$/, 'expr ($1) !== ($2) is true')
    .replace(/^var ([\w.]+) is (?!truthy$|falsy$)(true|false|null|-?[\d.]+|".*")$/, 'var $1 = $2');
}

function syntaxError(src) {
  try {
    // eslint-disable-next-line no-new-func -- parse-only check of a request's JS argument list; never called
    new Function('vars', `with (vars) { return [${src}]; }`);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** One step -> { verb, ... } or { error }. Never throws. */
export function parseStep(input) {
  const s = normStep(input);
  let m;
  if ((m = s.match(/^boot qaHooks((?: [\w=.-]+)*)$/))) {
    const st = { verb: 'boot', seed: '20260718', full: false, params: {} };
    for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
      if (tok === 'full') { st.full = true; continue; }
      const kv = tok.match(BOOT_OPTIONS);
      if (!kv) return { error: `NEEDS-GRAMMAR boot option ${tok} (allowed: full, seed=, qaMissionKind=, qaRoostIndex=, qaHour=, qaWorld=, qaNoRender=)` };
      if (kv[1] === 'seed') st.seed = kv[2];
      else st.params[kv[1]] = kv[2];
    }
    if (st.params.qaWorld === 'full') { st.full = true; delete st.params.qaWorld; }
    return st;
  }
  if (s === 'enter') return { verb: 'enter' };
  if ((m = s.match(/^hook (qa\w+)\((.*)\)(?: as (\w+))?$/))) {
    const raw = m[2].trim();
    if (!raw) return { verb: 'hook', name: m[1], args: [], as: m[3] };
    try { return { verb: 'hook', name: m[1], args: JSON.parse(`[${raw}]`), as: m[3] }; } catch { /* not JSON: a JS argument list */ }
    const err = syntaxError(raw);
    if (err) return { error: `NEEDS-GRAMMAR hook arguments do not parse: ${raw.slice(0, 80)} (${err})` };
    return { verb: 'hook', name: m[1], argsExpr: raw, as: m[3] };
  }
  if ((m = s.match(/^key (\w+) (down|up)$/))) return { verb: m[2] === 'down' ? 'keydown' : 'keyup', code: m[1] };
  if ((m = s.match(/^key (\w+)(?: hold (\d+))?$/))) return { verb: 'key', code: m[1], hold: m[2] ? +m[2] : 0 };
  if ((m = s.match(/^(tap|touch) (.+)$/))) return { verb: m[1], target: m[2].trim() };
  if ((m = s.match(/^click (.+)$/))) return { verb: 'click', sel: m[1].trim() };
  if ((m = s.match(/^drag (leftStick|rightStick|canvas) (-?\d+),(-?\d+)$/))) return { verb: 'drag', target: m[1], dx: +m[2], dy: +m[3] };
  if ((m = s.match(/^wait_for (.+?) within (\d+)$/))) return { verb: 'wait_for', expr: m[1], within: +m[2] };
  if ((m = s.match(/^poll (.+?) every (\d+) until (.+?) within (\d+)$/))) return { verb: 'poll', expr: m[1], every: +m[2], until: m[3], within: +m[4] };
  if ((m = s.match(/^sleep (\d+)$/))) return +m[1] <= MAX_SLEEP_MS ? { verb: 'sleep', ms: +m[1] } : { error: `NEEDS-GRAMMAR sleep over ${MAX_SLEEP_MS} ms: ${s}` };
  if ((m = s.match(/^dom (.+?) (visible|hidden|detached)$/))) return { verb: 'dom_wait', sel: m[1].replace(/^"|"$/g, ''), state: m[2] };
  if ((m = s.match(/^snap ([\w-]+)$/))) return { verb: 'snap', name: m[1] };
  if ((m = s.match(/^record (.+?) as (\w+)$/))) return { verb: 'record', expr: m[1], as: m[2] };
  return { error: `NEEDS-GRAMMAR ${s}` };
}

/** One expectation -> { kind, ... } or { error }. Never throws. */
export function parseAssertion(input) {
  const s = normAssertion(input);
  let m;
  const json = (text) => { try { return { v: JSON.parse(text) }; } catch { return null; } };
  if ((m = s.match(/^dom (.+?) (visible|hidden|detached)$/))) return { kind: 'dom', sel: m[1].replace(/^"|"$/g, ''), op: m[2] };
  if ((m = s.match(/^dom (.+?) count (\d+)$/))) return { kind: 'dom', sel: m[1].replace(/^"|"$/g, ''), op: 'count', n: +m[2] };
  if ((m = s.match(/^dom (.+?) text does not contain "(.*)"$/))) return { kind: 'dom', sel: m[1].replace(/^"|"$/g, ''), op: 'text-not', s: m[2] };
  if ((m = s.match(/^dom (.+?) text contains "(.*)"$/))) return { kind: 'dom', sel: m[1].replace(/^"|"$/g, ''), op: 'text', s: m[2] };
  if ((m = s.match(/^dom (.+?) attr (\S+) contains "(.*)"$/))) return { kind: 'dom', sel: m[1].replace(/^"|"$/g, ''), op: 'attr-contains', name: m[2], v: m[3] };
  if ((m = s.match(/^dom (.+?) attr (\S+) = (.*)$/))) return { kind: 'dom', sel: m[1], op: 'attr', name: m[2], v: m[3].replace(/^"|"$/g, '') };
  if ((m = s.match(/^style (.+?) (\S+) = (.*)$/))) return { kind: 'style', sel: m[1], prop: m[2], v: m[3].trim() };
  if ((m = s.match(/^expr (.+?) is (true|false)$/))) return { kind: 'expr', expr: m[1], op: 'is', v: m[2] === 'true' };
  if ((m = s.match(/^expr (.+?) = (.+)$/))) { const j = json(m[2]); return j ? { kind: 'expr', expr: m[1], op: '=', v: j.v } : { error: `NEEDS-GRAMMAR value is not JSON: ${s}` }; }
  if ((m = s.match(/^expr (.+?) (>|<) (-?[\d.]+)$/))) return { kind: 'expr', expr: m[1], op: m[2], v: +m[3] };
  if ((m = s.match(/^expr (.+?) between (-?[\d.]+) (-?[\d.]+)$/))) return { kind: 'expr', expr: m[1], op: 'between', a: +m[2], b: +m[3] };
  if ((m = s.match(/^expr (.+?) differs from var (\w+)$/))) return { kind: 'expr', expr: m[1], op: 'differs', var: m[2] };
  if ((m = s.match(/^var (\w+) - (\w+) between (-?[\d.]+) (-?[\d.]+)$/))) return { kind: 'vardiff', a: m[1], b: m[2], lo: +m[3], hi: +m[4] };
  if ((m = s.match(/^var ([\w.]+) = (.+)$/))) { const j = json(m[2]); return j ? { kind: 'var', name: m[1], op: '=', v: j.v } : { error: `NEEDS-GRAMMAR value is not JSON: ${s}` }; }
  // a literal before a variable name: `differs from 0` / `differs from true` compare to the value, not a var named "0"
  if ((m = s.match(/^var ([\w.]+) differs from (.+)$/)) && JSON_LITERAL.test(m[2]) && m[2] !== 'null') return { kind: 'var', name: m[1], op: 'differs-literal', v: JSON.parse(m[2]) };
  if ((m = s.match(/^var ([\w.]+) differs from ([\w.]+|null)$/))) return { kind: 'var', name: m[1], op: 'differs', other: m[2] };
  if ((m = s.match(/^var ([\w.]+) (>=|<=|>|<) (-?[\d.]+|[\w.]+)$/))) return { kind: 'var', name: m[1], op: m[2], v: /^-?[\d.]+$/.test(m[3]) ? +m[3] : { var: m[3] } };
  if ((m = s.match(/^var ([\w.]+) is (truthy|falsy)$/))) return { kind: 'var', name: m[1], op: m[2] };
  if ((m = s.match(/^var ([\w.]+) between (-?[\d.]+) (-?[\d.]+)$/))) return { kind: 'var', name: m[1], op: 'between', a: +m[2], b: +m[3] };
  if ((m = s.match(/^no-overlap ([\w-]+)$/))) return { kind: 'no-overlap', snap: m[1] };
  if (s === 'no-console-errors') return { kind: 'no-console-errors' };
  return { error: `NEEDS-GRAMMAR ${s}` };
}

export const resolveViewport = (name) => (VIEWPORTS.includes(VIEWPORT_ALIASES[name] || name) ? VIEWPORT_ALIASES[name] || name : null);

/**
 * Everything the runner would refuse, without running anything.
 * Returns { status: 'OK' | 'SKIPPED-DONE' | 'SKIPPED-EXPIRED' | 'NEEDS-GRAMMAR' | 'WRONG-BRANCH', errors: string[] }.
 */
export function validateRequest(text, now = new Date()) {
  const fm = parseFrontMatter(text);
  if (fm.error) return { status: 'NEEDS-GRAMMAR', errors: [fm.error] };
  if (fm.status === 'done') return { status: 'SKIPPED-DONE', errors: [] };
  if (fm.expires && new Date(fm.expires) < now) return { status: 'SKIPPED-EXPIRED', errors: [] };
  if (fm.branch !== 'release/next') return { status: 'WRONG-BRANCH', errors: [`branch ${fm.branch}: the tester only builds release/next`] };
  const errors = [
    ...fm.steps.map(parseStep).filter((x) => x.error).map((x) => x.error),
    ...fm.expected.map(parseAssertion).filter((x) => x.error).map((x) => x.error),
    ...fm.viewports.filter((v) => !resolveViewport(v)).map((v) => `NEEDS-GRAMMAR unknown viewport ${v} (known: ${VIEWPORTS.join(', ')})`),
  ];
  return { status: errors.length ? 'NEEDS-GRAMMAR' : 'OK', errors };
}
