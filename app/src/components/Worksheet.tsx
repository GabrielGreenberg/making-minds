// The answer area of a written problem (task 048; memo
// docs/buildout/designs/multi-part-problems.md) — the editor frame's centre
// (EditorShell) for an open or fill-in question, reading as a printed
// worksheet (Gabriel, 2026-09-26): the problem's stem, then each part's
// prompt directly followed by that part's field, then its closing. A
// multi-part problem sits on ONE page; a single written question reads the
// same way — its statement, then its field. The question panel beside it
// keeps the whole problem too: the text is restated here, not moved.
//
// A part's field follows its kind (problemSet.ts writtenKind): a line, a
// paragraph, labelled blanks, or a blank argument–value TABLE (task 079;
// cell (r, c) is fillAnswers[r·C + c]) drawn from the spec's headers and row
// count, never from a key — a student's copy has none, and nothing here
// reads one. Each part's answer is its own: the store's liveText[its id],
// saved and graded as that question.
//
// Every field on the page wears the ONE provenance guard (usePasteGuard; law
// 8): only text copied in the student's own assignments pastes in, and
// nothing copied here reaches the system clipboard. Into a digits-only blank
// or column no characters but digits reach the store. Locking is the
// store's (both setters ask isCurrentQuestionLocked first; law 3) —
// `readOnly` here only shows it.
//
// `Worksheet` is the one connector (the store's page, live text, lock and
// setters, and the page's paste guard); `WorksheetSheet` draws from props
// alone, so the harness renders it (navResetCheck [worksheet]).

import { useMemo, useState } from 'react';
import type { AssignmentData, AssignmentQuestion } from '../types';
import { useStore, selectLockNotice, type LiveText } from '../store';
import { usePasteGuard } from '../usePasteGuard';
import { problemLabel, resolveProblem, writtenKind } from '../problemSet';
import { fillInShape, fillInTableRows, type FillInTableShape } from '../engine/fillIn';
import { FigureView } from './ProblemSetDocument';
import { InlineMarkup, StatementBody } from './StatementBody';

type GuardRef = ReturnType<typeof usePasteGuard>['ref'];

const NO_TEXT: LiveText = { responseText: '', fillAnswers: [] };

export function Worksheet() {
  const assignment = useStore((s) => s.assignment);
  const index = useStore((s) => s.currentQuestionIndex);
  const liveText = useStore((s) => s.liveText);
  // Why the problem refuses edits (marked done, or it shows a submission).
  const lockNotice = useStore(selectLockNotice);
  const saveFailing = useStore((s) => s.autoSaveStatus === 'error');
  const setOpenResponse = useStore((s) => s.setOpenResponse);
  const setFillAnswer = useStore((s) => s.setFillAnswer);
  const { ref: pasteGuardRef, notice: pasteNotice } = usePasteGuard();

  if (!assignment) return null;
  return (
    <WorksheetSheet
      assignment={assignment}
      index={index}
      liveText={liveText}
      lockNotice={lockNotice}
      pasteNotice={pasteNotice}
      saveFailing={saveFailing}
      pasteGuardRef={pasteGuardRef}
      onText={setOpenResponse}
      onFill={setFillAnswer}
    />
  );
}

export interface WorksheetSheetProps {
  assignment: AssignmentData;
  /** Any question index of the problem on show (its page). */
  index: number;
  /** Each part's answer, by question id (a missing part reads empty). */
  liveText: Readonly<Record<number, LiveText>>;
  /** Why the problem is read-only, or null. */
  lockNotice: string | null;
  /** A refused paste's message, or null. */
  pasteNotice: string | null;
  saveFailing: boolean;
  pasteGuardRef: GuardRef;
  onText: (questionId: number, text: string) => void;
  onFill: (questionId: number, index: number, value: string) => void;
}

/** The worksheet from props alone: the problem's stem, each part's prompt
 *  followed by its field, the closing, the one foot line. */
export function WorksheetSheet({
  assignment,
  index,
  liveText,
  lockNotice,
  pasteNotice,
  saveFailing,
  pasteGuardRef,
  onText,
  onFill,
}: WorksheetSheetProps) {
  const locked = lockNotice !== null;
  const problem = useMemo(() => resolveProblem(assignment, index), [assignment, index]);

  if (!problem) return null;
  const first = problem.question;
  const title = first.title?.trim();
  const label = problemLabel(assignment, index);

  return (
    <div className="wb-answer mm-surface">
      <div className="wb-answer-inner wb-sheet">
        <div className="eyebrow wb-answer-eyebrow">{label}</div>
        {title && (
          <h2 className="wb-sheet-title"><InlineMarkup text={title} /></h2>
        )}
        {first.stem?.trim() && <StatementBody text={first.stem} className="wb-sheet-stem" />}
        {problem.parts.map((part) => (
          <section key={part.question.id} className="wb-sheet-part">
            <div className="wb-sheet-prompt">
              <StatementBody
                text={part.question.statement}
                lead={part.letter ? <strong className="wb-sheet-letter">{part.letter}.</strong> : undefined}
              />
              {(part.question.figures ?? []).map((f, i) => <FigureView key={i} figure={f} />)}
            </div>
            <PartField
              question={part.question}
              name={part.letter ? `${label}${part.letter}` : label}
              text={liveText[part.question.id] ?? NO_TEXT}
              locked={locked}
              pasteGuardRef={pasteGuardRef}
              onText={onText}
              onFill={onFill}
            />
          </section>
        ))}
        {first.closing?.trim() && <StatementBody text={first.closing} className="wb-sheet-closing" />}
        <AnswerFoot pasteNotice={pasteNotice} lockNotice={lockNotice} saveFailing={saveFailing} />
      </div>
    </div>
  );
}

