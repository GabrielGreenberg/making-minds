// The editor's question panel (task 052; design memo editor-workbench.md
// §Question panel): the problem first. Three stacked parts — a nav strip
// (Prev / Next, position, the lock tags, collapse), the current question
// (section, title, statement with its goal table, figures, caution notes in
// view, hints and section notes behind links, the done mark), and the
// homework's questions grouped by section with the student's own marks.
//
// Display only: navigation goes through `navigate` exactly as the old TabBar
// did (a viewed submission's attempt carried along), the done mark through
// the store's toggle, and every lock stays the store's (law 3) — the tags
// here only say which one applies.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssignmentData, AssignmentQuestion, Callout, QuestionCircuit } from '../types';
import { questionTask } from '../types';
import { useStore, selectAssignmentFrozen, showsSubmission } from '../store';
import { navigate } from '../routing';
import { DEFAULT_CALLOUT_TITLE, sectionOf } from '../problemSet';
import { parseStatement } from '../statementFormat';
import { assignmentShortName, questionHeading, questionList, sectionNotesLabel } from '../workbench';
import { FigureView, ProblemBody } from './ProblemSetDocument';
import { StatementBody } from './StatementBody';

/** Go to question `i` of the open assignment, staying on a viewed attempt. */
function useGoToQuestion(): (i: number) => void {
  const assignment = useStore((s) => s.assignment);
  const attempt = useStore((s) => s.viewingSubmission?.attempt);
  return (i: number) => {
    if (!assignment) return;
    navigate({ kind: 'assignment', id: assignment.id, attempt, questionIndex: i }, { replace: true });
  };
}

export function QuestionPanel({ onCollapse }: { onCollapse: () => void }) {
  const assignment = useStore((s) => s.assignment);
  const index = useStore((s) => s.currentQuestionIndex);
  const go = useGoToQuestion();
  if (!assignment) return null;
  const q = assignment.questions[index];
  const count = assignment.questions.length;

  return (
    <div className="qp mm-surface">
      <div className="qp-nav">
        <button type="button" className="qp-navbtn" disabled={index === 0} onClick={() => go(index - 1)} title="Previous question">
          ← Prev
        </button>
        <button type="button" className="qp-navbtn" disabled={index >= count - 1} onClick={() => go(index + 1)} title="Next question">
          Next →
        </button>
        <span className="qp-pos">
          <LockTag />
          {index + 1} of {count}
        </span>
        <button type="button" className="qp-collapse" onClick={onCollapse} title="Hide the question panel" aria-label="Hide the question panel">
          «
        </button>
      </div>
      {q && <CurrentQuestion key={q.id} assignment={assignment} question={q} />}
      <QuestionList assignment={assignment} onPick={go} />
    </div>
  );
}

/** The collapsed panel: a strip that opens it again, the question's title set
 *  vertically so the student still knows where they are. */
export function QuestionPanelStrip({ onExpand }: { onExpand: () => void }) {
  const q = useStore((s) => s.assignment?.questions[s.currentQuestionIndex]);
  return (
    <button type="button" className="wb-strip wb-strip--left mm-surface" onClick={onExpand} title="Show the question panel" aria-label="Show the question panel">
      <span className="wb-strip-toggle" aria-hidden>»</span>
      {q && <span className="wb-strip-title">{questionHeading(q)}</span>}
    </button>
  );
}

/** Which lock the open question is under, as the nav strip's tag. */
function LockTag() {
  const frozen = useStore(selectAssignmentFrozen);
  const viewing = useStore((s) => s.viewingSubmission);
  const done = useStore((s) => {
    const q = s.assignment?.questions[s.currentQuestionIndex];
    return q ? (s.questionCircuits.get(q.id)?.done ?? false) : false;
  });
  if (frozen) {
    return <span className="qp-tag" title="This assignment closed after its due date — showing your submitted answer, read-only.">🔒 past due</span>;
  }
  if (viewing) {
    return (
      <span className="qp-tag" title={`Your answer as submitted in attempt ${viewing.attempt}, read-only — Run and Step still work.`}>
        Submission {viewing.attempt}
      </span>
    );
  }
  if (done) return <span className="qp-tag" title="Locked — uncheck “I'm done” to edit">🔒 done</span>;
  return null;
}

