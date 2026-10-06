// Run: node --test lib/leaderboard/remote.test.ts
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callService } from './remote.ts';
import { NONCE_HEADER } from './signing.ts';

const config = { baseUrl: 'https://lb.example.ts.net', secret: 'k'.repeat(40) };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function connectError() {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } });
}

test('a connection failure is retried on a fresh, re-signed request and then succeeds', async () => {
  const nonces: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    nonces.push((init.headers as Record<string, string>)[NONCE_HEADER]);
    if (++calls < 3) throw connectError();
    return new Response(JSON.stringify({ record: null }), { status: 200 });
  }) as typeof fetch;
  const r = await callService(config, 'GET', '/v1/current');
  assert.deepEqual(r, { status: 200, body: { record: null } });
  assert.equal(calls, 3);
  assert.equal(new Set(nonces).size, 3, 'every attempt carries its own nonce (the service rejects replays)');
});

test('gives up after the attempt limit and returns null, never throws', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw connectError(); }) as typeof fetch;
  assert.equal(await callService(config, 'POST', '/v1/submit', { a: 1 }), null);
  assert.equal(calls, 3);
});

test('a hanging relay (timeout) is retried within the budget, each attempt with its own slice', async () => {
  let calls = 0;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    calls++;
    if (calls === 1) {
      // hang until this attempt's own abort signal fires, like the dead relay does
      await new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
    }
    return new Response(JSON.stringify({ id: 1, isRecord: false }), { status: 201 });
  }) as typeof fetch;
  // AbortSignal.timeout timers are unref'd; keep the event loop alive while the fake relay hangs.
  const keepAlive = setInterval(() => {}, 50);
  const t0 = Date.now();
  const r = await callService(config, 'POST', '/v1/submit', { a: 1 }, 900).finally(() => clearInterval(keepAlive));
  assert.deepEqual(r, { status: 201, body: { id: 1, isRecord: false } });
  assert.equal(calls, 2);
  assert.ok(Date.now() - t0 < 900, 'the first attempt only used its slice, not the whole budget');
});

test('an HTTP error status is returned as-is, not retried', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ error: 'cooldown' }), { status: 429 }); }) as typeof fetch;
  assert.deepEqual(await callService(config, 'POST', '/v1/submit', {}), { status: 429, body: { error: 'cooldown' } });
  assert.equal(calls, 1);
});
