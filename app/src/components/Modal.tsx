import { useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { isTopModal, popModal, pushModal } from '../modalStack';

/**
 * The one modal (task 088): a scrim and a card, portaled to `document.body`,
 * so it inherits nothing from whatever opened it (the editor's top bar is
 * nowrap and small type) and sits above every editor panel. Every dialog is
 * its children: the Feedback form, Password, the sandbox's save prompt,
 * Submit, Extension / Waive, Re-grade.
 *
 * It owns the keyboard while open. It registers in modalStack, so page-level
 * key handlers stand down (isModalOpen()). Escape closes the innermost modal
 * unless `busy`, and goes no further: the canvas's own Escape never sees it.
 * The scrim closes it only when a press starts AND ends on the scrim, so a
 * text selection dragged out of the card never loses a half-written message.
 *
 * React events still bubble from a portal to its opener's React tree, so the
 * click family stops here. Keydown, paste and pointerup do NOT: window
 * drag-ends, the Feedback form's paste listener on document and the
 * isModalOpen() gates all need them.
 */
export function Modal({
  onClose,
  busy = false,
  narrow = false,
  className,
  label,
  labelledBy,
  children,
}: {
  onClose: () => void;
  /** Mid-save: Escape and the scrim do nothing (the dialog's own buttons say so). */
  busy?: boolean;
  narrow?: boolean;
  /** A dialog's own class on the card (RegradeDialog's `gr-regrade`). */
  className?: string;
  /** The accessible name, when no heading in the card carries an id. */
  label?: string;
  /** The id of the heading that names the dialog. */
  labelledBy?: string;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pressedScrim = useRef(false);
  // The latest props, read at event time by the one keydown listener.
  const latest = useRef({ onClose, busy });
  useLayoutEffect(() => {
    latest.current = { onClose, busy };
  });

  useLayoutEffect(() => {
    // The token lives in the effect, so StrictMode's second mount pushes a
    // fresh one after the first is popped.
    const token = {};
    pushModal(token);
    // Take focus off the opener (a menu item Enter would re-click), unless a
    // child already took it (autoFocus runs first). Focus is not handed back
    // on close: it falls to the page, where the grading queue's keys expect it.
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || !isTopModal(token)) return;
      // Stopped here, at document: React unmounts the modal before the
      // window's listeners run, and they would then see no modal open.
      e.preventDefault();
      e.stopPropagation();
      if (!latest.current.busy) latest.current.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      popModal(token);
    };
  }, []);

  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const cls = ['mm-modal', narrow && 'mm-modal--narrow', className, 'mm-surface'].filter(Boolean).join(' ');

  return createPortal(
    <div
      className="mm-modal-backdrop"
      onMouseDown={(e) => {
        e.stopPropagation();
        pressedScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        e.stopPropagation();
        const onScrim = pressedScrim.current && e.target === e.currentTarget;
        pressedScrim.current = false;
        if (onScrim && !busy) onClose();
      }}
      onDoubleClick={stop}
      onContextMenu={stop}
      onPointerDown={stop}
    >
      <div
        ref={cardRef}
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
