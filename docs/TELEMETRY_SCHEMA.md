# Telemetry schema reference

LUL-2998. The schema itself is locked on the wiki (`game/m4-analytics-plan`) --
this file exists so a reader can find the current shape and its consumers
without re-deriving them from `lib/analytics.ts`, `app/api/telemetry/route.ts`,
`lib/dashboard/events.ts` and `lib/dashboard/aggregate.ts` by hand. When the
wiki page and this file disagree, the wiki page is authoritative (it is the
"update this page first" gate every schema PR follows); fix this file to match
it, not the other way round.

## End-to-end path

```
lib/analytics.ts (track(), AnalyticsEventInput)
  -> lib/telemetry-transport.ts (sendBeacon/fetch, no schema knowledge)
  -> POST /api/telemetry (app/api/telemetry/route.ts: envelope validation, rate limit, Blob write)
  -> Vercel Blob, events/{yyyy}/{mm}/{dd}/{uuid}.json
  -> lib/dashboard/events.ts (parseRawEvent(): re-validates the envelope on read-back)
  -> lib/dashboard/aggregate.ts (pure functions over RawEvent[] -> dashboard views)
  -> scripts/win-rate-by-tier.mjs and friends (CLI consumers)
```

`app/api/telemetry/route.ts` validates only the envelope (`event` against a
name allowlist, `ts`/`anon_id`/`build_sha`/`path` types) and rate limit -- it
does not validate per-event fields, so it never needs a change when a field is
added to an existing event, only when a new event *name* is added (`VALID_EVENTS`).
`lib/dashboard/events.ts` has the same split: `parseRawEvent()` re-checks the
envelope and the event name against `KNOWN_EVENTS`, then returns the object
as-is (`RawEvent` has a `[key: string]: unknown` index signature). Both files'
event-name lists must independently list every event `lib/analytics.ts` can
emit or that event is silently dropped end-to-end -- this happened twice
before (LUL-2239, LUL-2392) which is why `lib/dashboard/events.test.ts` locks
the two lists together with a test, not just a comment.

## Envelope (every event)

| field | type | source |
|---|---|---|
| `event` | string enum | `AnalyticsEventInput['event']` |
| `ts` | number | client `Date.now()`, ms epoch |
| `anon_id` | string (UUID v4) | `localStorage`, first-party, browser-profile not person |
| `build_sha` | string | `NEXT_PUBLIC_BUILD_SHA` at build time |
| `path` | string | `window.location.pathname` |

## Events and fields

Ten events total as of LUL-2998 (`lib/analytics.ts`'s `AnalyticsEventInput` union
is the source of truth for the exact shape -- this table is a summary, not a copy).

| event | fields | fed into |
|---|---|---|
| `page_view` | (none) | `computeFunnel` |
| `cta_start_clicked` | (none) | `computeFunnel` |
| `game_start` | `seed` | `computeFunnel` |
| `win` | `time_survived_ms`, `seed`, `payout`, `balance`, `difficulty`, `purchases_made?` (LUL-2998) | `computeFunnel`, `computeOutcomes`, `computeOutcomesByTier`, `computeEconomy` |
| `loss` | `predator_kind`, `time_survived_ms`, `seed`, `payout`, `balance`, `difficulty`, `distance_from_home_m`, `purchases_made?` (LUL-2998) | `computeOutcomes`, `computeOutcomesByTier`, `computeEconomy` |
| `session_length` | `duration_ms`, `reached_gameplay`, `session_id` | `computeSessions` |
| `feature_engagement` | `feature`, `action` | `computeFeatureEngagement` |
| `engine_contract_violation` | `missing_keys` | none (infra tripwire, not a gameplay metric) |
| `chase_gap` | `duration_ms`, `difficulty` | `computeChaseGapByTier` |
| `started_tiers` (LUL-2998) | `tiers: Record<string, number>` | none yet -- see "Known gaps" |

## Metric verification table (from LUL-2994, re-stated here so it lives with the schema)

