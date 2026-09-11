'use client';

import { useEffect, useRef, useState } from 'react';
import DesktopControls from './DesktopControls';
import MobileControls from './MobileControls';
import OrientationGate from './OrientationGate';
import SettingsPanel from './SettingsPanel';
import GameMenu from './GameMenu';
import ActionPrompt from './ActionPrompt';
import { isMobile } from '@/lib/input-mode';
import { track } from '@/lib/analytics';
import { SHOP_CATALOG, nextCost, veilMaxHoldForTier, effectiveScentLifetime, POCKET_STONES_RESERVE, CARRIED, RESCUE, type RunPayout } from '@/lib/game/economy';
import type { MissionKind, SecondaryKind } from '@/lib/game/mission';
import { formatChronicle, type ChronicleEvent } from '@/lib/game/chronicle';
import { CHARGE_WINDOW } from '@/lib/game/charge';

// LUL-34 (M2b): the HUD lifted out of engine/forest-engine.js's DOM writes into
// React. The engine emits a plain state object via `init(onStateChange)`;
// this component only renders it -- it never reaches back into engine
// internals except through the action functions `init()` returns (`actions`
// below), which is the one sanctioned way React talks back to the engine.
// Markup, classes, and copy are unchanged from the original prototype / the M1
// port (components/GameCanvas.tsx's old OVERLAY_MARKUP) so nothing about how the
// game looks or feels should be different -- only how it's rendered. The
// prototype itself is gone from the tree; see README.md for the git ref if you
// need to diff against it.
//
// Not lifted here, still engine-owned DOM (out of LUL-34 scope, see the ticket):
// #vignette, #spotFlash, #flash, #minimap, #hint, #pausePrompt, #deathVideo.

export interface EngineHudState {
  entered: boolean;
  objectiveVisible: boolean;
  objectiveText: string;
  objectiveReady: boolean;
  statusVisible: boolean;
  statusText: string;
  winVisible: boolean;
  winRevealed: boolean;
  deathVisible: boolean;
  deathKind: string;
  // LUL-1194: what actually killed the player (dodge miss / forced hunt / run down
  // mid-chase) -- the death screen names this, not deathKind's species; deathKind
  // stays around for the #deathKind test hook (e2e/*.spec.ts key on it directly).
  deathCause: 'charge' | 'hunt' | 'chase' | 'heard';
  deathCarrying: boolean;   // LUL-1438: show carry-death clause on first carry death only
  lossRevealed: boolean;
  survivedSeconds: number;
  pace: number;
  fog: number;
  // LUL-1709: live time-of-run pacing clock, plain "h:mm AM/PM" text -- ticks from
  // dawn to full night over the run. Engine-driven like pace/fog above.
  timeOfRunClock: string;
  soundOn: boolean;
  // LUL-40/LUL-382: hold-to-veil (mist ramp + follow-light dim + sight-detect cut),
  // engine-driven (see engine/forest-engine.js tick()) -- read-only here, there's no
  // setter because React never triggers it.
  lightDimmed: boolean;
  // LUL-382: veil resource meter, 1 (full) .. 0 (drained). veilLocked is true from a
  // full drain until charge regenerates back past VEIL_UNLOCK_CHARGE -- F does nothing
  // while locked, even if held.
  veilCharge: number;
  veilLocked: boolean;
  // LUL-1904: cave detection-immunity countdown -- 0 while inactive.
  caveImmuneActive:   boolean;
  caveImmuneTimeLeft: number;
  // LUL-1089: contextual action prompts for hide and veil mechanics.
  coverPromptVisible: boolean;
  coverPromptUrgent:  boolean;
  coverPromptKind:    'bramble' | 'log' | null;
  veilPromptVisible:  boolean;
  veilPromptUrgent:   boolean;
  // LUL-1113: stamina resource meter, 1 (full) .. 0 (drained). Decays while
  // sprinting, regenerates while walking. Passed to sprintSpeedMul() to ramp
  // sprint multiplier from STAMINA_SPRINT_MUL (at full charge) to 1 (walk speed,
  // at zero charge).
  staminaCharge: number;
  // LUL-213: a wolf/lion is telegraphing a charge -- press Space within the
  // window or get caught. `chargeToken` only changes on a fresh charge (not
  // every frame one is active), so it can key the prompt element and retrigger
  // its CSS countdown animation from a clean start each time.
  chargeVisible: boolean;
  chargeToken: number;
  // LUL-26: difficulty + accessibility, engine-controlled like pace/fog above.
  difficulty: 'lantern' | 'night' | 'blackout';
  runMode: 'hold' | 'toggle';
  sensitivity: number;
  invertY: boolean;
  reducedMotion: boolean;
  captionsOn: boolean;
  caption: string | null;
  captionId: number;
  // LUL-1043: Embers, the run currency -- engine-controlled like difficulty
  // above, synced from localStorage via setEmbers() (see useEmbers() below).
  // `lastPayout` is the breakdown for the run that just ended (null before
  // the first win/death this session), read alongside winVisible/deathVisible.
  embersBalance: number;
  livePileEmbers: number;   // LUL-1315: live unbanked total, run-only, 0 outside a run
  embersTiers: Record<string, number>;
  lastPayout: RunPayout | null;
  // LUL-1623: throwable distractions. heldThrowable gates the "holding a
  // stone — click/tap to throw" prompt; canGrabThrowable gates the "pick up
  // a stone" prompt, mirroring objectiveReady's role for the child.
  heldThrowable: boolean;
  canGrabThrowable: boolean;
  // LUL-1258: M2 Deepwater's minimal HUD panel. Both null whenever no mission
  // exists or the player is carrying (the engine never sends non-null values
  // in that case) -- Hud never has to know about `carrying` itself.
  missionKind: MissionKind | null;
  missionStatus: 'active' | 'complete' | null;
  // LUL-1666: secondary objectives (deepwater only, Phase 1). See
  // engine/forest-engine.js's hudState defaults for field semantics.
  missionUnlocks: { deepwater: boolean };
  secondaryChoice: SecondaryKind | null;
  secondaryKind: SecondaryKind | null;
  secondaryStatus: 'active' | 'complete' | null;
  secondaryProgress:
    | { kind: 'retrieval'; retrieved: boolean; distance: number }
    | { kind: 'speedrun'; remainingSeconds: number }
    | null;
  // LUL-1724: wind direction, engine-driven, map-constant (set once per
  // generateMap(), pushed once -- not a per-frame value like veilCharge).
  windX: number;
  windZ: number;
  // LUL-1103: The Run Chronicle. Engine-owned {t, code, args} buffer, handed
  // over once in the same pushState() call as winVisible/deathVisible (never
  // streamed per-frame -- see engine/forest-engine.js's logChronicle()
  // comment). lib/game/chronicle.ts's formatChronicle() renders it.
  chronicle: ChronicleEvent[];
  // LUL-2230: the scent trail visual. `scentTrailVisible` is the persisted
  // Settings toggle (default on).
  scentTrailVisible: boolean;
  // LUL-2307: generic first-encounter hint captions (replaces LUL-2230's
  // scentCaptionVisible/X/Y -- scent is now just one entry in the engine's
  // HINT_PRIORITY list). `hintsEnabled` is the persisted Settings toggle
  // (default on); `hintVisible`/`hintKey`/`hintText`/X/Y are pushed
  // per-frame, only while a hint is on screen (same per-frame-push pattern
  // veilCharge above uses). `hintX`/`hintY` (viewport fractions) only matter
  // for WORLD_HINT_KEYS below -- fixed-anchor hints are positioned by CSS
  // keyed on `hintKey` (components/GameCanvas.tsx), not these fields.
  hintsEnabled: boolean;
  hintVisible: boolean;
  hintKey: string | null;
  hintText: string;
  hintX: number;
  hintY: number;
}

