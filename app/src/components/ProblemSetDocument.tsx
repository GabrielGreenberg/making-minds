// The problem-set document: an assignment rendered the way its handout reads
// — preamble, sections (heading over a rule, the intro that carries the
// instruction for a run of problems), continuously numbered problems with
// run-in bold titles, truth tables several per row, one-liners in columns,
// callout boxes styled per kind, figures, a turbot's arena drawn live. Each
// problem links to its canvas and carries an unobtrusive status mark in the
// number gutter. A multi-part problem (task 048) is one problem: its stem,
// its lettered parts (each with its own verdict mark once released), its
// closing. The semantics (section normalisation, grouping, numbering,
// layout) are src/problemSet.ts; the markup renderer is StatementBody.
//
// `ProblemBody` is the part the editor reuses — the question panel
// (QuestionPanel.tsx) renders the whole problem with it, so a problem
// transcribed PDF-style — "NAND" over a table, or "6." over parts a–c —
// reads correctly on its own page too.

import type { MouseEvent, ReactNode } from 'react';
import type { AssignmentData, AssignmentQuestion, Callout, CalloutKind, Figure, Placement } from '../types';
import { questionModeLabel } from '../types';
import {
  DEFAULT_CALLOUT_TITLE,
  calloutTitleIsBlock,
  documentSections,
  figureUrl,
  placementOf,
  problemRuns,
  type ResolvedProblem,
  type ResolvedSection,
} from '../problemSet';
import { navigate, type Route } from '../routing';
import { hashLink } from './PageShell';
import { InlineMarkup, StatementBody } from './StatementBody';
import { parseStatement } from '../statementFormat';
import { ArenaCanvas } from './ArenaCanvas';
import type { Verdict } from '../gradeDisplay';

/** What the margin shows beside a problem: the student's own "done" tick and,
 *  once grades are released, the verdict. */
export interface ProblemStatus {
  done?: boolean;
  verdict?: Verdict;
}

// `?.`: import.meta.env exists only under Vite, and the harness renders the
// Worksheet (which borrows FigureView) under tsx (navResetCheck [worksheet]).
const BASE_URL: string = import.meta.env?.BASE_URL ?? '/';

export function FigureView({ figure }: { figure: Figure }) {
  return (
    <figure className="ps-figure">
      <img
        src={figureUrl(figure.src, BASE_URL)}
        alt={figure.alt}
        loading="lazy"
        style={figure.width ? { maxWidth: figure.width } : undefined}
      />
      {figure.caption && <figcaption><StatementBody text={figure.caption} /></figcaption>}
    </figure>
  );
}

/** `note` = a problem's margin note: no default heading, the kind shows only
 *  as its colour, as the PDFs' "<<" notes beside a table. */
function CalloutView({ callout, note = false }: { callout: Callout; note?: boolean }) {
  const title = callout.title ?? (note ? '' : DEFAULT_CALLOUT_TITLE[callout.kind]);
  const block = calloutTitleIsBlock(callout);
  return (
    <div className={`ps-callout ps-callout--${callout.kind}`}>
      {block && title && <div className="ps-callout-title">{title}</div>}
      <StatementBody
        text={callout.body}
        lead={!block && title ? <strong className="ps-callout-lead">{title}</strong> : undefined}
      />
      {(callout.figures ?? []).map((f, i) => <FigureView key={i} figure={f} />)}
    </div>
  );
}

/** The callouts and figures of one owner at one placement, callouts first. */
function Attachments({ callouts, figures, where, note = false }: { callouts: Callout[]; figures: Figure[]; where: Placement; note?: boolean }) {
  const cs = callouts.filter((c) => placementOf(c) === where);
  const fs = figures.filter((f) => placementOf(f) === where);
  if (cs.length === 0 && fs.length === 0) return null;
  return (
    <div className={`ps-attachments ps-attachments--${where}`}>
      {cs.map((c, i) => <CalloutView key={`c${i}`} callout={c} note={note} />)}
      {fs.map((f, i) => <FigureView key={`f${i}`} figure={f} />)}
    </div>
  );
}

/** Cell size that keeps an arena around 220px wide, never below 6px cells. */
function arenaCellSize(width: number): number {
  return Math.max(6, Math.min(22, Math.floor(220 / width)));
}

/** A problem's bold title, run into `text`'s first paragraph when it opens
 *  with one — the PDFs' idiom: "**Edge detector.** Design a machine …", the
 *  period only when text follows on the same line. */
function titleLead(title: string, text: string): ReactNode {
  const first = parseStatement(text)[0];
  const runsIn = first !== undefined && first.kind === 'para' && !first.part;
  return <strong className="ps-title"><InlineMarkup text={title} />{runsIn && !/[.!?:]$/.test(title) ? '.' : ''}</strong>;
}

