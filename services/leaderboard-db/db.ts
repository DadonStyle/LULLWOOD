import { renameSync, rmSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  COOLDOWN_MS, IP_LIMIT, IP_WINDOW_MS, GLOBAL_LIMIT, GLOBAL_WINDOW_MS, type LeaderboardRecord,
} from '../../lib/game/leaderboard.ts';

// LUL-3264 (SQLite variant): storage for the leaderboard and for the stats the
// studio's agents read. One file, one writer process (server.ts), WAL mode so
// agents can read (stats.ts, read-only connection) while the service writes.
//
// Every statement below is a prepared statement with bound parameters (B3) --
// there is no string-built SQL in this file, including LIMIT and the cursor.
//
// The record-break is atomic because SQLite has one writer: BEGIN IMMEDIATE
// takes the write lock before the rate-limit reads, so two concurrent
// submissions are serialized end to end and the second one's compare-and-set
// sees the first one's committed pointer (the concurrency requirement from the
// LUL-3264 execution review, tested in db.test.ts).

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Append-only history of eligible winning runs. valid=0 is the admin soft delete; rows are never DELETEd.
CREATE TABLE IF NOT EXISTS record_holders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname           TEXT    NOT NULL CHECK (length(nickname) BETWEEN 3 AND 20),
  country            TEXT    NOT NULL CHECK (length(country) = 2),
  time_ms            INTEGER NOT NULL CHECK (time_ms > 0),
  difficulty         TEXT    NOT NULL CHECK (difficulty = 'blackout'),
  build_sha          TEXT    NOT NULL,
  achieved_at        INTEGER NOT NULL,              -- epoch ms, server clock
  ip_hash            TEXT    NOT NULL CHECK (length(ip_hash) = 64),
  anon_id            TEXT,
  device_class       TEXT,
  browser            TEXT,
  valid              INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0, 1)),
  invalidated_at     INTEGER,
  invalidated_reason TEXT
);
CREATE INDEX IF NOT EXISTS record_holders_valid_time_idx ON record_holders (valid, time_ms, id);
CREATE INDEX IF NOT EXISTS record_holders_ip_time_idx ON record_holders (ip_hash, achieved_at);
CREATE INDEX IF NOT EXISTS record_holders_achieved_idx ON record_holders (achieved_at);

-- Single-row pointer to the current record holder (CHECK enforces exactly one row).
CREATE TABLE IF NOT EXISTS current_record (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  holder_id INTEGER REFERENCES record_holders (id)
);
INSERT OR IGNORE INTO current_record (id, holder_id) VALUES (1, NULL);

-- Nickname history, maintained in the same transaction as each submission.
CREATE TABLE IF NOT EXISTS players (
  nickname       TEXT PRIMARY KEY,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  submissions    INTEGER NOT NULL DEFAULT 0,
  best_time_ms   INTEGER,
  best_record_id INTEGER REFERENCES record_holders (id),
  last_country   TEXT,
  last_anon_id   TEXT
);

-- Every finished run (win or loss) from telemetry, typed for querying.
CREATE TABLE IF NOT EXISTS runs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at          INTEGER NOT NULL,
  event_ts             INTEGER,
  anon_id              TEXT,
  outcome              TEXT    NOT NULL CHECK (outcome IN ('win', 'loss')),
  difficulty           TEXT,
  time_survived_ms     INTEGER,
  seed                 INTEGER,
  payout               INTEGER,
  balance              INTEGER,
  predator_kind        TEXT,
  death_cause          TEXT,
  distance_from_home_m REAL,
  purchases_json       TEXT,
  build_sha            TEXT,
  device_class         TEXT,
  browser              TEXT,
  country              TEXT
);
CREATE INDEX IF NOT EXISTS runs_received_idx ON runs (received_at);
CREATE INDEX IF NOT EXISTS runs_anon_idx ON runs (anon_id, received_at);

-- Every telemetry event, raw (validated envelope + JSON payload). Pruned after EVENT_RETENTION_DAYS.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  INTEGER NOT NULL,
  event_ts     INTEGER,
  event        TEXT    NOT NULL,
  anon_id      TEXT,
  build_sha    TEXT,
  path         TEXT,
  device_class TEXT,
  browser      TEXT,
  country      TEXT,
  payload_json TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS events_received_idx ON events (received_at);
