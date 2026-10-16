'use client';

import type { ReactNode } from 'react';

// One square (or, with `wide`, text) button in GameMenu's top-left
// `.menuButtons` row, next to the hamburger and fullscreen toggles. LUL-5983
// introduced the first standalone one (suggestion box); Credits and "Be the
// rescuer" reuse it instead of copying its styles.
export function MenuButton({
  testId,
  ariaLabel,
  onClick,
  wide = false,
  children,
}: {
  testId: string;
  ariaLabel: string;
  onClick: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <button data-testid={testId} className={`menuButton${wide ? ' menuButtonWide' : ''}`} onClick={onClick} aria-label={ariaLabel}>
      {children}
      <style jsx>{`
        .menuButton {
          height: 48px;
          min-width: 48px;
          min-height: 48px;
          border: 1px solid #cdd9ea;
          background: rgba(6, 9, 15, 0.8);
          color: #cdd9ea;
          font-size: 20px;
          cursor: pointer;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background-color 0.2s;
        }
        .menuButtonWide {
          font-size: 14px;
          letter-spacing: 0.04em;
          padding: 0 14px;
          white-space: nowrap;
        }
        .menuButton:hover {
          background: rgba(6, 9, 15, 0.95);
        }
        .menuButton:active {
          transform: scale(0.95);
        }
      `}</style>
    </button>
  );
}

/** A MenuButton that opens a site page in a new tab -- so a player who has
 * entered a run doesn't lose it by clicking through (LUL-5983). Only the URL,
 * icon and label differ between uses (/suggest, /credits). */
export function MenuLinkButton({ testId, href, icon, ariaLabel }: { testId: string; href: string; icon: ReactNode; ariaLabel: string }) {
  return (
    <MenuButton testId={testId} ariaLabel={ariaLabel} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}>
      <span aria-hidden="true">{icon}</span>
    </MenuButton>
  );
}
