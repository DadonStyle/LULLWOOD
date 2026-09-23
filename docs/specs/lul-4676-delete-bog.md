# SPEC: LUL-4676 delete the bog entirely

LUL-3256 stage 5 (wiki `decisions/lul-3256-water-removal-plan.md`, sec 1 + sec 7 in that
doc's own numbering). Founder directive: "does not need a sea, a pond, a lake, or a bog" —
delete the bog biome entirely, not reskin. Independent of the lake deletion (LUL-4675,
sibling ticket, not yet merged as of this SPEC) and the mission swap (LUL-4588) — no
ordering dependency, own PR.

All citations verified live against `release/next@9095ffc` (2026-09-23).

## Files

- `lib/game/bog.ts` — delete
- `lib/game/bog.test.ts` — delete (three tests ported to `mission.test.ts`, see §2/§4)
- `lib/game/mission.ts` — gains `Point`, `Landmark`, `BLACKOUT_MIN_RADIUS`,
  `clearOfLandmarks`, `pickHardBabyPosition` (simplified)
- `lib/game/mission.test.ts` — gains the three ported tests
- `engine/tuning.js` — remove `CONFIG.bogTrees`/`CONFIG.bogReeds`, the micro-preset zeroing
  of both, `WOLF_BOG_MASK_STRENGTH`, `PROP_CHUNK_CAP.bogTree`, comments
- `engine/forest-engine.js` — imports, `playerBogMask`/`bogTreeData`/`bogChunkMeshes`/
  `bogChunkBuckets`, `generateBogTrees()`/`ensureBogChunk()`/`dropBogChunk()`/
  `drawBogTreeVisuals()` (bog half), reed keep-clear ring restriction, `coverData`/
  `throwableData` bog-keep-clear filters, `checkScent()`'s wolf-nose reduction,
  predator wading speed factor, `qaProbeBog`, `qaProbeBaby`, player bogginess/mask calc,
  player speed/noise bog factors, splash/footstep switch, `HINT_PRIORITY`/`HINT_TEXT`/
  `hintCandidate()`'s `'bog'` entries
- `engine/forest-engine.d.ts` — `qaProbeBaby` signature + doc comment, `qaProbeBog` removal,
  scattered doc-comment mentions
- `components/GameCanvas.tsx` — CSS selector lists, comments
- `components/Hud.tsx` — comment
- `components/SettingsPanel.tsx` — comment
- `docs/ELEMENTS.md` — delete `## The Bog` appendix + the stale top-of-file scope note;
  edit 6 scattered cross-references
- `docs/CUES.md` — delete the Bog row + its "explanation MISSING" bullet
- `e2e/bog-zone.spec.ts`, `e2e/mobile/bog-zone.spec.ts` — delete
- `e2e/minimap.spec.ts`, `e2e/mobile/minimap.spec.ts` — comment/title rename only
- `e2e/minimap-setting.spec.ts` — comment update
- `e2e/prop-density.spec.ts`, `e2e/mobile/prop-density.spec.ts` — drop `bogTree` cap +
  assertion
- `e2e/mobile/hints.spec.ts` — comment update
- `e2e/wind-assisted-evasion.spec.ts` — drop `'bog'` from an array literal
- `lib/game/pack.test.ts`, `lib/game/predator.test.ts` — rename a test title + comment, no
  functional change
- `lib/e2e-policy/world-policy.test.ts` — drop the two now-deleted files from
  `FULLMAP_ALLOWLIST` (CI-enforced, see §11)
- `playwright.config.ts` — two comment mentions, no functional change

## Deviation from the PLAN

The CEO-approved plan (wiki `decisions/lul-3256-water-removal-plan.md`) and this ticket's
own description get four things wrong or leave them unresolved. None blocks landing; all
four are engineering-level calls within a Founding Engineer's discretion, not design
questions — documented here per the "declare deviations" rule rather than silently fixed.

1. **"`noise.ts`/`predator.ts` bogginess call sites" don't exist.** Both the ticket and the
   plan (§1: *"`noise.ts`/`predator.ts`/`pack.test.ts` references are the bog's bogginess
   field feeding into pack pathing"*) attribute real call sites to those two files. Grepped
   live: `lib/game/noise.ts:8,10` and `lib/game/predator.ts:367` are prose comments only —
   no `biomeAt(`/`bogSpeedMultiplier(`/`bogNoiseMultiplier(` call appears in either file.
   The actual pack-pathing call site (`speed *= bogSpeedMultiplier(biomeAt(p.x, p.z))`,
   applied once per predator per tick after every state branch) lives in
   `engine/forest-engine.js:3043`, inside `updatePredators()` — plan §1's underlying claim
   (bog is a real movement-cost mechanic, not decoration) is correct, just misfiled. See §3
   below for the full call-site list, all in `forest-engine.js`. `pack.test.ts`'s own
   reference (§4 point 3) is a stale comment, not an assertion on bog behavior — see the
   "no functional change" entries under §9.

2. **`drownedCar` is out of scope for this ticket.** Plan §1 calls `drownedCar` "the bog's
   landmark," but §7 (open items) assigns its survive-or-delete call to *"whichever engineer
   stages 2/3 lands with"* — the mission/lake stages, not this one. Confirmed geometrically
   live: `lib/game/bog.test.ts:77` already asserts `biomeAt(-95, 46) === 0 // drownedCar must
   no longer sit inside the bog patch` — `drownedCar` has sat outside `BOG_OUTER_RADIUS`
   since LUL-2225 and no bog-deletion edit in this SPEC touches it, `mission.ts`, or
   `tuning.js`'s `LANDMARKS` entry for it. (The already-merged lake SPEC, LUL-4675 §"Constraints",
   independently reached the same conclusion the other way — "do not touch `drownedCar`,
   it's the bog's landmark" — confirming both tickets agree to leave it alone, for
   consistent but differently-stated reasons.)

3. **`pickHardBabyPosition()` is not a bog mechanic — it is blackout-mode's hard-baby-spawn
   placement, which happens to depend on bog geometry for one of its two conditions.**
   Neither the ticket nor the plan mentions this coupling at all. `lib/game/bog.ts:160-201`
   (`pickHardBabyPosition`) draws a point that must be both (a) `>= BLACKOUT_MIN_RADIUS`
   from home and (b) on a route home that crosses the bog's core (`routeCrossesBog`) —
   condition (b) has no meaning once the bog's coordinate system is deleted; keeping
   `BOG_CENTER`/`BOG_INNER_RADIUS` alive as bare geometry with no rendered terrain and no
   gameplay effect just to satisfy a distance-and-angle constraint nobody can see or feel
   would be exactly the kind of dead code this ticket exists to remove. Resolution: move
   `Point`, `Landmark`, `BLACKOUT_MIN_RADIUS`, `clearOfLandmarks`, `pickHardBabyPosition` to
   `lib/game/mission.ts` (baby-spawn's actual domain — `applyHardBabySpawn()`,
   `forest-engine.js:1247`, already imports `LANDMARKS`/mission-adjacent concerns from
   there), dropping the `routeCrossesBog` clause and keeping the `BLACKOUT_MIN_RADIUS`
   distance floor and landmark clearance unchanged. This preserves blackout's one
   externally-visible guarantee (the child spawns far from home, `>= 192` units, same as
   today) and drops only the vestigial "via the bog" routing constraint, which had zero
   gameplay tell even before this ticket (nothing rendered "the route crosses the bog," it
   was a pure rng-acceptance test). `Point`/`Landmark` are locally-scoped duplicate
   interfaces already (`lib/game/chronicle.ts:40`, `lib/game/pack.ts:29` each define their
   own copy) — defining a third copy in `mission.ts` matches existing repo convention, not a
   new pattern. Full diff in §2.

4. **Deleting bog's map generation shifts the rng stream for the full (480u) map — verified
   harmless to every existing `@fullmap` test, but worth stating plainly since it is a real,
   non-obvious behavior change.** `generateBogTrees()`, the bog half of `generateReeds()`,
   and `pickHardBabyPosition()`'s draw (via `applyHardBabySpawn()`) all consume `rng()` and
   sit at the tail of `generateMap()` (`forest-engine.js:1301-1354`, comment: *"everything
   below is new and runs last"*), ahead of the mission-kind pick (*"draw this run's mission
   last, after every other rng() consumer above"*). Deleting bog's draws means every seed
   past this point in the sequence — mission target selection, blackout's hard-baby draw —
   produces a **different** (still valid, still deterministic) map than it did before, for
   the same seed, on the full map only. **This does not affect the micro world or CI**:
   `applyQaWorldMicroPreset()` (`engine/tuning.js:211-222`) already zeros
   `CONFIG.bogTrees`/`CONFIG.bogReeds` to 0 for the 96u micro map every e2e spec and the QA
   rig actually run, so `generateBogTrees()`'s and `generateReeds()`'s bog-ring loops already
   draw zero `rng()` calls today in every environment CI touches — nothing shifts there.
   `E2E_FULLMAP=1` is never set in `.github/workflows/*.yml` (grepped, zero hits) — the
   `@fullmap` suite (LUL-2377) only ever runs manually, locally. Read all nine
   `FULLMAP_ALLOWLIST` files' seed-dependent assertions: none hardcodes a golden
   rng-derived coordinate. `predator-determinism.spec.ts` and `map-seed.spec.ts` compare two
   independent live boots of the *same* seed to each other, not to a stored value;
   `mission-landmark-sync.spec.ts` forces `qaMissionKind: 'deepwater'` explicitly rather than
   relying on the natural rng-drawn pick; `lul211-founder-report.spec.ts` and
   `tree-pathing.spec.ts` discover their target prop/obstacle live via a probe, not a fixed
   coordinate. No test is expected to need a values update. **Still run
   `E2E_FULLMAP=1 npx playwright test` locally as part of this PR's verification** (§10) —
   if any of the above is wrong, that run is where it will show up, not CI.

## The change

### 1. `lib/game/bog.ts` — delete entirely

Every export (`Point`, `Landmark`, `BOG_CENTER`, `BOG_INNER_RADIUS`, `BOG_OUTER_RADIUS`,
`biomeAt`, `bogKeepClear`, `routeCrossesBog`, `BOG_MASK_DECAY_TIME`, `bogMaskLevel`,
`BLACKOUT_MIN_RADIUS`, `BOG_SPEED_MULTIPLIER`, `BOG_NOISE_MULTIPLIER`,
`bogSpeedMultiplier`, `bogNoiseMultiplier`, `clearOfLandmarks`, `pickHardBabyPosition`) is
either deleted outright or moved per §2 below. Nothing outside this file and
`bog.test.ts`/`bog-zone.spec.ts`/`forest-engine.js`/`forest-engine.d.ts` imports from it
(verified: `grep -rn "from '@/lib/game/bog'\|game/bog'" .` → only those).

### 2. `lib/game/mission.ts` — add the relocated hard-baby-spawn helpers

Append near the top (after existing imports, before `MISSION_POOL`), byte-identical except
for the dropped `routeCrossesBog` clause (§ Deviation 3):

```ts
export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

// Floor for blackout-difficulty's hard baby-spawn draw below -- lantern's spawn annulus
// tops out at half*0.8=192u at half=240, so this never spawns closer than lantern's
// hardest draw. Moved from lib/game/bog.ts (LUL-4676): this was never a bog mechanic,
// only coupled to bog geometry via a route-crosses-the-patch condition that had no
// meaning once the patch stopped existing -- see docs/specs/lul-4676-delete-bog.md.
export const BLACKOUT_MIN_RADIUS = 192;

export function clearOfLandmarks(x: number, z: number, landmarks: readonly Landmark[], pad: number): boolean {
  return landmarks.every((l) => Math.hypot(x - l.x, z - l.z) >= l.clear + pad);
}

/**
 * Draws a point from `rng` at least BLACKOUT_MIN_RADIUS from home, at least `margin` units
 * in from the map edge on both axes, clear of every landmark by `pad`. Bounded by
 * `maxTries` so a landmark layout that happens to leave no candidate can't spin forever --
 * returns its last candidate rather than looping.
 */
export function pickHardBabyPosition(
  rng: () => number,
  half: number,
  landmarks: readonly Landmark[],
  pad = 6,
  margin = 20,
  maxTries = 200,
): Point {
  const lo = -Math.max(0, half - margin);
  const hi = Math.max(0, half - margin);
  let x = 0;
  let z = 0;
  for (let i = 0; i < maxTries; i++) {
    x = lo + rng() * (hi - lo);
    z = lo + rng() * (hi - lo);
    if (Math.hypot(x, z) >= BLACKOUT_MIN_RADIUS && clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}
```

### 3. `engine/forest-engine.js` — imports and module-level state

- `:89-99` — the `from '@/lib/game/bog'` import block: drop `bogSpeedMultiplier`,
  `bogNoiseMultiplier`, `bogMaskLevel`, `bogKeepClear`, `routeCrossesBog`, `BOG_CENTER`,
  `BOG_INNER_RADIUS`, `BOG_OUTER_RADIUS`. Add `pickHardBabyPosition` to the existing
  `from '@/lib/game/mission'`-style import (currently imported from `bog` at `:92`).
- `:207` — drop `WOLF_BOG_MASK_STRENGTH` from the `tuning.js` import list.
- `:247-248, :275, :290` — comments mentioning `CONFIG.bogTrees`/`CONFIG.bogReeds`/
  `inBog()`/bog map markers: drop the bog-specific clauses.
- `:445` — drop `playerBogMask = 0` from the `let` group.
- `:529-560` (the "Bog tree cover" / reed-comment block) — delete the `// ---- Bog tree
  cover (LUL-25) ----` header comment and its body; delete the reed geometry's bog-specific
  framing comment (`:555-559`) but **keep `reedGeo`/`reedMat`/`COVER_GEO_MAT.reed`** — reeds
  are `coverData` LOS-blocking props tracked separately from bog trees; nothing in this
  ticket's scope (bog.ts, `CONFIG.bogTrees`/`bogReeds`, movement-cost call sites) touches
  the reed *prop kind* itself, only its old placement restriction to the bog's outer ring
  (§ this section, `generateReeds()`). Confirm before deleting: `grep -n "'reed'"
  lib/game/cover.ts engine/forest-engine.js` — reeds remain a real LOS-blocking prop kind
  used regardless of biome.
- `:606` — drop the `bogTreeData` comment annotation on the `let treeData = []` group;
  delete `let bogTreeData = [];` itself.
- `:655` — `buildGrid()`: drop `addAllToGrid(bogTreeData);`.
- `:758-763` — `generateCover()`'s bog-keep-clear filter comment + `coverData = coverData
  .filter(c => c.kind === 'tree' || !bogKeepClear(c.x, c.z, 0));`: delete the filter line
  and its comment (no replacement — the filter's whole purpose was excluding bog-adjacent
  spawns).
- `:783-788` — same pattern for `throwableData`: delete the `bogKeepClear` filter + comment.
- `:822-838, :839-844` (`drawBogTreeVisuals()`) — delete the function and its header
  comment.
- `:878-879` — delete `bogChunkMeshes`/`bogChunkBuckets` array declarations (keep
  `treeChunkTrios`/`treeChunkBuckets`/`coverChunkMeshes`/`coverChunkBuckets`/`liveChunks`
  untouched — those are the forest-tree/cover streaming state, unrelated to bog).
- `:977` (`updateStreamedChunks()`) — drop `ensureBogChunk(c)` from the "wanted" load loop
  and `dropBogChunk(c)` from the unload loop; leave `ensureChunk`/`ensureCoverChunk` and
  `dropChunk`/`dropCoverChunk` untouched.
- `:1079-1112` (`ensureBogChunk()`/`dropBogChunk()`) — delete both functions.
- `:1114-1137` (`generateBogTrees()` + its header comment) — delete the function and the
  ordering-rationale comment above it (the comment's *content*, not the ordering guarantee
  it documents for `generateReeds()`/`applyHardBabySpawn()` below — rewrite that comment to
  describe only what's left: `generateReeds()` and `applyHardBabySpawn()` still run at the
  tail, after every other rng() consumer).
- `:1177-1200`-ish (`generateReeds()`) — this function places reeds generically
  (`coverData` push, `'reed'` kind) but restricts placement to the ring between
  `BOG_INNER_RADIUS` and `BOG_OUTER_RADIUS` (per `docs/ELEMENTS.md`'s own description,
  §"New elements it adds"). Read the live function body before editing: remove the
  bog-ring gating condition so reeds either (a) place across the whole map using
  `CONFIG.bogReeds`'s old budget re-homed as a plain reed count, or (b) are deleted
  entirely if the reed *prop kind* was purely a bog-boundary decoration with no other
  purpose. Decide from the live read, not from this SPEC's summary — this is the one
  function in this ticket whose exact resulting shape (keep reeds map-wide vs. delete them)
  isn't fully determined by the citations gathered for this SPEC. Default to **delete
  entirely** unless the live body shows reeds serving a purpose independent of the bog ring
  (e.g., already also placed elsewhere) — matching "delete entirely, not reskin." If deleted,
  also delete `reedGeo`/`reedMat`/`COVER_GEO_MAT.reed`, `THROWABLE`-adjacent reed constants,
  and every `kind === 'reed'`/`'reed'` string branch in `lib/game/cover.ts` and
  `engine/tuning.js` (`PROP_CHUNK_CAP.reed`, `BOG_REEDS`/`CONFIG.bogReeds`) — re-grep
  `'reed'` across the repo once this function's fate is decided, since the count above
  (§ Files) assumed reeds survive as a bog-only concept and may need revising either way.
- `:1128` — `if(biomeAt(x, z) <= 0) continue;` inside the reed loop: removed alongside
  §this-section's `generateReeds()` edit, whichever direction it goes.
- `:1157` — comment referencing the old `biomeAt(x,z) <= 0` reject: delete alongside the
  same edit.
- `:1247-1249` (`applyHardBabySpawn()`) — `pickHardBabyPosition(rng, half, LANDMARKS)` call
  unchanged in shape; only its import source moves (§ this section, imports) and its
  own body simplifies per §2.
- `:2360` (`checkScent()`) — `const nose = p.kind === 'wolf' ? p.spec.nose * (1 -
  WOLF_BOG_MASK_STRENGTH * playerBogMask) : p.spec.nose;` → `const nose = p.spec.nose;`
  (wolves lose their bog-mask nose reduction entirely — there is no mask without the bog).
  Delete the two comment lines above it (`:2358-2359`) describing the wolf-only reduction.
- `:3043` (`updatePredators()`, pack pathing) — delete `speed *= bogSpeedMultiplier(biomeAt(p.x,
  p.z));` and its three-line rationale comment above it (`:2655-2658`-equivalent local
  comment at this call site). Predators no longer pay a wading cost anywhere (the lake's
  own `pLakeMul` factor, sibling ticket, is untouched by this edit).
- `:4062-4069` (`qaProbeBog`) — delete the whole `window.ForestEngine.qaProbeBog = ...`
  block and its header comment.
- `:4035-4036` (`qaProbeBaby`) — `return { x: baby.x, z: baby.z, distHome: Math.hypot(baby.x,
  baby.z), routeCrossesBog: routeCrossesBog(0, 0, baby.x, baby.z) };` → drop the
  `routeCrossesBog` field entirely: `return { x: baby.x, z: baby.z, distHome:
  Math.hypot(baby.x, baby.z) };`.
- `:6163` — drop `playerBogMask = 0;` from the reset group (`staminaCharge = 1;
  staminaLowCuePlayed = false; playerBogMask = 0;` → drop the third clause).
- `:6570-6571` — delete `const playerBogginess = biomeAt(player.x, player.z); ...` and
  `playerBogMask = bogMaskLevel(playerBogginess, playerBogMask, dt);` and their comments.
- `:6586` — `const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) *
  bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);` → drop the
  `* bogSpeedMultiplier(playerBogginess)` factor (leave the lake factor untouched, sibling
  ticket's concern).
- `:6628` — `noiseRadius = (...) * bogNoiseMultiplier(playerBogginess);` → drop the
  `* bogNoiseMultiplier(playerBogginess)` factor entirely (leaves the base
  `NOISE_RADIUS_*` value with no multiplier at this call site, matching the lake pattern
  where no such factor exists for lake at all).
- `:7036` — `if(playerBogginess > 0) splash(0.3); else footstep(0.12);` → `footstep(0.12);`
  unconditionally (drop the `splash()` branch and its comment; `splash()` itself stays
  defined/used elsewhere for lake wading — sibling ticket's concern, don't delete the
  function).
- `:2245-2246` (`HINT_PRIORITY`) — drop `'bog'` from the array.
- `:2259` (`HINT_TEXT.bog`) — delete the `bog: '...'` entry.
- `:7144` (`hintCandidate()`) — delete `case 'bog': return [playerBogginess > 0.05, null];`.
- `:2255-2256` comment ("Self/panel-anchored keys (lake/bog/deepwater/...)") — drop `bog/`
  from the list.

### 4. `lib/game/bog.test.ts` → delete; port 3 tests to `lib/game/mission.test.ts`

Add the `seeded()` mulberry32 helper (`bog.test.ts:21-28`, byte-identical) to
`mission.test.ts` (it has no equivalent today — `fixedRng()` there only returns a
constant, insufficient for a multi-draw sequence), then port, adjusted:

```ts
test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), 240, []);
  const b = pickHardBabyPosition(seeded(42), 240, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition never lands closer than BLACKOUT_MIN_RADIUS', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const p = pickHardBabyPosition(seeded(seed), 240, []);
    assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, `seed ${seed}: (${p.x},${p.z}) is inside the floor`);
  }
});

