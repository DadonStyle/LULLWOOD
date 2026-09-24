'use client';

import { useEffect, useState } from 'react';
import Hud, { INITIAL_HUD_STATE, type EngineActions, type EngineHudState } from './Hud';
import WelcomeSplash from './WelcomeSplash';
import { track, startSessionTracking } from '@/lib/analytics';
import { initTelemetryTransport } from '@/lib/telemetry-transport';
import { isMobile } from '@/lib/input-mode';
import { assertEngineContract } from '@/lib/engine-contract';

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
// renders still use these ids/classes (#gate, #winScreen, #deathScreen,
// #deathText, #panel, .restartBtn, ...), and splitting one stylesheet across
// two files for no reason would just make it harder to diff against the
// original CSS. LUL-2312: #objective/#actionPrompt/#throwPrompt/#chargePrompt/
// #status are gone from this list -- see #actionSlot/.actionPromptRow below.
const OVERLAY_STYLE = `
  html, body { height: 100%; margin: 0; background: #0a0e15; overflow: hidden;
    overscroll-behavior: none; touch-action: manipulation;
    font-family: ui-sans-serif, system-ui, sans-serif; color: #b9c8dd;
    /* LUL-2312: shared tokens for every ActionPrompt row (components/
       ActionPrompt.tsx) -- see the #actionSlot comment further down for what
       each one means. Declared here, unconditionally and first in source
       order, so the mobile/short-viewport overrides below (which only set
       these on a matching media query) always win when they match -- a
       custom property's cascade follows normal specificity/source-order
       rules same as any other declaration, so the override must come later
       in the stylesheet than this default. */
    --action-pill-bg: rgba(12,17,26,0.6);
    --action-pill-border-calm: rgba(150,175,215,0.16);
    --action-pill-border-ready: rgba(255,200,140,0.45);
    --action-pill-border-status: rgba(120,200,150,0.4);
    --action-pill-color-calm: #d7c3b0;
    --action-pill-color-ready: #ffdca8;
    --action-pill-color-status: #9fd7b0;
    --action-pill-key-bg: #f0c79a;
    --action-pill-key-color: #1a1006;
    --action-pill-key-shadow: 0 2px 20px rgba(240,199,154,0.6);
    --action-pill-urgent-bg: #e8554a;
    --action-pill-urgent-shadow: 0 2px 26px rgba(232,85,74,0.85);
    --action-slot-row: 36px;
    --action-slot-row-charge: 48px;
    --action-slot-gap: 6px;
    --action-slot-bottom: 24px;
    --action-slot-height: calc(var(--action-slot-row-charge) + (5 * var(--action-slot-row)) + (5 * var(--action-slot-gap))); }
  canvas { display: block; }

  #vignette { position: fixed; inset: 0; z-index: 1; pointer-events: none;
    background: radial-gradient(120% 90% at 50% 44%, transparent 45%, rgba(0,0,0,0.6) 100%); }

  /* entry / pause gate */
  #gate { position: fixed; inset: 0; z-index: 20; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: rgba(6,9,15,0.72); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    cursor: pointer; text-align: center; padding: 24px; }
  #gateTitle { font-size: 40px; font-weight: 400; letter-spacing: 0.18em;
    color: #d7e4f6; text-shadow: 0 2px 30px rgba(120,160,230,0.35); }
  #gateSub { font-size: 14px; letter-spacing: 0.06em; color: #9fb2cd; }
  #gateCredit { font-size: 12px; letter-spacing: 0.04em; color: #6f82a0; }
  #gateKeys { margin-top: 18px; font-size: 12px; line-height: 2; color: #7f92ad;
    letter-spacing: 0.03em; max-width: 34rem; margin-inline: auto; }
  #gateKeys b { color: #b7c7de; font-weight: 500; }

  /* LUL-920: was top: 20px, same as #objective below -- the two sat directly on
     top of each other for the ~5s the hint is visible after entering. Dropped
     below the objective pill's rendered height (~20px top + ~34px pill) on both
     desktop and mobile; nothing else occupies this band. */
  #hint { position: fixed; top: 64px; left: 0; right: 0; z-index: 1; text-align: center;
    font-size: 12px; letter-spacing: 0.05em; color: #9fb2cd; pointer-events: none;
    text-shadow: 0 1px 8px rgba(0,0,0,0.8); transition: opacity 1.4s ease; opacity: 0; }
  /* LUL-2158 (LUL-2147 finding): #hint is engine-owned (forest-engine.js's enter()
     sets opacity 0.85 and fades it out 5s later, out of CSS's control and out of
     this ticket's scope to touch) -- a fast second death restarts that 5s timer
     (restart() calls enter()) and can land the death/win screen while the hint is
     still mid-fade-in. #deathText has no opaque backdrop of its own (unlike
     #winText's gradient), so the hint's text visibly overlapped "YOU LOSE" (94%
     box coverage, mobile-pixel5/iphone-se landscape). :has() reacts purely to
     whichever end screen React has actually mounted, with no engine change.
     transition: none is deliberate -- an opacity fade here would still overlap
     for up to 1.4s; the hint must be gone the instant the screen mounts. */
  body:has(#winScreen) #hint,
  body:has(#deathScreen) #hint { opacity: 0 !important; transition: none !important; }

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

  /* LUL-198: on touch/narrow viewports, MobileControls (components/MobileControls.tsx)
     draws an always-present movement stick + E button in this same bottom-left
     corner at z-index 30, above #panel's z-index 10 -- the stick's 128px hit
     region could sit directly over Sound/New map/Fullscreen. Lift #panel clear of
     that band instead of fighting it with z-index: 24px wrapper bottom + 128px
     stick + 10px gap + 56px E button + margin. LUL-276: this condition has to
     stay byte-for-byte in sync with lib/input-mode.ts's isMobile() (max-width
     768px fallback, OR (pointer: coarse) and (hover: none) -- CSS supports the
     same media features JS's matchMedia does), or LUL-198's overlap returns
     for viewports isMobile() calls mobile that this query doesn't catch. */
  @media (max-width: 768px), (pointer: coarse) and (hover: none) {
    /* LUL-2312: one shared clearance value for every bottom-centre HUD piece
       that has to clear the mobile control row (z-index 30, bottom:
       24px+safe-area) -- #panel and #actionSlot used to restate 240px
       independently (LUL-1089), which is exactly the kind of duplicated magic
       number LUL-1779 kept tripping over. #actionSlot's own rule picks this up
       via bottom: var(--action-slot-bottom). */
    body { --action-slot-bottom: 240px; }
    #panel { bottom: var(--action-slot-bottom); }
    /* LUL-69: ~44px is the standard (WCAG 2.5.5 / Apple HIG / Material)
       minimum touch-target side -- desktop's 6px/12px padding at 12px font
       sits well under that, and the founder's own complaint was "HUD sized
       for desktop". Bumping padding/font was meant to grow the box height
       comfortably past 44px without a hardcoded min-height fighting the
       button's own content -- but LUL-1088 measured #settingsBtn (a #panel
       button) at 78x43 on a real Pixel 5, one pixel under the claim above.
       Padding/font growth alone is text-metric-dependent and not reliable;
       min-height is the actual guarantee. */
    #panel button { padding: 13px 16px; font-size: 14px; min-height: 48px; }
    #panel label, #panel span { font-size: 13px; }
    #panel input[type="range"] { width: 64px; }
    /* LUL-1088: the settings X close button measured 28x26 on a real Pixel 5. */
    #settingsHeader button { min-width: 44px; min-height: 44px; }
    /* LUL-529: same 44px rationale as #panel button above -- 10px/24px at
       15px font sits well under it, and this is the only tap a player has on
       the win/death screen.
       LUL-1088 CASCADE-ORDER BUG: this override has always been dead. The
       unconditional .restartBtn rule near the bottom of this stylesheet
       (search "win screen") has identical selector specificity and comes
       LATER in source order, so *it* wins here too, even inside this media
       query -- padding/font-size below never actually apply on mobile. The
       fix lives on that later rule (a min-height: 48px added there, since
       min-height is the one property this override doesn't declare and so
       is not itself shadowed) rather than here. Do not "clean up" by
       reordering these two rules without re-verifying which one wins. */
    .restartBtn { padding: 15px 24px; font-size: 16px; }
    /* LUL-1043: same 44px rationale -- the Deeper Lungs buy button. */
    .buyBtn { padding: 13px 18px; font-size: 14px; }
    #gateTitle { font-size: 26px; }
    #gateSub { font-size: 12px; }
    /* LUL-3255: was 11px, under lib/ui/hygiene.ts's 12px MIN_FONT_PX floor --
       flagged every prod QA run on both landscape mobile viewports. Plenty of
       vertical slack on #gate (see the ticket's screenshot), so no compensating
       trim needed here. */
    #gateCredit { font-size: 12px; }
    #gateKeys { font-size: 12px; line-height: 1.7; max-width: 34rem; margin-inline: auto; }
    /* Minimap stays legible at the same physical size rather than shrinking
       further -- on a ~390px-wide phone it's already a larger fraction of
       the screen than on desktop, which is the point (small map = useless
       map): shrinking it to "save space" would fight the same "legible on a
       phone screen" requirement this block exists for. */
    /* LUL-1935: MobileControls' Pause button (pauseWrapper) is fixed at
       top: calc(16px + env(safe-area-inset-top)), left: calc(16px + ...),
       44px circle + 1.5px border -- bottom edge lands at ~63px + the inset.
       #missionPanel defaults to that identical top:16/left:16 corner, so on
       mobile (any width, any orientation -- this query catches landscape
       too, unlike a bare max-width check) it sat directly under the button
       and got covered. Push it below the button with a clear gap instead of
       moving Pause -- Pause's corner is deliberately chosen for reachability
       (see MobileControls.tsx LUL-529 comment); #missionPanel is
       pointer-events:none display text with no touch target of its own, so
       it's the one with nothing to lose by moving. */
    #missionPanel { top: calc(76px + env(safe-area-inset-top)); }
  }

  /* LUL-2612: first-visit marketing splash, WelcomeSplash.tsx. z-index 60 is
     the highest of any overlay -- it has to sit above #orientationGate (50)
     too, since a first-time visitor should see the studio credit before
     "rotate your phone", not after. Card + 9999px-spread backdrop, same
     trick as #settingsPanel below. */
  #welcomeSplash { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 60;
    width: min(560px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); overflow-y: auto;
    padding: 28px 26px; border-radius: 14px; text-align: left;
    background: rgba(14,19,29,0.97); border: 1px solid rgba(150,175,215,0.22);
    box-shadow: 0 0 0 9999px rgba(6,9,15,0.88), 0 20px 60px rgba(0,0,0,0.5);
    font-size: 14px; line-height: 1.6; color: #b9c8dd; }
  #welcomeSplash h1 { margin: 0 0 12px; font-size: 26px; font-weight: 400;
    letter-spacing: 0.08em; color: #d7e4f6; }
  #welcomeSplash p { margin: 0 0 12px; }
  #welcomeSplash .welcomeSplashStudio { font-size: 16px; letter-spacing: 0.02em; color: #ffdca8; }
  #welcomeSplash .welcomeSplashStudio strong { font-weight: 700; }
  #welcomeSplashDismiss { display: block; margin: 18px auto 0; font: inherit; font-size: 14px;
    letter-spacing: 0.05em; color: #1a1006; background: #f0c79a; border: none;
    border-radius: 8px; padding: 12px 22px; cursor: pointer; min-height: 44px; }
  #welcomeSplashDismiss:hover { filter: brightness(1.08); }
  #welcomeSplashDismiss:focus-visible { outline: 2px solid #7fa6dd; outline-offset: 2px; }
  @media (max-width: 480px) {
    #welcomeSplash { font-size: 13px; padding: 22px 20px; }
    #welcomeSplash h1 { font-size: 22px; }
  }

  /* LUL-69: mobile-only, portrait-only -- see components/OrientationGate.tsx.
     z-index 50 sits above every other overlay besides #welcomeSplash (60,
     LUL-2612 -- the marketing splash outranks even the rotate prompt since
     it's a first-time visitor's very first screen) so it blocks input to the
     canvas, the gate, and MobileControls' sticks/buttons underneath, without
     needing to unmount any of them. */
  #orientationGate { position: fixed; inset: 0; z-index: 50; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    background: rgba(6,9,15,0.94); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    text-align: center; padding: 24px; color: #d7e4f6; }
  #orientationGateIcon { font-size: 48px; animation: rotateHint 1.6s ease-in-out infinite; }
  #orientationGate p { margin: 0; font-size: 15px; letter-spacing: 0.04em; max-width: 280px; }
  @keyframes rotateHint { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-90deg); } }

  /* LUL-26: difficulty presets + accessibility dialog. The 9999px spread is
     the standard trick for a full-viewport dim without a second DOM node --
     SettingsPanel.tsx renders one #settingsPanel element, not a card plus a
     backdrop. */
  #settingsPanel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 40;
    width: min(420px, calc(100vw - 48px)); max-height: calc(100vh - 48px); overflow-y: auto;
    /* LUL-529: 100vh is the *largest* possible viewport on mobile Safari/Chrome
       (toolbar collapsed) -- while the toolbar is showing, a dialog sized off
       it can size taller than what's actually visible, pushing its own top
       edge (this box is centered via top:50%) off-screen. 100dvh tracks the
       real, current visible height; the 100vh rule above stays as the
       fallback for browsers with no dvh support. */
    max-height: calc(100dvh - 48px);
    padding: 20px 22px; border-radius: 14px;
    background: rgba(14,19,29,0.94); border: 1px solid rgba(150,175,215,0.22);
    box-shadow: 0 0 0 9999px rgba(6,9,15,0.72), 0 20px 60px rgba(0,0,0,0.5);
    font-size: 13px; color: #b9c8dd; }
  #settingsHeader { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  #settingsHeader h2 { margin: 0; font-size: 16px; font-weight: 500; letter-spacing: 0.06em; color: #d7e4f6; }
  #settingsHeader button { font: inherit; font-size: 16px; color: #cdd9ea; cursor: pointer;
    background: transparent; border: none; padding: 4px 8px; border-radius: 6px; }
  #settingsHeader button:hover { background: rgba(150,175,215,0.14); }
  #settingsPanel fieldset { border: 1px solid rgba(150,175,215,0.16); border-radius: 10px;
    padding: 10px 14px 14px; margin: 0 0 14px; }
  #settingsPanel legend { padding: 0 6px; font-size: 11px; letter-spacing: 0.08em;
    text-transform: uppercase; color: #9fb2cd; }
  #settingsPanel .radioRow, #settingsPanel .sliderRow { display: flex; align-items: center;
    gap: 8px; padding: 6px 0; user-select: none; }
  #settingsPanel .sliderRow { justify-content: space-between; }
  #settingsPanel .sliderRow input[type="range"] { flex: 1; accent-color: #7fa6dd; cursor: pointer; }
  #settingsPanel .sliderRow span { min-width: 40px; text-align: right; opacity: 0.7; }
  /* LUL-1088: the checkbox/radio itself only needs to be visually >=24px --
     pointer-events: none hands every click to the wrapping <label class="radioRow">
     instead (a label always forwards a click to its associated control, with
     or without pointer-events on that control), so the ROW below is the real
     tap target the touch-target audit measures, not this glyph. */
  #settingsPanel input[type="checkbox"], #settingsPanel input[type="radio"] {
    accent-color: #7fa6dd; cursor: pointer; width: 24px; height: 24px; pointer-events: none; }
  /* LUL-1088: min-height 48px makes the row itself the >=44px touch target
     (WCAG 2.5.5 / Apple HIG / Material, same rationale as #panel button's
     LUL-69 comment above); cursor: pointer marks it as the real tappable
     surface now that the checkbox/radio glyph inside it is pointer-events: none. */
  #settingsPanel .radioRow { min-height: 48px; cursor: pointer; }
  #settingsPanel :focus-visible { outline: 2px solid #7fa6dd; outline-offset: 2px; }

  /* LUL-1088: a landscape phone (e.g. Pixel 5 at 851x393) is short, not
     narrow -- #settingsPanel's own max-height: calc(100dvh - 48px) already
     caps it around 345px there, well under the two fieldsets' stacked height
     once every row above is a >=48px touch target. Laying the two fieldsets
     (Difficulty, Accessibility) out side by side instead of stacked is what
     actually buys back the vertical space; width is untouched (still
     min(420px, 100vw - 48px)), so this is purely a height-triggered query,
     independent of the width/pointer mobile query above. */
  @media (max-height: 500px) {
    #settingsPanel { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14px; align-content: start; }
    #settingsHeader { grid-column: 1 / -1; }
    #settingsPanel fieldset { margin: 0; }
  }

  /* LUL-26/LUL-2312: closed captions for predator calls -- every sound in this
     game is synthesized WebAudio with no other track, so this is the sole
     warning channel for a player who can't hear it. Rendered as an
     <ActionPrompt tone="status"> (Hud.tsx) -- .actionPromptLine supplies the
     pill chrome and its own mount fade, so this rule is positioning only: a
     row above #actionSlot, offset by the slot's own (variable) height so the
     two can never collide regardless of how many action-slot rows are
     currently populated. */
  #captionToast { position: fixed; left: 50%; transform: translateX(-50%); z-index: 14;
    bottom: calc(var(--action-slot-bottom) + var(--action-slot-height) + 10px);
    pointer-events: none; }

  /* LUL-26: high-contrast HUD. Presentation only -- SettingsPanel.tsx toggles
     this via document.body.dataset.highContrast, the same direct-DOM pattern
     LUL-144's cover desaturation already uses (data-los-covered). Brightens
     HUD chrome only; the WebGL scene itself is untouched. */
  /* LUL-2312: every #objective/#status/#actionPrompt/#throwPrompt/#captionToast
     high-contrast override collapses onto the shared .actionPromptRow/
     .actionPromptLine classes -- data-tone carries the same distinction the old
     per-id overrides did (ready==objective.ready/actionPrompt's calm state,
     urgent==actionPrompt.urgent, status==status.hiding, now also captionToast). */
  body[data-high-contrast="1"] #panel,
  body[data-high-contrast="1"] .actionPromptLine,
  body[data-high-contrast="1"] #settingsPanel { background: rgba(4,6,10,0.92); border-color: rgba(255,255,255,0.55); color: #f4f8ff; }
  body[data-high-contrast="1"] .actionPromptRow[data-tone="ready"] .actionPromptLine { color: #ffe6b0; border-color: #ffcf7a; }
  body[data-high-contrast="1"] .actionPromptRow[data-tone="urgent"] .actionPromptLine { color: #ff9f9f; border-color: #ff6b6b; }
  body[data-high-contrast="1"] .actionPromptRow[data-tone="status"] .actionPromptLine { color: #baffcf; border-color: #6fe89a; }

  /* LUL-650: admin mode. Presentation only, same dataset-flag pattern as
     high-contrast above -- SettingsPanel.tsx toggles document.body.dataset.adminMode.
     Default OFF hides the tuning/dev HUD (#panel's pace/mist/sound/regen/fullscreen
     controls); ON is today's behaviour, unchanged.
     LUL-650/LUL-656 originally carved #settingsBtn and #lightState/#veilState out
     of this rule so a player who turned admin mode off wouldn't lose Settings or
     the hold-to-veil readout. LUL-1085 (hamburger-menu migration) superseded that:
     #settingsBtn moved out of #panel entirely into components/GameMenu.tsx, and
     #panel was re-scoped to dev-only monitoring (pace/fog/lightState/veilState/
     embersBalance) with no exemption selector. There is no carve-out left --
     every #panel child, #lightState/#veilState included, is hidden by default
     (LUL-1824/game/lul1724-panel-dev-only-finding). The real player-facing tell
     for veil/light is the in-world vignette dim + fog billow, not this HUD. */
  body[data-admin-mode="0"] #panel { display: none !important; }

  /* LUL-4341: reverts LUL-2309's standalone player-facing minimap toggle --
     the leaderboard record (LUL-3264) is Blackout-only, no minimap, no admin
     mode, and a speed record isn't meaningful if half the field ran with a
     map on screen. Minimap is admin-gated again, same rule shape as #panel
     above. !important still needed: the engine writes its own inline
     mm.style.display (blackout difficulty preset, forest-engine.js) -- when
     this rule doesn't apply (admin mode is on), that inline style is what
     correctly still hides the minimap under blackout. */
  body[data-admin-mode="0"] #minimap { display: none !important; }

  /* shown when pointer lock is released — visual only, never blocks the panel */
  #pausePrompt { position: fixed; inset: 0; z-index: 15; display: none;
    align-items: center; justify-content: center; pointer-events: none;
    background: radial-gradient(120% 90% at 50% 50%, rgba(6,9,15,0.35), rgba(6,9,15,0.72));
    font-size: 15px; letter-spacing: 0.08em; color: #cdd9ea;
    text-shadow: 0 2px 20px rgba(0,0,0,0.8); }

  /* LUL-1258: M2 Deepwater's minimal mission panel -- two collapsed lines,
     top-left, per decisions/missions-accepted-2026-09-01 §2. Small and
     read-only (no touch target). LUL-1935: it does need a mobile override --
     MobileControls' Pause button (components/MobileControls.tsx pauseWrapper)
     is fixed to that exact same top:16/left:16 corner, so on mobile the two
     sit on top of each other regardless of how short the mission text is.
     See the mobile media query below for the fix.
     LUL-1942: pushed past #gameMenu's 48px toggle button (components/GameMenu.tsx,
     also top:16/left:16) so the pill no longer prints under the hamburger icon --
     this held on every viewport/state the QA layout audit measured, not just
     mobile, since #gameMenu is never hidden or repositioned on desktop. */
  #missionPanel { position: fixed; top: 76px; left: 16px; z-index: 10;
    display: flex; align-items: center; gap: 8px; pointer-events: none;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(12,17,26,0.55); border: 1px solid rgba(150,175,215,0.14);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    font-size: 12px; letter-spacing: 0.04em; color: #b9c8dd;
    text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
  #missionGlyph { color: #7fa6dd; }

  /* LUL-1904: cave detection-immunity countdown -- always visible while active,
     top-center below #objective so it never overlaps the mission panel or the
     wind indicator. */
  #caveImmunePanel { position: fixed; top: 56px; left: 50%; transform: translateX(-50%); z-index: 12;
    padding: 6px 14px; border-radius: 999px; pointer-events: none;
    background: rgba(20,40,36,0.6); border: 1px solid rgba(111,214,196,0.4);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    font-size: 13px; letter-spacing: 0.04em; color: #a8f0e0;
    text-shadow: 0 1px 6px rgba(0,0,0,0.7); }

  #windIndicator { position: fixed; top: 20px; right: 20px; z-index: 12;
    font-size: 28px; color: #ddd; text-shadow: 0 0 4px rgba(0,0,0,0.6);
    transform-origin: 50% 50%; pointer-events: none; }

  /* LUL-3009: Threat Beacon -- active per-moment pulse on top of the arrow's always-on
     direction (Hud.tsx toggles the class while state.movingAgainstWind, skipped entirely
     under reducedMotion, same precedent as .veilRefillFlash above it). Pulses filter, not
     transform -- #windIndicator's own inline style.transform does the rotation (Hud.tsx),
     and a CSS animation on transform would replace that inline value outright instead of
     composing with it. */
  #windIndicator.windIndicatorActive { animation: windIndicatorPulse 900ms ease-in-out infinite; }
  @keyframes windIndicatorPulse {
    0%, 100% { filter: brightness(1) drop-shadow(0 0 0 rgba(168,240,224,0)); }
    50% { filter: brightness(1.6) drop-shadow(0 0 8px rgba(168,240,224,0.9)); } }

  #windIndicatorHint { position: fixed; top: 64px; right: 8px; width: 76px; z-index: 12;
    font-size: 12px; line-height: 1.3; text-align: center; color: #9fb2cd;
    text-shadow: 0 1px 6px rgba(0,0,0,0.8); pointer-events: none; opacity: 1; }

  /* LUL-1912's minimap-clearance push only matters while the minimap is actually
     visible -- top:20/right:20 above is what a player with admin mode off (the
     default) and the QA tester actually see. LUL-4341: keyed back off
     data-admin-mode="1" now that minimap visibility is admin-gated again. */
  body[data-admin-mode="1"] #windIndicator { top: 184px; }
  body[data-admin-mode="1"] #windIndicatorHint { top: 228px; }

  /* LUL-2307: generic first-encounter hint caption, generalizing LUL-2230's
     scent-only #scentTrailCaption -- scent is now just one entry in the engine's
     HINT_PRIORITY list (engine/forest-engine.js), and keeps its original id/glyph
     class (Hud.tsx) since e2e/scent-trail.spec.ts and e2e/mobile/scent-trail.spec.ts
     assert on #scentTrailCaption directly and must pass unchanged -- every other
     key renders through the new #hintCaption/.hintCaptionGlyph instead. World-anchored
     keys (WORLD_HINT_KEYS, Hud.tsx) set left/top inline from the engine-projected
     viewport fraction; translate lifts the pill clear above the world point instead
     of covering it, same as the old scent-only rule. */
  /* LUL-2532: HINT_Y_MAX (engine/forest-engine.js) caps the raw engine fraction at
     0.78, but that's a fixed viewport-height fraction while #actionSlot's reserved
     region (bottom: var(--action-slot-bottom), height: var(--action-slot-height),
     same vars #captionToast above keys off) is a fixed pixel band that differs per
     breakpoint (24px/258px desktop vs. 190px/176px narrow) -- at a 720px-tall
     viewport, 0.78 already lands inside that band (562px vs. the band's 480px top
     edge), so translate(-50%,-120%)'s lift (which only clears ~20% of the pill's
     own height above the anchor) isn't enough on its own (LUL-2532: QA caught
     #scentTrailCaption's "↓" over .actionPromptLine at exactly this viewport/state).
     min() re-derives the true ceiling in pixels instead. 24px covers translate's
     ~20%-of-height clearance for the tallest realistic pill (three wrapped lines of
     the "bear" hint text at the 240px mobile max-width below, ~57px tall) plus a
     small visual gap -- tune it up if a future, longer HINT_TEXT entry still clips. */
  #scentTrailCaption, #hintCaption { position: fixed; z-index: 12; transform: translate(-50%, -120%);
    left: var(--hint-left, 50%);
    top: min(var(--hint-top, 50%), calc(100% - var(--action-slot-bottom) - var(--action-slot-height) - 24px));
    max-width: 60vw; padding: 6px 14px; border-radius: 999px; pointer-events: none;
    background: rgba(18,34,34,0.6); border: 1px solid rgba(159,224,208,0.4);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    font-size: 12px; letter-spacing: 0.03em; color: #cdf3e8; text-align: center;
    text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
  .scentTrailCaptionGlyph, .hintCaptionGlyph { color: #9fe0d0; margin-right: 4px; }
  /* Self/panel-anchored keys (bog/stamina/veil -- no real 3D point, and no
     player-facing meter to anchor to today; landmark -- fires unconditionally on
     entry, no single object to point at, same as the old toast it replaces -- see
     docs/specs/lul-2307-first-encounter-hints.md) share one bottom-center position:
     the same spot #captionToast already uses above #actionSlot, so "about your own
     state" reads consistently with predator-call captions. No inline left/top is set
     for these (Hud.tsx), so the position rule lives entirely here. */
  #hintCaption[data-hint-key="bog"],
  #hintCaption[data-hint-key="stamina"], #hintCaption[data-hint-key="veil"],
  #hintCaption[data-hint-key="landmark"], #hintCaption[data-hint-key="oakHollow"] {
    left: 50%; top: auto; transform: translateX(-50%);
    bottom: calc(var(--action-slot-bottom) + var(--action-slot-height) + 10px);
  }
  /* deepwater: below #missionPanel's top:76px/left:16px corner (:320 above). */
  #hintCaption[data-hint-key="deepwater"] { left: 16px; top: 110px; transform: none; }
  /* caveImmune: below #caveImmunePanel's top:56px/left:50% corner (:332 above); reuses
     its own copy so the two never show at once in practice (the hint dismisses itself
     the moment caveImmuneT reaches 0, before the panel disappears). */
  #hintCaption[data-hint-key="caveImmune"] { left: 50%; top: 92px; transform: translateX(-50%); }
  /* LUL-2158 precedent (see #hint above): a fast death/win must never leave this
     stranded over the end screen. LUL-2411: opacity: 0 alone left the fixed-position
     box's rect in place -- on mobile-pixel5-landscape the "deepwater" variant's
     top:110px/left:16px rect still overlapped .actionPromptLine's "nowhere to hide --
     HOLD" text while it (and #hintCaption) both remained painted through the
     try-again/win-input-battery transition, tripping the deterministic bounding-box
     audit exactly like #hint used to. display: none collapses the box itself. */
  body:has(#winScreen) #scentTrailCaption, body:has(#winScreen) #hintCaption,
  body:has(#deathScreen) #scentTrailCaption, body:has(#deathScreen) #hintCaption {
    display: none !important; }

  /* win screen -- transparent container (mirrors #deathScreen) so the fireBoom()
     particle burst on the canvas below is fully visible for the ~1.8s it runs;
     gradient moved to #winText inner wrapper so text remains readable */
  #winScreen { position: fixed; inset: 0; z-index: 25; display: none;
    align-items: center; justify-content: center; text-align: center; padding: 24px;
    background: rgba(0,0,0,0); pointer-events: none; }
  #winText { opacity: 0; transition: opacity 0.5s ease; display: flex; flex-direction: column;
    align-items: center; gap: 6px; pointer-events: auto;
    background: radial-gradient(120% 90% at 50% 42%, rgba(34,20,12,0.72), rgba(6,7,12,0.86));
    padding: 24px; border-radius: 4px;
    /* LUL-1103: #runChronicle can add up to 10 lines below the recap -- without
       this, a landscape phone (e.g. 851x393) has ~250px for h1+recap+button and
       the chronicle silently scrolls off-screen. Same pattern as #settingsPanel's
       own max-height (GameCanvas.tsx, "narrow" media query above). */
    max-height: calc(100dvh - 48px); overflow-y: auto; }
  #winText h1 { margin: 0; font-size: 40px; font-weight: 400; letter-spacing: 0.14em;
    color: #ffe6c8; text-shadow: 0 2px 44px rgba(255,190,130,0.5); }
  #winText p { margin: 0 0 8px; font-size: 15px; letter-spacing: 0.05em; color: #cbb7a4; }
  #runChronicle { list-style: none; margin: 4px 0 0; padding: 0; font-size: 12px;
    letter-spacing: 0.03em; color: #a99; text-align: left; max-width: 360px; }
  #runChronicle li { margin: 2px 0; }
  /* LUL-2727: without nowrap, a narrow landscape phone can break these spans'
     text across two lines, which balloons their inline bounding box to span
     both lines and geometrically overlap the previous line's content even
     though nothing is actually drawn on top of anything. */
  .emberGain { color: #ffdca8; font-weight: 500; white-space: nowrap; }
  .emberLoss { color: #ff8a8a; font-weight: 500; white-space: nowrap; }
  .restartBtn { font: inherit; font-size: 15px; letter-spacing: 0.06em; color: #2a1a10; cursor: pointer;
    background: #f0c79a; border: none; border-radius: 10px; padding: 10px 24px; margin-top: 8px;
    /* LUL-1088 CASCADE-ORDER BUG GUARD: the mobile-only .restartBtn override up
       in the @media block sets padding/font-size but this later, unconditional
       rule has identical specificity and wins for those properties on every
       viewport, including mobile -- see the comment on that override. min-height
       is the one property that override doesn't set, so it survives regardless
       of source order and is what actually keeps this button >=44px tall on a
       phone. Keep this even if the two rules are ever reordered. */
    min-height: 48px; }
  .restartBtn:hover { background: #f6d3ac; }
  .restartBtn:focus-visible { outline: 2px solid #ffe6c8; outline-offset: 3px; }

  /* LUL-1043: Embers shop -- Deeper Lungs I/II/III, the cheap version's one
     sink. Reused on #gate, #winScreen and #deathText (see Hud.tsx's
     EmbersShop comment for why it's on all three, not just the gate). */
  #embersShop { display: flex; flex-direction: column; align-items: center; gap: 6px;
    margin-top: 10px; font-size: 13px; color: #cbb7a4; }
  #embersShopBalance { color: #ffdca8; letter-spacing: 0.05em; }
  #embersShopMaxed { color: #9fd7b0; letter-spacing: 0.03em; }
  .buyBtn { font: inherit; font-size: 13px; letter-spacing: 0.03em; color: #d7e4f6; cursor: pointer;
    background: rgba(150,175,215,0.14); border: 1px solid rgba(150,175,215,0.3);
    border-radius: 8px; padding: 8px 14px; }
  .buyBtn:hover:not(:disabled) { background: rgba(150,175,215,0.24); }
  .buyBtn:disabled { opacity: 0.45; cursor: default; }
  .buyBtn:focus-visible { outline: 2px solid #7fa6dd; outline-offset: 2px; }

  /* LUL-2312: one fixed bottom action slot, replacing #objective (was
     top-centre)/#actionPrompt/#throwPrompt/#chargePrompt/#status -- five
     independently hand-positioned pills (74/92/110/130px bottom offsets plus
     #objective's separate top:20px) that LUL-1779/1780 kept catching drifting
     out of sync on mobile. #actionSlot is a CSS grid column, one fixed-height
     track per row, always laid out in this priority order regardless of which
     rows currently have content -- so a row appearing/disappearing never
     shifts any other row (no pop-in layout shift). Rows, top (highest
     priority, nearest screen centre) to bottom (nearest the screen edge):
       1. charge dodge   (SPACE/JUMP -- survival-critical, own drain bar)
       2. objective (E)  (lift the child / mist-charm / drowned car / distance)
       3. hide or veil   (H/Hide or F/Veil -- cover always wins over veil)
       4. throwable      (holding a stone -- click / tap Throw)
       5. pickup (E)     (LUL-2614: grab a stone -- mutually exclusive with row 4)
       6. status         (hidden / hunted)
     --action-pill-* custom properties are the "same tokens" requirement --
     the exact values #objective's pill used to hardcode, now named once and
     shared by every row via components/ActionPrompt.tsx's .actionPromptLine.
     --action-slot-row / --action-slot-row-charge / --action-slot-gap define
     the grid's fixed row heights in one place (defaults declared on the top
     html, body rule above); --action-slot-height derives the slot's total
     footprint from them so #captionToast (below) can sit just above it
     without restating the arithmetic. */
  /* LUL-1088 precedent: a landscape phone is short, not narrow -- six stacked
     rows plus the mobile control-row clearance below them does not fit a
     ~390px-tall viewport (e.g. Pixel 5 landscape, 851x393) at the desktop row
     sizes above. Tighten rows/gap and (combined with the mobile query below)
     the slot's own clearance specifically, without touching #panel's. */
  @media (max-height: 420px) {
    /* LUL-2614: row/gap shrunk from 30px/4px so the new 6th row (#pickupPrompt)
       still sums to the same 176px --action-slot-height as before (40 + 5*24 +
       5*3.2 = 176, was 40 + 4*30 + 4*4 = 176) -- every downstream pixel-math
       comment below (LUL-2410/2418/2459/2594) was tuned against that 176px
       figure with as little as 1px of margin, so preserving the total instead
       of letting it grow with the row count avoids re-deriving all of it blind. */
    html, body { --action-slot-row: 24px; --action-slot-row-charge: 40px; --action-slot-gap: 3.2px; }
  }
  @media (max-height: 420px) and (pointer: coarse) and (hover: none),
         (max-height: 420px) and (max-width: 768px) {
    body { --action-slot-bottom: 190px; }
    /* LUL-2410: --action-slot-bottom: 190px above pushes #actionSlot's rows
       (grid-template-rows starting with the charge row) up near the very top
       of a short landscape phone viewport (e.g. 667x375) -- there's no gap
       left below #gate's header controls to also fit #hint's fixed top: 64px
       band, so the objective row's .actionPromptLine sat on the same line as
       #hint's text (73% box overlap, iPhone SE landscape). #hint is a
       transient onboarding caption (engine fades it out 5s after enter(),
       see the LUL-2158 comment above) and the objective/hide/throwable pills
       in #actionSlot already carry the info a player needs at this size, so
       drop it here rather than fight for vertical space. display: none (not
       opacity: 0) so the box itself collapses to nothing -- the founder rule
       is "boxes must never intersect", and an opacity-hidden #hint would
       still occupy its top: 64px rect and keep tripping the deterministic
       DOM-bounding-box audit even though nothing is visibly drawn there.
       !important beats the engine's own inline hint.style.opacity writes
       (same precedent as the win/death :has() rules above). */
    #hint { display: none !important; }
    /* LUL-2418: deepwater is fixed at top:110px/left:16px (the "Self/panel-anchored
       keys" rule above), outside this media block, anchored below #missionPanel's
       corner -- it never moves at this breakpoint. At the raised
       --action-slot-bottom used here, #actionSlot's row 3 ("hide or veil") lands
       right on top of it on Pixel-5-landscape (851x393). Same collision family as
       LUL-2411, but that fix only addressed the win/death has() selector transition,
       not this in-gameplay case. deepwater is a transient first-encounter hint
       (LUL-2307 registry, fades once seen) and isn't in e2e/mobile/hints.spec.ts's
       must-stay-visible set (only landmark is, per LUL-2414) -- hide it here the
       same way #hint is. */
    #hintCaption[data-hint-key="deepwater"] { display: none !important; }
    /* LUL-2414: the bottom self-anchored #hintCaption family (bog/stamina/
       veil/landmark, see the "Self/panel-anchored keys" rule above) positions
       itself at bottom: action-slot-bottom + action-slot-height + 10px --
       190px + 176px + 10px = 376px at this breakpoint's own row/gap sizes,
       taller than a 375px-tall viewport (iPhone SE landscape), so the pill
       renders fully above the top edge ("offscreen" per the audit) regardless
       of which of the four keys fires -- unlike #hint, e2e/mobile/hints.spec.ts
       requires the landmark variant to stay legible at this exact breakpoint, so
       hiding it outright isn't an option here. There is no room left *above*
       #actionSlot (it now starts near the very top, see the comment above), but
       MobileControls.tsx's touch-control wrapper (bottom: 24px + safe-area,
       each stick/button column ~128px wide, anchored at the left/right edges via
       justify-content: space-between) leaves a horizontally-centred gap clear of
       both columns, in the band between #actionSlot's own bottom edge and the
       touch-control wrapper's bottom edge. Re-anchor top (from #actionSlot's
       bottom edge, 100vh - action-slot-bottom, plus a small gap) instead of
       bottom, and narrow max-width so it can't reach either stick column on the
       narrowest supported width (iPhone SE landscape, 667px). */
    /* LUL-2743: the world-anchored keys (scent/wolf/bear/lion/cover/throwable,
       WORLD_HINT_KEYS in Hud.tsx) used to get their own rule here (LUL-2459/
       LUL-2594, tuning a ceiling formula so the pill would float clear above
       #actionSlot). That ceiling IS #actionSlot's own top edge -- 100% -
       action-slot-bottom - action-slot-height, 27px on Pixel 5 landscape
       (851x393), 9px on iPhone SE landscape (667x375) -- and the base rule's
       translate(-50%,-120%) needs ~1.2x the pill's own rendered height of
       clearance above that edge to avoid drawing over #actionSlot. A real
       two-line pill (this family's text routinely wraps at the 240px
       max-width the narrower override below applies) is ~40-57px tall, so
       iPhone SE landscape would need
       the ceiling to sit >=1.2x that above y=0 -- no ceiling tuning gets
       there since the ceiling is already capped at 9px; LUL-2594's fix
       narrowed the gap but the viewport is structurally too short to float
       a pill of this height above #actionSlot at all (confirmed offscreen
       again on LUL-2631/LUL-2743). Per the LUL-2410/LUL-2418 precedent above
       -- stop repositioning once there's nowhere left to reposition to --
       these keys now share the self-anchored family's one proven-safe slot
       instead of world-anchoring at this breakpoint. Safe to combine
       unconditionally: HINT_PRIORITY (forest-engine.js) shows only one hint
       key at a time, and #scentTrailCaption/#hintCaption are mutually
       exclusive by key (Hud.tsx), so this family and the self-anchored one
       below never render at the same time. */
    #hintCaption[data-hint-key="bog"],
    #hintCaption[data-hint-key="stamina"], #hintCaption[data-hint-key="veil"],
    #hintCaption[data-hint-key="landmark"], #hintCaption[data-hint-key="oakHollow"],
    #scentTrailCaption,
    #hintCaption[data-hint-key="wolf"], #hintCaption[data-hint-key="bear"],
    #hintCaption[data-hint-key="lion"], #hintCaption[data-hint-key="cover"],
    #hintCaption[data-hint-key="throwable"] {
      left: 50%; top: calc(100vh - var(--action-slot-bottom) + 12px); bottom: auto;
      transform: translateX(-50%);
      max-width: min(60vw, 300px);
    }
    /* LUL-2694: #winText/#deathText's max-height: calc(100dvh - 48px) +
       overflow-y: auto (below) already handles #runChronicle overrun
       (LUL-1103), but on short-landscape phones (pixel5 393px, iphone-se
       375px tall) the content above #embersShop -- h1/dialogue/subtitle/
       RunRecap/restart button -- already consumes the whole ~327-345px
       budget, so the shop's balance line + 3 stacked buy buttons (the last
       child) render past the scroll container's content edge.
       getBoundingClientRect() reports their true unclipped position
       regardless of scroll, so local-qa's offscreen audit flags all 4 --
       same "boxes must never intersect/offscreen, scroll-to-reveal doesn't
       count" rule already enforced for #hint and the self-anchored
       #hintCaption family at this breakpoint (LUL-2410/LUL-2414 above).
       Row-laying the buttons out (an earlier version of this fix) did not
       help: buyBtn's text is a full sentence ("Deeper Lungs — veil hold 5s
       -> veil hold 6s — 120 embers"), so each button is nearly the full
       container width regardless of flex-direction and flex-wrap puts them
       back on separate rows anyway. The only lever that actually shrinks
       total content height is font-size/spacing, measured empirically
       against a live win screen (fresh save, 1-line chronicle) until
       scrollHeight <= clientHeight on iphone-se-landscape-667x375 (the
       tighter of the two reported viewports): 465px of content into a
       327px budget needed ~140px trimmed across every child, not just the
       shop. */
    /* LUL-3282: #deathText's own base padding/gap/h1/p rules (below, "death:
       video cutscene + loss text" section) are declared *after* this block,
       so at equal specificity they'd normally win by source order and silently
       cancel this squeeze on #deathText -- same class of bug as the documented
       LUL-1088 .restartBtn/.buyBtn cascade-order issue above. #winText's
       equivalent base rules sit *before* this block (no #deathText-style risk),
       so only the #deathText side of each declaration needs !important here,
       matching the LUL-2410/LUL-2158 precedent for guaranteed-win overrides. */
    #winText, #deathText { padding: 8px 16px; gap: 2px; }
    #deathText { padding: 8px 16px !important; gap: 2px !important; }
    #winText h1, #deathText h1 { font-size: 20px; }
    #deathText h1 { font-size: 20px !important; }
    #winText p, #deathText p { margin: 0 0 2px; font-size: 11px; }
    #deathText p { margin: 0 0 2px !important; font-size: 11px !important; }
    #runChronicle { font-size: 10px; margin-top: 2px; }
    .restartBtn { margin-top: 2px; padding: 6px 16px; }
    #embersShop { flex-direction: column; margin-top: 2px; gap: 1px; }
    /* LUL-3255: #embersShopBalance/.buyBtn were 11px/10px, under the 12px
       MIN_FONT_PX floor -- flagged every prod QA run (also reproduces on the
       win/death shop, shared markup, see the LUL-2694 comment above this
       block). Bumping both by 1-2px reopens the exact overflow LUL-2694 fixed,
       so the gap/padding trims here (2px->1px, 3px->2px vertical) claw back
       slightly more height than the font bump adds -- verified against a live
       win screen on iphone-se-landscape (375px tall, the tighter viewport)
       that #winText's scrollHeight still fits its clientHeight. */
    #embersShopBalance, #embersShopMaxed { font-size: 12px; }
    .buyBtn { font-size: 12px; padding: 2px 6px; }
    /* LUL-4577: #windIndicatorHint's default rule (top:64px, width:76px, outside
       this block) wraps its full sentence ("wind — move into the arrow to mask
       your scent; sprint into it for extra speed and quiet") into 8 lines at
       ~15.6px each (~125px tall) -- that's true regardless of admin mode. The
       LUL-4506 fix below only re-anchors the admin-mode-only 228px override back
       down to this same top:64px; it never touched the width/line-count, so the
       admin-off default (every real player, and this ticket's repro) still
       overflows the identical way: the box's last two lines ("extra speed" /
       "and quiet") land on top of MobileControls.tsx's touch column (y=157
       iPhone SE landscape / y=175 Pixel 5 landscape at this breakpoint's fixed
       bottom anchor, per the LUL-4506 comment below) -- caught as the
       touchVeil-vs-windIndicatorHint overlap in local-qa's deterministic
       bounding-box audit (layout-8b9d025457). Widening the box and dropping
       font-size a touch cuts the wrap to ~4-5 lines (~55-70px), which fits
       inside the 64px-to-157px gap on the tightest matching viewport (iPhone SE
       landscape) with room to spare, and only shrinks further -- never wraps
       more -- on every wider/taller viewport this media query also matches. */
    #windIndicatorHint { width: 160px; right: 4px; font-size: 11px; line-height: 1.25; }
    /* LUL-4506: the LUL-1912 admin-mode minimap-clearance push (top:228px, see the
       rule above outside this block) puts #windIndicatorHint's bottom edge at
       y=306 -- below MobileControls.tsx's touch column top (y=157 iPhone SE
       landscape / y=175 Pixel 5 landscape at this breakpoint's fixed bottom
       anchor). There is no vertical gap between the minimap-clearance zone and
       the touch controls on a viewport this short (same conclusion as the
       LUL-2410/2418/2459/2594/2743 comments above for this exact breakpoint).
       Falling back to the default top:64px here overlaps the admin-only minimap
       instead -- untested and accepted, since this is a dev-only combination
       (admin mode is off for every real player, body[data-admin-mode="0"]
       #minimap{display:none}, GameCanvas.tsx:338) and no spec asserts
       windIndicatorHint-vs-minimap clearance. */
    body[data-admin-mode="1"] #windIndicatorHint { top: 64px; }
  }
  /* LUL-4931: LUL-4786 added a third 56px button (Shuffle) into
     MobileControls.tsx's right-hand touch row (Hide/Shuffle/Veil), widening
     that row from 122px (2 buttons + 1 gap) to 188px. That row's container is
     right-anchored (MobileControls.tsx's wrapper uses justify-content:
     space-between, side auto-sizes to its widest child), so the extra 66px
     grows the column leftward, toward center, instead of off the right edge --
     Veil's position is unchanged but Hide (now leftmost of the three) sits
     66px further left than the ~128px-column math the block above was tuned
     against. On iPhone SE landscape (667px wide, the narrower of the two
     breakpoints this file supports) the self-anchored #hintCaption/
     #scentTrailCaption family above is centered (left:50%) with
     max-width:min(60vw,300px) -> 300px there, whose right edge (333.5 + 150 =
     483.5) now reaches past touchHide's new left edge (459) -- confirmed by
     local-qa's PR watch (pr-e2e-850-69fd145). Pixel 5 landscape (851px) has
     enough width that the same 66px column growth doesn't reach the 300px-wide
     pill (not flagged), so this only narrows the family for the tighter
     breakpoint via max-width: 700px (667 matches, 851 doesn't) rather than
     shrinking both and re-litigating the Pixel 5 pill-height budget above.
     240px keeps the pill's right edge at 333.5 + 120 = 453.5, clear of
     touchHide's 459 with a few px to spare; text wrapping to a 3rd line only
     grows the pill downward (top is fixed, not translateY'd), away from the
     touch row's y-band, so it doesn't reopen a vertical clearance issue. */
  @media (max-height: 420px) and (max-width: 700px) {
    #hintCaption[data-hint-key="bog"],
    #hintCaption[data-hint-key="stamina"], #hintCaption[data-hint-key="veil"],
    #hintCaption[data-hint-key="landmark"], #hintCaption[data-hint-key="oakHollow"],
    #scentTrailCaption,
    #hintCaption[data-hint-key="wolf"], #hintCaption[data-hint-key="bear"],
    #hintCaption[data-hint-key="lion"], #hintCaption[data-hint-key="cover"],
    #hintCaption[data-hint-key="throwable"] {
      max-width: 240px;
    }
  }

  #actionSlot { position: fixed; bottom: var(--action-slot-bottom); left: 50%; transform: translateX(-50%);
    z-index: 12; display: grid;
    grid-template-rows: var(--action-slot-row-charge) var(--action-slot-row) var(--action-slot-row) var(--action-slot-row) var(--action-slot-row) var(--action-slot-row);
    row-gap: var(--action-slot-gap); justify-items: center; pointer-events: none; }

  .actionPromptRow { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; }
  .actionPromptLine { display: flex; align-items: center; gap: 0; pointer-events: none;
    padding: 7px 16px; border-radius: 999px; white-space: nowrap;
    background: var(--action-pill-bg); border: 1px solid var(--action-pill-border-calm);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    font-size: 13px; letter-spacing: 0.03em; color: var(--action-pill-color-calm);
    text-shadow: 0 1px 6px rgba(0,0,0,0.7);
    animation: actionPromptFadeIn 150ms ease; }
  .actionPromptRow[data-tone="ready"] .actionPromptLine,
  .actionPromptRow[data-tone="urgent"] .actionPromptLine { color: var(--action-pill-color-ready); border-color: var(--action-pill-border-ready); }
  .actionPromptRow[data-tone="status"] .actionPromptLine { color: var(--action-pill-color-status); border-color: var(--action-pill-border-status); }
  .actionPromptKey { padding: 5px 14px; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: 0.08em;
    color: var(--action-pill-key-color); background: var(--action-pill-key-bg); box-shadow: var(--action-pill-key-shadow); }
  /* LUL-1780: tone="urgent" is the one flashing state -- background/box-shadow
     only, never transform, so the row's own translateX(-50%)-free flex layout
     is never at risk of the chargePulse-on-transform bug (decisions/
     lul1089-prompt-surface). This also now covers the charge-dodge keycap,
     which used to run its own always-on amber scale-pulse (chargePulse) --
     unified onto the same red flash as every other urgent row so the whole
     component family satisfies "opacity only, no scale/bounce" below. */
  .actionPromptRow[data-tone="urgent"] .actionPromptKey { animation: urgentFlash 0.42s ease-in-out infinite alternate; }
  @keyframes urgentFlash {
    from { background: var(--action-pill-key-bg); box-shadow: var(--action-pill-key-shadow); }
    to   { background: var(--action-pill-urgent-bg); box-shadow: var(--action-pill-urgent-shadow); } }
  /* LUL-2312 rule 4: transitions are opacity-only, 120-180ms, nothing pops --
     a row's pill fades in on mount; there is deliberately no exit transition,
     matching every one of these prompts' existing (zero-transition) hide
     behaviour, so this is a pure improvement, not a new pop-in. */
  @keyframes actionPromptFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .actionPromptLine { animation: none; }
    .actionPromptRow[data-tone="urgent"] .actionPromptKey { animation: none; background: var(--action-pill-urgent-bg); box-shadow: var(--action-pill-urgent-shadow); }
    /* LUL-3009: Hud.tsx already skips the class under reducedMotion -- this is the same
       belt-and-suspenders fallback #actionPromptLine gets above, not the primary gate. */
    #windIndicator.windIndicatorActive { animation: none; } }

  /* LUL-2331: mist-charm activation tell -- Hud.tsx toggles this class for the same
     400ms window it eases #veilState's displayed number up in (useVeilMeterRamp),
     skipped entirely (class never applied) when state.reducedMotion is set. */
  #veilState.veilRefillFlash { animation: veilRefillFlash 400ms ease-out; }
  @keyframes veilRefillFlash {
    from { color: #cfe8ff; } to { color: inherit; } }

  /* LUL-213/LUL-304: charge-dodge countdown bar -- durationSeconds comes from
     CHARGE_WINDOW (lib/game/charge.ts) as an inline style on the element
     itself now (components/Hud.tsx), not spliced into this stylesheet, so the
     bar can never drift from the real dodge window without also threading it
     through as per-frame engine state. */
  .actionPromptProgressTrack { width: 120px; height: 5px; border-radius: 999px; background: rgba(150,175,215,0.25); overflow: hidden; }
  .actionPromptProgressBar { height: 100%; width: 100%; background: #e8554a; transform-origin: left; animation: chargeDrain linear forwards; }
  @keyframes chargeDrain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

  /* death: video cutscene + loss text */
  #spotFlash { position: fixed; inset: 0; z-index: 12; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 50% 45%, rgba(255,20,20,0) 40%, rgba(200,0,0,0.5) 100%); }
  /* LUL-2856: cover-rustle vignette. Same edge-vignette shape as #spotFlash, brush-green tint
     instead of alert-red, z-index one below spotFlash (a real spot event is the more urgent
     signal and must read on top if both are ever active the same frame -- same ordering
     rationale #bearingPulse already uses relative to #spotFlash, :716-718). Sibling of #panel,
     NOT a descendant -- visible with adminMode off (Q3, GameCanvas.tsx:324's selector only
     matches #panel). */
  #rustleFlash { position: fixed; inset: 0; z-index: 11; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 50% 45%, rgba(120,140,40,0) 40%, rgba(90,110,30,0.5) 100%); }
  /* LUL-1308: off-screen predator bearing. z-index one below spotFlash so a
     real spot event (the more urgent, full-screen signal) reads on top if both
     are active at once. Class name ('left'/'right'/'behind') set by the engine
     off bearingOf(nearP,...).side; opacity is the only per-frame mutation. */
  #bearingPulse { position: fixed; inset: 0; z-index: 11; pointer-events: none; opacity: 0; }
  #bearingPulse.left { background: linear-gradient(to right, rgba(255,60,40,0.55) 0%, rgba(255,60,40,0) 22%); }
  #bearingPulse.right { background: linear-gradient(to left, rgba(255,60,40,0.55) 0%, rgba(255,60,40,0) 22%); }
  #bearingPulse.behind { background:
    linear-gradient(to right, rgba(255,60,40,0.5) 0%, rgba(255,60,40,0) 18%),
    linear-gradient(to left, rgba(255,60,40,0.5) 0%, rgba(255,60,40,0) 18%); }
  #flash { position: fixed; inset: 0; z-index: 23; pointer-events: none; opacity: 0; background: #fff; }
  #deathVideo { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover;
    z-index: 24; display: none; background: #000; pointer-events: none; }
  #deathScreen { position: fixed; inset: 0; z-index: 25; display: none;
    align-items: center; justify-content: center; text-align: center; padding: 24px;
    background: rgba(4,3,5,0); pointer-events: none; }
  #deathText { opacity: 0; transition: opacity 0.9s ease; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: auto;
    /* LUL-1103: see #winText's identical rule above -- same phone-viewport overflow risk from #runChronicle. */
    max-height: calc(100dvh - 48px); overflow-y: auto; }
  #deathText h1 { margin: 0; font-size: 44px; font-weight: 400; letter-spacing: 0.2em;
    color: #e8554a; text-shadow: 0 2px 50px rgba(255,40,30,0.5); }
  #deathText p { margin: 0 0 8px; font-size: 15px; letter-spacing: 0.05em; color: #b98f88; }
`;

