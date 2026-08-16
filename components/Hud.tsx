'use client';

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
  pace: 6,
  fog: 0.04,
  soundOn: true,
};

// The engine emits mist as the raw FogExp2 density it feeds Three; the panel's
// leading-dot format ('.040') is presentation and belongs here, not in the
// engine's state object.
const formatFog = (density: number) => density.toFixed(3).slice(1);

export default function Hud({
  state,
  actions,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
}) {
  return (
    <>
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
      </div>

      {!state.entered && (
        <div id="gate" onClick={() => actions?.enter()}>
          <div id="gateTitle">LULLWOOD</div>
          <div id="gateSub">a lost child is somewhere in the dark &nbsp;·&nbsp; click to enter</div>
          <div id="gateKeys">
            <b>WASD</b> — move &nbsp;·&nbsp; <b>mouse</b> — look &nbsp;·&nbsp; <b>Shift</b> — run
            <br />
            <b>H</b> — hold still (cover breaks line of sight) &nbsp;·&nbsp; <b>E</b> — lift the child &nbsp;·&nbsp; <b>Esc</b> — menu
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
            <button className="restartBtn" onClick={() => actions?.restart()}>
              Try again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