/** One part's field, by its kind, bound to that part's own answer. */
function PartField({
  question,
  name,
  text,
  locked,
  pasteGuardRef,
  onText,
  onFill,
}: {
  question: AssignmentQuestion;
  name: string;
  text: LiveText;
  locked: boolean;
  pasteGuardRef: GuardRef;
  onText: (questionId: number, text: string) => void;
  onFill: (questionId: number, index: number, value: string) => void;
}) {
  const id = question.id;
  const kind = writtenKind(question);
  const setOpenResponse = (value: string) => onText(id, value);
  const setFillAnswer = (i: number, value: string) => onFill(id, i, value);
  // A line part whose text already holds a line break — an answer written
  // while it was a paragraph (HW1's pilot answers to 6b, 9a, 10a–c) — keeps
  // a paragraph field: an <input> would flatten the breaks, and the next
  // keystroke would save that. Latched for as long as this part is on show,
  // so deleting the last break never swaps the field (and focus) mid-edit.
  const hasBreak = text.responseText.includes('\n');
  const [keepsParagraph, keepParagraph] = useState(hasBreak);
  if (hasBreak && !keepsParagraph) keepParagraph(true);

  if (kind === 'line' && !keepsParagraph) {
    return (
      <input
        className="wb-sheet-line"
        value={text.responseText}
        onChange={(e) => setOpenResponse(e.target.value)}
        ref={pasteGuardRef}
        aria-label={`Your answer to ${name}`}
        autoComplete="off"
        spellCheck
        readOnly={locked}
      />
    );
  }
  if ((kind === 'blanks' || kind === 'table') && question.fill_in) {
    const shape = fillInShape(question.fill_in);
    if (shape.kind === 'table') {
      return (
        <FillInTable
          shape={shape}
          answers={text.fillAnswers}
          locked={locked}
          pasteGuardRef={pasteGuardRef}
          onChange={setFillAnswer}
        />
      );
    }
    return (
      <div className="wb-fill-grid">
        {/* Keyed by position: answers are positional (fillAnswers[i] is
            blank i), and labels are unique only by authoring. */}
        {shape.blanks.map((blank, i) => (
          <label key={i} className="wb-fill-field">
            <span className="wb-fill-label">{blank.label}</span>
            <input
              className="wb-fill-input"
              value={text.fillAnswers[i] ?? ''}
              inputMode={blank.digitsOnly ? 'numeric' : 'text'}
              autoComplete="off"
              spellCheck={false}
              readOnly={locked}
              ref={pasteGuardRef}
              onChange={(e) => setFillAnswer(i, blank.digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value)}
            />
          </label>
        ))}
      </div>
    );
  }
  return (
    <textarea
      className="wb-answer-text wb-sheet-paragraph"
      value={text.responseText}
      onChange={(e) => setOpenResponse(e.target.value)}
      ref={pasteGuardRef}
      placeholder="Write your answer here."
      aria-label={`Your answer to ${name}`}
      spellCheck
      readOnly={locked}
    />
  );
}

/** The blank argument–value table: the headers, then `rows` rows of empty
 *  cells, every one wearing the page's one paste guard. */
function FillInTable({
  shape,
  answers,
  locked,
  pasteGuardRef,
  onChange,
}: {
  shape: FillInTableShape;
  answers: readonly string[];
  locked: boolean;
  pasteGuardRef: GuardRef;
  onChange: (index: number, value: string) => void;
}) {
  const c = shape.columns.length;
  return (
    <div className="mm-tablewrap wb-fill-tablewrap">
      <table className="mm-table wb-fill-table">
        <thead>
          <tr>
            {shape.columns.map((col, j) => (
              <th key={j} className={j === shape.argColumns ? 'wb-fill-value-start' : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Keyed by position: cell (r, j) is fillAnswers[r·C + j]. */}
          {fillInTableRows(shape, answers).map((row, r) => (
            <tr key={r}>
              {row.map((cell, j) => {
                const col = shape.columns[j];
                return (
                  <td key={j} className={j === shape.argColumns ? 'wb-fill-value-start' : undefined}>
                    <input
                      className="wb-fill-cell"
                      value={cell}
                      aria-label={`${col.header}, row ${r + 1}`}
                      inputMode={col.digitsOnly ? 'numeric' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      readOnly={locked}
                      ref={pasteGuardRef}
                      onChange={(e) =>
                        onChange(
                          r * c + j,
                          col.digitsOnly ? e.target.value.replace(/\D/g, '') : e.target.value,
                        )
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The answer area's one line: a refused paste, else why the problem is
 *  read-only, else how saving is going — "Saved as you type." unless a
 *  remote save is failing, when it never claims to be saved. */
function AnswerFoot({ pasteNotice, lockNotice, saveFailing }: { pasteNotice: string | null; lockNotice: string | null; saveFailing: boolean }) {
  if (pasteNotice) return <div className="wb-answer-foot paste-notice" role="status">{pasteNotice}</div>;
  if (lockNotice) return <div className="wb-answer-foot">{lockNotice}</div>;
  if (saveFailing) {
    return (
      <div className="wb-answer-foot wb-answer-foot--error">
        Not saved yet — your answer is kept in this browser, and saving retries on its own.
      </div>
    );
  }
  return <div className="wb-answer-foot">Saved as you type.</div>;
}
