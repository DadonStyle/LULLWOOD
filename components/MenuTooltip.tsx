'use client';

import type { ReactNode } from 'react';
import type { MenuTipCopy } from '@/lib/ui/menu-tips';

export type MenuTip = MenuTipCopy;

// Hover/keyboard-focus tooltip for the buttons in GameMenu's `.menuButtons`
// row: what the button is, plus a call to action. Pure CSS show/hide, so no
// state and nothing to clean up. It shows on a real hover (not on touch,
// where a tap would leave it stuck over the popup it just opened) and on
// keyboard focus (:focus-visible, so a mouse click doesn't pin it either).
export function MenuTooltip({ id, tip, hidden = false, children }: { id: string; tip: MenuTip; hidden?: boolean; children: ReactNode }) {
  return (
    <span className="menuTooltipWrap">
      {children}
      {!hidden && (
        <span role="tooltip" id={id} data-testid={id} className="menuTooltip">
          <strong>{tip.title}</strong>
          <span>{tip.text}</span>
          <em>{tip.cta}</em>
        </span>
      )}
      <style jsx>{`
        .menuTooltipWrap {
          position: relative;
          display: inline-flex;
        }
        .menuTooltip {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          z-index: 22;
          width: max-content;
          max-width: 240px;
          padding: 8px 10px;
          display: none;
          flex-direction: column;
          gap: 3px;
          background: #0c111a;
          border: 1px solid #3a4a63;
          border-radius: 6px;
          color: #c3d2e6;
          font-size: 12px;
          line-height: 1.4;
          text-align: left;
          white-space: normal;
          pointer-events: none;
        }
        .menuTooltip strong {
          color: #e6eefa;
          font-size: 13px;
          font-weight: 600;
        }
        .menuTooltip em {
          color: #f2c46d;
          font-style: normal;
        }
        @media (hover: hover) {
          .menuTooltipWrap:hover .menuTooltip {
            display: flex;
          }
        }
        .menuTooltipWrap:has(:focus-visible) .menuTooltip {
          display: flex;
        }
      `}</style>
    </span>
  );
}