test('pickHardBabyPosition avoids a landmark covering its whole reachable area, still terminates', () => {
  const landmarks: Landmark[] = [{ x: 22, z: 4, clear: 300 }];
  const p = pickHardBabyPosition(seeded(7), 120, landmarks, 6, 20, 5);
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});
```

Drop (not ported — asserted `routeCrossesBog`, which no longer exists): "lands beyond the
bog, clear of the map edge", "satisfies its full predicate with no fallback over >= 200
seeds", "the bog geometry reaches far enough from home". Drop entirely (tested
`bog.ts`-local functions with no surviving equivalent): the `biomeAt`/`bogKeepClear`
geometry tests, the `bogMaskLevel` tests, the "bog speed multiplier composes... exactly
once" regression test (`updatePredators()`'s bog factor is deleted in §3, not
double-applied — nothing left to regress-test).

### 5. `engine/forest-engine.d.ts`

- `:45-59` (`qaProbeBaby` doc comment + signature) — drop the "beyond the bog"/"whether the
  direct route home crosses the bog's full-bogginess core" language; signature becomes
  `qaProbeBaby?: () => { x: number; z: number; distHome: number };`.
- `:585-589, :591-599` (`qaProbeBog`) — delete the whole doc comment + signature.
- `:95, :97, :117, :122, :557` — drop `bogTree`/`bogLive`/`bogTreeData` mentions from prop
  count and streaming-state doc comments (keep `cover`/`reed`/`stone` fields if §3's
  `generateReeds()` decision keeps reeds as a category — reconcile once that's decided).

### 6. `components/GameCanvas.tsx`

- `:434, :441` and `:586, :626` — the two combined CSS selector lists
  (`#hintCaption[data-hint-key="lake"], #hintCaption[data-hint-key="bog"], ...`): drop
  `#hintCaption[data-hint-key="bog"],` from both (four occurrences total across the two
  breakpoint rules — grep `data-hint-key="bog"` to confirm the exact count live). Drop
  `bog` from the two prose comments listing the self-anchored key family
  (`:434-435`, `:586-587`).

