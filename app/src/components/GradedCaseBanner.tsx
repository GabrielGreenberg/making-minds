// The graded case loaded into this question's run ("Run this input" on the
// grade sheet → store loadCaseInput), shown under the question statement in
// every mode's panel.
//
// Three things, side by side: the verdict RECORDED for the case when it was
// graded (✗ + the reason, or "wrong output" — never the expected output), the
// verdict of THIS run — the canvas machine put through the grader's own case
// run (engine/caseRun.ts), so a remote student sees the output their machine
// gave without the server ever sending it — and whether the two are the same
// run. They are the same when the canvas holds the machine that was graded
// (a viewed submission — frozen or not — always does) — the machine of the case's own attempt,
// even after a later submit. When it does not — grades released before the
// due date and the question edited, or resubmitted, since — the run is of the
// CURRENT machine, and the banner says so rather than claim a match. The
// wording is gradeDisplay's gradedCaseView (pure, pinned in caseRunCheck).

import { useMemo } from 'react';
import { useStore } from '../store';
import { gradedCaseView } from '../gradeDisplay';
import { navigate } from '../routing';

export function GradedCaseBanner() {
  const loadedCase = useStore((s) => s.loadedCase);
  const assignment = useStore((s) => s.assignment);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);
  const viewedAttempt = useStore((s) => s.viewingSubmission?.attempt);
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const latestAttempt = useStore((s) => (s.assignment ? s.submissions[s.assignment.id]?.attempt : undefined));
  const loadCaseInput = useStore((s) => s.loadCaseInput);
  const clearLoadedCase = useStore((s) => s.clearLoadedCase);

  const question = assignment?.questions[currentQuestionIndex];
  const active = question && loadedCase && loadedCase.questionId === question.id ? loadedCase : null;

  // Recomputed as the machine changes; the grading circuit ignores run
  // scratch (MEM contents, INPUT toggles), so the verdict is the machine's,
  // not the run's position. Compared against the machine graded in the
  // case's OWN attempt (gradeDisplay gradedCaseView), not the latest one.
  const view = useMemo(
    () => (question && active ? gradedCaseView(question, active, { components, wires }, latestAttempt) : null),
    [question, active, components, wires, latestAttempt],
  );

  if (!assignment || !question || !active || !view) return null;
  const { what, recorded, now, note, noteText } = view;

  const close = () => {
    clearLoadedCase();
    // Drop the case from the URL, so a reload does not load it again — and
    // only the case: a submission on show stays on show.
    navigate({ kind: 'assignment', id: assignment.id, attempt: viewedAttempt, questionIndex: currentQuestionIndex }, { replace: true });
  };

  return (
    <div className="graded-case" role="status">
      <div className="graded-case-head">
        <span>Graded input · attempt {active.attempt}</span>
        <button className="graded-case-close" onClick={close} title="Dismiss" aria-label="Dismiss">✕</button>
      </div>
      <div className="graded-case-what">{what}</div>
      <div className="graded-case-row">
        <span className="graded-case-label">When graded</span>
        <span className={recorded.pass ? 'graded-case-pass' : 'graded-case-fail'}>{recorded.text}</span>
      </div>
      <div className="graded-case-row">
        <span className="graded-case-label">This run</span>
        <span className={now.pass === true ? 'graded-case-pass' : now.pass === false ? 'graded-case-fail' : undefined}>
          {now.text}
        </span>
      </div>
      <p className={note === 'same' ? 'graded-case-same' : 'graded-case-note'}>{noteText}</p>
      <div className="graded-case-actions">
        <button className="action-btn" onClick={() => void loadCaseInput(question.id, active.caseIndex)}>
          Run again
        </button>
        {question.buildMode !== 'CC' && <span className="graded-case-hint">Reset replays it step by step.</span>}
      </div>
    </div>
  );
}
