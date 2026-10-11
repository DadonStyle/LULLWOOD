'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  COUNTRY_ALLOWLIST, CLIENT_CACHE_KEY, NICKNAME_PATTERN, PLAUSIBILITY_FLOOR_MS,
  parseRecord, encodeCachedRecord, decodeCachedRecord, type LeaderboardRecord,
} from '@/lib/game/leaderboard';
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
const COUNTRIES = [...COUNTRY_ALLOWLIST].sort();

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

export function useLeaderboardRecord(): LeaderboardState {
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
  }, []);
  return state;
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

type SubmitStatus = 'idle' | 'submitting' | 'done' | 'record' | 'rate_limited' | 'error';

/**
 * Rendered only for an eligible run: a Blackout win with admin mode off
 * (Blackout already forces the minimap off, engine/tuning.js). Admin mode and
 * the plausibility floor stay silent (not real-player-facing); a non-Blackout
 * win instead renders #leaderboardIneligibleNote -- LUL-5944.
 */
export function LeaderboardSubmitForm({ survivedSeconds, difficulty }: { survivedSeconds: number; difficulty: string }) {
  const [nickname, setNickname] = useState('');
  const [country, setCountry] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  // Read once when the win screen mounts (SettingsPanel.tsx writes body[data-admin-mode]).
  // The game UI is client-only (ssr:false), so document always exists here.
  const [adminMode] = useState(() => document.body.dataset.adminMode === '1');

  const timeMs = Math.round(survivedSeconds * 1000);
  // Feature Checklist Q5: a refused input needs a positive tell. adminMode is a dev
  // tool and stays silent regardless of difficulty, checked first. The difficulty
  // gate must come before the plausibility floor -- a normal Lantern/Night win is
  // usually *faster* than the ~15.7s floor (it's the easier tier), so checking the
  // floor first would swallow the tell for exactly the common case it exists for.
  // The floor only matters once a run has already cleared the difficulty gate.
  if (adminMode) return null;
  if (difficulty !== 'blackout') {
    return <p id="leaderboardIneligibleNote">Switch to Blackout to compete for the leaderboard.</p>;
  }
  if (timeMs < PLAUSIBILITY_FLOOR_MS) return null;

  const canSubmit = status === 'idle' || status === 'error' ? NICKNAME_PATTERN.test(nickname) && country !== '' : false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, country, time_ms: timeMs, anon_id: getAnonId(), website: honeypot }),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { isRecord?: unknown };
        setStatus(body.isRecord === true ? 'record' : 'done');
      } else if (res.status === 429) {
        setStatus('rate_limited');
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
          // UX only (B2): the server re-validates. Drops anything outside a-z0-9.
          onChange={(e) => setNickname(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20))}
          placeholder="nickname"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          aria-describedby="leaderboardHint"
        />
        <select id="leaderboardCountry" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="country">
          <option value="">country</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="submit" className="restartBtn" disabled={!canSubmit}>
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
    </form>
  );
}
