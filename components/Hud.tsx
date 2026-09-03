'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import DesktopControls from './DesktopControls';
import MobileControls from './MobileControls';
import OrientationGate from './OrientationGate';
import SettingsPanel from './SettingsPanel';
import GameMenu from './GameMenu';
import { isMobile } from '@/lib/input-mode';
import { track } from '@/lib/analytics';
import { nextDeeperLungsCost, veilMaxHoldForTier, type RunPayout } from '@/lib/game/economy';

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
  deathVisible: boolean;
  deathKind: string;
  lossRevealed: boolean;
  survivedSeconds: number;
  pace: number;
  fog: number;
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
  embersDeeperLungsTier: number;
  lastPayout: RunPayout | null;
}

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
  setEmbers: (balance: number, deeperLungsTier: number) => void;
  purchaseDeeperLungs: () => void;
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
  deathVisible: false,
  deathKind: 'wolf',
  lossRevealed: false,
  survivedSeconds: 0,
  pace: 6,
  fog: 0.04,
  soundOn: true,
  lightDimmed: false,
  veilCharge: 1,
  veilLocked: false,
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
  embersDeeperLungsTier: 0,
  lastPayout: null,
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
  tiers: { deeperLungs: number };
}

function readEmbers(): PersistedEmbers | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EMBERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEmbers>;
    if (typeof parsed.balance !== 'number') return null;
    return { balance: parsed.balance, tiers: { deeperLungs: parsed.tiers?.deeperLungs ?? 0 } };
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