| # | Metric | Ready? | Field(s) | Aggregate function |
|---|---|---|---|---|
| 1 | Win rate per difficulty tier | Yes | `win/loss.difficulty` | `computeOutcomesByTier` (`lib/dashboard/aggregate.ts:169`) |
| 2 | Median run length (win vs loss) | Yes | `win/loss.time_survived_ms` | `computeOutcomesByTier` (`runLengthMs`) |
| 3 | Median distance-from-home at death | Yes | `loss.distance_from_home_m` | `computeOutcomesByTier` (`distanceFromHomeAtDeathM`) |
| 4 | Build attribution | Yes | envelope `build_sha` | filter before calling any aggregate function |
| 5 | Store-expansion purchases (LUL-2308) | **Fields emit as of LUL-3003; no aggregate function reads them yet** | `win/loss.purchases_made`, `started_tiers.tiers` | none written yet, see below |

## `purchases_made` (LUL-2998)

`Array<{ id: string; tier: number; cost: number }>`, optional, carried on `win`
and `loss`. `id` is a `lib/game/economy.ts` `SHOP_CATALOG` id (`'deeperLungs'
| 'quietStep' | 'pocketStones'`), `tier` is the tier reached by that purchase
(matches `EmbersState.tiers`), `cost` is the Embers price paid
(`economy.ts`'s `nextCost()` at purchase time). Meant to record every shop
purchase made *during that specific run*.

## `started_tiers` (LUL-2998)

New event. `tiers: Record<string, number>` is a snapshot of the player's
permanent-upgrade tier state (`lib/game/economy.ts`'s `EmbersState.tiers`,
keyed by `SHOP_CATALOG` id) at game boot, **before** any purchase made during
that run applies. Purpose: reconstruct a run's purchases from a
before(`started_tiers`)/after(next run's `started_tiers`, or the owned tiers
implied by later purchases) diff even where per-run `purchases_made` tracking
has a gap -- this was the Economist's explicit rationale for asking for it as
a second, independent signal rather than relying on `purchases_made` alone.

## Known gaps

- **Both fields are now populated (LUL-3003).** `engine/forest-engine.js`'s `enter()`
  emits `started_tiers` with a snapshot of `embers.tiers` taken before that run's own
  purchases apply, and `purchase(id)` accumulates `{id, tier, cost}` onto a per-run
  array (reset in `enter()`) that the `win`/`loss` `track()` calls attach as
  `purchases_made`. One caveat: `EmbersShop` (`components/Hud.tsx`) only renders
  pre-entry (the gate) or on the win/death screens, never while a run is actually in
  progress, so every purchase lands either before the accumulator resets or after that
  run's own outcome event already fired -- `purchases_made` is therefore legitimately
  `[]` on every event today. That is not a bug: it is exactly the gap `started_tiers`'s
  before/after tiers diff across consecutive runs exists to cover (see above). See
  `docs/ELEMENTS.md`'s Embers/shop section and `e2e/purchases-telemetry.spec.ts`.
- **`computeOutcomesByTier`/`computeEconomy` do not consume either field yet.**
  Per the ticket's explicit instruction ("Do NOT compute any player-derived
  statistic — the store is empty"), no aggregate function was added or changed
  to read `purchases_made`/`started_tiers`. `lib/dashboard/aggregate.test.ts`
  only asserts that their presence/absence does not break the *existing*
  aggregate functions (extra unknown keys on `RawEvent` are inert everywhere
  except the field readers that explicitly look for them).
- **`computeEconomy`'s existing purchase signal is a heuristic, not a fact.**
  `computeEconomy` (`lib/dashboard/aggregate.ts:382`) already infers "probably
  purchased" from a balance decrease within 3 runs of crossing 120 Embers
  (`purchase.purchasedWithin3RunsPct`) -- it cannot say *what* was bought, only
  that the balance went down. Once `purchases_made` is actually emitted, that
  heuristic becomes replaceable with an exact count; this ticket does not
  replace it, so both will coexist until a follow-up does.

## How to maintain this file

Every future schema change already has a required step: add a dated section
to the wiki page `game/m4-analytics-plan` (`lib/analytics.ts`'s own header
comment enforces this -- "do not add/rename events without updating that page
first"). Add the same change here too, in the same PR:

1. Add/change the field or event in the table(s) above.
2. If it's a new event, confirm it's listed in `VALID_EVENTS`
   (`app/api/telemetry/route.ts`) and `KNOWN_EVENTS` (`lib/dashboard/events.ts`)
   -- `lib/dashboard/events.test.ts`'s lock test will fail the build otherwise.
3. Note in "Known gaps" whether the emitter (`engine/forest-engine.js` or a
   component) actually populates it yet, or whether it's schema-only like this
   ticket -- a reader should never have to grep the engine to find out.