### 7. `components/Hud.tsx`

- `:173` — comment listing self/panel-anchored keys (`lake/bog/deepwater/stamina/...`):
  drop `bog/`.

### 8. `components/SettingsPanel.tsx`

- `:238` — comment "(lake, bog, predators, stamina, ...)": drop `bog,`.

### 9. `lib/game/pack.test.ts`, `lib/game/predator.test.ts` — no functional change

- `pack.test.ts:79-80` — test title `'flankTarget clamps the z axis to the asymmetric zMax
  bound (bog band), not half'` and its comment `// rectangular map, LUL-25 bog band`: `zMax`
  is already always equal to `half` in production (`forest-engine.js:276`, `const zMax =
  half`) — this test exercises a generic capability of `flankTarget()`'s optional `zMax`
  parameter that production code doesn't currently vary, independent of today's bog
  deletion (already true before this ticket). Rename the title to `'flankTarget clamps the
  z axis to an explicit zMax bound, not half'` and drop the bog-band framing from the
  comment; no assertion changes.
- `predator.test.ts:424` — same pattern, rename `'sniffStandoffPoint respects a separate
  zMax for asymmetric maps (LUL-25 bog band)'` to drop the bog reference; no assertion
  changes.

### 10. `docs/ELEMENTS.md`

- `:10-16` — delete the "**Scope note — LUL-25 (the Bog)...**" paragraph in full. It is
  already stale independent of this ticket (describes PR #58 as "still open, not merged";
  PR #58 in fact merged long ago and `## The Bog` below documents it as live) — moot once
  the section it points to is deleted.
- `:2247-2361` (`## The Bog (LUL-25 / LUL-1483 / LUL-1902 / LUL-2225)`, up to but not
  including the `## Startled roosts` header at `:2363`) — delete the entire section.
- `:305-311` — the hard-baby-spawn bullet under the baby/child entry: rewrite to describe
  the new location and predicate — `pickHardBabyPosition()` now lives in `lib/game/mission.ts`
  (LUL-4676), requiring only `>= BLACKOUT_MIN_RADIUS` from home and landmark clearance (no
  bog-crossing condition). Drop "beyond the Bog band" and "See the Bog appendix for the
  band itself."
- `:419` — drop `` `generateBogTrees()`/ `` from the whole-map-spawn draw-order list
  (leaves `generateCover()`/`generateReeds()`/`generateThrowables()` — or fewer, per §3's
  `generateReeds()` decision).
- `:635-647` — delete the "**LUL-2215: bog-tree canopy gap, fixed.**" paragraph in full
  (documents a fix for an interaction between `generateCover()` and the now-deleted
  `generateBogTrees()`/`bogTreeData` — describes dead code once both are gone).
- `:718` — "...see the Log section above for the bug this fixed and the one known
  remaining gap (bog-tree canopies)." → "...see the Log section above for the bug this
  fixed." (the gap no longer exists to reference).
- `:843, :862-863` — Lake section: drop the parenthetical "(and the bog's equivalent)" at
  `:843` and "same shape as the bog's `BOG_SPEED_MULTIPLIER`" at `:862-863` — touch only the
  bog tokens, leave the surrounding lake language for the sibling ticket.
- `:905` — "reads distinctly from the lake/bog fills" → "reads distinctly from the lake's
  fill" (or leave fully to the lake ticket if it lands first and rewords this line itself —
  whoever lands second re-reads this line before editing).
