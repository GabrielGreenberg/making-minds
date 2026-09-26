import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { AccountPanel, ChangePasswordModal } from '../auth/AccountPanel';
import { navigate } from '../routing';
import { FeedbackPanel } from './FeedbackPanel';

/**
 * Log out and land on the sign-in screen. Navigates Home FIRST, while the
 * session still exists, so the open workbook closes (and flushes its save)
 * as the signed-in user; then the session ends — the auth provider resets the
 * editor store for the visitor (store.ts resetForPrincipal), so nothing of
 * this user's stays in memory for the next — and Home, a signed-in route,
 * shows the sign-in screen. The one sign-out path for every surface.
 */
export function signOut(logout: () => void): void {
  navigate({ kind: 'home' });
  logout();
}

/**
 * The identity and its actions — the page shell's topbar and the editor's
 * top bar both render this. Signed in: the name, Feedback (opens the report
 * modal), Password (only when the server manages passwords — AccountPanel
 * decides), Log out. A visitor: a "Visitor" tag and Sign in. One component so
 * every surface offers the same controls in the same order.
 *
 * `menu` folds the signed-in actions under "Name ▾" (the editor's top bar,
 * where width is scarce — design memo editor-workbench.md §Top bar), with
 * the instructor's way back to the Dashboard first.
 */
export function SessionControls({ feedback = true, menu = false }: { feedback?: boolean; menu?: boolean }) {
  const { user, isVisitor, logout } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);

  if (isVisitor) {
    return (
      <div className="session">
        <span className="who">Visitor</span>
        <button type="button" onClick={() => navigate({ kind: 'home' })}>
          Sign in
        </button>
      </div>
    );
  }
  if (!user) return null;

  if (menu) return <SessionMenu feedback={feedback} />;

  return (
    <div className="session">
      <span className="who">
        {user.name}
        {user.role === 'instructor' ? ' · Instructor' : ''}
      </span>
      {feedback && (
        <button type="button" onClick={() => setShowFeedback(true)}>
          Feedback
        </button>
      )}
      <AccountPanel />
      <button type="button" onClick={() => signOut(logout)}>
        Log out
      </button>
      {showFeedback && <FeedbackPanel onClose={() => setShowFeedback(false)} />}
    </div>
  );
}

/** The signed-in controls as a "Name ▾" menu. The modals live outside the
 *  menu, so choosing an item can close it without closing what it opened. */
function SessionMenu({ feedback }: { feedback: boolean }) {
  const { user, capabilities, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'feedback' | 'password' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="session session--menu" ref={rootRef}>
      <button
        type="button"
        className="session-who"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {user.name}
        {user.role === 'instructor' ? ' · Instructor' : ''}
        <span className="session-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="session-menu" role="menu">
          {user.role === 'instructor' && (
            <button type="button" role="menuitem" onClick={pick(() => navigate({ kind: 'instructor' }))}>
              Dashboard
            </button>
          )}
          {feedback && (
            <button type="button" role="menuitem" onClick={pick(() => setModal('feedback'))}>
              Feedback
            </button>
          )}
          {capabilities?.usesPassword && (
            <button type="button" role="menuitem" onClick={pick(() => setModal('password'))}>
              Password
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(() => signOut(logout))}>
            Log out
          </button>
        </div>
      )}
      {modal === 'feedback' && <FeedbackPanel onClose={() => setModal(null)} />}
      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} />}
    </div>
  );
}
