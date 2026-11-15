'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  COUNTRY_ALLOWLIST, COUNTRY_NAMES, CLIENT_CACHE_KEY, NICKNAME_PATTERN,
  parseRecord, encodeCachedRecord, decodeCachedRecord, validateRunId, leaderboardSubmitGate, type LeaderboardRecord,
} from '@/lib/game/leaderboard';
import type { RunTrace } from '@/lib/game/run-trace';
import { formatDuration } from '@/lib/ui/format-duration';
import { getAnonId } from '@/lib/analytics';

// LUL-3264 wave 1, S3: the record line on #gate and the submit form on the
// Blackout win screen. Storage is the SQLite service behind
// app/api/leaderboard/** -- this file only ever talks to those routes.
//
// Every nickname is rendered as a React text child (textContent), never as
// HTML (B2). The localStorage cache is display-only (B8): it is validated on
// read and never sent back to the server.

// Exported (LUL-5820 + LUL-3295): components/Hud.tsx calls useLeaderboardRecord()
// once and shares the result with #leaderboardLine (below), the sky balloon and
// the tree tint (both via useLeaderboardSky -> the shared engine action), instead
// of each maintaining its own independent fetch.
export type LeaderboardState =
  | { status: 'loading' }
  | { status: 'populated'; record: LeaderboardRecord }
  | { status: 'empty' }
  | { status: 'failed'; cached: LeaderboardRecord | null };

const FETCH_TIMEOUT_MS = 5_000;
// Sorted by display name; the value submitted is still the ISO code.
const COUNTRIES = [...COUNTRY_ALLOWLIST].sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b]));

function readCache(): LeaderboardRecord | null {
  try {
    return decodeCachedRecord(window.localStorage.getItem(CLIENT_CACHE_KEY), Date.now());
  } catch {
    return null;
  }
}

function writeCache(record: LeaderboardRecord): void {
  try {
    window.localStorage.setItem(CLIENT_CACHE_KEY, encodeCachedRecord(record, Date.now()));
  } catch {
    // private mode / quota: the cache is a nicety, the line still renders
  }
}