- `:1470` — drop the parenthetical "(see the Bog appendix: this will matter the moment
  LUL-25 lands, since its own wiki page already documents leaving the minimap untouched by
  design)" — already-stale forward reference to a section this ticket deletes.

### 11. `lib/e2e-policy/world-policy.test.ts`

- Delete the `'e2e/bog-zone.spec.ts': 'bog is zeroed in the micro preset',` and
  `'e2e/mobile/bog-zone.spec.ts': 'bog is zeroed in the micro preset (phone viewport)',`
  entries from `FULLMAP_ALLOWLIST`. **Required, not optional**: `:97-101`'s "the allowlist
  only shrinks" test asserts `present.has(rel)` for every allowlist key against the actual
  files on disk — leaving either entry after deleting the corresponding spec file fails
  this test (`node --test`, part of the "unit tests" CI check).
- Optional, matches the file's own "may only shrink" philosophy: tighten `:101`'s bound
  from `<= 14` to `<= 12` (12 entries remain after the two deletions) and update its
  comment to note the 2026-09-23 drop from 14 to 12.

### 12. `docs/CUES.md`

- `:26` — delete the `| Bog | ... |` table row.
- `:50` — delete the `- **Bog** — explanation MISSING (audio/visual present)...` bullet.

### 13. `e2e/bog-zone.spec.ts`, `e2e/mobile/bog-zone.spec.ts` — delete outright

