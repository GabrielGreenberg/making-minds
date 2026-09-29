// The editor's question panel (task 052; design memo editor-workbench.md
// §Question panel): the problem first. Three stacked parts — a nav strip
// (Prev / Next, position, the lock tags, collapse), the current problem
// (section, title, statement with its goal table — or a multi-part problem's
// stem, lettered parts and closing, task 048 — figures, caution notes in
// view, hints and section notes behind links, the done mark), and the
// homework's problems grouped by section with the student's own marks.
// Navigation, the position and the list count PROBLEMS (problemSet.ts
// problemPages): a multi-part problem is one page, one row, one Mark done.
//
// Display only: navigation goes through `navigate` exactly as the old TabBar
// did (a viewed submission's attempt carried along), the done mark through
// the store's toggle, and every lock stays the store's (law 3) — the tags
// here only say which one applies.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssignmentData, Callout, QuestionCircuit } from '../types';
import { questionTask } from '../types';
import { useStore, selectAssignmentFrozen, selectProblemDone, showsSubmission } from '../store';
import { editorRoute, navigate } from '../routing';
import { DEFAULT_CALLOUT_TITLE, problemPages, resolveProblem, sectionOf, type ResolvedProblem } from '../problemSet';
import { parseStatement } from '../statementFormat';
import { assignmentShortName, questionHeading, questionList, sectionNotesLabel } from '../workbench';
import { FigureView, ProblemBody } from './ProblemSetDocument';
import { StatementBody } from './StatementBody';

/** Go to question `i` of the open assignment, staying on a viewed attempt. */
function useGoToQuestion(): (i: number) => void {
  return (i: number) => {
    // Whose attempt is on show rides along (routing editorRoute).
    const route = editorRoute(useStore.getState(), i);
    if (route) navigate(route, { replace: true });
  };
}

/** The current problem's heading: "Problem 1 · NAND", or just its name. */
function problemHeading(problem: Pick<ResolvedProblem, 'label' | 'question'>): string {
  return questionHeading({ label: problem.label, title: problem.question.title });
}

export function QuestionPanel({ onCollapse }: { onCollapse: () => void }) {
  const assignment = useStore((s) => s.assignment);
  const index = useStore((s) => s.currentQuestionIndex);
  const go = useGoToQuestion();
  const pages = useMemo(() => (assignment ? problemPages(assignment) : []), [assignment]);
  const problem = useMemo(() => (assignment ? resolveProblem(assignment, index) : undefined), [assignment, index]);
  if (!assignment) return null;
  // Prev / Next walk the problems: a multi-part problem is one page.
  const at = pages.indexOf(index);

  return (
    <div className="qp mm-surface">
      <div className="qp-nav">
        <button type="button" className="qp-navbtn" disabled={at <= 0} onClick={() => go(pages[at - 1])} title="Previous problem">
          ← Prev
        </button>
        <button type="button" className="qp-navbtn" disabled={at < 0 || at >= pages.length - 1} onClick={() => go(pages[at + 1])} title="Next problem">
          Next →
        </button>
        <span className="qp-pos">
          <LockTag />
          {at + 1} of {pages.length}
        </span>
        <button type="button" className="qp-collapse" onClick={onCollapse} title="Hide the question panel" aria-label="Hide the question panel">
          «
        </button>
      </div>
      {problem && <CurrentQuestion key={problem.question.id} assignment={assignment} problem={problem} />}
      <QuestionList assignment={assignment} onPick={go} />
    </div>
  );
}

/** The collapsed panel: a strip that opens it again, the problem's title set
 *  vertically so the student still knows where they are. */
export function QuestionPanelStrip({ onExpand }: { onExpand: () => void }) {
  const assignment = useStore((s) => s.assignment);
  const index = useStore((s) => s.currentQuestionIndex);
  const problem = useMemo(() => (assignment ? resolveProblem(assignment, index) : undefined), [assignment, index]);
  return (
    <button type="button" className="wb-strip wb-strip--left mm-surface" onClick={onExpand} title="Show the question panel" aria-label="Show the question panel">
      <span className="wb-strip-toggle" aria-hidden>»</span>
      {problem && <span className="wb-strip-title">{problemHeading(problem)}</span>}
    </button>
  );
}

