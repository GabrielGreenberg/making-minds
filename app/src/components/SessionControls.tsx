import { useState } from 'react';
import { useAuth } from '../auth';
import { AccountPanel } from '../auth/AccountPanel';
import { navigate } from '../routing';
import { FeedbackPanel } from './FeedbackPanel';

/**
 * The signed-in identity and its actions for the page shell's topbar: the
 * name, Feedback (opens the report modal), Password (only when the server
 * manages passwords — AccountPanel decides), Log out. One component so every
 * page surface offers the same controls in the same order.
 */
export function SessionControls({ feedback = true }: { feedback?: boolean }) {
  const { user, logout } = useAuth();
  const [showFeedback, setShowFeedback] = useState(false);

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
      <button type="button" onClick={() => { logout(); navigate({ kind: 'home' }); }}>
        Log out
      </button>
      {showFeedback && <FeedbackPanel onClose={() => setShowFeedback(false)} />}
    </div>
  );
}