// Elements still owned directly by the engine (getElementById, out of LUL-34's
// scope) -- everything else from the original overlay now lives in <Hud>.
// LUL-529: `#hint`/`#pausePrompt` text referenced mouse/click actions
// unconditionally, even on mobile where there's no mouse and no pointer lock
// to "click" back into -- built as a function of the same mode decision
// GameCanvas already makes below, rather than a static template string.
function overlayMarkup(mobile: boolean) {
  const hint = mobile ? 'drag the right stick to look &nbsp;·&nbsp; left stick to walk' : 'move the mouse to look &nbsp;·&nbsp; WASD to walk';
  const pausePrompt = mobile ? 'paused — tap the Pause button to resume' : 'click to look around';
  return `
<div id="vignette"></div>
<div id="spotFlash"></div>
<div id="rustleFlash"></div><!-- LUL-2856 -->
<div id="bearingPulse"></div>
<div id="flash"></div>
<canvas id="minimap" width="160" height="160"></canvas>
<div id="hint">${hint}</div>
<div id="pausePrompt">${pausePrompt}</div>
<video id="deathVideo" muted playsinline preload="auto" src="/death.mp4"></video>
`;
}

export default function GameCanvas() {
  const [hud, setHud] = useState<EngineHudState>(INITIAL_HUD_STATE);
  const [actions, setActions] = useState<EngineActions | null>(null);
  // LUL-276/LUL-529: decided once, same as Hud.tsx's `mobile` -- a device
  // doesn't switch control schemes mid-session.
  const mobile = useState(() => isMobile())[0];

  // LUL-153: page_view + session_length are independent of whether the engine
  // module ever finishes loading, so they get their own effect rather than
  // living inside the dynamic-import one below.
  useEffect(() => {
    initTelemetryTransport();
    track({ event: 'page_view' });
    return startSessionTracking();
  }, []);

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
      // LUL-276: also takes an explicit inputMode so desktop mouse-look and
      // mobile touch input bind disjoint listeners inside the engine instead
      // of both being live and writing player.yaw/pitch at once.
      // LUL-2239: runtime half of the founder's engine/React contract rule --
      // ENGINE_ACTION_KEYS (lib/engine-contract.ts) only catches EngineActions
      // gaining a key the type-level check doesn't know about; it can't see whether
      // init()'s own return object actually included every key (LUL-1697). Assert
      // against what init() actually returned, right after it returns.
      const engineActions = init(setHud, mobile ? 'mobile' : 'desktop');
      assertEngineContract(engineActions);
      setActions(engineActions);
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
    // `mobile` is a useState initializer value, never reassigned after mount,
    // so listing it here can't cause a second init() -- it just satisfies
    // exhaustive-deps without lying about what this effect reads.
  }, [mobile]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_STYLE }} />
      <WelcomeSplash />
      <div dangerouslySetInnerHTML={{ __html: overlayMarkup(mobile) }} />
      <Hud state={hud} actions={actions} />
    </>
  );
}