// LUL-2307: world-anchored hint keys render the down-arrow glyph and use the
// engine-projected hintX/hintY; the rest (lake/bog/deepwater/stamina/
// caveImmune/veil/landmark -- no real 3D point, or no player-facing panel to
// anchor to) are positioned by a fixed `[data-hint-key]` CSS rule instead. See
// docs/specs/lul-2307-first-encounter-hints.md.
const WORLD_HINT_KEYS = new Set(['scent', 'wolf', 'bear', 'lion', 'cover', 'throwable']);

export interface EngineActions {
  enter: () => void;
  restart: () => void;
  setPace: (v: number) => void;
  setFog: (v: number) => void;
  toggleSound: () => void;
  regenMap: () => void;
  // LUL-68: twin-stick touch input — called by MobileControls
  setTouchMove: (x: number, z: number) => void;
  setTouchLook: (x: number, y: number) => void;
  setTouchSprint: (v: boolean) => void;
  triggerTouchHide: () => void;
  triggerTouchInteract: () => void;
  triggerTouchThrow: () => void;
  // LUL-529: mobile parity for jump/pause/mist-veil/toggle-run -- see
  // MobileControls.tsx and forest-engine.js's triggerTouchJump/Pause/ToggleRun
  // and setTouchVeil.
  triggerTouchJump: () => void;
  triggerTouchPause: () => void;
  triggerTouchToggleRun: () => void;
  setTouchVeil: (v: boolean) => void;
  // LUL-26: difficulty + accessibility
  setDifficulty: (d: 'lantern' | 'night' | 'blackout') => void;
  setRunMode: (m: 'hold' | 'toggle') => void;
  setSensitivity: (v: number) => void;
  setInvertY: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  setCaptions: (v: boolean) => void;
  // LUL-1043
  setEmbers: (balance: number, tiers: Record<string, number>) => void;
  purchase: (id: string) => void;
  // LUL-1666
  setMissionUnlocks: (unlocks: { deepwater: boolean }) => void;
  setSecondaryChoice: (kind: SecondaryKind | null) => void;
  // LUL-2230
  setScentTrailVisible: (v: boolean) => void;
  // LUL-2307
  setHintsEnabled: (v: boolean) => void;
  resetHints: () => void;
}

