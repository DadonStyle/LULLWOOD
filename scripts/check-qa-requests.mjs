#!/usr/bin/env node
// CI guard for local-QA request files: a request the nightly tester cannot parse fails the PR that adds
// it, in front of the agent who wrote it, instead of being silently skipped at 00:30 (see
// scripts/qa-request-grammar.mjs for the history).
//
//   node scripts/check-qa-requests.mjs [file-or-dir ...]     # default: shared/local-qa/requests
//
// Exit 1 if any active request (not done, not expired) is NEEDS-GRAMMAR or targets a branch the
// tester does not build. Needs no node_modules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateRequest } from './qa-request-grammar.mjs';

export function collect(targets) {
  const files = [];
  for (const t of targets) {
    if (statSync(t).isDirectory()) {
      for (const f of readdirSync(t).sort()) if (f.endsWith('.md')) files.push(path.join(t, f));
    } else files.push(t);
  }
  return files;
}

export function check(files, now = new Date()) {
  const bad = [];
  for (const f of files) {
    const r = validateRequest(readFileSync(f, 'utf8'), now);
    if (r.status === 'NEEDS-GRAMMAR' || r.status === 'WRONG-BRANCH') bad.push({ file: f, ...r });
  }
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const targets = process.argv.slice(2);
  const files = collect(targets.length ? targets : ['shared/local-qa/requests']);
  const bad = check(files);
  for (const b of bad) {
    console.error(`${b.file}: ${b.status}`);
    for (const e of b.errors) console.error(`  - ${e}`);
  }
  console.log(`check-qa-requests: ${files.length} request(s), ${bad.length} the local QA tester cannot run.`);
  if (bad.length) console.error('Grammar reference: shared/local-qa/REQUESTING-A-TEST.md and scripts/qa-request-grammar.mjs.');
  process.exit(bad.length ? 1 : 0);
}
