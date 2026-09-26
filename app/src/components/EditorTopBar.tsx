// The editor's top bar (task 052; design memo editor-workbench.md §Top bar):
// the brand (Home), a breadcrumb to the assignment's document, the save state,
// the submitted time and Submit, and the session controls. It replaces the
// old MenuBar and the question half of TabBar; the sandbox keeps its File
// menu here and its worksheet tabs above the canvas.

import { useEffect, useState } from 'react';
import { useStore, selectAssignmentFrozen, showsSubmission } from '../store';
import { getCurrentUserEmail, useAuth } from '../auth';
import { navigate } from '../routing';
import { hashLink } from './PageShell';
import { SessionControls } from './SessionControls';
import { WorkbookFileMenu } from './WorkbookFileMenu';
import { submitConfirmMessage } from '../provenance/notice';
import { saveLabel, submittedLabel } from '../workbench';

/** The clock, re-read every `ms` — for labels that age ("Saved 3 min ago"). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function EditorTopBar() {
  const { user } = useAuth();
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const submission = useStore((s) => (s.assignment ? s.submissions[s.assignment.id] : undefined));
  const submitAssignment = useStore((s) => s.submitAssignment);
  const viewingSubmission = useStore((s) => s.viewingSubmission);
  const frozen = useStore(selectAssignmentFrozen);
  const showingSubmission = useStore(showsSubmission);
  const status = useStore((s) => s.autoSaveStatus);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const now = useNow(30_000);

  const handleSubmit = () => {
    if (!assignment) return;
    if (!confirm(submitConfirmMessage(assignment.title))) return;
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

  // A submission on show saves nothing, so there is no save state to report.
  const save = showingSubmission ? null : saveLabel(status, lastSavedAt, now);

  return (
    <header className="wb-topbar">
      {user ? (
        <a className="wb-brand" {...hashLink({ kind: 'home' })} title="Home — your assignments">
          Making Minds<span className="wb-course">PHIL 133</span>
        </a>
      ) : (
        <span className="wb-brand">
          Making Minds<span className="wb-course">PHIL 133</span>
        </span>
      )}

      <nav className="wb-crumbs" aria-label="Where you are">
        {assignment ? (
          <>
            <a {...hashLink({ kind: 'home' })}>Assignments</a>
            <span className="wb-crumb-sep" aria-hidden>/</span>
            <a
              className="wb-crumb-current"
              {...hashLink({ kind: 'assignment', id: assignment.id, attempt: viewingSubmission?.attempt })}
              title={`${assignment.title} — the whole problem set`}
            >
              {assignment.title}
            </a>
          </>
        ) : (
          <>
            <span className="wb-crumb-current">Sandbox</span>
            {/* File — the sandbox as a workbook file on this computer (New,
                Open…, Save, Save as…). Never in an assignment: a file only
                ever opens as sandbox tabs. */}
            <WorkbookFileMenu />
          </>
        )}
      </nav>

      <div className="wb-topbar-right">
        {save && (
          <span className={save.error ? 'wb-save wb-save--error' : 'wb-save'} role="status" title={
            save.error
              ? 'The server could not be reached — your work is kept in this browser and saving will retry automatically'
              : undefined
          }>
            {save.text}
          </span>
        )}
        {assignment && frozen && (
          <span className="wb-lock" title="This assignment closed after its due date — you're viewing your submission, read-only.">
            🔒 Past due — viewing your submission
          </span>
        )}
        {assignment && !frozen && viewingSubmission && (
          <>
            <span className="wb-lock" title="Your answers as submitted in this attempt — Run and Step still work, edits are off.">
              Viewing submission {viewingSubmission.attempt} — read-only
            </span>
            <button
              type="button"
              className="mm-btn mm-btn--primary wb-primary"
              onClick={() => navigate({ kind: 'assignment', id: assignment.id, questionIndex: currentQuestionIndex })}
              title="Leave the submission and go back to your live work on this question"
            >
              Back to my work
            </button>
          </>
        )}
        {assignment && !showingSubmission && (
          <>
            {submission && <span className="wb-submitted">{submittedLabel(submission.submittedAt, now)}</span>}
            <button type="button" className="mm-btn mm-btn--primary wb-primary" onClick={handleSubmit}>
              {submission ? 'Submit again' : 'Submit assignment'}
            </button>
          </>
        )}
        <SessionControls menu />
      </div>
    </header>
  );
}