// Placeholder for the single frame before the engine module resolves and calls
// emitState() with the real values. LUL-35 (pass 2): `pace`/`fog` must match
// engine CONFIG.walk / CONFIG.fog. They used to be a third copy of those
// defaults (alongside the engine's and the inputs' `defaultValue=`), and the
// copies had already drifted -- the panel showed mist `.045` while the scene
// rendered CONFIG.fog `0.04`. The sliders below are driven from state now, so
// this is the only literal on the React side.
export const INITIAL_HUD_STATE: EngineHudState = {
  entered: false,
  objectiveVisible: false,
  objectiveText: '',
  objectiveReady: false,
  statusVisible: false,
  statusText: '',
  winVisible: false,
  winRevealed: false,
  deathVisible: false,
  deathKind: 'wolf',
  deathCause: 'chase',
  deathCarrying: false,
  lossRevealed: false,
  survivedSeconds: 0,
  pace: 6,
  fog: 0.04,
  timeOfRunClock: '6:00 AM',
  soundOn: true,
  lightDimmed: false,
  veilCharge: 1,
  veilLocked: false,
  caveImmuneActive: false,
  caveImmuneTimeLeft: 0,
  coverPromptVisible: false,
  coverPromptUrgent: false,
  coverPromptKind: null,
  veilPromptVisible: false,
  veilPromptUrgent: false,
  staminaCharge: 1,
  chargeVisible: false,
  chargeToken: 0,
  difficulty: 'night',
  runMode: 'hold',
  sensitivity: 1,
  invertY: false,
  reducedMotion: false,
  captionsOn: false,
  caption: null,
  captionId: 0,
  embersBalance: 0,
  livePileEmbers: 0,
  embersTiers: {},
  lastPayout: null,
  heldThrowable: false,
  canGrabThrowable: false,
  missionKind: null,
  missionStatus: null,
  missionUnlocks: { deepwater: false },
  secondaryChoice: null,
  secondaryKind: null, secondaryStatus: null, secondaryProgress: null,
  windX: 1,
  windZ: 0,
  chronicle: [],
  scentTrailVisible: true,
  hintsEnabled: true,
  hintVisible: false,
  hintKey: null,
  hintText: '',
  hintX: 0.5,
  hintY: 0.5,
};

// LUL-1258: display names for MISSION_POOL kinds -- a later ticket adding
// M1/M3/M4/M5 extends this map, not the render logic below.
const MISSION_NAMES: Record<MissionKind, string> = {
  deepwater: 'Deepwater',
};

// LUL-1194: the death screen names the cause, not the species -- a death the
// player can name produces "one more run," one they can't produces a closed
// tab. Keyed on engine/forest-engine.js's triggerDeath() call sites (charge
// dodge miss, the 30s force-hunt escalation, a normal chase run-down).
const DEATH_CAUSE_TEXT: Record<EngineHudState['deathCause'], string> = {
  charge: "you didn't clear its charge in time",
  hunt: 'you went quiet too long, and it came looking',
  chase: 'it ran you down before you could break away',
  heard: 'it heard the child crying and came for you',
};

// The engine emits mist as the raw FogExp2 density it feeds Three; the panel's
// leading-dot format ('.040') is presentation and belongs here, not in the
// engine's state object.
const formatFog = (density: number) => density.toFixed(3).slice(1);

const formatDuration = (totalSeconds: number) => {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

// LUL-1089/LUL-2312: hide/veil action-slot row copy. Only one of the two
// mechanics prompts at a time -- cover wins (engine enforces via
// !coverPromptVisible in the veil condition, forest-engine.js), so this is a
// single priority chain, not two independent branches. Returns props to
// spread onto <ActionPrompt> rather than JSX so the caller doesn't need a
// four-way conditional inline; called unconditionally (its result is only
// ever displayed when the caller's own `visible` prop is true).
function hideVeilPromptContent(
  state: EngineHudState,
  mobile: boolean,
): { text: string; suffix?: string; keycap: string; tone: 'ready' | 'urgent' } {
  const noun = 'bush'; // LUL-2311: bramble is the only hide-eligible cover kind now
  if (state.coverPromptVisible) {
    if (state.coverPromptUrgent) {
      return mobile
        ? { text: `the ${noun} is right there — TAP  `, keycap: 'Hide', tone: 'urgent' }
        : { text: `the ${noun} is right there — PRESS  `, keycap: 'H', tone: 'urgent' };
    }
    return mobile
      ? { text: 'Tap  ', keycap: 'Hide', suffix: `  to slip into the ${noun}`, tone: 'ready' }
      : { text: 'Press  ', keycap: 'H', suffix: `  to hide in the ${noun}`, tone: 'ready' };
  }
  if (state.veilPromptUrgent) {
    return mobile
      ? { text: 'nowhere to hide — HOLD  ', keycap: 'Veil', tone: 'urgent' }
      : { text: 'nowhere to hide — HOLD  ', keycap: 'F', suffix: '  for the veil', tone: 'urgent' };
  }
  return mobile
    ? { text: 'it is hunting you — hold  ', keycap: 'Veil', tone: 'ready' }
    : { text: 'it is hunting you — hold  ', keycap: 'F', suffix: '  for the mist veil', tone: 'ready' };
}

// LUL-1043: Embers, the run currency -- supersedes the LUL-84 personal-best
// time survived this block used to hold (deleted: it rewarded dying slowly,
// see wiki game/economy/state-of-play). Same client-only persistence
// convention as the rest of the project (typeof window guard, try/catch
// around the actual calls) -- see useFullscreen above / SettingsPanel.tsx.
// The engine is the source of truth for balance/tiers (mirrors difficulty/
// runMode/etc.) -- this hook only reads localStorage once to seed the
// engine via setEmbers(), then persists whenever the engine's own state
// changes, the same two-effect shape SettingsPanel.tsx uses.
const EMBERS_KEY = 'lullwood:embers';

interface PersistedEmbers {
  balance: number;
  tiers: Record<string, number>;
}

function readEmbers(): PersistedEmbers | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EMBERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEmbers>;
    if (typeof parsed.balance !== 'number') return null;
    const tiers: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.tiers ?? {})) {
      if (typeof v === 'number') tiers[k] = v;
    }
    return { balance: parsed.balance, tiers };
  } catch {
    return null;
  }
}

function writeEmbers(s: PersistedEmbers) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EMBERS_KEY, JSON.stringify(s));
  } catch {
    // private mode / quota exceeded -- balance still applies this session, just won't persist
  }
}