Both files exist only for bog coverage (confirmed: every test in both imports
`BOG_CENTER`/`BOG_INNER_RADIUS`/`BOG_OUTER_RADIUS`/`BOG_SPEED_MULTIPLIER` from
`lib/game/bog` and probes `qaProbeBog`/`qaProbeBogKeepClear`, both deleted in §1/§3).

### 14. `e2e/minimap.spec.ts`, `e2e/mobile/minimap.spec.ts`

No assertion changes — `qaProbeMinimapPoint(0, 200)`/`(40, 150)` test generic `w2m()`
clamping for any world coordinate near the map edge, unrelated to whether bog terrain
renders there (confirmed: the test only checks the returned pixel stays on-canvas, never
reads `qaProbeBog` or any bog constant). The naming is stale regardless of this ticket
(z=200/z=150 haven't been "deep bog" since LUL-2225 shrank the patch to a small area near
`{-40,80}`, three tickets ago) — rename the `test.describe` titles and header comments to
drop "past the forest/bog seam"/"deep bog" framing (e.g. "stays on-canvas near the map
edge"), keep every `expect()` and coordinate unchanged.

### 15. `e2e/minimap-setting.spec.ts`

- `:49` — comment "for this exact reason by `e2e/bog-zone.spec.ts` -- forces the real...":
  update to point at whatever spec now covers the same setup pattern, or drop the
  cross-reference if none does (read the comment's full sentence live before editing — it
  references bog-zone.spec.ts's own justification for a specific `boot()` option, not an
  assertion this file makes itself).

### 16. `e2e/prop-density.spec.ts`, `e2e/mobile/prop-density.spec.ts`

- `CAPS = { cover: 12, reed: 24, bogTree: 12, stone: 3 }` (both files) → drop `bogTree: 12,`
  (or drop `reed` too if §3's `generateReeds()` decision removes the reed category
  entirely — reconcile with that decision before editing this file).
- `expect(entry.bogTree, ...).toBeLessThanOrEqual(CAPS.bogTree);` (both files) → delete.

### 17. `e2e/mobile/hints.spec.ts`

- `:117` — comment "positions the self-anchored hint family (lake/bog/stamina/veil/
  landmark)...": drop `bog/`.

