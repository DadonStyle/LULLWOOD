import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { LeaderboardDb } from './db.ts';
import {
  validateNickname, validateCountry, validateTimeMs, validateAnonId, clampListLimit, parseCursor,
} from '../../lib/game/leaderboard.ts';
import { verify, usableSecret, SIGNATURE_HEADER, TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_MAX_SKEW_MS } from '../../lib/leaderboard/signing.ts';

// LUL-3264 (SQLite variant): the leaderboard + stats service on the founder's
// server. Zero dependencies (node:http + node:sqlite) so there is no supply
// chain to audit. Listens on loopback only; the public path to it is Tailscale
// Funnel, and every route except GET /healthz requires a request signed with
// LB_API_SECRET (lib/leaderboard/signing.ts), which only the Vercel route
// handlers hold. Players never talk to this service directly.
//
// Defence in depth: the Vercel handlers already validate everything, and this
// service validates it all again -- it never trusts the hop in front of it.

export const MAX_REQUEST_BYTES = 4096;
const SAFE_TOKEN = /^[a-z0-9_-]{1,32}$/;
const IP_HASH = /^[0-9a-f]{64}$/;
const BUILD_SHA = /^([0-9a-f]{7,40}|dev)$/;
const REASON = /^[a-z0-9 .,_-]{0,200}$/i;
const EVENTS = new Set([
  'page_view', 'cta_start_clicked', 'game_start', 'win', 'loss', 'session_length',
  'feature_engagement', 'engine_contract_violation', 'chase_gap', 'started_tiers',
]);

// Telemetry payloads are written by players' browsers and later read by the
// studio's agents (stats.ts). Every string anywhere in a payload must be a
// plain token -- the real schema (lib/analytics.ts) only ever sends enums,
// ids, paths and shas -- so free text, and with it any prompt-injection
// attempt aimed at an agent, never reaches the database. Depth and size are
// bounded too.
const PAYLOAD_STRING = /^[A-Za-z0-9_.:\/-]{0,64}$/;
function isPlainPayload(value: unknown, depth = 0): boolean {
  if (depth > 3) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return PAYLOAD_STRING.test(value);
  if (Array.isArray(value)) return value.length <= 32 && value.every((v) => isPlainPayload(v, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 32 && entries.every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(k) && isPlainPayload(v, depth + 1));
  }
  return false;
}

class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(body);
    this.status = status;
    this.body = body;
  }
}

export interface ServiceOptions {
  db: LeaderboardDb;
  secret: string;
  now?: () => number;
  log?: (line: string) => void;
  /** Founder alert on a new record (threat model B1). Fire-and-forget; never blocks or fails a request. */
  onNewRecord?: (nickname: string, country: string, timeMs: number) => void;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > MAX_REQUEST_BYTES) return reject(new HttpError(413, 'payload too large'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new HttpError(413, 'payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonObject(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'invalid json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'invalid payload');
  return parsed as Record<string, unknown>;
}

const optionalToken = (v: unknown): string | null => (typeof v === 'string' && SAFE_TOKEN.test(v) ? v : null);
const optionalCountry = (v: unknown): string | null => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null);

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = body === null && status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

