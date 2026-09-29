import { useStore, selectAssignmentFrozen } from '../store';
import { navigate } from '../routing';
import { StudentLayout } from './StudentLayout';
import { ProblemSetDocument, type ProblemStatus } from './ProblemSetDocument';
import { useEffect, useState } from 'react';
import { useAsyncValue } from '../useAsyncValue';
import { assignmentStore } from '../storage/backend';
import { figureUrl, problemGroups } from '../problemSet';
import { problemVerdict } from '../gradeDisplay';
import { scoreRecord } from '../engine/score';
import { dueInput } from '../lateContext';
import { COURSE_CALENDAR } from '../courseCalendar';
import { formatDueDate, formatDateTime } from '../dueDates';
import { SubmitDialog } from './SubmitDialog';
import type { AssignmentQuestion } from '../types';

/**
 * The page an assignment opens to: the problem set as a document (title, due
 * date, preamble, sections, numbered problems — components/ProblemSetDocument).
 * Clicking a problem opens its dedicated canvas (#/a/:id/q/:i); the canvas's
 * nav bar leads back here or to the neighbouring problems. Submit covers the
 * whole assignment. While a submitted attempt is on show (#/a/:id/submission/:n,
 * store viewingSubmission) the page says so, its problems open that attempt,
 * and Submit gives way to the way back to the live work.
 */
export function AssignmentOverview() {
  const assignment = useStore((s) => s.assignment);
  const submissions = useStore((s) => s.submissions);
  // Submit opens the one Submit dialog (components/SubmitDialog.tsx).
  const [submitting, setSubmitting] = useState(false);
  const hydrateSubmissions = useStore((s) => s.hydrateSubmissions);
  const questionCircuits = useStore((s) => s.questionCircuits);
  const frozen = useStore(selectAssignmentFrozen);
  const viewing = useStore((s) => s.viewingSubmission);
  // Release is policy on the seam, not part of the assignment, so the page has
  // to ask for it (the home catalog gets it on the summary).
  const { value: released } = useAsyncValue(
    () => (assignment ? assignmentStore.getGradesReleased(assignment.id) : Promise.resolve(false)),
    [assignment?.id],
  );

  // Re-fetch on every visit (not just once at app boot) so a grade or
  // feedback note recorded after the student's last reload shows up here
  // without requiring a hard refresh.
  useEffect(() => {
    void hydrateSubmissions();
  }, [hydrateSubmissions, assignment?.id]);

  if (!assignment) return null;
  const sub = submissions[assignment.id];
  // Problems, not questions: a multi-part problem (task 048) counts once, and
  // is done when every part is (its one Mark done).
  const problems = problemGroups(assignment);
  const total = problems.length;
  const done = problems.filter((g) => g.parts.every((i) => questionCircuits.get(assignment.questions[i].id)?.done)).length;
  // Once released: each problem's points, from the one grade definition.
  const score =
    released && sub?.result
      ? scoreRecord(assignment.questions, sub, Date.now(), dueInput(assignment, { waived: sub.lateWaived }, COURSE_CALENDAR))
      : null;
  const results = new Map((sub?.result?.questions ?? []).map((r) => [r.questionId, r]));
  const status = (q: AssignmentQuestion): ProblemStatus => ({
    done: questionCircuits.get(q.id)?.done,
    verdict: score ? problemVerdict(score.problems.find((p) => p.questionId === q.id), results.get(q.id)) : undefined,
  });

  return (
    <StudentLayout current="assignments">
      <div className="mm-head">
        <a
          className="eyebrow"
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate({ kind: 'home' }); }}
        >
          ← All assignments
        </a>
        <h1>{assignment.title}</h1>
        <p className="mm-lede overview-meta">
          {assignment.dueDate && (
            <span>
              Due {formatDueDate(assignment.dueDate)}
              {assignment.dueExtended && ' (extended)'}
            </span>
          )}
          <span>
            {total} problem{total === 1 ? '' : 's'}
            {total > 0 && ` · ${done} of ${total} marked done`}
          </span>
          {assignment.sourcePdf && (
            <a
              className="mm-link"
              href={figureUrl(assignment.sourcePdf, import.meta.env.BASE_URL)}
              target="_blank"
              rel="noopener"
            >
              Original PDF ↗
            </a>
          )}
        </p>
      </div>

      <ProblemSetDocument
        assignment={assignment}
        route={(index) => ({ kind: 'assignment', id: assignment.id, attempt: viewing?.attempt, questionIndex: index })}
        status={status}
      />

      <div className="overview-submit">
        {sub ? (
          <span className="home-status--done" title={`Attempt ${sub.attempt}`}>
            ✓ Submitted {new Date(sub.submittedAt).toLocaleString()}
          </span>
        ) : (
          <span className="dim">Not submitted</span>
        )}
        <span className="mm-actions">
          {released && sub?.result && (
            <button className="mm-btn" onClick={() => navigate({ kind: 'grades', id: assignment.id })}>
              View grades
            </button>
          )}
          {frozen ? (
            <span
              className="home-locked"
              title="This assignment closed after its due date — each question shows your submission, read-only."
            >
              🔒 Past due — showing your submission
            </span>
          ) : viewing ? (
            <span className="dim" title="Each problem opens your answer as submitted in this attempt — Run and Step still work, edits are off.">
              Viewing submission {viewing.attempt}, submitted {formatDateTime(viewing.submittedAt)} — read-only ·{' '}
              <button className="mm-link" onClick={() => navigate({ kind: 'assignment', id: assignment.id })}>
                Back to my work
              </button>
            </span>
          ) : (
            <button className="mm-btn mm-btn--primary" onClick={() => setSubmitting(true)}>
              Submit assignment
            </button>
          )}
        </span>
      </div>

      {submitting && (
        <SubmitDialog assignment={assignment} onClose={() => setSubmitting(false)} />
      )}
    </StudentLayout>
  );
}
