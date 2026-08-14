'use client';

import { useEffect, useRef } from 'react';

// Verbatim from game/forest.html (M2 wiki plan: game/port-plan) -- CSS lines 6-99,
// body markup lines 102-142. Not refactored per LUL-13 scope: M1 ports as-is,
// module decomposition is M2 (LUL-9). Only change from the source file: the death
// video's inline base64 data URI was swapped for /death.mp4 (public/death.mp4).
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
  #status.danger { color: #ff9a86; border-color: rgba(255,120,90,0.5); }

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

const OVERLAY_MARKUP = `
<div id="vignette"></div>
<div id="spotFlash"></div>
<div id="flash"></div>
<canvas id="minimap" width="160" height="160"></canvas>
<div id="hint">move the mouse to look &nbsp;·&nbsp; WASD to walk</div>

<div id="panel">
  <label>Pace <input id="pace" type="range" min="2" max="12" step="0.5" value="6"><span id="paceVal">6</span></label>
  <label>Mist <input id="fog" type="range" min="0.02" max="0.11" step="0.005" value="0.045"><span id="fogVal">.045</span></label>
  <button id="sound">Sound: on</button>
  <button id="regen">New map</button>
</div>

<div id="gate">
  <div id="gateTitle">LULLWOOD</div>
  <div id="gateSub">a lost child is somewhere in the dark &nbsp;·&nbsp; click to enter</div>
  <div id="gateKeys">
    <b>WASD</b> — move &nbsp;·&nbsp; <b>mouse</b> — look &nbsp;·&nbsp; <b>Shift</b> — run<br>
    <b>H</b> — hide from predators &nbsp;·&nbsp; <b>E</b> — lift the child &nbsp;·&nbsp; <b>Esc</b> — menu
  </div>
</div>

<div id="pausePrompt">click to look around</div>

<div id="objective"></div>
<div id="status"></div>

<div id="winScreen">
  <h1>YOU WON</h1>
  <p>the child is safe — you carried them home through the Lullwood</p>
  <button class="restartBtn">Play again</button>
</div>

<video id="deathVideo" muted playsinline preload="auto" src="/death.mp4"></video>
<div id="deathScreen">
  <div id="deathText">
    <h1>YOU LOSE</h1>
    <p>a <span id="deathKind">wolf</span> caught you in the dark</p>
    <button class="restartBtn">Try again</button>
  </div>
</div>
`;

const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const ENGINE_SRC = '/forest-engine.js';

export default function GameCanvas() {
  const startedRef = useRef(false);

  useEffect(() => {
    // The engine (public/forest-engine.js) registers listeners and starts an
    // unconditional rAF loop with no teardown -- it was never built to be mounted
    // twice. Guard against StrictMode's double-effect in dev (also see
    // next.config.ts, which turns StrictMode off for the same reason).
    if (startedRef.current) return;
    startedRef.current = true;

    const threeScript = document.createElement('script');
    threeScript.src = THREE_SRC;
    threeScript.onload = () => {
      const engineScript = document.createElement('script');
      engineScript.src = ENGINE_SRC;
      document.body.appendChild(engineScript);
    };
    document.body.appendChild(threeScript);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: OVERLAY_MARKUP }} />
    </>
  );
}
