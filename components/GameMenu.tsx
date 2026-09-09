'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineActions, EngineHudState } from './Hud';

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

export default function GameMenu({
  state,
  actions,
  onOpenSettings,
  onOpenChange,
}: {
  state: EngineHudState;
  actions: EngineActions | null;
  onOpenSettings: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { supported: fullscreenSupported, isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // LUL-2231: report open state up so Hud.tsx can gate MobileControls -- the
  // menuPanel (z-index 21) sits under mobile's sticks/buttons (z-index 30/31)
  // and, unlike LUL-2131's end-screen case, nothing here ever unmounts to get
  // out of the way. `open` itself stays local; this is a one-way notification,
  // not a controlled-component conversion.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const handleOpenSettings = () => {
    setOpen(false);
    onOpenSettings();
  };

  // LUL-2131: #gameMenu's hamburger sits at z-index 20, and the menuPanel it
  // opens covers most of the same corner -- both stayed mounted and tappable
  // over #winScreen/#deathScreen (z-index 25, GameCanvas.tsx) because nothing
  // here ever read winVisible/deathVisible. Unmount rather than hide: an open
  // menu with a live "New map"/"Pause" row has no business surviving into an
  // end screen that already offers its own restart.
  if (state.winVisible || state.deathVisible) return null;

  return (
    <div id="gameMenu" ref={menuRef}>
      <button
        data-testid="menuToggle"
        className="menuToggle"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        ☰
      </button>

      {open && (
        <div className="menuPanel">
          {fullscreenSupported && (
            <button
              data-testid="menuFullscreen"
              className="menuRow"
              onClick={() => {
                toggleFullscreen();
                setOpen(false);
              }}
            >
              Fullscreen: {isFullscreen ? 'on' : 'off'}
            </button>
          )}

          <button
            data-testid="menuPause"
            className="menuRow"
            onClick={() => {
              actions?.triggerTouchPause();
              setOpen(false);
            }}
          >
            Pause
          </button>

          <button
            data-testid="menuSound"
            className="menuRow"
            onClick={() => {
              actions?.toggleSound();
              setOpen(false);
            }}
          >
            Sound: {state.soundOn ? 'on' : 'off'}
          </button>

          {!state.entered && (
            <div className="menuRow menuDifficulty">
              <label>Difficulty</label>
              <div className="segmentedControl">
                {(['lantern', 'night', 'blackout'] as const).map((d) => {
                  const tierLabel = d === 'lantern' ? 'Lantern' : d === 'night' ? 'Night' : 'Blackout';
                  return (
                    <button
                      key={d}
                      data-testid={`menuDifficulty${d}`}
                      className={`segment ${state.difficulty === d ? 'active' : ''}`}
                      onClick={() => {
                        actions?.setDifficulty(d);
                        setOpen(false);
                      }}
                      title={d === 'lantern' ? 'Forgiving' : d === 'night' ? 'Default' : 'No mercy'}
                    >
                      {tierLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!state.entered && state.missionUnlocks.deepwater && (
            <div className="menuRow menuSecondary">
              <label>Secondary objective</label>
              <div className="segmentedControl">
                {([null, 'retrieval', 'speedrun'] as const).map((k) => {
                  const label = k === null ? 'None' : k === 'retrieval' ? 'Retrieval' : 'Speedrun';
                  return (
                    <button
                      key={label}
                      data-testid={`menuSecondary${label}`}
                      className={`segment ${state.secondaryChoice === k ? 'active' : ''}`}
                      onClick={() => {
                        actions?.setSecondaryChoice(k);
                        setOpen(false);
                      }}
                      title={k === null ? 'No bonus' : k === 'retrieval' ? 'Find the radio mast for a bonus' : 'Reach home within the time limit for a bonus'}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            id="settingsBtn"
            className="menuRow"
            onClick={handleOpenSettings}
            aria-label="Open settings"
          >
            Settings...
          </button>

          <button
            data-testid="menuRestart"
            className="menuRow"
            onClick={() => {
              actions?.restart();
              setOpen(false);
            }}
          >
            New map
          </button>
        </div>
      )}

      <style jsx>{`
        #gameMenu {
          position: fixed;
          top: 16px;
          left: 16px;
          z-index: 20;
          font-family: inherit;
        }

        .menuToggle {
          width: 48px;
          height: 48px;
          min-width: 48px;
          min-height: 48px;
          border: 1px solid #cdd9ea;
          background: rgba(6, 9, 15, 0.8);
          color: #cdd9ea;
          font-size: 24px;
          cursor: pointer;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background-color 0.2s;
        }

        .menuToggle:hover {
          background: rgba(6, 9, 15, 0.95);
        }

        .menuToggle:active {
          transform: scale(0.95);
        }

        .menuPanel {
          position: absolute;
          top: 56px;
          left: 0;
          background: rgba(6, 9, 15, 0.95);
          border: 1px solid #cdd9ea;
          border-radius: 4px;
          min-width: 200px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          z-index: 21;
          overflow: hidden;
        }

        .menuRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-height: 48px;
          padding: 12px 16px;
          border: none;
          background: none;
          color: #cdd9ea;
          font-size: 13px;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          transition: background-color 0.2s;
          border-bottom: 1px solid rgba(205, 217, 234, 0.1);
        }

        .menuRow:last-child {
          border-bottom: none;
        }

        .menuRow:hover {
          background: rgba(205, 217, 234, 0.1);
        }

        .menuRow:active {
          background: rgba(205, 217, 234, 0.2);
        }

        .menuDifficulty {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .menuDifficulty label {
          width: 100%;
          font-size: 13px;
          color: #cdd9ea;
          margin: 0;
        }

        .segmentedControl {
          display: flex;
          gap: 4px;
          width: 100%;
        }

        .segment {
          flex: 1;
          min-height: 32px;
          padding: 4px 6px;
          border: 1px solid #cdd9ea;
          background: transparent;
          color: #cdd9ea;
          font-size: 11px;
          cursor: pointer;
          border-radius: 2px;
          transition: all 0.2s;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .segment:hover {
          background: rgba(205, 217, 234, 0.1);
        }

        .segment.active {
          background: rgba(205, 217, 234, 0.3);
          border-color: #fff;
        }

        @media (max-width: 768px) {
          .menuPanel {
            min-width: 160px;
          }

          .menuRow {
            font-size: 12px;
            padding: 10px 12px;
            min-height: 44px;
          }

          .segment {
            min-height: 28px;
            padding: 2px 6px;
            font-size: 10px;
          }
        }
      `}</style>
    </div>
  );
}
