'use client';

import { useEffect, useState } from 'react';
import type { EngineActions, EngineHudState } from './Hud';
import { isMobile } from '@/lib/input-mode';

// LUL-26: difficulty presets + accessibility, shipped together per the ticket.
// Difficulty/runMode/sensitivity/invertY/reducedMotion/captionsOn are engine
// state (see forest-engine.js's hudState) -- this panel only renders them and
// calls the matching action, the same controlled-input pattern the existing
// pace/mist sliders in Hud.tsx already use. `highContrast` has no engine-side
// effect (it's presentation only), so it stays local React state applied via
// a `document.body` dataset flag that GameCanvas.tsx's stylesheet keys off.
const SETTINGS_KEY = 'lullwood:settings';

interface PersistedSettings {
  difficulty: EngineHudState['difficulty'];
  runMode: EngineHudState['runMode'];
  sensitivity: number;
  invertY: boolean;
  reducedMotion: boolean;
  captionsOn: boolean;
  // LUL-2230: default on -- see readSettings()'s `?? true` below, since an
  // absent/never-persisted key must not read as "off" the way the other
  // boolean settings above correctly default to falsy.
  scentTrailVisible: boolean;
  // LUL-2307: default on, same `!== false` idiom as scentTrailVisible above.
  hintsEnabled: boolean;
  highContrast: boolean;
  // LUL-650: dev/tuning HUD (the #panel pace/mist/sound/regen/fullscreen
  // controls). Same presentation-only shape as highContrast -- no engine
  // action, applied via a document.body dataset flag. Defaults to OFF (see
  // readSettings() below): a player shouldn't see dev GUI unless they opt in.
  adminMode: boolean;
  // LUL-2309: the minimap became a player-facing navigation aid (home ring +
  // beacon colours, LUL-2248) and needs its own player-visible toggle rather
  // than riding along with the dev-only admin mode above. Same
  // presentation-only shape and falsy default idiom as adminMode/highContrast
  // (NOT the `!== false` default-on idiom scentTrailVisible/hintsEnabled use
  // above) -- a never-persisted key must read as OFF.
  showMinimap: boolean;
}

function readSettings(): Partial<PersistedSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedSettings>) : {};
  } catch {
    return {};
  }
}

function writeSettings(s: PersistedSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private mode / quota exceeded -- settings still apply for this session, just won't persist
  }
}

