# SPEC: LUL-3264 Global leaderboard — wave 1 (S0 schema, S1 write path, S2 read path, S3 client state machine)

**Ticket:** LUL-3264 (parent), executed via LUL-3289 (S0, CTO), LUL-3291 (S1), LUL-3292 (S2),
LUL-3293 (S3) — all three Founding-Engineer-owned per
`decisions/lul-3264-leaderboard-accepted-2026-09-18`. **Tier: B** — new API routes
(`app/api/leaderboard/**`) and new components; no `engine/**` edit (see "Why no engine change"
below), so this is not Tier C. Merges on green; Code Reviewer review lands after, per AGENTS.md.

**Written against:** `release/next` @ `5a955a7` (2026-09-23). Re-derive every `file:line` below
from the branch you actually implement on if it has moved.

**Hard blocker on shipping (not on writing this spec):** S0's Postgres database does not exist
yet. `LUL-3289` (CTO) is `blocked` on `LUL-3310`, a founder-only 2-minute Vercel-dashboard action
(create a Postgres database, attach to Production) — no agent on this box has Vercel credentials
(`decisions` note on LUL-3289, verified again 2026-09-23: no `~/.vercel`, no `VERCEL_*` env var,
`package.json` still has only `@vercel/blob`). This SPEC exists so that the moment LUL-3310 is
resolved, S0-S3 can be implemented back-to-back without another research pass. **Do not merge any
S1/S2/S3 code that talks to a real Postgres connection until LUL-3289 posts the production
write-then-read-back proof** (per the ratified sequencing — "no display surface ships before that
proof"). `lib/game/leaderboard.ts` (pure validation/plausibility logic, no DB import) can be built
and merged standalone ahead of S0 with zero risk; the route handlers cannot.

## Why no engine change (Tier B, not C)

Every value the write path needs is already computed and already leaves the engine on every win:
`survivedSeconds` (`engine/forest-engine.js:5911`, `Math.max(0, clock.elapsedTime - enteredAt)`)
and `difficulty` are both in the `pushState({..., survivedSeconds, ..., difficulty, ...})` call at
the end of the win handler (`engine/forest-engine.js:5944-5948`) and already flow into
`EngineHudState` (`components/Hud.tsx:39` `winVisible`, `:48` `survivedSeconds`) and into
`RunRecap`'s props (`components/Hud.tsx:557`). Eligibility (tier + minimap + admin mode, below) is
readable client-side with zero new engine plumbing. Nothing in wave 1 changes how the game plays.

## Q1.5 — trigger reachability (checklist §A)

`state.winVisible` (the gate for showing the submission form) is set `true` by the real win path
only: `pushState({ ..., winVisible: true, ... })` at `engine/forest-engine.js:5944`, inside the
function that runs when the player delivers the child home (`logChronicle('win')` immediately
above it, `:5943`). No QA hook sets `winVisible` directly — `qaTeleportNearBaby` +
`KeyE` (pickup) + walking home still drive the real code path, same as
`e2e/progression.spec.ts:14-16`. Reachable today, real-play only.

## Files

- `lib/game/leaderboard.ts` — created. Pure constants + validation + plausibility floor. No DB
  import, importable from both a route handler and a client component.
- `lib/game/leaderboard.test.ts` — created. `node --test` unit coverage for every guard.
- `lib/db/leaderboard-schema.sql` — created. S0's migration, run once by whoever executes LUL-3289
  (`psql $POSTGRES_URL -f lib/db/leaderboard-schema.sql`, documented in the file header). Not
  application code — nothing imports it.
- `app/api/leaderboard/route.ts` — created. `POST` (submit) + `GET` (paginated winners table).
- `app/api/leaderboard/current/route.ts` — created. `GET`, edge-cached.
- `app/api/leaderboard/[id]/invalidate/route.ts` — created. `POST`, admin-only.
- `app/api/leaderboard/route.test.ts`, `app/api/leaderboard/current/route.test.ts`,
  `app/api/leaderboard/[id]/invalidate/route.test.ts` — created. Mirror
  `app/api/suggestions/route.test.ts`'s shape (web-standard `Request`, `node --test`).
- `components/Leaderboard.tsx` — created. `LeaderboardMenuLine` (gate surface) +
  `LeaderboardSubmitForm` (win-screen surface) + the 4-state fetch hook, `useLeaderboardRecord()`.
- `components/Hud.tsx` — edited. Mount `LeaderboardMenuLine` inside `#gate`
  (`components/Hud.tsx:881-896`) and `LeaderboardSubmitForm` inside the win screen, gated on
  `state.winVisible && state.difficulty === 'blackout'` (near `components/Hud.tsx:1170-1176`,
  the existing `RunRecap` mount).
- `NOAM_MDS/ARCHITECTURE.md` — edited. No `.env.example` exists in this repo (verified — grep for
  the filename finds nothing); env vars are documented in prose here instead, e.g.
  `SUGGESTIONS_IP_HASH_SALT` at `NOAM_MDS/ARCHITECTURE.md:1025,1034`. Add the same two rows for
  `LEADERBOARD_IP_HASH_SALT` and `LEADERBOARD_ADMIN_TOKEN`, same fail-closed-if-unset contract
  (`app/api/suggestions/route.ts:127-130`, `getIpHashSalt`), no default value for either.
- `package.json` — edited. Add `@vercel/postgres` (next to the existing `"@vercel/blob": "^2.8.0"`,
  `package.json:18`) at whatever is `latest` when S0 is actually executed — pin the exact version
  in the S0/S1 PR, do not guess it here.

## S0 — schema (design now, execute later, CTO-owned per LUL-3289)

`lib/db/leaderboard-schema.sql`:

```sql
-- LUL-3264 wave 1, S0. Run once against the Production Postgres database
-- created by LUL-3310. Two tables per decisions/lul-3264-leaderboard-accepted-2026-09-18:
-- record_holders is append-only history, current_record is a maintained pointer.
-- valid=false is a soft delete (admin invalidate) -- never DELETE a row.

CREATE TABLE record_holders (
  id             BIGSERIAL PRIMARY KEY,
  nickname       TEXT NOT NULL,           -- already lowercased, /^[a-z0-9]{3,20}$/
  country        CHAR(2) NOT NULL,        -- ISO 3166-1 alpha-2, allowlist-checked at write time
  time_ms        INTEGER NOT NULL CHECK (time_ms > 0),
  difficulty     TEXT NOT NULL CHECK (difficulty = 'blackout'),  -- LUL-3264 Amendment 2 S1.1: no other tier is eligible
  build_sha      TEXT NOT NULL,
  achieved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash        TEXT NOT NULL,           -- salted, never the raw IP -- LEADERBOARD_IP_HASH_SALT
  valid          BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX record_holders_valid_time_idx ON record_holders (valid, time_ms) WHERE valid;
CREATE INDEX record_holders_achieved_at_idx ON record_holders (achieved_at DESC);

-- Single-row pointer table (not a view -- a view recomputing MIN(time_ms) over
-- an unindexed WHERE valid scan on every GET /current defeats the point of
-- edge-caching that route). Updated in the same transaction as the insert
-- that broke the record (see POST handler below).
CREATE TABLE current_record (
  id            BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- enforces exactly one row
  holder_id     BIGINT REFERENCES record_holders(id)
);
INSERT INTO current_record (id, holder_id) VALUES (true, NULL);
```

**S0 execution checklist** (for whoever runs LUL-3289 once LUL-3310 lands): apply this file, then
prove it with a real write + read-back against Production (not a unit test) — `psql` insert a
throwaway row with `nickname='__s0proof__'`, `SELECT` it back, `DELETE` it. Post the proof
transcript on LUL-3289. Only then unblock LUL-3291.

## S1 — `POST /api/leaderboard` (write path)

`lib/game/leaderboard.ts`:

```ts
export const NICKNAME_PATTERN = /^[a-z0-9]{3,20}$/;
export const MAX_BODY_BYTES = 2048;              // app/api/suggestions/route.ts:63, same cap reused
export const COOLDOWN_MS = 10_000;                // app/api/suggestions/route.ts:67 DEFAULT_COOLDOWN_MS, same value
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 60 * 60 * 1000;       // app/api/suggestions/route.ts:77-78, same values
export const GLOBAL_LIMIT = 200;                  // app/api/suggestions/route.ts:81
export const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

// engine/tuning.js:18 mapSize=480, :60 home at origin, :42 walk=6,
// lib/game/stamina.ts:15 STAMINA_SPRINT_MUL=1.8 -- max theoretical speed
// 6*1.8=10.8 u/s, max theoretical distance = half-diagonal of the map =
// sqrt(240^2+240^2) ~= 339.4u. Floor = that distance / that speed, halved
// again as a safety margin against false-positives on a genuinely fast
// legitimate run (terrain, hiding, baby-carry slowdown all push real times
// well above the theoretical unobstructed minimum) -- tune PLAUSIBILITY_MARGIN
// from real S1 data once the board has traffic, do not re-derive the whole
// formula.
export const PLAUSIBILITY_MARGIN = 0.5;
export const PLAUSIBILITY_FLOOR_MS = Math.round(
  (339.4 / 10.8) * 1000 * PLAUSIBILITY_MARGIN
); // ~15_700

export const PLAUSIBILITY_CEILING_MS = 60 * 60 * 1000; // 1h -- reject stale/bogus large values, not a real constraint

// ISO 3166-1 alpha-2, intentionally not the full ~250-entry table -- add
// codes as needed, this is a denylist-by-omission allowlist, not meant to be
// exhaustive on day one. S5 (flag-tinted trees, Game Engineer) needs a much
// bigger country->palette table; that is a separate concern, do not merge
// the two.
export const COUNTRY_ALLOWLIST = new Set([
  'US','GB','CA','AU','DE','FR','JP','BR','IN','MX','ES','IT','NL','SE','NO',
  'DK','FI','PL','RU','CN','KR','ZA','NZ','IE','PT','AR','CL','TR','GR','IL',
]);

// Digit-substitution normalization per LUL-3288 threat model B4
// (decisions/lul-3288-leaderboard-threat-model-accepted-2026-09-18.md):
// 4->a, 1->i, 0->o, 3->e, 5->s, checked AFTER lowercasing.
const LEET_MAP: Record<string, string> = { '4': 'a', '1': 'i', '0': 'o', '3': 'e', '5': 's' };
export function normalizeForDenylist(nickname: string): string {
  return nickname.toLowerCase().replace(/[41035]/g, (c) => LEET_MAP[c]);
}

// Seed list only -- narrow and intentionally conservative. Per
// decisions/lul-3264-leaderboard-accepted-2026-09-18 "three items are
// founder-only... denylist seed" -- this starter set unblocks S1 merging
// without inventing the founder's actual list; flag for founder review
// before the record surface goes live to real players (S3/S4 launch, not S1
// merge).
export const NICKNAME_DENYLIST = new Set(['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'rape']);

export function isDenylisted(nickname: string): boolean {
  const norm = normalizeForDenylist(nickname);
  for (const bad of NICKNAME_DENYLIST) if (norm.includes(bad)) return true;
  return false;
}

export function validateNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (!NICKNAME_PATTERN.test(lower)) return null;
  if (isDenylisted(lower)) return null;
  return lower;
}

export function validateCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  return COUNTRY_ALLOWLIST.has(upper) ? upper : null;
}

// Strict per threat-model B1: integer only, finite, in-range. Rejects
// NaN/Infinity/negative/float/numeric-string/oversize by construction --
// `typeof === 'number'` alone already rejects "5" (a string); the explicit
// checks below reject the rest.
export function validateTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) return null;
  if (raw < PLAUSIBILITY_FLOOR_MS || raw > PLAUSIBILITY_CEILING_MS) return null;
  return raw;
}
```

`app/api/leaderboard/route.ts` `POST` handler — same shape as
`app/api/suggestions/route.ts:240-305`, reusing its fixed `getClientIp`
(`app/api/suggestions/route.ts:132-149`) and `hashIp`/`getIpHashSalt`
(`:122-130`) verbatim with `LEADERBOARD_IP_HASH_SALT` in place of
`SUGGESTIONS_IP_HASH_SALT`, but with rate-limit/cooldown state moved from
Blob-backed best-effort counters to real Postgres, per LUL-3288 threat model
A3 ("not acceptable even as an interim state" for this route):

```ts
import { sql } from '@vercel/postgres';
import {
  validateNickname, validateCountry, validateTimeMs,
  MAX_BODY_BYTES, COOLDOWN_MS, IP_LIMIT, IP_WINDOW_MS, GLOBAL_LIMIT, GLOBAL_WINDOW_MS,
} from '@/lib/game/leaderboard';

export async function POST(req: Request): Promise<Response> {
  // 1. content-length + body-size guard, same two-stage check as
  //    app/api/suggestions/route.ts:241-244 (Content-Length header first,
  //    actual byte length second -- a client can lie about the header).
  // 2. parse JSON, reject non-object -- suggestions route.ts:246-259.
  // 3. honeypot ('website' field non-empty -> 204, do nothing) --
  //    suggestions route.ts:263-266. Not a security control (LUL-3288
  //    "Relationship to the honeypot field"), bot-noise reduction only.
  // 4. validateNickname / validateCountry / validateTimeMs -- reject 400 on
  //    any null. difficulty is NOT read from the body -- hardcode 'blackout'
  //    server-side (a client claiming a non-blackout run as eligible gains
  //    nothing; the column CHECK constraint would reject it anyway).
  // 5. LEADERBOARD_IP_HASH_SALT unset -> 503, fail closed (suggestions
  //    route.ts:276-282 A2 pattern, same reasoning).
  // 6. ipHash = hashIp(getClientIp(req), salt).
  // 7. Cooldown + IP + global rate limit, via three real SQL statements
  //    inside one transaction per request (not Blob get/put):
  //      - cooldown: SELECT achieved_at FROM record_holders WHERE ip_hash=$1
  //        ORDER BY achieved_at DESC LIMIT 1; reject 429 if < COOLDOWN_MS ago.
  //      - per-IP: SELECT count(*) FROM record_holders WHERE ip_hash=$1 AND
  //        achieved_at > now() - interval '1 hour'; reject 429 if >= IP_LIMIT.
  //      - global: SELECT count(*) FROM record_holders WHERE achieved_at >
  //        now() - interval '1 day'; reject 429 if >= GLOBAL_LIMIT.
  //    All three are read-then-decide on the SAME connection right before
  //    the insert below, inside one BEGIN/COMMIT -- Postgres row-level
  //    locking during the transaction is what makes this safe under
  //    concurrency where Blob's plain get/put (LUL-3288 A3) was not.
  // 8. The record-break itself, ONE transaction (LUL-3264 execution review
  //    "concurrency" requirement -- must not lose a simultaneous win):
  //      BEGIN;
  //      INSERT INTO record_holders (nickname, country, time_ms, difficulty,
  //        build_sha, ip_hash) VALUES ($1,$2,$3,'blackout',$4,$5)
  //        RETURNING id;
  //      UPDATE current_record SET holder_id = $newId
  //        WHERE id = true AND (
  //          holder_id IS NULL OR
  //          (SELECT time_ms FROM record_holders WHERE id = holder_id AND valid)
  //            > $3
  //        );
  //      COMMIT;
  //    The UPDATE's own WHERE clause is the compare-and-set: two concurrent
  //    transactions both INSERT (history keeps both), but only the row that
  //    is still faster than whatever the OTHER transaction just committed
  //    wins the UPDATE -- Postgres's MVCC serializes the two UPDATEs, so
  //    the second one to commit re-evaluates the subquery against the
  //    first one's new pointer. This is the concurrency test target (S1
  //    verification below).
  // 9. build_sha comes from process.env.VERCEL_GIT_COMMIT_SHA (Vercel's own
  //    injected env var, not client-supplied) -- do not trust a client
  //    build_sha field even if the body includes one.
  // 10. Return 204 (match suggestions route's shape, route.ts:305).
}
```

`app/api/leaderboard/[id]/invalidate/route.ts` `POST` handler (admin, B5):

```ts
// Authorization: Bearer <LEADERBOARD_ADMIN_TOKEN> header. Unset env var ->
// 503 (fail closed, same A2-class lesson -- never silently accept an
// unauthenticated call because the token wasn't configured). Wrong/missing
// header -> 401. Every call (success or reject) gets one console.error line
// with { id, outcome } for Vercel function-log visibility -- there is no
// dashboard for this yet (S6 moderation ops), logs are the only trail.
//
// On success: UPDATE record_holders SET valid=false WHERE id=$1; then, in
// the same transaction, promote the next-fastest valid row into
// current_record (UPDATE current_record SET holder_id = (SELECT id FROM
// record_holders WHERE valid ORDER BY time_ms ASC LIMIT 1)) -- this is the
// "promote next fastest" requirement (LUL-3288 verification list, ticket
// PART 4). If no valid rows remain, holder_id goes back to NULL (empty
// state resumes, S3 below).
```

## S2 — read path

`app/api/leaderboard/current/route.ts`:

```ts
// GET, no params (LUL-3288 B7 -- literally nothing user-controlled reaches
// this handler, so the cache key can never vary by request). Reads
// current_record JOIN record_holders, returns
// { nickname, country, time_ms, achieved_at } or null if holder_id IS NULL
// (empty state). export const revalidate = 60 (Next.js route segment config
// -- edge-cached short TTL per decisions/lul-3264-leaderboard-accepted-
// 2026-09-18 Decision 3; 60s is a starting point, not derived from anything
// -- the record changes at most a few times a day).
```

`app/api/leaderboard/route.ts` `GET` handler (same file as S1's `POST`, different export):

```ts
// GET ?limit=&cursor= -- paginated winners table, valid rows only, ORDER BY
// achieved_at DESC. limit clamped to [1,50] server-side (ignore an
// out-of-range or non-numeric value, use the default of 20, do not 400 --
// this is a display list, not a security boundary, but LUL-3288 B3 still
// requires the query itself to be parameterised: `... LIMIT $1 OFFSET $2`
// or a keyset cursor on `id`, never string-interpolated).
```

## S3 — client state machine

`components/Leaderboard.tsx`:

```ts
type LeaderboardState =
  | { status: 'loading' }
  | { status: 'populated'; nickname: string; country: string; timeMs: number }
  | { status: 'empty' }
  | { status: 'failed'; cached: { nickname: string; country: string; timeMs: number } | null };

const CLIENT_CACHE_KEY = 'lullwood:leaderboard:current';
const CLIENT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h -- "hours, not days" per ticket PART 2.3
const FETCH_TIMEOUT_MS = 5_000;

// useLeaderboardRecord(): fetches GET /api/leaderboard/current on mount
// (client-only -- called from a component that is itself dynamic-imported
// ssr:false, same as the rest of the game UI, app/page.tsx's GameLoader
// comment), races it against FETCH_TIMEOUT_MS via AbortController, and
// implements the exact 4-state machine from the ticket's founder amendments
// (state machine correction 2026-09-18 10:54, sky-text clarification
// 2026-09-18 10:55, FAILED-state refinement 2026-09-18 10:55):
//   - starts 'loading'
//   - fetch resolves with a record -> 'populated', ALSO write it + Date.now()
//     to localStorage[CLIENT_CACHE_KEY] (validate shape on read elsewhere
//     per LUL-3288 B8 -- cache is display-only, never sent back to the
//     server, never used to decide a write)
//   - fetch resolves null (succeeded, no record) -> 'empty'
//   - fetch throws / aborts (timeout) / non-2xx / malformed JSON -> read
//     localStorage; if present AND (Date.now() - storedAt) < CLIENT_CACHE_MAX_AGE_MS,
//     -> 'failed' with that cached record (render exactly as populated,
//     per the ticket's explicit "never fall back to empty on failure");
//     else -> 'failed' with cached: null (hide both surfaces)
```

`LeaderboardMenuLine` (mounted inside `#gate`, `components/Hud.tsx:881-896`, right after
`#gateSub` at `:894`):

```tsx
{state.status === 'loading'   && <div id="leaderboardLine">Loading top rescuer…</div>}
{state.status === 'populated' && <div id="leaderboardLine">{state.nickname} is the top rescuer at {formatDuration(state.timeMs/1000)} — can you beat it?</div>}
{state.status === 'empty'     && <div id="leaderboardLine">No rescuer yet — be the first.</div>}
{state.status === 'failed' && state.cached && <div id="leaderboardLine">{state.cached.nickname} is the top rescuer at {formatDuration(state.cached.timeMs/1000)} — can you beat it?</div>}
{/* failed + no cache: render nothing -- line hidden entirely, per ticket PART 2.4 */}
```

`formatDuration` already exists and is already used for this exact `mm:ss` shape at
`components/Hud.tsx:564` (`RunRecap`'s "time survived" line) — import it, do not reimplement.

Reserve `min-width` on `#leaderboardLine` for the longest string (`be the first — --:--` at 21
chars is the sky copy per ticket PART 2.4's own note, not the menu copy above — menu strings run
longer, e.g. `"{20-char nickname} is the top rescuer at 59:59 — can you beat it?"`; measure the
actual longest menu string, not the sky one, when implementing) so there is no layout shift between
states (ticket PART 7 acceptance criterion).

`LeaderboardSubmitForm` (mounted on the win screen, gated `state.winVisible && state.difficulty ===
'blackout'`, near `components/Hud.tsx:1170-1176`'s existing `RunRecap` mount):

```tsx
// Eligibility, computed client-side at render time (not just gated on
// difficulty): document.body.dataset.adminMode !== '1' (SettingsPanel.tsx:123
// writes this dataset attr) AND state.difficulty === 'blackout'. Minimap-off
// does NOT need a separate check -- engine/tuning.js:306's blackout preset
// already forces preset.minimap=false, applied unconditionally by
// engine/forest-engine.js:2120 (`mm.style.display = preset.minimap ? '' :
// 'none'`) regardless of admin-mode state (confirmed live,
// e2e/minimap-setting.spec.ts:39-53's "hidden on blackout regardless of
// admin mode" test already covers this as a game-mechanics invariant this
// spec depends on, not one it re-tests).
//
// Not eligible (wrong tier or admin mode on) -> form does not render at all;
// RunRecap's existing content is unaffected. This is deliberately silent,
// not a "you were not eligible" message -- Q5 of the feature checklist asks
// about REFUSED INPUT, not withheld affordances; there is no input to
// refuse if the form was never offered. (If a later run wants an explicit
// "Blackout + no admin mode required for the leaderboard" tell on lower
// tiers, that is a follow-up, not S3 scope.)
//
// Eligible -> two inputs (nickname text, country <select> from
// COUNTRY_ALLOWLIST) + hidden honeypot 'website' field (CSS-hidden, same
// convention as the suggestion box) + Submit button. On submit: POST
// { nickname, country, time_ms: Math.round(state.survivedSeconds * 1000), website },
// time_ms taken from state.survivedSeconds (components/Hud.tsx:48,
// engine/forest-engine.js:5911) -- the SAME field the existing telemetry
// call already sends as time_survived_ms (engine/forest-engine.js, the
// track({event:'win', time_survived_ms: Math.round(survivedSeconds*1000), ...})
// line right after pushState (engine/forest-engine.js:5949) -- do not invent a second timer.
// Client-side pattern check before POST is UX only (LUL-3288 B2 -- "client
// validation is UX only"); the server re-validates independently.
```

## Verification

- `node --test lib/game/leaderboard.test.ts` — every export in "S1" above: nickname
  pattern/denylist/leet-normalization, country allowlist, `time_ms` strict-integer rejection of
  `-1, 0, 1.5, "5", NaN, Infinity, 1e308` (LUL-3288 verification list, exact values named there).
- `node --test app/api/leaderboard/route.test.ts app/api/leaderboard/current/route.test.ts app/api/leaderboard/[id]/invalidate/route.test.ts`
  — mirrors `app/api/suggestions/route.test.ts`'s shape (web-standard `Request`/`Response`, no
  Next.js runtime mocking) PLUS the LUL-3288-specific cases: spoofed `X-Forwarded-For` does not
  reset cooldown; missing `LEADERBOARD_IP_HASH_SALT`/`LEADERBOARD_ADMIN_TOKEN` refuses rather than
  falling back insecure; a denylisted nickname (including leet-substituted) is rejected; admin
  invalidate without the token is 401 and changes nothing; a nickname containing `<script>` is
  regex-rejected before it ever reaches a render path; **concurrent submissions of two
  faster-than-current times leave exactly one correct winner** (spin up two overlapping `POST`
  calls against a real (or `pg-mem`/test) Postgres instance, assert `current_record` ends up
  pointing at the genuinely-fastest of the two, not whichever committed last) — this is the
  concurrency test the LUL-3264 execution review named explicitly as commonly skipped.
- `npx tsc --noEmit` — no new `any`, `LeaderboardState` discriminated union exhaustively handled.
- `npm run lint` — clean.
- **Not run by this PR, run by whoever executes S0 (LUL-3289):** the production write-then-read-back
  proof against the real database. This spec's own unit/integration tests use a local/test Postgres
  or `pg-mem`, which per the ratified sequencing is explicitly NOT a substitute for that proof.

## e2e

**Specs.**
- `e2e/leaderboard-menu.spec.ts` — new. "shows loading then empty state on first ever visit"
  (stub `GET /api/leaderboard/current` to return `null` after a delay, assert `#leaderboardLine`
  text transitions loading -> empty without reload) and "shows a cached record on a stubbed 500"
  (seed `localStorage[lullwood:leaderboard:current]`, stub a 500, assert `#leaderboardLine` still
  shows the cached record) and "hides the line on failure with no cache" (empty localStorage +
  stubbed 500 -> `#leaderboardLine` absent from the DOM).
- `e2e/leaderboard-submit.spec.ts` — new. "submit form appears on a blackout win, not on lantern" —
  boot with `qaHooks:true`, switch to Blackout via the real Settings radio + `qaRegenerateMap`
  (exact sequence already proven in `e2e/minimap-setting.spec.ts:39-53`), drive a real win via
  `qaTeleportNearBaby` + `KeyE` + walk home (same convention as `e2e/progression.spec.ts:14-16`),
  assert the submit form is present; repeat on the lantern-default tier (no switch) and assert it
  is absent. "admin mode suppresses the form even on blackout" — seed
  `localStorage['lullwood:settings']` with `{ adminMode: true }` before boot, same blackout win,
  assert form absent (mirrors `e2e/minimap-setting.spec.ts:24-29`'s settings-seeding pattern).
  "submitting posts the real survived time" — stub the `POST`, capture the body, assert
  `time_ms === Math.round(recap's survivedSeconds * 1000)` read via the existing
  `window.ForestEngine.qaProbeElapsedTime` hook (`engine/forest-engine.js:4093`) or the HUD state
  directly if exposed to the test harness already.

**World.** micro (`qaBuildScene` default per founder rule LUL-2377) — no new trees/props/predators
needed, this is a HUD/menu/win-screen feature, not a stealth mechanic; the existing
`qaTeleportNearBaby`/home-walk win path already works against the micro world (every cited existing
spec above already runs on it).

**Hooks.** No new engine hooks needed. Every hook this spec's e2e cites already exists:
`qaTeleportNearBaby` (`engine/forest-engine.js:4004`), `qaRegenerateMap`
(`engine/forest-engine.js:4034`), `qaProbeElapsedTime` (`engine/forest-engine.js:4093`).

**Tester scenario.** File `shared/local-qa/requests/lul-3264-leaderboard-wave1.md` alongside this
spec's PR — nightly coverage of the loading/empty/populated/failed menu states and the blackout-only
submit-form gating on both desktop and a mobile landscape viewport (PART 7 acceptance's four-viewport
requirement is broader than the nightly tester's usual two; the extra iPhone-SE/Pixel-5-portrait
coverage stays e2e-only, named in "Not covered" below).

**Not covered.** Sky balloons and tree tinting (S4/S5, Game Engineer, separate spec, not this wave).
The 20-character-nickname-does-not-overflow-on-iphone-se-landscape acceptance line (PART 7) — real
device/viewport visual check, flag for local-qa request file, not an e2e pixel-diff. Country flag
rendering fidelity (emoji vs. SVG) — implementer's call, not specified here since it does not affect
gameplay or the data model either way.

## Cues

**Visual.** `#leaderboardLine` text change on the `#gate` screen (`components/Hud.tsx:881-896`
region) — a text-content swap, not an animation; the submit form appearing on `#winScreen` is the
existing win-screen reveal, no new visual treatment.
**Audio.** None new — this is menu/HUD text and a form, not a gameplay event; no existing cue-triple
precedent (cave immunity, veil charge) applies to informational text.
**Explanation.** The copy itself IS the explanation (`"{nick} is the top rescuer at {mm:ss} — can
you beat it?"` / `"No rescuer yet — be the first."`) — no separate caption needed, this is not
gated by `captionsOn` since it carries no audio cue to caption.
**Reduced motion.** Static text and a static form — nothing here was ever animated, so nothing
degrades.

## Constraints

- No `engine/**` edit (see "Why no engine change" above) — if implementation finds this untrue,
  stop and re-route to Tier C / Code Reviewer gate before proceeding, do not silently absorb an
  engine change into a Tier B PR.
- `time_ms` is always server-recomputed as `Math.round(x)` of whatever the client sent as a
  validated integer — never trust, never reformat client-supplied strings into the stored value.
- Every SQL statement is parameterized (LUL-3288 B3) — no template-literal string building of a
  query, including `LIMIT`/`OFFSET`/`id` in the pagination and invalidate routes.
- `@vercel/postgres`'s `sql` tagged-template client already parameterizes automatically when used
  as `` sql`... WHERE id = ${id}` `` — do not hand-build a query string and pass it to `.query()`.

## Out of scope

- S4 (sky balloons) and S5 (flag-tinted trees) — Game Engineer, own spec, blocked on this wave's
  API shape per the ratified sequencing, not touched here.
- S6 (moderation ops: founder alert on new record, denylist maintenance beyond the seed list above,
  retention policy) — separate ticket, admin-invalidate itself (the mandatory-day-one piece) ships
  in S1 above; the *alert mechanism* does not.
- Denylist content beyond the small seed list — founder call per
  `decisions/lul-3264-leaderboard-accepted-2026-09-18`, not an engineering decision.
- Actually provisioning the Postgres database and proving the prod write/read-back — LUL-3289
  (CTO), blocked on LUL-3310 (founder). This spec's S0 section is schema *design* only.
