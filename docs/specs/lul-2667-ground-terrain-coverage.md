# SPEC: LUL-2686 Scope ground/terrain e2e coverage (zero today)

**Ticket:** LUL-2686 (LUL-2667 child 3/6) · **Tier:** A — this spec's deliverable is the
audit disposition itself; it makes **no code change** (no new spec file, no new hook, no
`docs/ELEMENTS.md` edit).

**Written against:** `release/next` @ `4be9b68` (2026-09-16, after LUL-2685/PR #676).

## Files

None. This ticket's honest scope, per its own text ("the investigation itself is most of
the work, and the honest answer may be 'there is very little to assert'"), turns out to be
exactly that: there is no ground/terrain behaviour left uncovered once the region-boundary
systems people associate with "ground" are correctly attributed to their own, already-
covered elements. See "The change" below for the full investigation and disposition.

## The change

### Q1 — is there any behaviour beyond "a flat plane renders"?

No. `docs/ELEMENTS.md:764-786` ("Ground / terrain") is accurate and current, confirmed
line-by-line against the live engine:

- **The mesh.** One `THREE.Mesh(new THREE.PlaneGeometry(800, 800), new
  THREE.MeshStandardMaterial({ color: CONFIG.ground, roughness: 1, metalness: 0 }))`,
  `ground.rotation.x = -Math.PI/2`, added to the scene once
  (`engine/forest-engine.js:378-380`). `CONFIG.ground = 0x0c1117`
  (`engine/tuning.js:48`).
- **No re-reference after creation.** `grep -n '\bground\b' engine/forest-engine.js`
  returns the three creation lines (378-380) and nothing else — the local `ground`
  variable is never read again. Nothing raycasts against it, nothing queries its
  geometry, no other element derives a position or rotation from it.
- **The player's vertical position is not derived from it.** The camera's Y is
  `eyeH + bob + jumpY` (`engine/forest-engine.js:6217`, `:6249`), where `eyeH` eases
  toward the hardcoded `CONFIG.eye = 2.2` (or `1.05` while hidden,
  `engine/forest-engine.js:6022`) and `jumpY` comes from a scripted `jumpOffset()`
  curve (`:6028`) — neither reads `ground` or performs a raycast. "Standing on the
  ground" is Y-value coincidence between these hardcoded constants and the plane's
  Y=0, not a physical relationship, exactly as `docs/ELEMENTS.md` already states.
- **No texture variation or slope.** The material is a flat single color; the geometry
  is an unmodified, unsubdivided `PlaneGeometry` (no vertex displacement anywhere in
  the file).

Conclusion: there is no collision function, no per-frame logic, and no state to assert
beyond "the mesh is constructed with these literal arguments and added to the scene" —
which is not runtime *behaviour*, it's a one-time constructor call.

### Q1 (continued) — do any documented regions belong under ground/terrain instead of
their own element?

No. Checked every region-boundary predicate layered on top of the flat plane:

- **`inLake(x,z)`** (`engine/forest-engine.js:598`) — Lake is its own top-level
  `docs/ELEMENTS.md` section (`### Lake`, line 801) backed by its own module
  (`lib/game/lake.ts` + `lib/game/lake.test.ts`). Already indirectly exercised by
  `e2e/hints.spec.ts` (teleports to `CONFIG.lake.x/z`), `e2e/prop-density.spec.ts`
  (asserts zero reeds land in `CONFIG.lake.clear`), and
  `e2e/predator-spawn-clearance.spec.ts` (asserts the LUL-791
  `pushOutOfLakeClearance()` behaviour). Legitimately separate — has its own element
  entry, its own lib, its own coverage.
- **`inSpawn(x,z) = x*x+z*z<40`** (`engine/forest-engine.js:599`) — not a "ground"
  concept at all; it's documented under `### Home (the goal landmark)`
  (`docs/ELEMENTS.md:857-885`) as the shared coordinate `CONFIG.home` reuses "no new
  rng draw". `arriveHome()`'s win trigger has its own coverage
  (`e2e/win-persist.spec.ts`, `e2e/death-sequence.spec.ts`, `e2e/minimap.spec.ts`,
  `e2e/smoke.spec.ts`), and `e2e/positional-hiding.spec.ts:40` already documents
  landing "deep inside `inSpawn`" as a known test precondition. Legitimately
  attributed to Home, not Ground.
- **Bog zone** (`BOG_CENTER`/`BOG_INNER_RADIUS`/`BOG_OUTER_RADIUS`,
  `lib/game/bog.ts`) — its own top-level `## The Bog` section
  (`docs/ELEMENTS.md:2113`), its own extensive unit suite (`lib/game/bog.test.ts`),
  and its own e2e file (`e2e/bog-zone.spec.ts`), exactly as the ticket anticipated.
  The bog's visual patch is even documented in-code as a deliberate *addition on top
  of* the plain ground mesh, not a modification of it: "The single flat `ground`
  plane above gave the bog no visible boundary at all... Two concentric discs, same
  'flat mesh just above `ground`' approach" (`engine/forest-engine.js:1379-1381`).

Every region boundary is already correctly scoped to, and covered under, its own
element. None of them are mis-filed "ground/terrain" gaps.

### Q2/Q3 — is there a cheap smoke-level assertion worth adding?

Considered and rejected as redundant, not skipped. The only way "the plane exists, is
sized/positioned correctly, and nothing floats or clips through Y=0" could fail at
runtime is a JS exception during scene construction (e.g. malformed constructor args) —
and that failure mode is **already caught, on every single existing e2e spec, by the
`boot()`/`enter()` helpers and `expectNoConsoleErrors()`** (`e2e/helpers.ts:38-50`,
used throughout `e2e/smoke.spec.ts` and most other spec files): `init()` runs
synchronously top-to-bottom, so a throw at `engine/forest-engine.js:378-380` would
fail scene construction and fail `boot()` itself, not just this one hypothetical new
test. There is no `qaProbe*` hook that reads back the ground mesh's own transform (it's
a raw Three.js object, not game state — `qaProbePlayer()` returns only
`{x,z,yaw}`, no `y`), so a *new* assertion here would need a *new* hook whose only job
would be to duplicate a check ~100 existing green specs already make as a side effect
of booting at all. Per the ticket's own option 3, writing that hook and spec would be
inventing mechanics that do not exist, not closing a real gap.

