'use client';

import { useEffect, useState } from 'react';
import Hud, { INITIAL_HUD_STATE, type EngineActions, type EngineHudState } from './Hud';

// CSS verbatim from the original single-file prototype (M2 wiki plan:
// game/port-plan) -- its lines 6-99. The prototype is no longer in the tree;
// README.md has the git ref to diff against. Only change from the source file:
// the death video's inline base64 data URI was swapped for /death.mp4
// (public/death.mp4). LUL-35 (pass 2) dropped one dead rule, `#status.danger`
// -- no code path has ever applied that class.
//
// LUL-34 (M2b): the gate/objective/status/win/death/panel *markup* moved out of
// this string and into <Hud> (components/Hud.tsx) as real JSX driven by engine
// state -- see that file. The rules below stay here because the elements Hud
// renders still use these ids/classes (#gate, #objective, .ready, #status,
// .hiding, #winScreen, #deathScreen, #deathText, #panel, .restartBtn, ...), and
// splitting one stylesheet across two files for no reason would just make it
// harder to diff against the original CSS.
const OVERLAY_STYLE = `
  html, body { height: 100%; margin: 0; background: #0a0e15; overflow: hidden;
    font-family: ui-sans-serif, system-ui, sans-serif; color: #b9c8dd; }
  canvas { display: block; }

  #vignette { position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(120% 90% at 50% 44%, transparent 45%, rgba(0,0,0,0.6) 100%); }

  /* entry / pause gate */
  #gate { position: fixed; inset: 0; z-index: 20; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: rgba(6,9,15,0.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    cursor: pointer; text-align: center; padding: 24px; }
  #gateTitle { font-size: 40px; font-weight: 400; letter-spacing: 0.18em;
    color: #d7e4f6; text-shadow: 0 2px 30px rgba(120,160,230,0.35); }
  #gateSub { font-size: 14px; letter-spacing: 0.06em; color: #9fb2cd; }
  #gateKeys { margin-top: 18px; font-size: 12px; line-height: 2; color: #7f92ad;
    letter-spacing: 0.03em; }
  #gateKeys b { color: #b7c7de; font-weight: 500; }

  #hint { position: fixed; top: 20px; left: 0; right: 0; text-align: center;
    font-size: 12px; letter-spacing: 0.05em; color: #9fb2cd; pointer-events: none;
    text-shadow: 0 1px 8px rgba(0,0,0,0.8); transition: opacity 1.4s ease; opacity: 0; }

  #minimap { position: fixed; top: 16px; right: 16px; z-index: 10;
    width: 160px; height: 160px; border-radius: 10px;
    border: 1px solid rgba(150,175,215,0.18); background: rgba(10,14,21,0.5);
    box-shadow: 0 6px 24px rgba(0,0,0,0.4); }

  #panel { position: fixed; left: 16px; bottom: 16px; z-index: 10;
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 12px 16px; border-radius: 12px;
    background: rgba(12,17,26,0.62); border: 1px solid rgba(150,175,215,0.16);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    font-size: 12px; color: #b9c8dd; }
  #panel label { display: flex; align-items: center; gap: 8px; user-select: none; }
  #panel span { min-width: 30px; opacity: 0.7; }
  #panel input[type="range"] { width: 84px; accent-color: #7fa6dd; cursor: pointer; }
  #panel button { font: inherit; color: #cdd9ea; cursor: pointer;
    background: rgba(150,175,215,0.10); border: 1px solid rgba(150,175,215,0.20);
    border-radius: 8px; padding: 6px 12px; }
  #panel button:hover { background: rgba(150,175,215,0.18); }
  #panel :focus-visible { outline: 2px solid #7fa6dd; outline-offset: 2px; }

  /* shown when pointer lock is released — visual only, never blocks the panel */
  #pausePrompt { position: fixed; inset: 0; z-index: 15; display: none;
    align-items: center; justify-content: center; pointer-events: none;
    background: radial-gradient(120% 90% at 50% 50%, rgba(6,9,15,0.35), rgba(6,9,15,0.72));
    font-size: 15px; letter-spacing: 0.08em; color: #cdd9ea;
    text-shadow: 0 2px 20px rgba(0,0,0,0.8); }

  /* objective banner */
  #objective { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 12;
    display: none; padding: 8px 18px; border-radius: 999px; white-space: nowrap;
    background: rgba(12,17,26,0.6); border: 1px solid rgba(150,175,215,0.16);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    font-size: 13px; letter-spacing: 0.04em; color: #d7c3b0;
    text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
  #objective.ready { color: #ffdca8; border-color: rgba(255,200,140,0.45); }

  /* win screen */
  #winScreen { position: fixed; inset: 0; z-index: 25; display: none;
    flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    text-align: center; padding: 24px;
    background: radial-gradient(120% 90% at 50% 42%, rgba(34,20,12,0.72), rgba(6,7,12,0.86)); }
  #winScreen h1 { margin: 0; font-size: 40px; font-weight: 400; letter-spacing: 0.14em;
    color: #ffe6c8; text-shadow: 0 2px 44px rgba(255,190,130,0.5); }
  #winScreen p { margin: 0 0 8px; font-size: 15px; letter-spacing: 0.05em; color: #cbb7a4; }
  .restartBtn { font: inherit; font-size: 15px; letter-spacing: 0.06em; color: #2a1a10; cursor: pointer;
    background: #f0c79a; border: none; border-radius: 10px; padding: 10px 24px; margin-top: 8px; }
  .restartBtn:hover { background: #f6d3ac; }
  .restartBtn:focus-visible { outline: 2px solid #ffe6c8; outline-offset: 3px; }

  /* status line (hiding / hunted) */
  #status { position: fixed; bottom: 74px; left: 50%; transform: translateX(-50%); z-index: 12;
    display: none; padding: 7px 16px; border-radius: 999px; white-space: nowrap;
    background: rgba(12,17,26,0.6); border: 1px solid rgba(150,175,215,0.16);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    font-size: 13px; letter-spacing: 0.03em; text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
  #status.hiding { color: #9fd7b0; border-color: rgba(120,200,150,0.4); }

  /* death: video cutscene + loss text */
  #spotFlash { position: fixed; inset: 0; z-index: 12; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 50% 45%, rgba(255,20,20,0) 40%, rgba(200,0,0,0.5) 100%); }
  #flash { position: fixed; inset: 0; z-index: 23; pointer-events: none; opacity: 0; background: #fff; }
  #deathVideo { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover;
    z-index: 24; display: none; background: #000; pointer-events: none; }
  #deathScreen { position: fixed; inset: 0; z-index: 25; display: none;
    align-items: center; justify-content: center; text-align: center; padding: 24px;
    background: rgba(4,3,5,0); pointer-events: none; }
  #deathText { opacity: 0; transition: opacity 0.9s ease; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: auto; }
  #deathText h1 { margin: 0; font-size: 44px; font-weight: 400; letter-spacing: 0.2em;
    color: #e8554a; text-shadow: 0 2px 50px rgba(255,40,30,0.5); }
  #deathText p { margin: 0 0 8px; font-size: 15px; letter-spacing: 0.05em; color: #b98f88; }
`;