/** The body options ProblemBody passes down to each question's content. */
interface BodyOptions {
  showArena: boolean;
  showHint: boolean;
  omitKinds: readonly CalloutKind[];
}

/** One question's content: its statement (with `lead` run in), hint,
 *  callouts and figures, and (for a turbot) its first arena. */
function QuestionContent({ question, lead, showArena, showHint, omitKinds }: BodyOptions & { question: AssignmentQuestion; lead?: ReactNode }) {
  const callouts = (question.callouts ?? []).filter((c) => !omitKinds.includes(c.kind));
  const figures = question.figures ?? [];
  const arena = showArena && question.buildMode === 'turbot' ? question.turbot_cases?.[0]?.arena : undefined;
  return (
    <>
      <Attachments callouts={callouts} figures={figures} where="before" />
      <StatementBody text={question.statement} lead={lead} />
      {/* A problem has no margin of its own: its asides follow it as notes. */}
      <Attachments callouts={callouts} figures={figures} where="aside" note />
      {showHint && question.hint && <div className="ps-hint"><StatementBody text={question.hint} /></div>}
      {arena && (
        <div className="ps-arena">
          <ArenaCanvas arena={arena} cellSize={arenaCellSize(arena.width)} />
          {(question.turbot_cases?.length ?? 0) > 1 && (
            <div className="ps-arena-more">
              Graded on {question.turbot_cases!.length} arenas. This is the first.
            </div>
          )}
        </div>
      )}
      <Attachments callouts={callouts} figures={figures} where="after" />
    </>
  );
}

/**
 * One problem's own content: run-in title, then — a problem without parts —
 * its statement, hint, callouts and figures, and (for a turbot) its first
 * arena; or — a multi-part problem (task 048) — its stem, each lettered part
 * with its own statement and attachments, and its closing. `showArena` is
 * off in the editor, whose right panel already draws the live arena. The
 * editor's question panel (QuestionPanel.tsx) heads the problem with its own
 * title, keeps caution notes always in view and puts the hints behind a
 * link, so it passes `showTitle={false}`, `showHint={false}` and omits those
 * kinds here. `partMark` is what sits beside a part's letter (the
 * document's per-part verdict).
 */
export function ProblemBody({
  problem,
  showArena = true,
  showTitle = true,
  showHint = true,
  omitKinds = [],
  partMark,
}: {
  problem: Pick<ResolvedProblem, 'question' | 'parts'>;
  showArena?: boolean;
  showTitle?: boolean;
  showHint?: boolean;
  omitKinds?: readonly CalloutKind[];
  partMark?: (q: AssignmentQuestion) => ReactNode;
}) {
  const first = problem.question;
  const title = showTitle ? first.title?.trim() : undefined;
  const stem = first.stem?.trim() ?? '';
  const closing = first.closing?.trim() ?? '';
  const options: BodyOptions = { showArena, showHint, omitKinds };
  const lettered = problem.parts.some((p) => p.letter !== '');
  if (!lettered && !stem && !closing) {
    return (
      <div className="ps-body">
        <QuestionContent question={first} lead={title ? titleLead(title, first.statement) : undefined} {...options} />
      </div>
    );
  }
  return (
    <div className="ps-body">
      {(stem || title) && <StatementBody text={stem} lead={title ? titleLead(title, stem) : undefined} />}
      {problem.parts.map((part) =>
        part.letter ? (
          <div key={part.question.id} className="ps-part" data-part-index={part.index}>
            <span className="ps-part-letter">{part.letter}.{partMark?.(part.question)}</span>
            <div className="ps-part-main"><QuestionContent question={part.question} {...options} /></div>
          </div>
        ) : (
          <QuestionContent key={part.question.id} question={part.question} {...options} />
        ),
      )}
      {closing && <StatementBody text={closing} className="ps-closing" />}
    </div>
  );
}

function StatusMarks({ status }: { status: ProblemStatus | undefined }) {
  if (!status) return null;
  const v = status.verdict;
  return (
    <>
      {v && v.tone !== 'none' ? (
        <span className={`ps-mark ps-mark--${v.tone}`} title={v.text}>
          {v.tone === 'pass' ? '✓' : v.tone === 'half' ? '½' : v.tone === 'fail' ? '✗' : '…'}
        </span>
      ) : status.done ? (
        <span className="ps-mark ps-mark--done" title="Marked done">✓</span>
      ) : null}
    </>
  );
}

/** A problem's own margin status: a problem without parts is its question's;
 *  a multi-part one is done only when every part is (its one Mark done), and
 *  its verdicts sit beside the part letters instead (each part is graded). */
function problemStatus(problem: ResolvedProblem, status?: (q: AssignmentQuestion) => ProblemStatus): ProblemStatus | undefined {
  if (!status) return undefined;
  if (problem.parts.length === 1) return status(problem.question);
  return { done: problem.parts.every((p) => status(p.question).done) };
}

