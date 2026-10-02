# SPEC: LUL-3264 wave 2 — sky balloons (S4) + flag-tinted trees (S5)

**Ticket:** LUL-3264 (S4, S5 child tickets) · **Tier:** C — both pieces touch `engine/**`
(`forest-engine.js`) directly: S4 adds sky objects next to the existing moon/stars/sky-compass
group, S5 adds per-instance tree colour logic inside `ensureChunk()`. `REVIEW: APPROVED` required
before merge, same as wave 1 (`lul-3264-leaderboard-wave1.md`).

**Written against:** `release/next` @ `9962026` (2026-10-02). Re-derive every `file:line` below
if the branch has moved — this spec is written right after wave 1 (PR#999) merged, so it should
still be close.

**Depends on:** wave 1's API shape (now merged, not a blocker): `GET /api/leaderboard/current`
(`app/api/leaderboard/current/route.ts`) returns `{ record: LeaderboardRecord | null }` or
`{ unavailable: true }`; `LeaderboardRecord` is `{ nickname, country, timeMs, achievedAt }`
(`lib/game/leaderboard.ts`, `parseRecord`). `components/Leaderboard.tsx:43`
(`useLeaderboardRecord()`) already implements the 4-state fetch/cache machine S3 required — reuse
it, do not re-implement fetch/cache logic here.

**New dependency landed with this spec:** `lib/game/country-palettes.ts` —
`COUNTRY_PALETTES: Record<string, readonly string[]>`, one 2-3 hex-colour array per code in
`COUNTRY_ALLOWLIST` (`lib/game/leaderboard.ts:30`, 30 codes — the PLAN's "~200 entries"
estimate predates S1 scoping the allowlist down to 30; this table already covers all of them).
Covered by `lib/game/country-palettes.test.ts` (asserts every allowlisted code has 2-3 `#RRGGBB`
colours, and that no extra codes exist).

## Files

- `components/GameLoader.tsx` — edited: lift `useLeaderboardRecord()` here (the one component
  that is a parent of both `Hud` and `GameCanvas`), pass the resolved record down as a prop.
- `components/GameCanvas.tsx` — edited: accept the record prop, call the new engine action on
  change.
- `components/Hud.tsx` — edited: `EngineActions` gains `setLeaderboardRecord`; `LeaderboardMenuLine`
  (`:974`) stops calling `useLeaderboardRecord()` itself and instead takes the record as a prop
  from the same lift, so there is exactly one fetch per page load, not two.
- `lib/engine-contract.ts` — edited: `ENGINE_ACTION_KEYS` gains `'setLeaderboardRecord'`
  (founder rule 2026-09-09, engine/React contract — skipping this fails `tsc`, not optional).
- `engine/forest-engine.js` — edited: new sky-balloon objects (S4), new per-chunk tree-tint
  consumer (S5), `setLeaderboardRecord` action, `?qaHooks=1` probes.
- `engine/forest-engine.d.ts` — edited: declare the new `qa*` hooks.
- `docs/ELEMENTS.md` — edited: new entries for the balloon sprites and the tree-tint source,
  same PR (founder rule, "Update docs/ELEMENTS.md in the same PR").

## The change

### Shared: getting the record from React into the engine

`useLeaderboardRecord()` (`components/Leaderboard.tsx:43`) already resolves to one of
`{status:'loading'}` / `{status:'populated', record}` / `{status:'empty'}` /
`{status:'failed', cached}`. Collapse that to what the engine needs — "what record should the
sky/trees show right now, or null for show-nothing":

```ts
// components/GameLoader.tsx, inside GameLoader(), before `return <GameCanvas ... />`
const leaderboardState = useLeaderboardRecord();
const leaderboardRecord =
  leaderboardState.status === 'populated' ? leaderboardState.record
  : leaderboardState.status === 'failed' ? leaderboardState.cached
  : null; // loading or empty -- S4's sky text for those states is driven by the state, not a record
```

Pass both `leaderboardState.status` and `leaderboardRecord` down: `<GameCanvas leaderboardStatus={leaderboardState.status} leaderboardRecord={leaderboardRecord} />`.
`GameCanvas` (`components/GameCanvas.tsx:1022`, currently takes no props) gains these two props and,
in the `useEffect` that already watches `actions` for other post-init wiring, calls
`actions?.setLeaderboardRecord?.(leaderboardStatus, leaderboardRecord)` whenever either changes.

`Hud.tsx:974`'s `<LeaderboardMenuLine />` becomes `<LeaderboardMenuLine status={...} record={...} />`,
reading the same two values instead of calling the hook a second time (today it calls
`useLeaderboardRecord()` itself inside `LeaderboardMenuLine` — two independent fetches per load once
GameCanvas also needs it, which is the thing this lift avoids).

Engine side, `init()`'s return object (`forest-engine.js:8997`) gains `setLeaderboardRecord`,
added to `ENGINE_ACTION_KEYS` (`lib/engine-contract.ts:14`) and `EngineActions`
(`components/Hud.tsx`, wherever the other `setXxx` actions are typed) in the same PR — all three
or `tsc` fails per the engine/React contract rule. The action stores `{status, record}` in a
module-level variable the per-frame tick (where moonGroup/stars already update,
`forest-engine.js:8846`) and `ensureChunk()` (`:1004`) both read; it does not immediately touch
any THREE objects itself (frames may not be rendering between calls), it just records state and
sets a dirty flag the next tick/chunk-build reads.

### S4 — sky balloons

**Precedent to copy:** the Sky Compass glyphs (`forest-engine.js:446-491`, LUL-5486) are the
closest existing thing to "balloon letterforms in the sky" — canvas-drawn glyph →
`THREE.CanvasTexture` → `THREE.Sprite`, `fog:false`/`depthWrite:false` so they read through fog
and never occlude/get occluded, swap the *texture* on state change rather than recreating the
sprite (exactly PART 2.5's "fade in on first appearance; swap TEXT on state change, never
re-create the balloon objects" requirement). Re-use `drawSkyCompassGlyph`'s general approach
(2D canvas context, draw letterforms) but draw balloon shapes (inflated oval/letterform body +
a thin trail/string beneath, per PART 2.5) instead of compass glyphs.

**Positioning — "offset to the side, must not occlude the sun/moon":** `moonGroup`
(`forest-engine.js:462`, billboarded to the camera every frame at `:8846-8847`,
`moonGroup.position.copy(camera.position).addScaledVector(moonDir, 300)`) is the pattern for
"stays in the sky, follows the player." Balloons should use the same camera-relative billboard
technique but with their own direction vector rotated e.g. 35-45° away from `moonDir` around the
vertical axis, at the same radius (300), so they never share screen space with the sun/moon disc
regardless of time of day.

**Content per state** (PART 2.4 sky column, already decided, do not re-derive):
- loading → `"loading top rescuer"` (no flag)
- populated → `"{nickname} — {mm:ss}"` + flag (flag drawn from `COUNTRY_PALETTES[record.country]`
  — simplest correct rendering is 2-3 vertical/horizontal colour bars next to the text, "fidelity
  (emoji vs SVG) is implementer's call" per wave 1 spec's "Not covered" — this spec extends that
  same latitude to the sky balloon flag swatch)
- empty → `"be the first — --:--"` (no flag)
- failed, no cache → balloons hidden entirely (remove/hide the sprite group, don't leave a blank
  balloon floating)
- failed, with cache → render exactly as populated, using the cached record

**Shadow/trails/transparency (PART 2.5, mandatory):** a small soft shadow sprite (another
low-opacity dark circle sprite, same `CircleGeometry` + `MeshBasicMaterial({transparent:true})`
idiom as the moon's halo mesh, `:463-465`) positioned slightly below-and-behind each balloon
letterform; 2-4 thin `THREE.Line` or tapered-sprite trails hanging below each glyph. Semi-transparent
(`opacity` ~0.75-0.9) is explicitly permitted — use it so the balloons read as atmospheric, not
flat decals.

**Fade:** on first appearance (state transitions away from no-balloons-yet, i.e. load or
loading→anything), animate sprite material `opacity` from 0 to target over ~1-2s in the existing
per-frame tick, not a CSS/React transition (these are WebGL sprites). On subsequent state changes
(e.g. empty → populated when the first real record lands), swap the canvas texture in place —
no fade, no re-creation, per PART 2.5.

### S5 — flag-tinted trees

**Precedent:** `ensureChunk()` (`forest-engine.js:1004-1032`) already tints every tree instance
via `tintCol.setRGB(t.tint*0.92, t.tint, t.tint*0.86); trio[1].setColorAt(slot, tintCol); trio[2].setColorAt(slot, tintCol);`
(`:1027-1028`) where `t.tint` is a per-tree random rot/weathering factor (`0.72 + rng()*0.5`,
`:1298`) baked in at map generation, not touched by this feature. `trio[1]`/`trio[2]` are the two
foliage `InstancedMesh`es (`cone1Geo`/`cone2Geo`, `:1010-1011`) — `trio[0]` (trunk) is never tinted
today and this spec doesn't start tinting it (flag colours on tree trunks would look wrong;
canopy only).

**Coverage — "a SUBSET of trees, not all" (PART 2.6):** pick the subset deterministically from
data already on each tree, not a new random draw (`ensureChunk()`'s comment at `:1000-1002`
explicitly calls out "no rng() call here, so streaming a chunk in/out can never perturb the seeded
stream" — adding `rng()` here would break that invariant). Use `ti % N === 0` (every Nth tree by
its stable `treeData` index) for a small, fixed fraction — N=8 or so gives ~12% of trees, tune by
eye against "saturation low... a forest of bright national colours destroys the night-forest
look." This is the one judgment call left to the implementer per PART 2.6 "mapping... fine
positioning delegated to the implementer."

**Blend, not replace:** for a selected tree, blend `COUNTRY_PALETTES[country][i % palette.length]`
(parse hex to RGB, `i` = that tree's position among the selected subset, so multi-colour flags
spread across different trees rather than every tinted tree getting the same one colour) into the
existing `tintCol` at low weight (e.g. `tintCol.lerp(flagColor, 0.25)` after the existing
`setRGB` call, before `setColorAt`) — this keeps the weathering variation and keeps saturation low
by construction, satisfying PART 2.6's "saturation low" without a second desaturation step.

**Live update when the record changes without reload (PART 2.4's empty→populated transition,
and a new record overtaking an old one):** `ensureChunk()` only runs once per chunk and caches the
result in `treeChunkTrios` (`:1005`) — a later palette change needs an explicit re-tint pass, not
just waiting for the next chunk stream-in. Add a function that iterates every already-built
`treeChunkTrios[c]` entry, re-applies the tint subset loop against the current record's palette
(or the plain `tintCol` with no blend if the record is null/empty/failed-no-cache), and sets
`m.instanceColor.needsUpdate = true` — call it from `setLeaderboardRecord` whenever the *country*
actually changes (compare against the previously stored record, skip the full re-tint if only
`timeMs`/`achievedAt` changed and the country is the same).

**Empty/failed, no default:** PART 2.6 — "no tint, trees normal. Never pick a default country."
When `setLeaderboardRecord` is called with no usable record (loading, empty, or failed-no-cache),
the tint subset must resolve back to the plain `tintCol` (no blend), not skip the re-tint and
leave a stale country's colours showing.

## Verification

- `node --test lib/game/country-palettes.test.ts` — both tests pass (already landed, this spec's
  prerequisite, not new work).
- `npx tsc --noEmit` — `EngineActions`/`ENGINE_ACTION_KEYS` exhaustiveness check passes.
- `npm run lint` (`eslint`) — clean.
- `npm run build` (`next build`) — green, no new console.error from `assertEngineContract()`.
- Manual: `?qaHooks=1`, use the new probe hooks (below) to confirm sprite count/visibility and
  tinted-instance count match the current leaderboard state without a page reload, across a
  simulated empty → populated → different-country-populated sequence.

## e2e

**Specs.** `e2e/leaderboard-sky-and-trees.spec.ts` (new) —
- `'sky balloons show the loading/empty/populated/failed text and hide on failed-no-cache'` —
  stub `/api/leaderboard/current` with each of the four response shapes PART 2.4 defines, assert
  `qaProbeLeaderboardSky()`'s text/visibility per case.
- `'sky balloons never overlap the sun/moon disc'` — assert the balloon group's billboard angle
  offset from `moonDir` is never 0 (regression guard on the angle constant, not a pixel check).
- `'a subset of trees tint toward the record holder's flag palette, the rest stay untinted'` —
  `qaBuildScene` with a small number of trees, stub a populated record for a known country, assert
  `qaProbeTreeTint()` reports the expected tinted-instance ratio and that `instanceColor` values
  moved toward (not became) the flag colour.
- `'tree tint clears when the record goes back to empty/failed-no-cache'` — re-stub to empty mid-run,
  assert `qaProbeTreeTint()` returns to the untinted baseline without a reload.

**World.** micro (`qaBuildScene({ trees: 40, ... })` — plenty to assert a ~12% subset ratio
without `@fullmap`; no predator/cover needed, this is a visual-state feature, not stealth).

**Hooks.** New, both inside the `?qaHooks=1` block (`forest-engine.js:4630`), next to
`qaProbeTreeChunks` (`:4830`):
- `qaProbeLeaderboardSky(): {visible: boolean, text: string, hasFlag: boolean}` — reads the
  current balloon sprite group's texture-backing state (store the last-drawn text string
  alongside the sprite when drawing it, same as any other QA probe that can't read pixels back
  out of a canvas texture).
- `qaProbeTreeTint(): {totalTrees: number, tintedCount: number, sampleTintedColor: [number,number,number] | null}` —
  iterates live `treeChunkTrios`, counts instances whose `instanceColor` differs from the plain
  `tintCol` baseline for that tree's `t.tint`.

**Tester scenario.** `shared/local-qa/requests/lul-3264-leaderboard-wave2.md` (new, file with this
spec's PR) — desktop + one mobile-landscape viewport, confirms balloons are visible and readable
(not occluding HUD) and tree tint is visually present but subtle, on a real record.

**Not covered.** Exact balloon glyph artistry (letterform shape, trail curve) — visual-feel,
real-eyes call per PART 2.5 "fine positioning delegated to the implementer." Frame-time
measurement before/after (PART 7 acceptance line) — use the existing perf probe
(`qaProbeElapsedTime` precedent in wave 1's spec names a similar probe; find this wave's
equivalent perf hook) in the tester request file, not a new e2e assertion with a hard frame-time
budget (those are flaky under CI's variable hardware).

## Cues

**Visual.** Balloon sprite group (new, sky) — fade-in on first appearance, texture swap on
state change, per S4 above. Tree tint — no transition cue of its own; it rides the same frame
the sprite swap happens, since both are driven by one `setLeaderboardRecord` call.
**Audio.** None new — matches wave 1's reasoning (informational, not a gameplay event).
**Explanation.** The balloon text itself is the explanation, same as the menu line (wave 1 Cues
section) — no separate caption.
**Reduced motion.** The fade-in (0→target opacity over 1-2s) is the only new animation. Under
`reducedMotion`, skip the fade and set target opacity immediately — same degrade pattern as any
other fade-in in this codebase gated by `setReducedMotion`.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- No `rng()` calls inside `ensureChunk()`'s tint-subset selection — it must stay a pure function
  of `treeData[ti]`'s already-generated fields, never a fresh random draw (breaks the seeded
  stream invariant the surrounding code already protects, `:1000-1002`).
- Never recreate a balloon `THREE.Sprite`/texture on a state change that is only a text swap —
  `fade`/`swap TEXT... never re-create` is explicit in PART 2.5 and policed by the
  `qaProbeLeaderboardSky` hook's expectation that the sprite reference is stable across calls.
- Tree tint must blend into the existing `tintCol`, never replace it outright — losing the
  per-tree rot/weathering variation on tinted trees would look flatter than untinted ones next to
  them, the opposite of "subtle."
- `setLeaderboardRecord` is additive to `EngineActions`/`ENGINE_ACTION_KEYS`/`init()`'s return —
  all three in the same PR, per the 2026-09-09 engine/React contract rule, or this is the next
  LUL-1697.

## Out of scope

- S6 (moderation ops: founder alert on new record, denylist maintenance, retention policy) —
  separate ticket, no rendering, not touched here.
- Country flag rendering fidelity beyond "a few colour bars" (actual flag SVGs/emoji) — same
  "implementer's call, doesn't affect gameplay" latitude as wave 1's spec gave the menu/win-screen
  flag picker.
- Re-tuning the tint-subset fraction (N in `ti % N === 0`) beyond a first reasonable guess — a
  follow-up visual-polish ticket if the tester or founder calls it too strong/weak once live.