CREATE INDEX IF NOT EXISTS events_event_idx ON events (event, received_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  action    TEXT    NOT NULL,
  record_id INTEGER,
  outcome   TEXT    NOT NULL,
  detail    TEXT
);

-- Read-only views for the agents (services/leaderboard-db/stats.ts). Times are epoch ms.
CREATE VIEW IF NOT EXISTS v_runs_daily AS
  SELECT date(received_at / 1000, 'unixepoch') AS day, difficulty,
         count(*) AS runs, sum(outcome = 'win') AS wins,
         round(100.0 * sum(outcome = 'win') / count(*), 1) AS win_pct,
         round(avg(time_survived_ms) / 1000.0, 1) AS avg_survived_s,
         count(DISTINCT anon_id) AS players
  FROM runs GROUP BY day, difficulty;

CREATE VIEW IF NOT EXISTS v_deaths AS
  SELECT difficulty, predator_kind, death_cause, count(*) AS deaths,
         round(avg(time_survived_ms) / 1000.0, 1) AS avg_survived_s,
         round(avg(distance_from_home_m), 1) AS avg_distance_from_home_m
  FROM runs WHERE outcome = 'loss' GROUP BY difficulty, predator_kind, death_cause;

CREATE VIEW IF NOT EXISTS v_devices AS
  SELECT device_class, browser, count(*) AS runs,
         round(100.0 * sum(outcome = 'win') / count(*), 1) AS win_pct,
         round(avg(time_survived_ms) / 1000.0, 1) AS avg_survived_s
  FROM runs GROUP BY device_class, browser;

CREATE VIEW IF NOT EXISTS v_player_runs AS
  SELECT anon_id, count(*) AS runs, sum(outcome = 'win') AS wins,
         min(received_at) AS first_run_at, max(received_at) AS last_run_at,
         min(CASE WHEN outcome = 'win' THEN time_survived_ms END) AS best_win_ms
  FROM runs WHERE anon_id IS NOT NULL GROUP BY anon_id;

CREATE VIEW IF NOT EXISTS v_funnel_daily AS
  SELECT date(received_at / 1000, 'unixepoch') AS day,
         count(DISTINCT CASE WHEN event = 'page_view' THEN anon_id END) AS viewed,
         count(DISTINCT CASE WHEN event = 'cta_start_clicked' THEN anon_id END) AS clicked_start,
         count(DISTINCT CASE WHEN event = 'game_start' THEN anon_id END) AS started,
         count(DISTINCT CASE WHEN event IN ('win', 'loss') THEN anon_id END) AS finished_a_run,
         count(DISTINCT CASE WHEN event = 'win' THEN anon_id END) AS won
  FROM events GROUP BY day;

CREATE VIEW IF NOT EXISTS v_feature_engagement AS
  SELECT json_extract(payload_json, '$.feature') AS feature, json_extract(payload_json, '$.action') AS action,
         count(*) AS uses, count(DISTINCT anon_id) AS players
  FROM events WHERE event = 'feature_engagement' GROUP BY feature, action;

CREATE VIEW IF NOT EXISTS v_nicknames AS
  SELECT p.nickname, p.submissions, p.best_time_ms, p.last_country,
         datetime(p.first_seen / 1000, 'unixepoch') AS first_seen, datetime(p.last_seen / 1000, 'unixepoch') AS last_seen,
         (SELECT count(*) FROM runs r WHERE r.anon_id = p.last_anon_id) AS runs_on_device
  FROM players p;

CREATE VIEW IF NOT EXISTS v_leaderboard AS
  SELECT id, nickname, country, time_ms, datetime(achieved_at / 1000, 'unixepoch') AS achieved_at, valid
  FROM record_holders ORDER BY valid DESC, time_ms, id;