// `refreshKey`: bump it to fetch /current again (after a submit that set a new
// record). The current state stays on screen until the new answer lands.
export function useLeaderboardRecord(refreshKey = 0): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/leaderboard/current', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { record?: unknown; unavailable?: unknown };
        if (!body || typeof body !== 'object' || body.unavailable === true || !('record' in body)) throw new Error('unavailable');
        if (body.record === null) return null;
        const record = parseRecord(body.record);
        if (!record) throw new Error('malformed record');
        return record;
      })
      .then((record) => {
        if (cancelled) return;
        if (record) {
          writeCache(record);
          setState({ status: 'populated', record });
        } else {
          setState({ status: 'empty' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed', cached: readCache() });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return state;
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

interface RunSessionState { serial: number; runId: string; finished: boolean; refused: boolean }

/** What the win screen needs from the run session: the confirmed run id, or whether the service refused the run. */
export interface RunSessionResult { runId: string | null; refused: boolean }

/**
 * Server-timed run session for the current run (lib/game/leaderboard.ts "run
 * sessions"). `runSerial` changes on every engine enter() (restarts too): a
 * Blackout run then gets a run id from /api/run/start. `runFinished` turns true
 * at the lift, when the run clock stops: the finish goes to /api/run/finish
 * right then, with the engine's proof-of-play trace (lib/game/run-trace.ts),
 * because the win screen shows ~11 s later. Returns the run id once the
 * service has both stamps, else null (start failed, the run is not Blackout,
 * or the start answer came back after the lift and is dropped -- its finish
 * would be late and fail the clock check anyway). `refused` is true when the
 * service answered the finish with a 400 (for example invalid_trace): that
 * run can't be submitted, and the win screen says so instead of offering the
 * form. A network error or 503 leaves it false (the untimed note).
 */
export function useRunSession(runSerial: number, difficulty: string, runFinished: boolean, runTrace: RunTrace | null = null): RunSessionResult {
  const [session, setSession] = useState<RunSessionState | null>(null);
  // Last serial a start was decided for / a lift was seen for. Each is acted on
  // once per run; difficulty is read when the run starts (a change mid-run only
  // applies to the next run, same as the engine).
  const startedFor = useRef(0);
  const liftedFor = useRef(0);

  useEffect(() => {
    if (runSerial === 0 || startedFor.current === runSerial) return;
    startedFor.current = runSerial;
    if (difficulty !== 'blackout') return;
    const serial = runSerial;
    postJson('/api/run/start', { difficulty, anon_id: getAnonId() })
      .then(async (res) => (res.status === 201 ? validateRunId(((await res.json()) as { run_id?: unknown })?.run_id) : null))
      .catch(() => null)
      .then((runId) => {
        if (runId && startedFor.current === serial && liftedFor.current !== serial) setSession({ serial, runId, finished: false, refused: false });
      });
  }, [runSerial, difficulty]);

  useEffect(() => {
    if (!runFinished || liftedFor.current === runSerial) return;
    liftedFor.current = runSerial;
    if (!session || session.serial !== runSerial) return;
    const { serial, runId } = session;
    postJson('/api/run/finish', { run_id: runId, anon_id: getAnonId(), ...(runTrace ? { trace: runTrace } : {}) })
      .then((res) => {
        if (res.ok) setSession((prev) => (prev && prev.serial === serial ? { ...prev, finished: true } : prev));
        else if (res.status === 400) setSession((prev) => (prev && prev.serial === serial ? { ...prev, refused: true } : prev));
      })
      .catch(() => {});
  }, [runFinished, runSerial, session, runTrace]);

  const current = session && session.serial === runSerial ? session : null;
  return { runId: current && current.finished ? current.runId : null, refused: current?.refused ?? false };
}

const recordLine = (r: LeaderboardRecord) => `${r.nickname} is the top rescuer at ${formatDuration(r.timeMs / 1000)} — can you beat it?`;

export function LeaderboardMenuLine({ state }: { state: LeaderboardState }) {
  if (state.status === 'failed' && !state.cached) return null; // hidden entirely when there is nothing to show
  const record = state.status === 'populated' ? state.record : state.status === 'failed' ? state.cached : null;
  const text =
    state.status === 'loading' ? 'Loading top rescuer…'
      : state.status === 'empty' ? 'No rescuer yet — be the first.'
        : recordLine(record!);
  return <div id="leaderboardLine" data-state={state.status}>{text}</div>;
}

type SubmitStatus = 'idle' | 'submitting' | 'done' | 'record' | 'rate_limited' | 'rejected' | 'error';

/**
 * Rendered only for an eligible run: a Blackout win with admin mode off for the
 * whole run (Blackout already forces the minimap off, engine/tuning.js). A run
 * that had admin mode on at any point renders #leaderboardAdminNote instead
 * (founder 2026-10-13: say so, don't stay silent); a non-Blackout win renders
 * #leaderboardIneligibleNote -- LUL-5944. The plausibility floor stays silent.
 * A run paused at any point renders #leaderboardPausedNote, and a run the
 * server did not time (no run id from useRunSession) #leaderboardUntimedNote,
 * and a run the server refused at the finish (its path did not check out)
 * #leaderboardUnverifiedNote (lib/game/leaderboard.ts leaderboardSubmitGate
 * has the order).
 */
export function LeaderboardSubmitForm({ survivedSeconds, difficulty, adminUsedThisRun = false, pausedThisRun = false, runId, runRefused = false, onRecord }: {
  survivedSeconds: number; difficulty: string; adminUsedThisRun?: boolean; pausedThisRun?: boolean; runId: string | null; runRefused?: boolean; onRecord?: () => void;
}) {
  const [nickname, setNickname] = useState('');
  const [country, setCountry] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [rejection, setRejection] = useState('');
  // Read once when the win screen mounts (SettingsPanel.tsx writes body[data-admin-mode]).
  // The game UI is client-only (ssr:false), so document always exists here.
  const [adminMode] = useState(() => document.body.dataset.adminMode === '1');

  const timeMs = Math.round(survivedSeconds * 1000);
  // Feature Checklist Q5: a refused input needs a positive tell. Admin mode (on
  // now, or at any point of the run) is checked first and says so. The difficulty
  // gate must come before the plausibility floor -- a normal Lantern/Night win is
  // usually *faster* than the ~15.7s floor (it's the easier tier), so checking the
  // floor first would swallow the tell for exactly the common case it exists for.
  // The floor only matters once a run has already cleared the difficulty gate.
  const gate = leaderboardSubmitGate({ adminMode, adminUsedThisRun, difficulty, timeMs, pausedThisRun, runId, runRefused });
  if (gate === 'admin') {
    return <p id="leaderboardAdminNote">Admin mode was on during this run, so it can&apos;t be counted as the top rescuer.</p>;
  }
  if (gate === 'ineligible') {
    return <p id="leaderboardIneligibleNote">Switch to Blackout to compete for the leaderboard.</p>;
  }
  if (gate === 'hidden') return null;
  if (gate === 'paused') return <p id="leaderboardPausedNote">Paused runs can&apos;t be counted as the top rescuer.</p>;
  if (gate === 'unverified') {
    return <p id="leaderboardUnverifiedNote">The server couldn&apos;t verify this run, so it can&apos;t be counted as the top rescuer.</p>;
  }
  if (gate === 'untimed') {
    return <p id="leaderboardUntimedNote">The server couldn&apos;t time this run, so it can&apos;t be counted as the top rescuer.</p>;
  }

  const canSubmit = status === 'idle' || status === 'error' ? NICKNAME_PATTERN.test(nickname) && country !== '' : false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, country, time_ms: timeMs, anon_id: getAnonId(), run_id: runId, website: honeypot }),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { isRecord?: unknown };
        setStatus(body.isRecord === true ? 'record' : 'done');
        if (body.isRecord === true) onRecord?.();
      } else if (res.status === 429) {
        setStatus('rate_limited');
      } else if (res.status === 400) {
        // The run itself was refused (used, expired, time not verified): retrying won't help.
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setRejection(typeof body?.error === 'string' ? body.error.slice(0, 80) : 'this run could not be verified');
        setStatus('rejected');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  if (status === 'record' || status === 'done') {
    return (
      <p id="leaderboardSubmitted" role="status">
        {status === 'record' ? `New record! ${nickname} is the top rescuer.` : `Saved — ${nickname}, ${formatDuration(timeMs / 1000)}.`}
      </p>
    );
  }

  return (
    <form
      id="leaderboardForm"
      onSubmit={handleSubmit}
      // Typing a nickname must not reach the engine's window keydown listener.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label htmlFor="leaderboardNickname">Put your name on the board</label>
      <div className="leaderboardRow">
        <input
          id="leaderboardNickname"
          value={nickname}
          // UX only (B2): the server re-validates. Drops anything outside a-z.
          onChange={(e) => setNickname(e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 20))}
          placeholder="nickname"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          aria-describedby="leaderboardHint"
        />
        <select id="leaderboardCountry" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="country">
          <option value="">country</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
        </select>
        {/* LUL-5967: own class, not .restartBtn -- shares restartBtn's styling via
            GameCanvas.tsx's selector lists, but must stay a distinct class so
            `#winText .restartBtn` (focus-management, LUL-1081 battery) stays unique. */}
        <button type="submit" className="leaderboardSubmitBtn" disabled={!canSubmit}>
          {status === 'submitting' ? 'saving…' : 'Submit'}
        </button>
      </div>
      <p id="leaderboardHint">3–20 letters or digits · {formatDuration(timeMs / 1000)}</p>
      {/* Honeypot: off-screen, not display:none -- same convention as SuggestionBox. */}
      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="leaderboardHoneypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      {status === 'rate_limited' && <p role="alert" className="leaderboardError">Too many submissions — try again in a little while.</p>}
      {status === 'error' && <p role="alert" className="leaderboardError">That could not be saved. Try again.</p>}
      {status === 'rejected' && <p role="alert" className="leaderboardError">Not saved: {rejection}.</p>}
    </form>
  );
}
