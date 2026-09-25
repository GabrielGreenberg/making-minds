import { useState } from 'react';
import { useAuth } from '../auth';
import { AccountPanel } from '../auth/AccountPanel';
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
 * The identity and its actions for the page shell's topbar. Signed in: the
 * name, Feedback (opens the report modal), Password (only when the server
 * manages passwords — AccountPanel decides), Log out. A visitor: a "Visitor"
 * tag and Sign in. One component so every page surface offers the same
 * controls in the same order.
 */
export function SessionControls({ feedback = true }: { feedback?: boolean }) {
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
