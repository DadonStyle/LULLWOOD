'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Reusable modal popup: a title, any content, and one dismiss button. Used for
// the "Be the rescuer" rules, the suggestion box, the credits and the
// admin-mode warning. Closes on the button,
// Esc, or a click on the backdrop; focus moves to the dismiss button on open so
// a keyboard player can close it straight away. Rendered into document.body
// through a portal: a caller inside a positioned HUD element (e.g. #gameMenu,
// z-index 20) would otherwise trap it under the start gate and end screens.
export function InfoDialog({
  open,
  testId,
  title,
  onClose,
  closeLabel = 'Got it',
  children,
}: {
  open: boolean;
  testId: string;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc also means "pause/menu" to the engine; this dialog consumes it.
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose]);

  if (!open) return null;
  const titleId = `${testId}-title`;
  return createPortal(
    <div className="infoDialogBackdrop" data-testid={`${testId}-backdrop`} onClick={onClose}>
      <div
        className="infoDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        // Typing in a popup (the suggestion box) must not reach the engine's
        // window keydown listener and move the player. Esc is handled above,
        // in the capture phase, before this runs.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="infoDialogBody">{children}</div>
        <button ref={closeRef} className="infoDialogClose" data-testid={`${testId}-close`} onClick={onClose}>
          {closeLabel}
        </button>
      </div>
      <style jsx>{`
        .infoDialogBackdrop {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(4, 6, 10, 0.72);
          cursor: default;
        }
        .infoDialog {
          max-width: 480px;
          width: 100%;
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          background: #0c111a;
          border: 1px solid #3a4a63;
          border-radius: 8px;
          padding: 20px 22px;
          color: #c3d2e6;
          text-align: left;
          font-size: 14px;
          line-height: 1.5;
        }
        h2 {
          margin: 0 0 12px;
          font-size: 20px;
          font-weight: 500;
          color: #e6eefa;
        }
        .infoDialogBody :global(ul) {
          margin: 0 0 16px;
          padding-left: 20px;
        }
        .infoDialogBody :global(li) {
          margin-bottom: 6px;
        }
        .infoDialogBody :global(p) {
          margin: 0 0 12px;
        }
        .infoDialogClose {
          margin-top: 12px;
          min-height: 44px;
          padding: 0 20px;
          border: 1px solid #cdd9ea;
          border-radius: 4px;
          background: rgba(205, 217, 234, 0.12);
          color: #e6eefa;
          font-size: 14px;
          cursor: pointer;
        }
        .infoDialogClose:hover {
          background: rgba(205, 217, 234, 0.22);
        }
      `}</style>
    </div>,
    document.body,
  );
}
