// The editor's top bar (task 052; design memo editor-workbench.md §Top bar):
// the brand (Home), a breadcrumb to the assignment's document, the save state,
// the submitted time and Submit, and the session controls. It replaces the
// old MenuBar and the question half of TabBar; the sandbox keeps its File
// menu here and its worksheet tabs above the canvas.

import { useEffect, useState } from 'react';
import { useStore, selectAssignmentFrozen, showsSubmission, type SubmissionOwner } from '../store';
import { useAuth } from '../auth';
import { navigate } from '../routing';
import { hashLink } from './PageShell';
import { SessionControls } from './SessionControls';
import { WorkbookFileMenu } from './WorkbookFileMenu';
import { SubmitDialog } from './SubmitDialog';
import { saveLabel, submittedLabel } from '../workbench';
import { FROZEN_BADGE, FROZEN_NOTICE } from '../dueDates';

/** The clock, re-read every `ms` — for labels that age ("Saved 3 min ago"). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The crumbs over another person's attempt (task 067): back to the
 *  Grading tab, the assignment's matrix and the student's submission page —
 *  never to the viewer's own work. */
function ForeignCrumbs({ id, title, owner }: { id: string; title: string; owner: SubmissionOwner }) {
  return (
    <>
      <a {...hashLink({ kind: 'instructor-grading' })}>Grading</a>
      <span className="wb-crumb-sep" aria-hidden>/</span>
      <a {...hashLink({ kind: 'instructor-grading-assignment', id, view: 'matrix' })}>{title}</a>
      <span className="wb-crumb-sep" aria-hidden>/</span>
      <a
        className="wb-crumb-current"
        {...hashLink({ kind: 'instructor-grading-student', id, student: owner.key })}
        title={`${owner.name}'s submission (every problem)`}
      >
        {owner.name}
      </a>
    </>
  );
}

export function EditorTopBar() {
  const { user } = useAuth();
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const submission = useStore((s) => (s.assignment ? s.submissions[s.assignment.id] : undefined));
  const viewingSubmission = useStore((s) => s.viewingSubmission);
  // Another person's attempt on show (task 067): the crumbs lead back to
  // their submission page, never to this person's own work.
  const owner = useStore((s) => s.viewingOwner);
  const frozen = useStore(selectAssignmentFrozen);
  const showingSubmission = useStore(showsSubmission);
  const status = useStore((s) => s.autoSaveStatus);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const now = useNow(30_000);

  // Submit opens the one Submit dialog (components/SubmitDialog.tsx).
  const [submitting, setSubmitting] = useState(false);

  // A submission on show saves nothing, so there is no save state to report.
  const save = showingSubmission ? null : saveLabel(status, lastSavedAt, now);

  return (
    <header className="wb-topbar">
      {user ? (
        <a className="wb-brand" {...hashLink({ kind: 'home' })} title="Home">
          Making Minds<span className="wb-course">PHIL 133</span>
        </a>
      ) : (
        <span className="wb-brand">
          Making Minds<span className="wb-course">PHIL 133</span>
        </span>
      )}

      <nav className="wb-crumbs" aria-label="Where you are">
        {assignment ? (
          owner ? (
            <ForeignCrumbs id={assignment.id} title={assignment.title} owner={owner} />
          ) : (
            <>
              <a {...hashLink({ kind: 'home' })}>Assignments</a>
              <span className="wb-crumb-sep" aria-hidden>/</span>
              <a
                className="wb-crumb-current"
                {...hashLink({ kind: 'assignment', id: assignment.id, attempt: viewingSubmission?.attempt })}
                title={`${assignment.title} (the whole problem set)`}
              >
                {assignment.title}
              </a>
            </>
          )
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
              ? 'The server could not be reached. Your work is kept in this browser, and saving will retry automatically.'
              : undefined
          }>
            {save.text}
          </span>
        )}
        {assignment && frozen && (
          <span className="wb-lock" title={FROZEN_NOTICE}>
            {FROZEN_BADGE}
          </span>
        )}
        {assignment && owner && viewingSubmission && (
          <>
            <span className="wb-lock" title={`${owner.name}'s answers as submitted in this attempt are read-only. Run and Step still work.`}>
              Viewing {owner.name}'s attempt {viewingSubmission.attempt} (read-only)
            </span>
            <button
              type="button"
              className="mm-btn mm-btn--primary wb-primary"
              onClick={() => navigate({ kind: 'instructor-grading-student', id: assignment.id, student: owner.key })}
              title={`Leave the viewer and go back to ${owner.name}'s submission page`}
            >
              Back to {owner.name}'s submission
            </button>
          </>
        )}
        {assignment && !owner && !frozen && viewingSubmission && (
          <>
            <span className="wb-lock" title="Your answers as submitted in this attempt are read-only. Run and Step still work.">
              Viewing submission {viewingSubmission.attempt} (read-only)
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
            <button type="button" className="mm-btn mm-btn--primary wb-primary" onClick={() => setSubmitting(true)}>
              {submission ? 'Submit again' : 'Submit assignment'}
            </button>
            {submitting && (
              <SubmitDialog assignment={assignment} onClose={() => setSubmitting(false)} />
            )}
          </>
        )}
        <SessionControls menu />
      </div>
    </header>
  );
}