`;

export const EVENT_RETENTION_DAYS = 180;
export const MAX_EVENTS_PER_DAY = 100_000;
export const MAX_DB_BYTES = 2 * 1024 * 1024 * 1024;

export interface SubmitInput {
  nickname: string;
  country: string;
  timeMs: number;
  buildSha: string;
  ipHash: string;
  anonId: string | null;
  deviceClass: string | null;
  browser: string | null;
}

export type SubmitResult =
  | { ok: true; id: number; isRecord: boolean }
  | { ok: false; reason: 'cooldown' | 'ip-limit' | 'global-limit' };

export interface EventInput {
  event: string;
  eventTs: number | null;
  anonId: string | null;
  buildSha: string | null;
  path: string | null;
  deviceClass: string | null;
  browser: string | null;
  country: string | null;
  payload: Record<string, unknown>;
}

interface Row { [key: string]: unknown }

function toRecord(row: Row | undefined): LeaderboardRecord | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    nickname: String(row.nickname),
    country: String(row.country),
    timeMs: Number(row.time_ms),
    achievedAt: new Date(Number(row.achieved_at)).toISOString(),
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 64): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

export class LeaderboardDb {
  readonly db: DatabaseSync;
  private readonly stmts: Record<string, StatementSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    const p = (sql: string) => this.db.prepare(sql);
    this.stmts = {
      lastByIp: p('SELECT achieved_at FROM record_holders WHERE ip_hash = ? ORDER BY achieved_at DESC LIMIT 1'),
      countByIp: p('SELECT count(*) AS n FROM record_holders WHERE ip_hash = ? AND achieved_at > ?'),
      countAll: p('SELECT count(*) AS n FROM record_holders WHERE achieved_at > ?'),
      insertHolder: p(`INSERT INTO record_holders (nickname, country, time_ms, difficulty, build_sha, achieved_at, ip_hash, anon_id, device_class, browser)
                       VALUES (?, ?, ?, 'blackout', ?, ?, ?, ?, ?, ?)`),
      // Compare-and-set: only moves the pointer when the new row is strictly
      // faster than the current valid holder (or there is none).
      casPointer: p(`UPDATE current_record SET holder_id = :id WHERE id = 1 AND (
                       holder_id IS NULL OR
                       (SELECT time_ms FROM record_holders WHERE id = current_record.holder_id AND valid = 1) IS NULL OR
                       (SELECT time_ms FROM record_holders WHERE id = current_record.holder_id) > :time)`),
      upsertPlayer: p(`INSERT INTO players (nickname, first_seen, last_seen, submissions, best_time_ms, best_record_id, last_country, last_anon_id)
                       VALUES (:nick, :now, :now, 1, :time, :id, :country, :anon)
                       ON CONFLICT (nickname) DO UPDATE SET
                         last_seen = :now, submissions = submissions + 1, last_country = :country,
                         last_anon_id = coalesce(:anon, last_anon_id),
                         best_record_id = CASE WHEN best_time_ms IS NULL OR :time < best_time_ms THEN :id ELSE best_record_id END,
                         best_time_ms = CASE WHEN best_time_ms IS NULL OR :time < best_time_ms THEN :time ELSE best_time_ms END`),
      current: p(`SELECT r.id, r.nickname, r.country, r.time_ms, r.achieved_at FROM current_record c
                  JOIN record_holders r ON r.id = c.holder_id AND r.valid = 1 WHERE c.id = 1`),
      listFirst: p('SELECT id, nickname, country, time_ms, achieved_at FROM record_holders WHERE valid = 1 ORDER BY id DESC LIMIT ?'),
      listAfter: p('SELECT id, nickname, country, time_ms, achieved_at FROM record_holders WHERE valid = 1 AND id < ? ORDER BY id DESC LIMIT ?'),
      exists: p('SELECT id, valid FROM record_holders WHERE id = ?'),
      invalidate: p('UPDATE record_holders SET valid = 0, invalidated_at = ?, invalidated_reason = ? WHERE id = ?'),
      repoint: p(`UPDATE current_record SET holder_id = (SELECT id FROM record_holders WHERE valid = 1 ORDER BY time_ms, id LIMIT 1) WHERE id = 1`),
      audit: p('INSERT INTO admin_audit (at, action, record_id, outcome, detail) VALUES (?, ?, ?, ?, ?)'),
      eventsSince: p('SELECT count(*) AS n FROM events WHERE received_at > ?'),
      insertEvent: p(`INSERT INTO events (received_at, event_ts, event, anon_id, build_sha, path, device_class, browser, country, payload_json)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insertRun: p(`INSERT INTO runs (received_at, event_ts, anon_id, outcome, difficulty, time_survived_ms, seed, payout, balance,
                      predator_kind, death_cause, distance_from_home_m, purchases_json, build_sha, device_class, browser, country)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      prune: p('DELETE FROM events WHERE received_at < ?'),
      dbBytes: p('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()'),
    };
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  submit(input: SubmitInput, now: number): SubmitResult {
    return this.tx(() => {
      const last = this.stmts.lastByIp.get(input.ipHash) as Row | undefined;
      if (last && now - Number(last.achieved_at) < COOLDOWN_MS) return { ok: false, reason: 'cooldown' } as const;
      if (Number((this.stmts.countByIp.get(input.ipHash, now - IP_WINDOW_MS) as Row).n) >= IP_LIMIT) return { ok: false, reason: 'ip-limit' } as const;
      if (Number((this.stmts.countAll.get(now - GLOBAL_WINDOW_MS) as Row).n) >= GLOBAL_LIMIT) return { ok: false, reason: 'global-limit' } as const;

      const id = Number(this.stmts.insertHolder.run(
        input.nickname, input.country, input.timeMs, input.buildSha, now, input.ipHash, input.anonId, input.deviceClass, input.browser,
      ).lastInsertRowid);
      const isRecord = Number(this.stmts.casPointer.run({ id, time: input.timeMs }).changes) === 1;
      this.stmts.upsertPlayer.run({ nick: input.nickname, now, time: input.timeMs, id, country: input.country, anon: input.anonId });
      return { ok: true, id, isRecord } as const;
    });
  }

  current(): LeaderboardRecord | null {
    return toRecord(this.stmts.current.get() as Row | undefined);
  }

  list(limit: number, cursor: number | null): { records: LeaderboardRecord[]; nextCursor: number | null } {
    const rows = (cursor === null ? this.stmts.listFirst.all(limit) : this.stmts.listAfter.all(cursor, limit)) as Row[];
    const records = rows.map((r) => toRecord(r)!);
    return { records, nextCursor: records.length === limit ? records[records.length - 1].id : null };
  }

  /** B5: soft delete + promote the next-fastest valid row, in one transaction. */
  invalidate(id: number, reason: string | null, now: number): { found: boolean; current: LeaderboardRecord | null } {
    return this.tx(() => {
      const row = this.stmts.exists.get(id) as Row | undefined;
      if (!row) {
        this.stmts.audit.run(now, 'invalidate', id, 'not-found', null);
        return { found: false, current: this.current() };
      }
      this.stmts.invalidate.run(now, reason, id);
      this.stmts.repoint.run();
      this.stmts.audit.run(now, 'invalidate', id, 'ok', reason);
      return { found: true, current: this.current() };
    });
  }

  /**
   * Stores one telemetry event, plus a typed `runs` row for win/loss. Returns
   * false when the daily cap or the size cap is hit -- telemetry is shed
   * before it can fill the disk; leaderboard writes are not affected.
   */
  recordEvent(input: EventInput, now: number): boolean {
    if (Number((this.stmts.eventsSince.get(now - 24 * 60 * 60 * 1000) as Row).n) >= MAX_EVENTS_PER_DAY) return false;
    if (Number((this.stmts.dbBytes.get() as Row).bytes) >= MAX_DB_BYTES) return false;
    const p = input.payload;
    this.tx(() => {
      this.stmts.insertEvent.run(now, input.eventTs, input.event, input.anonId, input.buildSha, input.path,
        input.deviceClass, input.browser, input.country, JSON.stringify(p));
      if (input.event === 'win' || input.event === 'loss') {
        const purchases = Array.isArray(p.purchases_made) ? JSON.stringify(p.purchases_made).slice(0, 1024) : null;
        this.stmts.insertRun.run(now, input.eventTs, input.anonId, input.event, str(p.difficulty, 16), num(p.time_survived_ms),
          num(p.seed), num(p.payout), num(p.balance), str(p.predator_kind, 16), str(p.death_cause, 32), num(p.distance_from_home_m),
          purchases, input.buildSha, input.deviceClass, input.browser, input.country);
      }
    });
    return true;
  }

  /**
   * Writes a consistent copy of the whole database to `path` (VACUUM INTO a
   * temp file, then an atomic rename). The agents' stats.ts reads this copy,
   * never the live file: they run as a different OS user, need no write access
   * anywhere, and cannot hold a lock that stalls the service.
   */
  snapshot(path: string): void {
    const tmp = `${path}.tmp`;
    rmSync(tmp, { force: true });
    this.db.prepare('VACUUM INTO ?').run(tmp);
    renameSync(tmp, path);
  }

  pruneEvents(now: number): number {
    return Number(this.stmts.prune.run(now - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).changes);
  }

  close(): void {
    this.db.close();
  }
}