function CurrentQuestion({ assignment, question }: { assignment: AssignmentData; question: AssignmentQuestion }) {
  // Both links start closed, and reset on every question: the panel is keyed
  // by question, so this state never carries over.
  const [hintOpen, setHintOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const section = sectionOf(assignment, question.id);
  const callouts = question.callouts ?? [];
  const cautions = callouts.filter((c) => c.kind === 'caution');
  const hints: Callout[] = [
    ...(question.hint ? [{ kind: 'hint' as const, body: question.hint }] : []),
    ...callouts.filter((c) => c.kind === 'hint'),
  ];
  const notesLabel = section ? sectionNotesLabel(section) : null;
  // The representation matters to a machine that reads values off wires or a
  // tape; an input-output profile already spells out every bit.
  const profileOnly = parseStatement(question.statement).every((b) => b.kind === 'io-table');
  const showRep = questionTask(question) === 'function' && !profileOnly;

  return (
    <div className="qp-current">
      {section?.heading && <div className="qp-eyebrow">{section.heading}</div>}
      <h2 className="qp-title">{questionHeading(question)}</h2>
      {showRep && <div className="qp-meta">{question.representation} representation</div>}
      <div className="qp-statement">
        {section?.intro && <StatementBody text={section.intro} className="qp-intro" />}
        <ProblemBody question={question} showArena={false} showTitle={false} showHint={false} omitKinds={['hint', 'caution']} />
      </div>
      {cautions.map((c, i) => (
        <PanelNote key={i} callout={c} className="qp-caution" />
      ))}
      {hints.length > 0 && (
        <Disclosure label="Hint" open={hintOpen} onToggle={() => setHintOpen((o) => !o)}>
          {hints.map((c, i) => <PanelNote key={i} callout={c} />)}
        </Disclosure>
      )}
      {section && notesLabel && (
        <Disclosure label={notesLabel} open={notesOpen} onToggle={() => setNotesOpen((o) => !o)}>
          {section.callouts.map((c, i) => <PanelNote key={`c${i}`} callout={c} />)}
          {section.figures.map((f, i) => <FigureView key={`f${i}`} figure={f} />)}
        </Disclosure>
      )}
      <DoneMark questionId={question.id} />
    </div>
  );
}

/** A callout as the panel shows it: its title (or its kind's) run into the
 *  text in bold, then any figures it carries. */
function PanelNote({ callout, className = 'qp-note' }: { callout: Callout; className?: string }) {
  const lead = callout.title?.trim() || DEFAULT_CALLOUT_TITLE[callout.kind].replace(/!$/, ':');
  return (
    <div className={className}>
      <StatementBody text={callout.body} lead={lead ? <strong className="qp-note-lead">{lead}</strong> : undefined} />
      {(callout.figures ?? []).map((f, i) => <FigureView key={i} figure={f} />)}
    </div>
  );
}

function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="qp-disclosure">
      <button type="button" className="qp-link" aria-expanded={open} onClick={onToggle}>
        <span className="qp-link-caret" aria-hidden>{open ? '▾' : '▸'}</span> {label}
      </button>
      {open && <div className="qp-disclosure-body">{children}</div>}
    </div>
  );
}

/** "I'm done with this question" — the student's own mark, and still a lock
 *  (Gabriel, 2026-09-25: done keeps locking, through the store's
 *  isCurrentQuestionLocked). Hidden while a submission is on show, where the
 *  toggle is refused. */
function DoneMark({ questionId }: { questionId: number }) {
  const showing = useStore(showsSubmission);
  const done = useStore((s) => s.questionCircuits.get(questionId)?.done ?? false);
  const toggle = useStore((s) => s.toggleCurrentQuestionDone);
  if (showing) return null;
  return (
    <div className="qp-done">
      <label className="qp-done-label">
        <input type="checkbox" className="qp-done-input" checked={done} onChange={() => toggle()} />
        <span className="qp-done-box" aria-hidden>{done ? '✓' : ''}</span>
        I'm done with this question
      </label>
      {done && <div className="qp-done-note">🔒 Locked against edits — uncheck to keep working.</div>}
    </div>
  );
}

function QuestionList({ assignment, onPick }: { assignment: AssignmentData; onPick: (i: number) => void }) {
  const index = useStore((s) => s.currentQuestionIndex);
  const questionCircuits = useStore((s) => s.questionCircuits);
  const showing = useStore(showsSubmission);
  // The open question's work is live on the canvas, not yet folded into the
  // map; a submission on show is not the student's work, so the map answers.
  const components = useStore((s) => s.components);
  const openResponse = useStore((s) => s.openResponse);
  const fillAnswers = useStore((s) => s.fillAnswers);
  const sections = useMemo(() => {
    const currentId = assignment.questions[index]?.id;
    const circuitOf = (id: number): QuestionCircuit | undefined => {
      const saved = questionCircuits.get(id);
      if (showing || id !== currentId) return saved;
      return { components, wires: [], boxes: [], responseText: openResponse, fillAnswers, done: saved?.done };
    };
    return questionList(assignment, circuitOf, index);
  }, [assignment, index, questionCircuits, showing, components, openResponse, fillAnswers]);

  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const short = assignmentShortName(assignment.title);
  return (
    <>
      <div className="qp-list-head">{short ? `${short} · Questions` : 'Questions'}</div>
      <div className="qp-list">
        {sections.map((section, si) => (
          <div key={si} className="qp-list-section">
            {section.heading && <div className="qp-list-label">{section.heading}</div>}
            {section.rows.map((row) => (
              <button
                key={row.index}
                ref={row.current ? currentRef : undefined}
                type="button"
                className={row.current ? 'qp-row qp-row--current' : 'qp-row'}
                aria-current={row.current ? 'step' : undefined}
                onClick={() => onPick(row.index)}
              >
                <span className="qp-row-num">{row.number}</span>
                <span className={row.title ? 'qp-row-name' : 'qp-row-name qp-row-name--dim'}>{row.title ?? row.label}</span>
                <span className={row.tag.machine ? 'tag tag--accent qp-row-tag qp-row-tag--machine' : 'qp-row-tag'}>{row.tag.text}</span>
                <span className={row.mark ? `qp-row-mark qp-row-mark--${row.mark}` : 'qp-row-mark'}>{row.mark ?? ''}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