function useEmbers(actions: EngineActions | null, balance: number, deeperLungsTier: number) {
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
    if (stored) actions.setEmbers(stored.balance, stored.tiers.deeperLungs);
  }, [actions]);

  // Persist whenever the engine's own balance/tier actually change -- after
  // the apply-on-ready effect above, so a mount with a stored balance isn't
  // immediately overwritten by the engine's own zeroed default before it applies.
  useEffect(() => {
    if (!appliedRef.current) return;
    writeEmbers({ balance, tiers: { deeperLungs: deeperLungsTier } });
  }, [balance, deeperLungsTier]);
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
function RunRecap({ survivedSeconds, payout, balance }: { survivedSeconds: number; payout: RunPayout | null; balance: number }) {
  return (
    <p id="runRecap">
      time survived: {formatDuration(survivedSeconds)}
      {payout && (
        <>
          <br />
          +{payout.depth} depth · +{payout.survival} survival
          {payout.carried > 0 && <> · +{payout.carried} child</>}
          {payout.home > 0 && <> · +{payout.home} home</>}
          {' '}= <span className="emberGain">{payout.total} embers</span> · balance: {balance}
        </>
      )}
    </p>
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
function EmbersShop({ balance, tier, actions }: { balance: number; tier: number; actions: EngineActions | null }) {
  const cost = nextDeeperLungsCost(tier);
  const currentHold = veilMaxHoldForTier(tier);
  return (
    <div id="embersShop">
      <div id="embersShopBalance">Embers: {balance}</div>
      {cost == null ? (
        <div id="embersShopMaxed">Deeper Lungs maxed — veil hold {currentHold}s</div>
      ) : (
        <button
          className="buyBtn"
          id="buyDeeperLungs"
          disabled={balance < cost}
          onClick={(e) => {
            // #gate's own onClick would otherwise also fire enter() on this same click.
            e.stopPropagation();
            actions?.purchaseDeeperLungs();
          }}
        >
          Deeper Lungs — veil hold {currentHold}s → {veilMaxHoldForTier(tier + 1)}s — {cost} embers
        </button>
      )}
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
  useEmbers(actions, state.embersBalance, state.embersDeeperLungsTier);
  // LUL-276: decided once per mount (GameCanvas is ssr:false, so this never
  // runs on the server and there's no hydration mismatch to worry about).
  // Exactly one of DesktopControls/MobileControls mounts below.
  const mobile = useState(() => isMobile())[0];
  // LUL-26: difficulty + accessibility settings panel.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const captionVisible = useCaptionToast(state.captionsOn, state.captionId);

  return (
    <>
      <OrientationGate />

      {mobile ? (
        <MobileControls actions={actions} entered={state.entered} runMode={state.runMode} />
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
        {/* LUL-1043: the run currency's balance -- exempted from admin-mode's
            #panel hide the same way lightState/veilState are (GameCanvas.tsx),
            since this is core game progress, not a dev-tuning control. */}
        <span id="embersBalance">Embers: {state.embersBalance}</span>
        <button id="regen" onClick={() => actions?.regenMap()}>
          New map
        </button>
      </div>

      <GameMenu state={state} actions={actions} onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsPanel state={state} actions={actions} open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* LUL-26: closed captions for predator calls -- the only warning
          channel for a player who can't hear the (fully synthesized) audio.
          `key` forces a remount per captionId so a caption that arrives while
          the previous one is still fading restarts the toast cleanly instead
          of the old text lingering under a re-triggered fade. */}
      {captionVisible && state.caption && (
        <div id="captionToast" key={state.captionId} role="status" aria-live="polite">
          {state.caption}
        </div>
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
                <b>left stick</b> — move &nbsp;·&nbsp; <b>right stick</b> — look &nbsp;·&nbsp; push the left stick further to run
                <br />
                <b>Hide</b> button — hide (bushes &amp; hollow logs only) &nbsp;·&nbsp; <b>E</b> button — lift the child
                <br />
                <b>Jump</b> button — jump (also how you clear a charging wolf or lion) &nbsp;·&nbsp;{' '}
                <b>Pause</b> button — pause / resume
                <br />
                <b>Veil</b> button — hold for the mist veil (dims your light, floods the world in mist, and cuts
                how far predators can see you) — limited, watch the Veil meter
              </>
            ) : (
              <>
                <b>WASD</b> — move &nbsp;·&nbsp; <b>mouse</b> — look &nbsp;·&nbsp; <b>Shift</b> — run
                <br />
                <b>H</b> — hide (bushes &amp; hollow logs only) &nbsp;·&nbsp; <b>E</b> — lift the child &nbsp;·&nbsp; <b>Esc</b> — menu
                <br />
                <b>Space</b> — jump (also how you clear a charging wolf or lion)
                <br />
                <b>F</b> — hold for the mist veil (dims your light, floods the world in mist, and cuts
                how far predators can see you) — limited, watch the Veil meter
              </>
            )}
          </div>
          <EmbersShop balance={state.embersBalance} tier={state.embersDeeperLungsTier} actions={actions} />
        </div>
      )}

      {/* CSS default for #objective/#status is `display: none` (they were only
          ever shown by the old code writing `style.display = 'block'`) --
          the inline override below reproduces that, otherwise the stylesheet
          rule would hide them even though React has mounted the element. */}
      {state.objectiveVisible && (
        <div id="objective" className={state.objectiveReady ? 'ready' : undefined} style={{ display: 'block' }}>
          {state.objectiveText}
        </div>
      )}

      {/* `hiding` is not a second flag: status only ever appears while hidden
          (LUL-35 pass 2 removed the `statusHiding` field, which the engine only
          ever set to the same value as `statusVisible`). */}
      {state.statusVisible && (
        <div id="status" className="hiding" style={{ display: 'block' }}>
          {state.statusText}
        </div>
      )}

      {/* LUL-213: the visual key for the charge dodge -- `key` on chargeToken
          forces React to remount this element on every fresh charge (not on
          overlapping ones, see beginChargeHud in the engine), which restarts
          the CSS countdown bar animation from a clean 100%. The countdown
          duration is CHARGE_WINDOW, imported into GameCanvas.tsx's OVERLAY_STYLE
          (see lib/game/charge.ts) rather than passed here as engine state --
          it's a fixed, learnable window by design, not a per-frame tunable
          the HUD needs to stay in sync with. LUL-304: this used to restate the
          value as a bare "1s" literal in the CSS; it's now the same constant.
          LUL-617: on mobile the pill reads "JUMP" but #chargePrompt's CSS is
          `pointer-events: none` (it's a caption on desktop, not a control) --
          that made it a false affordance once the label became actionable
          text. Override pointer-events + wire the same triggerTouchJump the
          bottom-left Jump button uses, `onPointerDown` like ActionBtn (LUL-653:
          avoids the browser's pan-gesture disambiguation on tap targets). The
          bottom-left button stays too -- removing it is a UX call for the
          Game Tester, not a code-correctness one. */}
      {state.chargeVisible && (
        <div
          id="chargePrompt"
          key={state.chargeToken}
          style={mobile ? { pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer' } : undefined}
          onPointerDown={mobile ? (e) => { e.preventDefault(); actions?.triggerTouchJump(); } : undefined}
          data-testid={mobile ? 'chargePromptTap' : undefined}
        >
          <span id="chargeKey">{mobile ? 'JUMP' : 'SPACE'}</span>
          <div id="chargeBarTrack">
            <div id="chargeBar" />
          </div>
        </div>
      )}

      {state.winVisible && (
        <div id="winScreen" style={{ display: 'flex' }}>
          <h1>YOU WON</h1>
          <p>the child is safe — you carried them home through the Lullwood</p>
          <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} />
          <button className="restartBtn" onClick={() => actions?.restart()}>
            Play again
          </button>
          <EmbersShop balance={state.embersBalance} tier={state.embersDeeperLungsTier} actions={actions} />
        </div>
      )}

      {state.deathVisible && (
        <div id="deathScreen" style={{ display: 'flex' }}>
          <div id="deathText" style={{ opacity: state.lossRevealed ? 1 : 0 }}>
            <h1>YOU LOSE</h1>
            <p>
              a <span id="deathKind">{state.deathKind}</span> caught you in the dark
            </p>
            <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} />
            <button className="restartBtn" onClick={() => actions?.restart()}>
              Try again
            </button>
            <EmbersShop balance={state.embersBalance} tier={state.embersDeeperLungsTier} actions={actions} />
          </div>
        </div>
      )}
    </>
  );
}
