import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// LUL-1918/LUL-2963: POST /api/suggestions -- player suggestion intake for
// the suggestion box (parent LUL-1917). Re-validates the UI's lowercase-a-z-
// and-space restriction server-side, independently, byte for byte --
// duplication with components/SuggestionBox.tsx is intentional (LUL-1917
// guard 2).
//
// Uses web-standard Request/Response (no next/server import), same reasoning
// as app/api/telemetry/route.ts: directly testable with node --test, no
// Next.js runtime mocking required.
//
// Security posture (see PR body for the full note):
// - Text is DATA only, restricted to `^[a-z ]{3,300}$` -- lowercase English
//   letters and spaces, no digits, no punctuation, no other scripts. It is
//   fenced as "untrusted player text" wherever it is persisted and is never
//   placed anywhere it could be read as an instruction.
// - IP addresses are never stored raw -- only a salted SHA-256 hash, used
//   both for rate-limit bucketing and as an audit trail on the stored record.
//
// LUL-2963 (founder direction, 2026-09-16): the Paperclip-API-backed storage
// this route used before required a credential (SUGGESTIONS_PAPERCLIP_TOKEN/
// _API_URL/_COMPANY_ID) that sat unprovisioned for 9+ days (LUL-1918
// interaction 529e8562). The founder asked to write suggestions to local
// storage instead, "for now". See writeSuggestionLocally() below for why
// that only actually persists anything when this process runs somewhere
// with real, writable disk -- which the current production deployment
// (Vercel) is not.

const TEXT_PATTERN = /^[a-z ]{3,300}$/;
const MAX_BODY_BYTES = 2048;

// Abuse guards: in-memory, reset on cold start. Best-effort only, same
// tradeoff as app/api/telemetry/route.ts's isRateLimited -- a new Lambda
// instance starts fresh. Vercel KV would survive across instances; not worth
// the added dependency for a form nobody expects to be hammered.
const lastSubmitAtByIp = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 10 * 1000; // founder direction 2026-09-16: 1 suggestion per 10s per IP

function cooldownMs(): number {
  // Overridable only so route.test.ts can run many same-IP requests back to
  // back without a real 10s sleep per test; production always gets the
  // 10s default, no env var is set for it anywhere else.
  const override = Number(process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE);
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_COOLDOWN_MS;
}

const ipCounts = new Map<string, { count: number; resetAt: number }>();
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_LIMIT = 200;
let globalCount = 0;
let globalResetAt = Date.now() + DAY_MS;

function hashIp(ip: string): string {
  const salt = process.env.SUGGESTIONS_IP_HASH_SALT ?? '';
  return createHash('sha256').update(salt + ip).digest('hex');
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isInCooldown(ipHash: string): boolean {
  const now = Date.now();
  const last = lastSubmitAtByIp.get(ipHash);
  if (last !== undefined && now - last < cooldownMs()) {
    return true;
  }
  lastSubmitAtByIp.set(ipHash, now);
  return false;
}

function isIpRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ipHash);
  if (!entry || now >= entry.resetAt) {
    ipCounts.set(ipHash, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > IP_LIMIT;
}

function isGlobalRateLimited(): boolean {
  const now = Date.now();
  if (now >= globalResetAt) {
    globalCount = 0;
    globalResetAt = now + DAY_MS;
  }
  globalCount++;
  return globalCount > GLOBAL_LIMIT;
}

// LUL-2963: local-disk storage, no external credential.
//
// Default directory is the box's large HDD mount (`/mnt/hdd`), not the SSD
// system disk -- founder direction 2026-09-16. Override with
// SUGGESTIONS_STORAGE_DIR for a different host layout.
//
// IMPORTANT -- this only persists anything on a host where the Next.js
// server process has real, writable disk. The production deployment for
// www.lullwoodgame.com runs on Vercel: Node.js serverless functions there
// get a fresh, isolated, non-persistent filesystem per invocation with no
// route to this (or any) machine's physical disks, so a write to
// `/mnt/hdd` or any other path fails there every time (see LUL-2963 comment
// thread for the full tradeoff and the durability options still open).
// mkdir/appendFile failures are caught and degrade to the same 503 this
// route already used for a missing Paperclip credential -- never a 500.
const DEFAULT_STORAGE_DIR = '/mnt/hdd/lullwood-suggestions';
let warnedAboutStorage = false;

function storageFile(): string {
  const dir = process.env.SUGGESTIONS_STORAGE_DIR || DEFAULT_STORAGE_DIR;
  return path.join(dir, 'suggestions.ndjson');
}

async function writeSuggestionLocally(text: string, ipHash: string): Promise<boolean> {
  const file = storageFile();
  // One JSON-encoded record per line. JSON.stringify does the escaping --
  // `text` is already restricted by TEXT_PATTERN to `[a-z ]`, so there is no
  // control character, quote, backslash or newline for it to escape, but the
  // encoding step stays in place as defense in depth rather than trusting
  // the regex alone.
  const record = {
    submitted_at: new Date().toISOString(),
    ip_hash: ipHash,
    text,
  };
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch (err) {
    if (!warnedAboutStorage) {
      console.warn(`suggestion storage write failed for ${file} -- suggestion intake is degraded`, err);
      warnedAboutStorage = true;
    }
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }

  const { text, website } = payload as Record<string, unknown>;

  // Honeypot: hidden from real players via CSS, so a non-empty value means a
  // bot filled every field. Look successful, create nothing.
  if (typeof website === 'string' && website.length > 0) {
    return new Response(null, { status: 204 });
  }

  if (typeof text !== 'string' || !TEXT_PATTERN.test(text)) {
    return Response.json({ error: 'text must match ^[a-z ]{3,300}$' }, { status: 400 });
  }

  const ipHash = hashIp(getClientIp(req));

  if (isInCooldown(ipHash)) {
    return Response.json({ error: 'please wait a few seconds before sending another suggestion' }, { status: 429 });
  }

  if (isIpRateLimited(ipHash) || isGlobalRateLimited()) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  const created = await writeSuggestionLocally(text, ipHash);
  if (!created) {
    return Response.json({ error: 'suggestion intake unavailable' }, { status: 503 });
  }

  return new Response(null, { status: 204 });
}
