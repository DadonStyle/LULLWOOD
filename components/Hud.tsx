'use client';

import { useCallback, useEffect, useState } from 'react';
import TouchControls from './TouchControls';
import { track } from '@/lib/analytics';

// LUL-124: fullscreen toggle. `document.fullscreenEnabled` is false on
// browsers that never expose the API (older iOS Safari) so the button is
// simply omitted there instead of rendering a control that would reject on
// every click. The `fullscreenchange` listener is what keeps `isFullscreen`
// correct after the browser's own exit paths (Esc key, system UI) which
// don't otherwise call back into this component.
function useFullscreen() {
  const supported = useState(() => typeof document !== 'undefined' && document.fullscreenEnabled)[0];
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement != null,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return { supported, isFullscreen, toggle };
}

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
}

export interface EngineActions {
  enter: () => void;
  restart: () => void;
  setPace: (v: number) => void;
  setFog: (v: number) => void;
  toggleSound: () => void;
  regenMap: () => void;
  // LUL-68: twin-stick touch input — called by TouchControls
  setTouchMove: (x: number, z: number) => void;
  setTouchLook: (x: number, y: number) => void;
  setTouchSprint: (v: boolean) => void;
  triggerTouchHide: () => void;
  triggerTouchInteract: () => void;
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

// LUL-84: personal-best time survived, local only (no backend, no M4 telemetry).
// Guarded the same way as the rest of the project's client-only state (see
// useFullscreen above / LUL-26's panel persistence) -- `typeof window` first,
// then a try/catch around the actual localStorage calls so private-mode/quota
// rejections degrade to "no best to compare against" instead of a crash.
const BEST_TIME_KEY = 'lullwood:bestTimeSeconds';

function readBestTime(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BEST_TIME_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeBestTime(seconds: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BEST_TIME_KEY, String(seconds));
  } catch {
    // private mode / quota exceeded -- this run's time still renders, it just won't persist
  }
}

// Reacts to the `ended` flip (false -> true) exactly once per run, not on
// every re-render, even though winVisible/deathVisible stay true for the rest
// of the screen's lifetime. `best`/`isNewBest` are adjusted synchronously
// during render (the React-documented "adjusting state when a prop changes"
// pattern: https://react.dev/learn/you-might-not-need-an-effect) instead of
// from a useEffect, because setting state from inside an effect body triggers
// an extra cascading render for no benefit here. The actual localStorage
// write is the one genuine side effect, so that alone stays in a useEffect.
function useRunRecap(ended: boolean, survivedSeconds: number) {
  const [wasEnded, setWasEnded] = useState(ended);
  const [best, setBest] = useState<number | null>(() => readBestTime());
  const [isNewBest, setIsNewBest] = useState(false);

  if (ended !== wasEnded) {
    setWasEnded(ended);
    if (ended) {
      const beat = best == null || survivedSeconds > best;
      setIsNewBest(beat);
      if (beat) setBest(survivedSeconds);
    } else {
      setIsNewBest(false);
    }
  }

  useEffect(() => {
    if (isNewBest && best != null) writeBestTime(best);
  }, [isNewBest, best]);

  return { best, isNewBest };
}

function RunRecap({ survivedSeconds, best, isNewBest }: { survivedSeconds: number; best: number | null; isNewBest: boolean }) {
  return (
    <p id="runRecap">
      time survived: {formatDuration(survivedSeconds)}
      {isNewBest ? (
        <>
          {' '}
          — <span className="newBest">new best!</span>
        </>
      ) : best != null ? (
        <> · best: {formatDuration(best)}</>
      ) : null}
    </p>
  );
}

export default function Hud({
  state,
  actions,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
}) {
  const { supported: fullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const { best: bestTime, isNewBest } = useRunRecap(state.winVisible || state.deathVisible, state.survivedSeconds);

  return (
    <>
      {/* LUL-68: twin-stick touch controls (only renders on touch-capable viewports) */}
      <TouchControls actions={actions} entered={state.entered} />

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
        <button id="regen" onClick={() => actions?.regenMap()}>
          New map
        </button>
        {fullscreenSupported && (
          <button id="fullscreen" onClick={toggleFullscreen}>
            Fullscreen: {isFullscreen ? 'on' : 'off'}
          </button>
        )}
      </div>

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
          <div id="gateKeys">
            <b>WASD</b> — move &nbsp;·&nbsp; <b>mouse</b> — look &nbsp;·&nbsp; <b>Shift</b> — run
            <br />
            <b>H</b> — hide (bushes &amp; hollow logs only) &nbsp;·&nbsp; <b>E</b> — lift the child &nbsp;·&nbsp; <b>Esc</b> — menu
            <br />
            <span style={{ fontSize: 11, opacity: 0.7 }}>on mobile: left stick — move &nbsp;·&nbsp; right stick — look &nbsp;·&nbsp; Hide / E buttons</span>
          </div>
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

      {state.winVisible && (
        <div id="winScreen" style={{ display: 'flex' }}>
          <h1>YOU WON</h1>
          <p>the child is safe — you carried them home through the Lullwood</p>
          <RunRecap survivedSeconds={state.survivedSeconds} best={bestTime} isNewBest={isNewBest} />
          <button className="restartBtn" onClick={() => actions?.restart()}>
            Play again
          </button>
        </div>
      )}

      {state.deathVisible && (
        <div id="deathScreen" style={{ display: 'flex' }}>
          <div id="deathText" style={{ opacity: state.lossRevealed ? 1 : 0 }}>
            <h1>YOU LOSE</h1>
            <p>
              a <span id="deathKind">{state.deathKind}</span> caught you in the dark
            </p>
            <RunRecap survivedSeconds={state.survivedSeconds} best={bestTime} isNewBest={isNewBest} />
            <button className="restartBtn" onClick={() => actions?.restart()}>
              Try again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