/** Which lock the open problem is under, as the nav strip's tag. */
function LockTag() {
  const frozen = useStore(selectAssignmentFrozen);
  const viewing = useStore((s) => s.viewingSubmission);
  const done = useStore(selectProblemDone);
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

function CurrentQuestion({ assignment, problem }: { assignment: AssignmentData; problem: ResolvedProblem }) {
  // Both links start closed, and reset on every problem: the panel is keyed
  // by problem, so this state never carries over.
  const [hintOpen, setHintOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const question = problem.question;
  const section = sectionOf(assignment, question.id);
  // Every part's cautions stay in view and its hints go behind the one link.
  const parts = problem.parts.map((p) => p.question);
  const callouts = parts.flatMap((q) => q.callouts ?? []);
  const cautions = callouts.filter((c) => c.kind === 'caution');
  const hints: Callout[] = [
    ...parts.flatMap((q) => (q.hint ? [{ kind: 'hint' as const, body: q.hint }] : [])),
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
      <h2 className="qp-title">{problemHeading(problem)}</h2>
      {showRep && <div className="qp-meta">{question.representation} representation</div>}
      <div className="qp-statement">
        {section?.intro && <StatementBody text={section.intro} className="qp-intro" />}
        <ProblemBody problem={problem} showArena={false} showTitle={false} showHint={false} omitKinds={['hint', 'caution']} />
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
      <DoneMark multi={problem.parts.length > 1} />
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
 *  isCurrentQuestionLocked). One per problem: a multi-part problem is done
 *  when every part is (selectProblemDone), and the toggle writes them all.
 *  Hidden while a submission is on show, where the toggle is refused. */
function DoneMark({ multi }: { multi: boolean }) {
  const showing = useStore(showsSubmission);
  const done = useStore(selectProblemDone);
  const toggle = useStore((s) => s.toggleCurrentQuestionDone);
  if (showing) return null;
  // A button with checkbox semantics, not an <input>: the canvas's keyboard
  // shortcuts stand down while an input has focus, so a checkbox would leave
  // Delete and ⌘Z dead after the click.
  return (
    <div className="qp-done">
      <button type="button" role="checkbox" aria-checked={done} className="qp-done-label" onClick={() => toggle()}>
        <span className={done ? 'qp-done-box qp-done-box--on' : 'qp-done-box'} aria-hidden>{done ? '✓' : ''}</span>
        {multi ? "I'm done with this problem" : "I'm done with this question"}
      </button>
      {done && <div className="qp-done-note">🔒 Locked against edits — uncheck to keep working.</div>}
    </div>
  );
}

function QuestionList({ assignment, onPick }: { assignment: AssignmentData; onPick: (i: number) => void }) {
  const index = useStore((s) => s.currentQuestionIndex);
  const questionCircuits = useStore((s) => s.questionCircuits);
  const showing = useStore(showsSubmission);
  // The open problem's work is live (its canvas, each part's text), not yet
  // folded into the map; a submission on show is not the student's work, so
  // the map answers.
  const components = useStore((s) => s.components);
  const liveText = useStore((s) => s.liveText);
  const sections = useMemo(() => {
    const currentId = assignment.questions[index]?.id;
    const circuitOf = (id: number): QuestionCircuit | undefined => {
      const saved = questionCircuits.get(id);
      const text = liveText[id];
      if (showing || !text) return saved;
      return {
        components: id === currentId ? components : saved?.components ?? [],
        wires: [],
        boxes: [],
        responseText: text.responseText,
        fillAnswers: text.fillAnswers,
        done: saved?.done,
      };
    };
    return questionList(assignment, circuitOf, index);
  }, [assignment, index, questionCircuits, showing, components, liveText]);

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
