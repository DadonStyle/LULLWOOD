'use client';

import type { ReactNode } from 'react';
import { MenuTooltip, type MenuTip } from './MenuTooltip';

// One square (or, with `wide`, text) button in GameMenu's top-left
// `.menuButtons` row, next to the hamburger and fullscreen toggles. LUL-5983
// introduced the first standalone one (suggestion box); Credits and "Be the
// rescuer" reuse it instead of copying its styles. Every one carries a
// MenuTooltip (what it is, plus a call to action).
export function MenuButton({
  testId,
  ariaLabel,
  onClick,
  tip,
  wide = false,
  children,
}: {
  testId: string;
  ariaLabel: string;
  onClick: () => void;
  tip: MenuTip;
  wide?: boolean;
  children: ReactNode;
}) {
  const tipId = `${testId}-tooltip`;
  return (
    <MenuTooltip id={tipId} tip={tip}>
    <button data-testid={testId} className={`menuButton${wide ? ' menuButtonWide' : ''}`} onClick={onClick} aria-label={ariaLabel} aria-describedby={tipId}>
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
    </MenuTooltip>
  );
}