// Elements still owned directly by the engine (getElementById, out of LUL-34's
// scope) -- everything else from the original overlay now lives in <Hud>.
const OVERLAY_MARKUP = `
<div id="vignette"></div>
<div id="spotFlash"></div>
<div id="flash"></div>
<canvas id="minimap" width="160" height="160"></canvas>
<div id="hint">move the mouse to look &nbsp;·&nbsp; WASD to walk</div>
<div id="pausePrompt">click to look around</div>
<video id="deathVideo" muted playsinline preload="auto" src="/death.mp4"></video>
`;

export default function GameCanvas() {
  const [hud, setHud] = useState<EngineHudState>(INITIAL_HUD_STATE);
  const [actions, setActions] = useState<EngineActions | null>(null);

  useEffect(() => {
    // The engine is a bundled module now (LUL-28), so there is no <script> tag
    // to inject and no `window.THREE` global to install first. The import still
    // belongs inside the effect rather than at module top level: the engine
    // touches `document` as soon as it evaluates, and keeping it dynamic means
    // three + the engine land in their own chunk instead of the entry bundle.
    //
    // `cancelled` guards StrictMode's double-invoke -- the effect can be torn
    // down before this promise settles, and calling init() after that would
    // strand a live engine that no cleanup will ever dispose.
    let cancelled = false;
    // LUL-35 (pass 2): teardown used to go through `window.ForestEngine.dispose()`,
    // a second way into the same function that contradicted the engine's own
    // claim that the global is a QA/debug surface only. Holding the imported
    // `dispose` here keeps one path in and one path out, and doubles as the
    // "did this mount actually start an engine?" flag the cleanup needs.
    let disposeEngine: (() => void) | null = null;

    import('@/engine/forest-engine').then(({ init, dispose }) => {
      if (cancelled) return;
      // LUL-34: init() now takes a state-change callback and returns the
      // engine's action API (enter/restart/setPace/...) instead of nothing --
      // see engine/forest-engine.js's own comment on `emitState`/`pushState`.
      setActions(init(setHud));
      disposeEngine = dispose;
    });

    return () => {
      cancelled = true;
      // Only tear down an engine this mount actually started.
      if (disposeEngine) {
        disposeEngine();
        setActions(null);
        setHud(INITIAL_HUD_STATE);
      }
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: OVERLAY_MARKUP }} />
      <Hud state={hud} actions={actions} />
    </>
  );
}
