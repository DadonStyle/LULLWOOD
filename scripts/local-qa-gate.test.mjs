import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePullRequest, isEmergencyHotfix } from './local-qa-gate.mjs';

const REPO = 'DadonStyle/LULLWOOD';
const SHA = 'e0ff0ba4abcdef0123456789abcdef0123456789';

function pr({ sha = SHA, headRef = 'release/next', baseRef = 'main', labels = [] } = {}) {
  return {
    number: 1154,
    base: { ref: baseRef },
    head: { sha, ref: headRef },
    labels,
  };
}

function withMockedFetch(statusesForSha, run) {
  return async () => {
    const prevFetch = globalThis.fetch;
    const posted = [];
    try {
      globalThis.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (opts.method === 'POST' && u.includes('/statuses/')) {
          posted.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({}) };
        }
        if (!opts.method && u.endsWith(`/commits/${SHA}/status`)) {
          return { ok: true, json: async () => ({ statuses: statusesForSha }) };
        }
        throw new Error(`unexpected fetch: ${opts.method || 'GET'} ${u}`);
      };
      await run(posted);
    } finally {
      globalThis.fetch = prevFetch;
    }
  };
}

// ---- the LUL-6086 race: a delayed pull_request run must not clobber a -----
// ---- verdict an issue_comment run already landed for the same sha ---------

test(
  'pull_request no-ops when local-qa is already success for this sha (the PR#1154/e0ff0ba race)',
  withMockedFetch([{ context: 'local-qa', state: 'success' }], async (posted) => {
    await handlePullRequest(REPO, 'token', { pull_request: pr() });
    assert.deepEqual(posted, [], 'must not re-arm to pending once a real verdict has landed');
  }),
);

test(
  'pull_request no-ops when local-qa is already failure for this sha',
  withMockedFetch([{ context: 'local-qa', state: 'failure' }], async (posted) => {
    await handlePullRequest(REPO, 'token', { pull_request: pr() });
    assert.deepEqual(posted, []);
  }),
);

test(
  'pull_request still arms pending when no local-qa status exists yet for this sha',
  withMockedFetch([], async (posted) => {
    await handlePullRequest(REPO, 'token', { pull_request: pr() });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].state, 'pending');
    assert.equal(posted[0].context, 'local-qa');
  }),
);

test(
  'pull_request still arms pending when local-qa is already pending for this sha',
  withMockedFetch([{ context: 'local-qa', state: 'pending' }], async (posted) => {
    await handlePullRequest(REPO, 'token', { pull_request: pr() });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].state, 'pending');
  }),
);

test(
  'an unrelated context on the same sha does not block the pending re-arm',
  withMockedFetch([{ context: 'build', state: 'success' }], async (posted) => {
    await handlePullRequest(REPO, 'token', { pull_request: pr() });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].state, 'pending');
  }),
);

// ---- existing behaviour must survive the new guard -------------------------

test(
  'base != main is skipped before any status GET/POST happens',
  withMockedFetch([{ context: 'local-qa', state: 'success' }], async (posted) => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      throw new Error(`must not fetch anything for a non-main-base PR: ${url}`);
    };
    try {
      await handlePullRequest(REPO, 'token', { pull_request: pr({ baseRef: 'release/next' }) });
    } finally {
      globalThis.fetch = prevFetch;
    }
    assert.deepEqual(posted, []);
  }),
);

test(
  'emergency-hotfix label auto-passes without consulting the existing status',
  withMockedFetch([{ context: 'local-qa', state: 'failure' }], async (posted) => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (opts.method === 'POST' && u.includes('/statuses/')) {
        posted.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({}) };
      }
      throw new Error(`emergency-hotfix must not GET the existing status: ${u}`);
    };
    try {
      await handlePullRequest(
        REPO,
        'token',
        { pull_request: pr({ headRef: 'some-hotfix-branch', labels: [{ name: 'emergency-hotfix' }] }) },
      );
    } finally {
      globalThis.fetch = prevFetch;
    }
    assert.equal(posted.length, 1);
    assert.equal(posted[0].state, 'success');
  }),
);

test('isEmergencyHotfix sanity: release/next head is never treated as a hotfix', () => {
  assert.equal(isEmergencyHotfix(pr({ headRef: 'release/next', labels: [{ name: 'emergency-hotfix' }] })), false);
});