function useEmbers(actions: EngineActions | null, balance: number, tiers: Record<string, number>) {
  // Track whether the apply-on-ready effect has run, so persist doesn't fire
  // with zero defaults before the stored balance is applied.
  const appliedRef = useRef(false);

  // Apply-on-ready: same pattern as SettingsPanel.tsx's identical effect for
  // difficulty/runMode/etc. -- only fires once per engine instance, since
  // `actions` only changes identity on mount/remount, never per-click.
  useEffect(() => {
    if (!actions) return;
    appliedRef.current = true;
    const stored = readEmbers();
    if (stored) actions.setEmbers(stored.balance, stored.tiers);
  }, [actions]);

  // Persist whenever the engine's own balance/tiers actually change -- after
  // the apply-on-ready effect above, so a mount with a stored balance isn't
  // immediately overwritten by the engine's own zeroed default before it applies.
  useEffect(() => {
    if (!appliedRef.current) return;
    writeEmbers({ balance, tiers });
  }, [balance, tiers]);
}

// LUL-1666: cross-session unlock record -- same split as useEmbers() above
// (engine owns state, this hook only seeds it once on mount and persists
// on change). Key deliberately distinct from EMBERS_KEY.
const MISSION_UNLOCKS_KEY = 'lullwood:mission-unlocks';

function readMissionUnlocks(): { deepwater: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MISSION_UNLOCKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ deepwater: boolean }>;
    return { deepwater: !!parsed.deepwater };
  } catch {
    return null;
  }
}

function writeMissionUnlocks(unlocks: { deepwater: boolean }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MISSION_UNLOCKS_KEY, JSON.stringify(unlocks));
  } catch {
    // private mode / quota exceeded -- unlock still applies this session, just won't persist
  }
}

function useMissionUnlocks(actions: EngineActions | null, unlocks: { deepwater: boolean }) {
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!actions) return;
    appliedRef.current = true;
    const stored = readMissionUnlocks();
    // LUL-2221: a contract mismatch between EngineActions and the engine must never blank the page.
    if (stored) actions.setMissionUnlocks?.(stored);
  }, [actions]);

  useEffect(() => {
    if (!appliedRef.current) return;
    writeMissionUnlocks(unlocks);
  }, [unlocks]);
}

// LUL-26: captions are the only channel carrying predator warnings for a deaf/
// HoH player (every game sound is synthesized WebAudio, no other track exists),
// so the toast needs its own visible lifetime -- the engine only ever sets
// `caption` and bumps `captionId` on a fresh call, it never clears it back to
// null. `captionId === 0` is the pre-game placeholder (INITIAL_HUD_STATE), so
// the very first render doesn't flash a toast with no real caption behind it.
const CAPTION_DISPLAY_MS = 3200;

function useCaptionToast(captionsOn: boolean, captionId: number) {
  // "Adjust state during render" (https://react.dev/learn/you-might-not-need-an-effect):
  // `lastSeenId` is last render's captionId, compared inline instead of from
  // a useEffect, so a fresh caption shows immediately in the render that
  // received it rather than one tick later.
  const [lastSeenId, setLastSeenId] = useState(captionId);
  const [visible, setVisible] = useState(false);

  if (captionId !== lastSeenId) {
    setLastSeenId(captionId);
    setVisible(captionsOn && captionId !== 0);
  } else if (!captionsOn && visible) {
    setVisible(false);
  }

  // The auto-hide timer is the one genuine side effect -- it has to key on
  // captionId too (not just visible) so a second caption arriving while the
  // first is still showing restarts the clock instead of the first timeout
  // cutting the second caption's display short.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), CAPTION_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [visible, captionId]);

  return visible;
}

