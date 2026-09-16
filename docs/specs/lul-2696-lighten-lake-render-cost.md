# SPEC: LUL-2696 lighten the lake's render cost to fix the qaAdvance swiftshader crash

**Ticket:** LUL-2696 · **Tier:** C — engine render loop (per CTO PLAN comment 2026-09-15T23:59:22Z
on this ticket). Needs `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `1f68d5c` (2026-09-16). Re-derive every `file:line` below
from the branch you actually implement on if it has moved.

## Background (do not re-litigate)

Confirmed by Game Engineer's live repro (comment 23:55:36Z) and the Founding Engineer feasibility
spike (05:04:21Z, this ticket): teleporting into the lake and running 410 synchronous
`qaAdvance()` steps crashes the tab under `--use-gl=swiftshader` (2/2 nightly runs, `desktop-1280x720`
only — `pixel5-landscape` passes clean both times). The bug is real render cost, not a QA-harness
timing artifact — `adaptResolution()`'s safety valve (`engine/forest-engine.js:5969-5975`) can't
fire under `qaAdvance`'s fixed synthetic `dt`, and the spike proved there is no cheap synchronization
point to add instead (forcing a real GPU sync every 1–50 steps either reproduces the crash directly
or blows the 90s per-viewport budget on its own). **This SPEC does not touch `qaAdvance` or
`adaptResolution` at all** — per the CTO's plan correction (05:20:48Z), the fix is to make the lake
itself cheaper to render, which is also a genuine perf win for real low-end players independent of
the QA rig.

## Files

- `engine/forest-engine.js` — edit the lake water mesh's material and remove `lakeLight`
  (`:1365-1376`).

## The change

At `engine/forest-engine.js:1365-1376`, currently:

```js
// ---- Lake landmark (the thing to find) -----------------------------------
const water = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.lake.r, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1a2c, roughness: 0.35, metalness: 0.15 }));
water.rotation.x = -Math.PI/2; water.position.set(CONFIG.lake.x, 0.02, CONFIG.lake.z); scene.add(water);

const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.lake.r*0.72, CONFIG.lake.r*1.05, 48),
  new THREE.MeshBasicMaterial({ color: CONFIG.lake.glow, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI/2; ring.position.set(CONFIG.lake.x, 0.06, CONFIG.lake.z); scene.add(ring);

const lakeLight = new THREE.PointLight(CONFIG.lake.glow, 1.3 * LEGACY_LIGHT_SCALE, 75, 2);
lakeLight.position.set(CONFIG.lake.x, 7, CONFIG.lake.z); scene.add(lakeLight);
```

Change to:

```js
// ---- Lake landmark (the thing to find) -----------------------------------
// LUL-2696: was MeshStandardMaterial + a dedicated PointLight. The water mesh sits
// close enough to the camera at the "chest-deep" teleport point to near-fill the
// view, and PBR's per-fragment lighting math there (plus lakeLight adding another
// point light every other lit mesh in the frame has to loop over) is what backed up
// swiftshader's software render pipeline into the qaAdvance(410) crash -- see this
// ticket for the live measurements. Lambert is unlit-cheap but still reacts to the
// scene's existing moon/hemi/rim lights, so the water still darkens/lightens with
// the day-night cycle; the glow ring below (unlit already) carries the "landmark
// visible at night" cue that lakeLight used to help with.
const water = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.lake.r, 48),
  new THREE.MeshLambertMaterial({ color: 0x0a1a2c }));
water.rotation.x = -Math.PI/2; water.position.set(CONFIG.lake.x, 0.02, CONFIG.lake.z); scene.add(water);