export function createService(opts: ServiceOptions): Server {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  // Nonces accepted inside the skew window; anything older is rejected as stale anyway.
  const seenNonces = new Map<string, number>();

  function authenticate(req: IncomingMessage, path: string, body: string): void {
    const t = now();
    const header = (name: string) => {
      const v = req.headers[name];
      return typeof v === 'string' ? v : null;
    };
    const result = verify(opts.secret, { ts: header(TIMESTAMP_HEADER), nonce: header(NONCE_HEADER), signature: header(SIGNATURE_HEADER) },
      req.method ?? '', path, body, t);
    if (!result.ok) throw new HttpError(401, 'unauthorized');
    for (const [nonce, expires] of seenNonces) if (expires < t) seenNonces.delete(nonce);
    if (seenNonces.has(result.nonce)) throw new HttpError(401, 'unauthorized');
    seenNonces.set(result.nonce, result.ts + 2 * SIGNATURE_MAX_SKEW_MS);
  }

  function submit(body: Record<string, unknown>): [number, unknown] {
    const nickname = validateNickname(body.nickname);
    const country = validateCountry(body.country);
    const timeMs = validateTimeMs(body.time_ms);
    if (nickname === null || country === null || timeMs === null) throw new HttpError(400, 'invalid submission');
    if (typeof body.ip_hash !== 'string' || !IP_HASH.test(body.ip_hash)) throw new HttpError(400, 'invalid submission');
    if (typeof body.build_sha !== 'string' || !BUILD_SHA.test(body.build_sha)) throw new HttpError(400, 'invalid submission');
    const result = opts.db.submit({
      nickname, country, timeMs,
      buildSha: body.build_sha, ipHash: body.ip_hash,
      anonId: validateAnonId(body.anon_id), deviceClass: optionalToken(body.device_class), browser: optionalToken(body.browser),
    }, now());
    if (!result.ok) return [429, { error: result.reason }];
    if (result.isRecord) opts.onNewRecord?.(nickname, country, timeMs);
    return [201, { id: result.id, isRecord: result.isRecord }];
  }

  function recordEvent(body: Record<string, unknown>): [number, unknown] {
    const payload = body.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'invalid payload');
    const p = payload as Record<string, unknown>;
    if (typeof p.event !== 'string' || !EVENTS.has(p.event)) throw new HttpError(400, 'unknown event');
    if (!isPlainPayload(p)) throw new HttpError(400, 'invalid payload');
    const stored = opts.db.recordEvent({
      event: p.event,
      eventTs: typeof p.ts === 'number' && Number.isSafeInteger(p.ts) ? p.ts : null,
      anonId: validateAnonId(p.anon_id),
      buildSha: typeof p.build_sha === 'string' && BUILD_SHA.test(p.build_sha) ? p.build_sha : null,
      path: typeof p.path === 'string' ? p.path.slice(0, 128) : null,
      deviceClass: optionalToken(body.device_class),
      browser: optionalToken(body.browser),
      country: optionalCountry(body.country),
      payload: p,
    }, now());
    return stored ? [202, { stored: true }] : [202, { stored: false, reason: 'shed' }];
  }

  async function route(req: IncomingMessage): Promise<[number, unknown]> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = req.url ?? '/';
    if (req.method === 'GET' && url.pathname === '/healthz') return [200, { ok: true }];

    const body = req.method === 'POST' ? await readBody(req) : '';
    authenticate(req, path, body);

    if (req.method === 'POST' && url.pathname === '/v1/submit') return submit(parseJsonObject(body));
    if (req.method === 'POST' && url.pathname === '/v1/events') return recordEvent(parseJsonObject(body));
    if (req.method === 'GET' && url.pathname === '/v1/current') return [200, { record: opts.db.current() }];
    if (req.method === 'GET' && url.pathname === '/v1/records') {
      return [200, opts.db.list(clampListLimit(url.searchParams.get('limit')), parseCursor(url.searchParams.get('cursor')))];
    }
    const inv = /^\/v1\/records\/(\d{1,15})\/invalidate$/.exec(url.pathname);
    if (req.method === 'POST' && inv) {
      const id = Number(inv[1]);
      const b = parseJsonObject(body || '{}');
      const reason = typeof b.reason === 'string' && REASON.test(b.reason) ? b.reason : null;
      const result = opts.db.invalidate(id, reason, now());
      log(`[leaderboard-db] admin invalidate id=${id} outcome=${result.found ? 'ok' : 'not-found'}`);
      return result.found ? [200, { current: result.current }] : [404, { error: 'not found' }];
    }
    throw new HttpError(404, 'not found');
  }

  const server = createServer((req, res) => {
    const started = now();
    route(req)
      .then(([status, body]) => send(res, status, body))
      .catch((err: unknown) => {
        if (err instanceof HttpError) {
          send(res, err.status, { error: err.body });
        } else {
          log(`[leaderboard-db] internal error: ${err instanceof Error ? err.message : String(err)}`);
          send(res, 500, { error: 'internal error' });
        }
      })
      .finally(() => {
        // Method, path without query, status, duration. Never bodies, never headers.
        log(`[leaderboard-db] ${req.method} ${(req.url ?? '').split('?')[0].slice(0, 64)} ${res.statusCode} ${now() - started}ms`);
      });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 128;
  return server;
}

function alertCommand(path: string | undefined): ServiceOptions['onNewRecord'] {
  if (!path) return undefined;
  return (nickname, country, timeMs) => {
    // execFile, fixed argv, no shell: nickname is already [a-z0-9]{3,20}, country [A-Z]{2}.
    execFile(path, ['Lullwood: new leaderboard record', `${nickname} (${country}) ${(timeMs / 1000).toFixed(1)}s`],
      { timeout: 30_000 }, (err) => { if (err) console.error('[leaderboard-db] new-record alert failed:', err.message); });
  };
}

// Entry point: `node services/leaderboard-db/server.ts`. Configuration is env only (see README.md).
if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = usableSecret(process.env.LB_API_SECRET);
  const dbPath = process.env.LB_DB_PATH;
  if (!secret || !dbPath) {
    console.error('[leaderboard-db] refusing to start: LB_API_SECRET (>= 32 chars) and LB_DB_PATH are required');
    process.exit(1);
  }
  const db = new LeaderboardDb(dbPath);
  const pruned = db.pruneEvents(Date.now());
  setInterval(() => db.pruneEvents(Date.now()), 24 * 60 * 60 * 1000).unref();
  // Hourly read-only copy for the agents (stats.ts) and the nightly off-disk backup.
  const snapshotPath = process.env.LB_SNAPSHOT_PATH;
  if (snapshotPath) {
    const takeSnapshot = () => {
      try { db.snapshot(snapshotPath); } catch (err) { console.error('[leaderboard-db] snapshot failed:', err instanceof Error ? err.message : err); }
    };
    takeSnapshot();
    setInterval(takeSnapshot, 60 * 60 * 1000).unref();
  }
  const port = Number(process.env.LB_PORT ?? '8787');
  createService({ db, secret, onNewRecord: alertCommand(process.env.LB_ALERT_CMD) })
    .listen(port, '127.0.0.1', () => console.log(`[leaderboard-db] listening on 127.0.0.1:${port}, db=${dbPath}, pruned ${pruned} old events`));
}
