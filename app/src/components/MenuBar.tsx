import { useState } from 'react';
import { useStore, selectAssignmentFrozen, showsSubmission } from '../store';
import { getCurrentUserEmail, useAuth } from '../auth';
import { AccountPanel } from '../auth/AccountPanel';
import { navigate } from '../routing';
import { signOut } from './SessionControls';
import { FeedbackPanel } from './FeedbackPanel';
import { submitConfirmMessage } from '../provenance/notice';

export function MenuBar() {
  const { user, isVisitor, logout } = useAuth();
  const { assignment, submitAssignment, submissions, viewingSubmission } = useStore();
  const frozen = useStore(selectAssignmentFrozen);
  const showingSubmission = useStore(showsSubmission);
  const [showFeedback, setShowFeedback] = useState(false);

  const handleSubmitAssignment = () => {
    if (!assignment) return;
    const ok = confirm(submitConfirmMessage(assignment.title));
    if (!ok) return;
    // Submit is online-only, never queued: a failure records NOTHING and asks
    // for a visible retry (the server stamps the submission time, so nothing
    // can be silently late near a deadline). The work itself is autosaved.
    void submitAssignment(assignment.id, getCurrentUserEmail()).catch(() => {
      alert(
        'Submission failed — the server could not be reached, and nothing was recorded.\n\n' +
        'Your work is still saved. Please try Submit again in a moment.'
      );
    });
  };

  return (
    <div className="menu-bar">
      {/* Home — back to the assignment catalog (a visitor has none) */}
      {!isVisitor && (
        <div className="menu-item" onClick={() => navigate({ kind: 'home' })}>
          ⌂ Home
        </div>
      )}

      {/* Submit — record an immutable snapshot of the current assignment.
          Hidden while the canvas shows a submission — frozen (item 3), or a
          submitted attempt viewed from the grade sheet (task 003): what is on
          screen is not the work a submit would record. */}
      {assignment && !showingSubmission && (
        <div
          className="menu-item menu-submit"
          onClick={handleSubmitAssignment}
          title={
            submissions[assignment.id]
              ? `Last submitted ${new Date(submissions[assignment.id].submittedAt).toLocaleString()}`
              : 'Submit this assignment'
          }
        >
          {submissions[assignment.id] ? 'Submit ✓' : 'Submit'}
        </div>
      )}
      {assignment && frozen && (
        <div className="menu-item menu-frozen" title="This assignment closed after its due date — you're viewing your submission, read-only.">
          🔒 Past due — viewing your submission
        </div>
      )}
      {assignment && !frozen && viewingSubmission && (
        <div className="menu-item menu-frozen" title="Your answers as submitted in this attempt — Run and Step still work, edits are off.">
          Viewing submission {viewingSubmission.attempt} — read-only
        </div>
      )}

      {/* Session controls — right-aligned. The instructor link is shown only to
          instructor accounts; students never see it (typing #/instructor hits the
          access-denied gate). */}
      <div className="menu-right">
        {user?.role === 'instructor' && (
          <button
            className="menu-link-button"
            onClick={() => navigate({ kind: 'instructor' })}
          >
            Instructor view
          </button>
        )}
        {user && (
          <>
            <span className="session-chip">
              {user.name}
              {user.role === 'instructor' ? ' · Instructor' : ''}
            </span>
            <button className="menu-link-button" onClick={() => setShowFeedback(true)}>
              Feedback
            </button>
            <AccountPanel />
            <button className="menu-link-button" onClick={() => signOut(logout)}>
              Log out
            </button>
          </>
        )}
        {/* A visitor: who they are, and the way in. No Feedback — reports
            are filed by a signed-in account (the server requires one). */}
        {isVisitor && (
          <>
            <span className="session-chip session-chip--visitor">Visitor</span>
            <button className="menu-link-button" onClick={() => navigate({ kind: 'home' })}>
              Sign in
            </button>
          </>
        )}
      </div>
      {showFeedback && <FeedbackPanel onClose={() => setShowFeedback(false)} />}
    </div>
  );
}