// LUL-1043: the win/death payout breakdown -- replaces the old best-time
// recap. `payout` is null only for the single frame before the engine's
// first pushState after arriveHome()/triggerDeath() lands, so this never
// renders with stale data from a previous run (lastPayout is set in the
// same pushState call as winVisible/deathVisible).
function RunRecap({ survivedSeconds, payout, balance, isDeath, chronicle, difficulty }: { survivedSeconds: number; payout: RunPayout | null; balance: number; isDeath: boolean; chronicle: ChronicleEvent[]; difficulty: 'lantern' | 'night' | 'blackout' }) {
  const lines = formatChronicle(chronicle);
  const tierLabel = difficulty === 'lantern' ? 'Lantern' : difficulty === 'night' ? 'Night' : 'Blackout';
  return (
    <>
      <p id="runRecap">
        {tierLabel} · time survived: {formatDuration(survivedSeconds)}
        {payout && (
          <>
            <br />
            +{payout.depth} depth · +{payout.survival} survival
            {isDeath ? (
              <> · <span className="emberLoss">-{CARRIED + RESCUE} lost</span> (child &amp; rescue, forfeited)</>
            ) : (
              <>
                {payout.carried > 0 && <> · +{payout.carried} child</>}
                {payout.rescue > 0 && <> · +{payout.rescue} rescue</>}
              </>
            )}
            {payout.spent > 0 && <> · −{payout.spent} charm</>}
            {' '}= <span className="emberGain">{payout.total} embers</span> · balance: {balance}
          </>
        )}
      </p>
      {lines.length > 0 && (
        <ul id="runChronicle">
          {lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </>
  );
}

// LUL-1043: the one sink the cheap version ships -- Deeper Lungs I/II/III,
// each tier adding a second to the mist veil's hold before it locks out (see
// lib/game/veil.ts's VEIL_MAX_HOLD / lib/game/economy.ts's
// veilMaxHoldForTier). Reused on the gate (the ticket's literal "spend
// screen at the gate") and, deliberately, also on the win/death screens --
// restart() never re-shows #gate (entered stays true for the rest of the
// page's life), so gate-only would mean a returning player can only ever
// spend once per page load, not "between runs" the way the design
// (wiki game/economy/embers) describes it. Declared explicitly in the PR
// body as a stated extension of the ticket's literal wording, not a silent one.
function shopEffectCopy(id: string, tier: number): { current: string; next: string } {
  if (id === 'deeperLungs') {
    return { current: `veil hold ${veilMaxHoldForTier(tier)}s`, next: `veil hold ${veilMaxHoldForTier(tier + 1)}s` };
  }
  if (id === 'quietStep') {
    return {
      current: `scent fades in ${effectiveScentLifetime(tier).toFixed(1)}s`,
      next: `scent fades in ${effectiveScentLifetime(tier + 1).toFixed(1)}s`,
    };
  }
  // pocketStones: single tier, tier is always 0 here (cost==null branch handles tier 1)
  return { current: 'no reserve stones', next: `+${POCKET_STONES_RESERVE} throwables/run` };
}

function EmbersShop({ balance, tiers, actions }: { balance: number; tiers: Record<string, number>; actions: EngineActions | null }) {
  return (
    <div id="embersShop">
      <div id="embersShopBalance">Embers: {balance}</div>
      {SHOP_CATALOG.map((item) => {
        const tier = tiers[item.id] ?? 0;
        const cost = nextCost(item.id, tier);
        const copy = shopEffectCopy(item.id, tier);
        return cost == null ? (
          <div key={item.id} id={`embersShopMaxed-${item.id}`}>
            {item.label} maxed — {copy.current}
          </div>
        ) : (
          <button
            key={item.id}
            className="buyBtn"
            id={`buy-${item.id}`}
            disabled={balance < cost}
            onClick={(e) => {
              // #gate's own onClick would otherwise also fire enter() on this same click.
              e.stopPropagation();
              actions?.purchase(item.id);
            }}
          >
            {item.label} — {copy.current} → {copy.next} — {cost} embers
          </button>
        );
      })}
    </div>
  );
}

export default function Hud({
  state,
  actions,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
}) {
  useEmbers(actions, state.embersBalance, state.embersTiers);
  useMissionUnlocks(actions, state.missionUnlocks);
  // LUL-276: decided once per mount (GameCanvas is ssr:false, so this never
  // runs on the server and there's no hydration mismatch to worry about).
  // Exactly one of DesktopControls/MobileControls mounts below.
  const mobile = useState(() => isMobile())[0];
  // LUL-26: difficulty + accessibility settings panel.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // LUL-2231: whether GameMenu's panel is open -- gates MobileControls so its
  // sticks/buttons don't render on top of the menu (see MobileControls.tsx).
  const [menuOpen, setMenuOpen] = useState(false);
  const captionVisible = useCaptionToast(state.captionsOn, state.captionId);

  // LUL-1194: the keyboard is otherwise dead on end screens (isPlaying() gates
  // every keydown branch in the engine on !won && !dead) -- focusing the
  // restart button once the screen actually reveals gives Enter/Space a path
  // back in for free via the browser's native focused-button activation.
  // Deliberately keyed on *Revealed, not *Visible: focusing early (while the
  // death screen is still opacity:0 during the unskippable first-death
  // cutscene) would let a stray Enter restart through native button
  // activation, bypassing the cutscene entirely.
  //
  // LUL-1614: focusing the instant *Revealed flips true was itself the bug --
  // Space is also the jump key, so a player who was jumping (over the last
  // obstacle on the carry leg, most commonly) right as they cross home has that
  // keypress still in flight the moment the button gains focus, and the
  // browser's native "activate the focused button on Space/Enter" fires before
  // the player has consciously registered YOU WON, silently restarting the run
  // -- reproduced live: press Space right after winRevealed and #winScreen is
  // gone, #objective is back, with zero click on .restartBtn. This is the
  // "game just resumes after finding the child" report. A short delay before
  // focusing lets any already-in-flight key from active gameplay lapse first;
  // a player who presses Space/Enter *after* actually seeing the screen still
  // gets the same accessible path back in.
  // 2000ms, not a round guess: #winText's own opacity transition (GameCanvas.tsx's
  // OVERLAY_STYLE, `transition: opacity 0.9s ease`) means winRevealed flips true a full
  // 0.9s before the text is actually visible on screen -- a shorter delay measured from
  // winRevealed still lands within or just after that fade, before a player has had any
  // real chance to read "YOU WON" and decide to press something.
  const RESTART_FOCUS_DELAY_MS = 2000;
  const winRestartRef = useRef<HTMLButtonElement>(null);
  const deathRestartRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!state.winRevealed) return;
    const id = setTimeout(() => winRestartRef.current?.focus(), RESTART_FOCUS_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.winRevealed]);
  useEffect(() => {
    if (!state.lossRevealed) return;
    const id = setTimeout(() => deathRestartRef.current?.focus(), RESTART_FOCUS_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.lossRevealed]);

  return (
    <>
      <OrientationGate />

      {mobile ? (
        <MobileControls
          actions={actions}
          entered={state.entered}
          runMode={state.runMode}
          heldThrowable={state.heldThrowable}
          winVisible={state.winVisible}
          deathVisible={state.deathVisible}
          menuOpen={menuOpen}
        />
      ) : (
        <DesktopControls />
      )}

      <div id="panel">
        {/* Controlled, not `defaultValue`: the engine is the source of truth for
            both knobs, so the thumb follows engine state (including a restart or
            a future engine-side change) instead of a hardcoded starting copy. */}
        <label>
          Pace{' '}
          <input
            id="pace"
            type="range"
            min={2}
            max={12}
            step={0.5}
            value={state.pace}
            onChange={(e) => actions?.setPace(+e.target.value)}
          />
          <span id="paceVal">{state.pace}</span>
        </label>
        <label>
          Mist{' '}
          <input
            id="fog"
            type="range"
            min={0.02}
            max={0.11}
            step={0.005}
            value={state.fog}
            onChange={(e) => actions?.setFog(+e.target.value)}
          />
          <span id="fogVal">{formatFog(state.fog)}</span>
        </label>
        <button id="sound" onClick={() => actions?.toggleSound()}>
          Sound: {state.soundOn ? 'on' : 'off'}
        </button>
        {/* LUL-40/LUL-382: readout only, not a control -- the engine drives this from the
            held key (hold F), same one-directional emit path as pace/fog/soundOn. */}
        <span id="lightState">Light: {state.lightDimmed ? 'dimmed' : 'normal'}</span>
        {/* LUL-382: veil charge meter -- the cost/limit on the mist veil (F). Empty
            means F does nothing until it regenerates; "recharging" means a full drain
            locked it out until charge climbs back past the unlock threshold. */}
        <span id="veilState">
          Veil: {Math.round(state.veilCharge * 100)}%{state.veilLocked ? ' (recharging)' : ''}
        </span>
        {/* LUL-1113: stamina resource meter -- the cost on sprint. Decays while
            sprinting, regenerates while walking. */}
        <span id="staminaState">
          Stamina: {Math.round(state.staminaCharge * 100)}%
        </span>
        {/* LUL-1709: plain-text day/night pacing clock, ticks from dawn to night
            over the run. Read-only readout, same one-directional engine->HUD
            pattern as lightState/veilState/staminaState above it. */}
        <span id="timeOfRunClock">Time: {state.timeOfRunClock}</span>
        {/* LUL-1043: the run currency's balance. LUL-1085 re-scoped #panel to
            dev-only monitoring with no exemptions (GameCanvas.tsx) -- this span
            is hidden by default like every other #panel child. The real
            player-facing balance is #embersShopBalance (EmbersShop, above),
            which this duplicates for dev monitoring only. */}
        <span id="embersBalance">Embers: {state.embersBalance}</span>
        {state.entered && !state.winVisible && !state.deathVisible && (
          <span id="embersPile">Unbanked: {state.livePileEmbers}</span>
        )}
        <button id="regen" onClick={() => actions?.regenMap()}>
          New map
        </button>
      </div>

      <GameMenu state={state} actions={actions} onOpenSettings={() => setSettingsOpen(true)} onOpenChange={setMenuOpen} />
      <SettingsPanel state={state} actions={actions} open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* LUL-26/LUL-2312: closed captions for predator calls -- the only warning
          channel for a player who can't hear the (fully synthesized) audio.
          `key` forces a remount per captionId so a caption that arrives while
          the previous one is still fading restarts the toast cleanly instead
          of the old text lingering under a re-triggered fade. Rendered as an
          <ActionPrompt> row positioned above #actionSlot (GameCanvas.tsx) --
          tone="status" instead of the old dedicated amber #captionToast colour,
          so every non-actionable HUD readout (this + the hidden/hunted status
          row below) shares one look; declared in the PR, not silent. */}
      {/* LUL-2131: predator calls stop while playing===false but captionVisible/
          state.caption are toast state, not reset by triggerDeath/arriveHome --
          a caption in flight at the exact moment of win/death would otherwise
          keep fading in over the end screen. */}
      {captionVisible && state.caption && !state.winVisible && !state.deathVisible && (
        <ActionPrompt
          id="captionToast"
          key={state.captionId}
          visible
          text={state.caption}
          tone="status"
          role="status"
          ariaLive="polite"
        />
      )}

      {!state.entered && (
        <div
          id="gate"
          onClick={() => {
            // LUL-153: the real gate-dismiss click. Must not live inside the
            // engine's enter() -- restart() also calls enter() on every "Play
            // again"/"Try again," and this event exists to count first-time
            // starts for the funnel, not every run.
            track({ event: 'cta_start_clicked' });
            actions?.enter();
          }}
        >
          <div id="gateTitle">LULLWOOD</div>
          <div id="gateSub">a lost child is somewhere in the dark &nbsp;·&nbsp; click to enter</div>
          <div id="gateCredit">Developed by an independent AI studio</div>
          <div id="gateKeys">
            {mobile ? (
              <>
                sticks to move and look &nbsp;·&nbsp; push the left stick to run
                <br />
                <b>Hide</b> / <b>E</b> / <b>Jump</b> &nbsp;·&nbsp; the buttons tell you when
                <br />
                <b>Veil</b> &nbsp;·&nbsp; holds off what is hunting you
                <br />
                <b>Deepwater</b> tag, top-left &nbsp;·&nbsp; reach the marked zone for a bonus Embers payout on a successful run
              </>
            ) : (
              <>
                <b>WASD</b> — move &nbsp;·&nbsp; <b>mouse</b> — look &nbsp;·&nbsp; <b>Shift</b> — run
                <br />
                <b>H</b> — hide (bushes only) &nbsp;·&nbsp; <b>E</b> — lift the child &nbsp;·&nbsp; <b>Esc</b> — menu
                <br />
                <b>Space</b> — jump (also how you clear a charging wolf or lion)
                <br />
                <b>F</b> — hold for the mist veil (dims your light, floods the world in mist, and cuts
                how far predators can see you) — limited, watch the Veil meter
                <br />
                <b>F11</b> / <b>Alt+Enter</b> — fullscreen
                <br />
                <b>Deepwater</b> tag, top-left — reach the marked zone for a bonus Embers payout on a
                successful run
              </>
            )}
          </div>
          <EmbersShop balance={state.embersBalance} tiers={state.embersTiers} actions={actions} />
        </div>
      )}

      {/* LUL-1258: M2 Deepwater's minimal HUD panel -- decisions/missions-accepted-2026-09-01
          §2's "two collapsed lines, top-left, never occupying the play area". No
          expand-on-hold in this ship (declared simplification, spec S5) -- read-only
          text, no touch target, so it needs no new EngineActions entry. */}
      {state.missionKind && state.missionStatus && (
        <div id="missionPanel">
          {MISSION_NAMES[state.missionKind]}
          <span id="missionGlyph">{state.missionStatus === 'complete' ? '●' : '○'}</span>
        </div>
      )}

      {/* LUL-1666: secondary objective panel -- progress indicator (retrieval) or
          countdown (speedrun). Same collapsed, top-left, non-blocking treatment as
          #missionPanel above (decisions/missions-accepted-2026-09-01 §2's rule
          extends naturally here -- it's the same panel family). Desktop+mobile
          parity is rendering-only: no new input, this is read-only like
          #missionPanel already is. */}
      {state.secondaryKind && state.secondaryProgress && (
        <div id="secondaryPanel" className={state.secondaryStatus === 'complete' ? 'complete' : undefined}>
          {state.secondaryKind === 'retrieval' ? (
            <>
              Retrieve the radio mast
              <span id="secondaryGlyph">
                {state.secondaryProgress.kind === 'retrieval' && state.secondaryProgress.retrieved
                  ? '●'
                  : `${(state.secondaryProgress.kind === 'retrieval' && state.secondaryProgress.distance) ?? 0}m`}
              </span>
            </>
          ) : (
            <>
              Speedrun
              <span id="secondaryGlyph">
                {state.secondaryProgress.kind === 'speedrun' ? formatDuration(state.secondaryProgress.remainingSeconds) : ''}
              </span>
            </>
          )}
        </div>
      )}

      {/* LUL-1904: cave detection-immunity countdown -- always visible while
          active so the player can never be surprised by a silent lapse. Raw
          seconds from the engine, formatted here (same "engine emits data, React
          renders" rule as fogDisplay/timeOfRunClock). */}
      {state.caveImmuneActive && (
        <div id="caveImmunePanel">
          Immune · {Math.ceil(state.caveImmuneTimeLeft)}s
        </div>
      )}

      {/* LUL-2131: gate on !winVisible/!deathVisible too -- entered stays true
          through the end screens (restart() never clears it), so this used to
          keep drawing at z-index 12 over #winScreen/#deathScreen's z-index 25.
          It's below the modals visually either way, but it's still a live,
          ticking readout that has no business rendering once the run is over. */}
      {state.entered && !state.winVisible && !state.deathVisible && (
        <div
          id="windIndicator"
          title="Wind direction -- move into the arrow to reduce your scent trail"
          style={{ transform: `rotate(${Math.atan2(state.windZ, state.windX)}rad)` }}
        >
          {'→'}
        </div>
      )}

      {state.entered && !state.winVisible && !state.deathVisible && (
        <div id="windIndicatorHint">wind — move into the arrow to lower your scent trail</div>
      )}

      {/* LUL-2307: generic first-encounter hint caption, generalizing LUL-2230's
          scent-only version -- scent is now just one HINT_PRIORITY entry
          (engine/forest-engine.js). World-anchored keys (WORLD_HINT_KEYS above)
          get the engine-projected screen position (hintX/Y, viewport fractions)
          and the down-arrow glyph; the rest are positioned by a fixed
          `[data-hint-key]` CSS rule (components/GameCanvas.tsx) instead. The
          'scent' key keeps its original #scentTrailCaption id/glyph class
          instead of the new generic #hintCaption/.hintCaptionGlyph --
          e2e/scent-trail.spec.ts and e2e/mobile/scent-trail.spec.ts assert on
          `#scentTrailCaption` directly and must pass unchanged. Gated on
          !winVisible/!deathVisible like #hint (LUL-2158 precedent) so a fast
          death never shows it over "YOU LOSE". */}
      {state.hintVisible && !state.winVisible && !state.deathVisible && (
        <div
          id={state.hintKey === 'scent' ? 'scentTrailCaption' : 'hintCaption'}
          data-hint-key={state.hintKey ?? undefined}
          style={state.hintKey && WORLD_HINT_KEYS.has(state.hintKey)
            ? { left: `${state.hintX * 100}%`, top: `${state.hintY * 100}%` }
            : undefined}
        >
          {state.hintKey && WORLD_HINT_KEYS.has(state.hintKey) && (
            <span className={state.hintKey === 'scent' ? 'scentTrailCaptionGlyph' : 'hintCaptionGlyph'} aria-hidden="true">↓</span>
          )}
          {state.hintText}
        </div>
      )}

      {/* LUL-2312: the one fixed bottom action slot -- a CSS grid of five
          always-mounted rows (GameCanvas.tsx's #actionSlot), each an
          <ActionPrompt>, in the founder's stated priority order top-to-bottom:
          charge dodge > objective (E) > hide-or-veil > throwable > status.
          Rows with nothing to show still occupy their grid track (no
          pop-in layout shift when one appears/disappears) -- ActionPrompt
          itself decides whether to render a pill inside that track.
          Every row is gated on !winVisible && !deathVisible: engine state for
          all five is only recomputed `if(playing)` (forest-engine.js's tick())
          and resets one frame after triggerDeath()/arriveHome() flip
          winVisible/deathVisible, so without the gate a prompt live at the
          exact moment of win/death would render over the end screen for that
          frame (LUL-2131 precedent -- previously only actionPrompt/throwPrompt
          carried this gate; extended to all five here for consistency, not a
          previously-reported bug on the other three). */}
      <div id="actionSlot">
        {/* LUL-213/LUL-304/LUL-617: charge-dodge keycap + countdown bar. `key`
            on chargeToken forces the drain bar's CSS animation to restart from
            a clean 100% on a *fresh* charge (not an overlapping one -- see
            beginChargeHud in the engine); durationSeconds is CHARGE_WINDOW
            (lib/game/charge.ts) so the bar can never drift from the real dodge
            window without also threading it through as per-frame engine
            state. tone="urgent" replaces the old #chargeKey's own always-on
            amber scale-pulse (chargePulse) with the same red flash every other
            urgent row uses -- LUL-2312 rule 4 bans scale/bounce transitions,
            and unifying the two keeps this the only urgent animation in the
            component family; declared here, not silent. On mobile the pill is
            an actual tap target (pointer-events:auto + onPointerDown, LUL-653
            avoids the browser's pan-gesture disambiguation), same
            triggerTouchJump the bottom-left Jump button already uses -- that
            button stays too, removing it is a UX call for a tester, not a
            code-correctness one. */}
        <ActionPrompt
          id="chargePrompt"
          testId={mobile ? 'chargePromptTap' : undefined}
          visible={state.chargeVisible && !state.winVisible && !state.deathVisible}
          tone="urgent"
          keycap={mobile ? 'JUMP' : 'SPACE'}
          reducedMotion={state.reducedMotion}
          progress={{ token: state.chargeToken, durationSeconds: CHARGE_WINDOW }}
          onPointerDown={mobile ? (e) => { e.preventDefault(); actions?.triggerTouchJump(); } : undefined}
        />
        {/* objective (E) -- text is an opaque string from the engine
            (objectiveText, forest-engine.js), sometimes with no key at all
            ("Find the lost child · 40m"), so it is rendered as plain text
            rather than parsed for a keycap chip -- engine contract unchanged. */}
        <ActionPrompt
          id="objective"
          visible={state.objectiveVisible && !state.winVisible && !state.deathVisible}
          tone={state.objectiveReady ? 'ready' : 'calm'}
          text={state.objectiveText}
        />
        {/* LUL-1089: contextual hide/veil prompt -- only one of the two shown
            at a time, cover wins (engine enforces via !coverPromptVisible in
            the veil condition). Double-spaces around the key name are house
            style (match "Press  E  to lift the child"). */}
        <ActionPrompt
          id="actionPrompt"
          visible={(state.coverPromptVisible || state.veilPromptVisible) && !state.winVisible && !state.deathVisible}
          reducedMotion={state.reducedMotion}
          {...hideVeilPromptContent(state, mobile)}
        />
        {/* LUL-1623: holding-a-throwable affordance -- there's no held-item
            mesh in first person, so this is the only way the player knows
            they're carrying a stone. tone="ready" unconditionally, matching
            the old #throwPrompt's always-amber styling (it never had a calm
            state of its own). */}
        <ActionPrompt
          id="throwPrompt"
          visible={state.heldThrowable && !state.winVisible && !state.deathVisible}
          tone="ready"
          text={mobile ? 'Holding a stone — tap  ' : 'Holding a stone — click to throw'}
          keycap={mobile ? 'Throw' : undefined}
        />
        {/* `hiding` is not a second flag: status only ever appears while hidden
            (LUL-35 pass 2 removed the `statusHiding` field, which the engine
            only ever set to the same value as `statusVisible`). */}
        <ActionPrompt
          id="status"
          visible={state.statusVisible && !state.winVisible && !state.deathVisible}
          tone="status"
          text={state.statusText}
        />
      </div>

      {state.winVisible && (
        <div id="winScreen" style={{ display: 'flex' }}>
          <div id="winText" style={{ opacity: state.winRevealed ? 1 : 0 }}>
            <h1>YOU WON</h1>
            <p>the child is safe — you lifted her into the light</p>
            <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={false} chronicle={state.chronicle} difficulty={state.difficulty} />
            <button
              ref={winRestartRef}
              className="restartBtn"
              disabled={!state.winRevealed}
              onClick={() => actions?.restart()}
            >
              Play again
            </button>
            <EmbersShop balance={state.embersBalance} tiers={state.embersTiers} actions={actions} />
          </div>
        </div>
      )}

      {state.deathVisible && (
        <div id="deathScreen" style={{ display: 'flex' }}>
          <div id="deathText" style={{ opacity: state.lossRevealed ? 1 : 0 }}>
            <h1>YOU LOSE</h1>
            <p>
              {/* LUL-1194: #deathKind carries species for the existing e2e hooks
                  (e2e/*.spec.ts assert on it directly) but is no longer the copy
                  shown to the player -- that's DEATH_CAUSE_TEXT below, keyed on
                  the cause, not the animal. */}
              <span id="deathKind" style={{ display: 'none' }}>{state.deathKind}</span>
              {DEATH_CAUSE_TEXT[state.deathCause]}
              {state.deathCarrying && <> — you were carrying the only light in it</>}
            </p>
            <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={true} chronicle={state.chronicle} difficulty={state.difficulty} />
            <button
              ref={deathRestartRef}
              className="restartBtn"
              disabled={!state.lossRevealed}
              onClick={() => actions?.restart()}
            >
              Try again
            </button>
            <EmbersShop balance={state.embersBalance} tiers={state.embersTiers} actions={actions} />
          </div>
        </div>
      )}
    </>
  );
}