const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.lake.r*0.72, CONFIG.lake.r*1.05, 48),
  new THREE.MeshBasicMaterial({ color: CONFIG.lake.glow, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI/2; ring.position.set(CONFIG.lake.x, 0.06, CONFIG.lake.z); scene.add(ring);
```

`lakeLight` (the `THREE.PointLight` and its `scene.add()` call) is deleted outright, not retuned.
Confirmed by grep (`grep -n lakeLight engine/forest-engine.js`) that its variable is referenced
nowhere else in the file — no hint/audio/HUD logic reads it, so removing it cannot leave a dangling
reference. The ambient "twinkle" chime bias (`engine/forest-engine.js:6536`, `distLake < CONFIG.lake.r*3`)
is driven by player-to-lake distance, not by `lakeLight`, and is unaffected.

If the implementer's own screenshot comparison (see Verification) shows the glow ring alone reads as
noticeably dimmer at night than before, raise `ring`'s `opacity` (currently `0.16`) rather than
reintroducing a light — that stays inside this spec's scope; reintroducing `lakeLight` does not.

## Verification

- `npx tsc --noEmit` — clean (no engine type changes, but keep the project honest).
- `npx eslint engine/forest-engine.js` — clean.
- Live crash-repro re-run (the exact spike from this ticket's 05:04:21Z comment): dev server on
  `release/next` with this change, Playwright launched with
  `--use-gl=swiftshader --enable-unsafe-swiftshader --no-sandbox --mute-audio --disable-dev-shm-usage`
  and `LD_LIBRARY_PATH=/home/noam/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu`,
  `qaSetFixedStep(0.02)`, `qaTeleportTo(34,-28)`, then 820 synchronous `qaAdvance(1)` calls
  (matching `_lake1`+`_dw1` in `shared/local-qa/requests/lul-2307-first-encounter-hints.md`).
  Passing looks like: completes without `Target page, context or browser has been closed`, in
  wall-clock time in the same order of magnitude as the existing `_land1` baseline (order of a few
  seconds, not tens of seconds) — this is the actual acceptance bar, not just "doesn't crash once."
  Run it 3 times; a single clean run under today's host load isn't enough given the ticket's own
  host-load-contention finding (04:31:34Z comment).
- Screenshot compare: `qaBuildScene` a fixed seed, teleport to `(34,-28)` (in-lake) and to a point
  outside the lake with it in view, at both day and night `timeOfRun`, before/after the material
  change. Passing looks like: the water still reads as dark, glowing water, not a flat unlit color
  swatch — this is the "visible material swap" the CTO's comment (05:20:48Z) explicitly asked to be
  checked by eye, not by an assertion.

## e2e

**Specs.** No new spec file — this is a material/lighting change, not new player-facing behavior.
Existing specs must pass **unchanged**: `e2e/hints.spec.ts` (lake first-encounter hint — confirms
the hint trigger radius and copy are untouched) and any spec that stages a lake screenshot
(`grep -rl "lake" e2e/` before starting, to catch pixel-comparison specs that might need their
reference image regenerated for the new material).
**World.** micro (default). No new hooks needed — this change has no new player-observable state,
only a material/light swap on existing static geometry.
**Hooks.** None new. Existing `qaTeleportTo`, `qaSetFixedStep`, `qaAdvance`, `qaBuildScene` (all
already declared in `engine/forest-engine.d.ts`) are what the Verification section's live re-run
uses.
**Tester scenario.** The existing `shared/local-qa/requests/lul-2307-first-encounter-hints.md`
request (this ticket's own source) is the regression gate — the CTO's plan correction names 2
consecutive clean nightly runs (desktop **and** mobile) post-merge as the actual pass condition.
Do not close the review/verification loop on a local run alone; leave this ticket's disposition
naming that nightly condition explicitly, the same way LUL-2734 did.
**Not covered.** Whether the lake "looks right" at every time-of-day/weather combination stays a
manual call (Cues section below) — the deterministic suite can't judge material aesthetics, only
that nothing crashes and existing DOM/flag assertions still pass.

## Cues

**Visual.** The lake water mesh (`engine/forest-engine.js:1366-1369`) goes from a glossy PBR
surface (`MeshStandardMaterial`, roughness 0.35/metalness 0.15) to a flat-lit surface
(`MeshLambertMaterial`) — still receives the scene's moon/hemisphere/rim lights, so it stays dark
in fog and lighter under moonlight, just without the specular highlight PBR added at roughness
0.35. The additive glow `ring` (`:1370-1373`, unchanged) still carries the "this is a landmark, it
glows" read. `lakeLight`'s dedicated point-light falloff around the water disappears.
**Audio.** Unaffected — the ambient twinkle chime (`twinkle()`, `engine/forest-engine.js:3452`,
triggered at `:6534-6538`) is driven by `distLake` (player-to-lake distance), not by the light
object being removed.
**Explanation.** Unaffected — the `lake` first-encounter hint text ("chest-deep water — half
pace. predators wade too", `engine/forest-engine.js:2121`) and its trigger (`inLakeWater()`) are
untouched by this change.
**Reduced motion.** Unaffected — the water mesh was already static geometry with no animation
(the wisp particles above it, `lwisps` at `:1606-1609`, are untouched and out of scope here).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Do not touch `qaAdvance()` (`engine/forest-engine.js:3950`) or `adaptResolution()` (`:5969-5975`)
  — the spike already ruled out fixing this at that layer (see Background).
- Do not change `CONFIG.lake.r`/`.x`/`.z`/`.clear`/`.glow` (`engine/tuning.js:59`) — this is a
  material/lighting change only, not a geometry or gameplay-radius change. `inLake()`,
  `inLakeWater()`, `lakeSpeedMultiplier()`, and every spawn-clearance check that reads `CONFIG.lake`
  must be byte-for-byte unaffected.
- `lakeLight` must be deleted, not merely dimmed to zero intensity — an intensity-0 light still
  costs a light-loop iteration in every lit material's shader; the goal is one fewer point light
  in the scene, not a dark one.
- If the screenshot compare calls for restoring some of the lost glow, raise `ring`'s `opacity`
  (a `MeshBasicMaterial` property, already unlit-cheap) — do not reintroduce a `PointLight`.

## Out of scope

- The second, distinct crash signature the CTO surfaced on LUL-2223 (bog/child scene, no lake,
  4500 sync steps, same `Target...closed` signature, passed clean on retry with no code change) —
  that is host-load contention on the shared nightly rig, a QA-rig capacity question per the CTO's
  05:20:48Z comment, not this spec's concern. If it recurs on a different scene, that is a new
  ticket.
- General lake visual polish (color grading, reflections, a real water shader) — the wisp
  particles' comment at `engine/forest-engine.js` already calls a ripple/water-shader pass "a
  legitimate follow-up, not a blocker here" for a different ticket (LUL-2225's bog note applies the
  same logic to the lake).
- Any other `MeshStandardMaterial` instance in the scene (ground, trees, cover, throwables, all
  still `MeshStandardMaterial` per `engine/forest-engine.js:379,501-554` etc.) — this spec is scoped
  to the one mesh proven to sit at the crash's camera position, not a blanket materials pass.