### 18. `e2e/wind-assisted-evasion.spec.ts`

- `:21` — `const HINTS_AHEAD_OF_WIND_ASSIST = ['scent', 'landmark', 'lake', 'bog',
  'deepwater', 'oakHollow', 'wolf', 'bear', 'lion', 'stamina'];` → drop `'bog',`.

## Verification

- `npx tsc --noEmit` — clean (catches `qaProbeBaby`'s signature change at every call site,
  and `mission.ts`'s new exports if a type mismatches).
- `npm run lint` (`eslint`, `next lint` was removed in Next 16) — clean.
- `npm run build` — clean.
- `node --test lib/game/*.test.ts` — `mission.test.ts` passes with the three new tests;
  `lib/game/bog.test.ts` no longer exists to run; `lib/e2e-policy/world-policy.test.ts`
  passes (§11).
- `node scripts/check-elements-citations.mjs` — `OK`, no `unknown symbol`.
- `npx playwright test e2e/hints.spec.ts e2e/mobile/hints.spec.ts
  e2e/wind-assisted-evasion.spec.ts e2e/prop-density.spec.ts e2e/mobile/prop-density.spec.ts
  e2e/minimap-setting.spec.ts` — green, all default micro world.
- `E2E_FULLMAP=1 npx playwright test e2e/minimap.spec.ts e2e/mobile/minimap.spec.ts
  e2e/predator-determinism.spec.ts e2e/map-seed.spec.ts e2e/mission-landmark-sync.spec.ts
  e2e/lul211-founder-report.spec.ts e2e/tree-pathing.spec.ts` — green (see § Deviation 4 —
  this is the check that confirms the rng-stream shift is harmless; do not skip it).
- `grep -rn -i "bog" engine/ lib/ components/ e2e/ docs/ELEMENTS.md docs/CUES.md` — zero
  hits (spot-check each before trusting a nonzero count as failure — some may be
  unrelated words).
- `grep -rn "playerBogMask\|playerBogginess\|BOG_\|biomeAt\|bogSpeedMultiplier\|
  bogNoiseMultiplier\|bogMaskLevel\|bogKeepClear\|routeCrossesBog" engine/ lib/` — zero hits.

## e2e

**Specs.**
- `e2e/bog-zone.spec.ts`, `e2e/mobile/bog-zone.spec.ts` — deleted.
- `e2e/hints.spec.ts` — must pass unchanged (no bog-specific test in this file today;
  confirmed via grep, only the mobile twin mentions bog, in a comment).
- `e2e/mobile/hints.spec.ts` — comment-only edit; must pass unchanged.
- `e2e/wind-assisted-evasion.spec.ts` — array-literal edit; all tests must pass unchanged
  (the array is a hint-priority ordering fixture, not itself asserted on its exact
  contents beyond ordering behavior — confirm no test iterates the array expecting `'bog'`
  present).
- `e2e/prop-density.spec.ts`, `e2e/mobile/prop-density.spec.ts` — assertion deletion;
  remaining density assertions (`cover`/`reed`-or-not per §3/§16 reconciliation/`stone`
  caps, min-pair-spacing) must pass unchanged.
- `e2e/minimap.spec.ts`, `e2e/mobile/minimap.spec.ts` — comment/title rename only, zero
  assertion changes, must pass unchanged (`@fullmap`, local-only per LUL-2377).
- `e2e/minimap-setting.spec.ts` — comment-only edit, must pass unchanged.
- Every other spec file in `e2e/` and `e2e/mobile/` — must pass unchanged; none references
  bog (grepped).

**World.** Micro (default) for every edited spec except the two `@fullmap` minimap files
(unedited assertions, pre-existing tag).

**Hooks.** `qaProbeBog` deleted (§3) — grepped, no remaining `?qaHooks` block reference or
e2e spec calls it once `bog-zone.spec.ts` is gone. `qaProbeBaby` keeps its name, drops one
field (`routeCrossesBog`) — no e2e spec other than the deleted `bog-zone.spec.ts` reads that
field (grepped). No new hooks needed.

**Tester scenario.** None: this is a pure removal, not new player-facing behavior to script
a nightly interaction for. The removal itself is player-visible (no more bog terrain,
ground render, splash audio, or first-encounter hint) but proven by the e2e specs above and
`check-elements-citations.mjs`, not by a scripted playthrough. No `shared/local-qa/requests/`
file filed for this ticket, matching the lake SPEC's own precedent for the same class of
change.

**Not covered.** Whether the map "feels" different at `{-40,80}` where the bog patch used
to be, and whether the full-map rng-stream shift (§ Deviation 4) produces a subjectively
worse or better mission-target/blackout-spawn distribution for any given seed — level-design
judgment for a human or the founder, not something a hook can assert. The nightly local-qa
run's screenshot pass (if any) will surface anything visually broken.

## Cues

Not a new-cue spec — this removes a player-facing element and its one first-encounter hint
(`HINT_TEXT.bog`, "bog — half pace, but it masks your scent from wolves") rather than adding
one. The visual (`bogOuterGround`/`bogInnerGround` discs, `bogTreeData` render — deleted in
§3), audio (`splash()` call at bog >0 — the branch is deleted, `splash()` itself survives
for lake wading), and explanation (the hint text) cues all disappear together, consistently
— no half-state where e.g. the ground mesh is gone but the hint still fires.

## Constraints

- Do not touch anything lake-specific. `lake`/`LAKE_*`/`lib/game/lake.ts` is the sibling
  ticket (LUL-4675, not yet merged as of this SPEC); every edit above that touches a
  shared list/comment/CSS selector containing both `lake` and `bog` removes only the `bog`
  token (mirror of LUL-4675's own stated rule, applied in reverse).
- Do not touch `drownedCar`, `lib/game/mission.ts`'s existing exports (only append),
  `MISSION_POOL`, or anything under the mission-swap ticket LUL-4588's scope — see
  § Deviation 2.
- `checkScent()`'s sight-based detection (`detect()`/`canSee()`) is untouched — only the
  wolf-only scent-nose reduction (§3, `:2360`) is removed.
- Land this as its own PR, independent of LUL-4675 (lake) and LUL-4588 (mission swap), no
  ordering dependency between the three, per the ticket's own text and plan §7.
- Run the `E2E_FULLMAP=1` suite locally before opening the PR (§ Verification) — this is
  the one ticket in the water-removal sequence with a real rng-stream-shift risk (§
  Deviation 4); do not skip this step because CI doesn't run it.

## Out of scope

- The lake (`lib/game/lake.ts`, `CONFIG.lake`, `lakeSpeedMultiplier`) — LUL-4675.
- The Deepwater mission slot and its economy rewards — LUL-4588 and the Game Economist's
  re-balance.
- `drownedCar`'s ultimate fate (survive as forest terrain vs. delete with the mission) —
  plan §7, "whichever engineer stages 2/3 lands with."
- Re-homing or re-tuning the `reed` prop kind if §3's `generateReeds()` read finds it
  should survive as a map-wide prop rather than delete — implement whichever the live
  function body indicates, but do not invent a new reed placement scheme beyond "keep
  as-is, un-gated" or "delete"; a redesign is a different ticket.
- Whether blackout difficulty needs a *new* difficulty-signaling mechanic to replace the
  bog-crossing route constraint's now-removed contribution to spawn variety — the distance
  floor alone (`BLACKOUT_MIN_RADIUS`) is judged sufficient per § Deviation 3; a design
  review of blackout's difficulty curve is a separate concern if the founder or CEO wants
  one.