/** Where a problem opens: a route (the student's canvas) or a callback (the
 *  instructor's editor, which opens the creator instead of navigating). */
export type ProblemTarget =
  | { route: (index: number) => Route; onOpen?: undefined }
  | { onOpen: (index: number) => void; route?: undefined };

function ProblemView({
  problem,
  target,
  status,
}: {
  problem: ResolvedProblem;
  target: ProblemTarget;
  status?: (q: AssignmentQuestion) => ProblemStatus;
}) {
  const route = target.route?.(problem.index);
  const link = route ? hashLink(route) : undefined;
  const open = (index = problem.index) => (route ? navigate(route) : target.onOpen?.(index));
  // The whole block opens the problem (the PDF idiom has no button); a click
  // that lands on a real link, or carries a modifier, is left to the browser.
  // A student's page holds every part, so their route is the problem's; the
  // instructor's editor authors each part as its own question, so there a
  // click on a lettered part opens that part (the stem and closing: the first).
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const hit = e.target as HTMLElement;
    if (hit.closest('a, button')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (window.getSelection()?.toString()) return;
    const part = hit.closest<HTMLElement>('[data-part-index]')?.dataset.partIndex;
    open(part === undefined ? problem.index : Number(part));
  };
  // A multi-part problem's parts share their mode, but a part may be a
  // fill-in: the chip then just says what they all are.
  const modes = new Set(problem.parts.map((p) => questionModeLabel(p.question)));
  const mode = modes.size === 1 ? [...modes][0] : problem.question.buildMode;
  const partMark = status && problem.parts.length > 1
    ? (q: AssignmentQuestion) => <StatusMarks status={{ verdict: status(q).verdict }} />
    : undefined;
  return (
    <div className={`ps-problem ps-problem--${problem.shape}`} onClick={onClick}>
      <div className="ps-gutter">
        {link ? (
          <a className="ps-num" {...link} aria-label={problem.label}>{problem.number}.</a>
        ) : (
          <button type="button" className="ps-num" aria-label={problem.label} onClick={() => open()}>{problem.number}.</button>
        )}
        <StatusMarks status={problemStatus(problem, status)} />
      </div>
      <div className="ps-problem-main">
        <span className="tag ps-mode" title="Canvas mode">{mode}</span>
        <ProblemBody problem={problem} partMark={partMark} />
      </div>
    </div>
  );
}

function SectionView({
  section,
  target,
  status,
}: {
  section: ResolvedSection;
  target: ProblemTarget;
  status?: (q: AssignmentQuestion) => ProblemStatus;
}) {
  const asideCallouts = section.callouts.filter((c) => placementOf(c) === 'aside');
  const asideFigures = section.figures.filter((f) => placementOf(f) === 'aside');
  const hasAside = asideCallouts.length + asideFigures.length > 0;
  return (
    <section className={`ps-section${section.heading ? '' : ' ps-section--continued'}`}>
      {section.heading && <h2 className="ps-section-heading">{section.heading}</h2>}
      <div className={`ps-section-body${hasAside ? ' ps-section-body--aside' : ''}`}>
        <div className="ps-section-main">
          {section.intro && <div className="ps-intro"><StatementBody text={section.intro} /></div>}
          <Attachments callouts={section.callouts} figures={section.figures} where="before" />
          {problemRuns(section).map((run, i) => (
            <div key={i} className={`ps-run ps-run--${run.flow}`}>
              {run.problems.map((p) => (
                <ProblemView key={p.question.id} problem={p} target={target} status={status} />
              ))}
            </div>
          ))}
          <Attachments callouts={section.callouts} figures={section.figures} where="after" />
        </div>
        {hasAside && (
          <aside className="ps-section-aside">
            {asideCallouts.map((c, i) => <CalloutView key={`c${i}`} callout={c} />)}
            {asideFigures.map((f, i) => <FigureView key={`f${i}`} figure={f} />)}
          </aside>
        )}
      </div>
    </section>
  );
}

/**
 * The whole document below the page head: preamble, then every section.
 * `route(index)` says where a problem opens (its canvas) — or `onOpen(index)`
 * for a host that opens it itself; `status(q)` is what its margin shows.
 */
export function ProblemSetDocument({
  assignment,
  status,
  ...target
}: {
  assignment: AssignmentData;
  status?: (q: AssignmentQuestion) => ProblemStatus;
} & ProblemTarget) {
  const sections = documentSections(assignment);
  return (
    <article className="ps">
      {assignment.preamble && <div className="ps-preamble"><StatementBody text={assignment.preamble} /></div>}
      {sections.map((s, i) => <SectionView key={i} section={s} target={target} status={status} />)}
      {assignment.questions.length === 0 && <p className="mm-empty">This assignment has no questions yet.</p>}
    </article>
  );
}