### Disposition

**No new e2e spec file, no new hook.** Ground/terrain's only observable behaviour (a
static plane renders, colored, positioned, and rotated per fixed constants) is already
exhaustively and redundantly covered as an implicit precondition of every existing
spec's boot sequence — a defect in its construction breaks the whole suite, not just a
hypothetical dedicated test. Every "region on the ground" a reasonable person would
expect to test (lake, spawn/home, bog) is legitimately a separate, already-documented,
already-covered element. This spec, recording that reasoning, is the deliverable that
closes the LUL-2667 audit gap for this element — a future audit re-flagging
"ground/terrain: 0 e2e" should be pointed at this file rather than re-litigated from
scratch.

## Verification

- N/A — no code changes. `docs/ELEMENTS.md:764-786` was re-read line-by-line against
  `engine/forest-engine.js` and `engine/tuning.js` on `release/next @ 4be9b68` and found
  accurate; no citation drift, so `node scripts/check-elements-citations.mjs` is
  unaffected.

## e2e

**Specs.** None added. No behaviour exists to stage an opposing system against (there is
no collision, no state, no HUD surface — see "The change" above), so a new spec file
here would assert only "the game boots," which is already `e2e/smoke.spec.ts`'s job.

**World.** N/A.

**Hooks.** None added. `qaProbePlayer()` (existing, `engine/forest-engine.js:4089`)
already covers the only player-facing coordinate space; no hook exposes the raw
`ground` Three.js mesh because nothing in game logic ever needs to read it back.

**Tester scenario.** None filed. Not player-visible as a distinct feature — the ground
is inert set dressing whose only failure mode (a construction-time exception) already
fails the nightly's very first boot, before any scenario-specific check would run.

**Not covered.** Nothing deliberately deferred — this is a completeness disposition, not
a partial implementation.

## Cues

Not applicable — no new player-visible state, no new render/HUD/audio/caption. Section A
of `docs/FEATURE_CHECKLIST.md` does not apply; this ticket introduces no state.

## Constraints

- No engine, HUD, or lib changes. No `docs/ELEMENTS.md` edit (the existing "Ground /
  terrain" section was verified accurate, not changed).

## Out of scope

- Lake, Home/spawn-clearing, and Bog region coverage — legitimately separate elements,
  each already documented and covered under their own `docs/ELEMENTS.md` sections and
  e2e files (cited above). Not re-litigated here.
- The other LUL-2667 children (time-of-day, wayfinding, tree/rock/log `@fullmap`
  migration) — separate tickets, separate elements.