export default function SettingsPanel({
  state,
  actions,
  open,
  onClose,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
  open: boolean;
  onClose: () => void;
}) {
  // Presentation-only and not engine state, so it reads straight from
  // localStorage at mount instead of waiting on the engine-readiness effect
  // below like the other settings do -- there's no engine action for it to
  // wait for.
  const [highContrast, setHighContrast] = useState(() => !!readSettings().highContrast);
  // LUL-650: defaults OFF (`!!undefined` on a never-persisted key is `false`).
  const [adminMode, setAdminMode] = useState(() => !!readSettings().adminMode);
  // LUL-2309: defaults OFF, same idiom as adminMode above.
  const [showMinimap, setShowMinimap] = useState(() => !!readSettings().showMinimap);
  // LUL-1088: "(instead of hold Shift)" names a keyboard key that doesn't exist
  // on a touch device -- same isMobile() single source of truth every other
  // mobile surface uses (see components/OrientationGate.tsx).
  const mobile = useState(() => isMobile())[0];

  // Apply persisted settings once the engine is ready to receive them (mirrors
  // the rest of the codebase's `actions != null` readiness check -- see
  // TouchControls / the panel sliders in Hud.tsx). Runs once per engine
  // instance: `actions` only changes identity on mount/remount, never per-click.
  useEffect(() => {
    if (!actions) return;
    const s = readSettings();
    if (s.difficulty) actions.setDifficulty(s.difficulty);
    if (s.runMode) actions.setRunMode(s.runMode);
    if (typeof s.sensitivity === 'number') actions.setSensitivity(s.sensitivity);
    if (typeof s.invertY === 'boolean') actions.setInvertY(s.invertY);
    if (typeof s.reducedMotion === 'boolean') actions.setReducedMotion(s.reducedMotion);
    if (typeof s.captionsOn === 'boolean') actions.setCaptions(s.captionsOn);
    // LUL-2230: default on, so a never-persisted key (new player, or an
    // existing player's first load after this ships) doesn't turn the trail
    // off -- only an explicit `false` in storage does.
    actions.setScentTrailVisible(s.scentTrailVisible !== false);
    // LUL-2307: same default-on idiom as scentTrailVisible above.
    actions.setHintsEnabled(s.hintsEnabled !== false);
  }, [actions]);

  // Presentation-only: no engine action for this, so it's applied directly to
  // the DOM the same way engine code already does for LUL-144's cover
  // desaturation (`document.body.dataset.losCovered`).
  useEffect(() => {
    document.body.dataset.highContrast = highContrast ? '1' : '0';
  }, [highContrast]);

  useEffect(() => {
    document.body.dataset.adminMode = adminMode ? '1' : '0';
  }, [adminMode]);

  useEffect(() => {
    document.body.dataset.showMinimap = showMinimap ? '1' : '0';
  }, [showMinimap]);

  // Persist whenever any of these actually change -- after the apply-on-ready
  // effect above, so a mount with a stored `sensitivity: 1.4` doesn't get
  // immediately re-written as the engine's own default before it applies.
  useEffect(() => {
    writeSettings({
      difficulty: state.difficulty,
      runMode: state.runMode,
      sensitivity: state.sensitivity,
      invertY: state.invertY,
      reducedMotion: state.reducedMotion,
      captionsOn: state.captionsOn,
      scentTrailVisible: state.scentTrailVisible,
      hintsEnabled: state.hintsEnabled,
      highContrast,
      adminMode,
      showMinimap,
    });
  }, [
    state.difficulty,
    state.runMode,
    state.sensitivity,
    state.invertY,
    state.reducedMotion,
    state.captionsOn,
    state.scentTrailVisible,
    state.hintsEnabled,
    highContrast,
    adminMode,
    showMinimap,
  ]);

  if (!open) return null;

  return (
    <div id="settingsPanel" role="dialog" aria-label="Settings">
      <div id="settingsHeader">
        <h2>Settings</h2>
        <button onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <fieldset>
        <legend>Difficulty</legend>
        {(['lantern', 'night', 'blackout'] as const).map((d) => (
          <label key={d} className="radioRow">
            <input
              type="radio"
              name="difficulty"
              checked={state.difficulty === d}
              onChange={() => actions?.setDifficulty(d)}
            />
            {d === 'lantern' ? 'Lantern — forgiving' : d === 'night' ? 'Night — default' : 'Blackout — no mercy'}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Accessibility</legend>
        <label className="radioRow">
          <input
            type="checkbox"
            checked={state.runMode === 'toggle'}
            onChange={(e) => actions?.setRunMode(e.target.checked ? 'toggle' : 'hold')}
          />
          {mobile ? 'Toggle to run' : 'Toggle to run (instead of hold Shift)'}
        </label>
        <label className="sliderRow">
          Look sensitivity
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={state.sensitivity}
            onChange={(e) => actions?.setSensitivity(+e.target.value)}
          />
          <span>{state.sensitivity.toFixed(2)}×</span>
        </label>
        <label className="radioRow">
          <input type="checkbox" checked={state.invertY} onChange={(e) => actions?.setInvertY(e.target.checked)} />
          Invert look Y-axis
        </label>
        <label className="radioRow">
          <input
            type="checkbox"
            checked={state.reducedMotion}
            onChange={(e) => actions?.setReducedMotion(e.target.checked)}
          />
          Reduced motion (head bob, pickup camera swing, dust)
        </label>
        <label className="radioRow">
          <input
            type="checkbox"
            checked={state.captionsOn}
            onChange={(e) => actions?.setCaptions(e.target.checked)}
          />
          Captions for predator calls
        </label>
        <label className="radioRow">
          <input
            type="checkbox"
            checked={state.scentTrailVisible}
            onChange={(e) => actions?.setScentTrailVisible(e.target.checked)}
          />
          Show my scent trail
        </label>
        {/* LUL-2307: one-time first-encounter explanations (lake, bog, predators,
            stamina, ...) -- see docs/specs/lul-2307-first-encounter-hints.md. */}
        <label className="radioRow">
          <input
            type="checkbox"
            checked={state.hintsEnabled}
            onChange={(e) => actions?.setHintsEnabled(e.target.checked)}
          />
          Show hints
        </label>
        {/* Not a <label>: this row has no associated checkbox/radio, just the
            button itself -- reuses .radioRow purely for the row spacing/min-height. */}
        <div className="radioRow">
          <button type="button" onClick={() => actions?.resetHints()}>
            Reset hints
          </button>
        </div>
        <label className="radioRow">
          <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} />
          High-contrast HUD
        </label>
        <label className="radioRow">
          <input
            type="checkbox"
            checked={showMinimap}
            onChange={(e) => setShowMinimap(e.target.checked)}
          />
          Minimap
        </label>
        <label className="radioRow">
          <input type="checkbox" checked={adminMode} onChange={(e) => setAdminMode(e.target.checked)} />
          Admin mode (show pace/mist panel)
        </label>
        {/* Fog density already has an adjustable control -- the "Mist" slider
            in the main #panel (components/Hud.tsx) -- which is exactly the
            low-vision knob this ticket's spec asks for. Not duplicated here. */}
      </fieldset>
    </div>
  );
}
