// The problem-set document: an assignment rendered the way its handout reads
// — preamble, sections (heading over a rule, the intro that carries the
// instruction for a run of problems), continuously numbered problems with
// run-in bold titles, truth tables several per row, one-liners in columns,
// callout boxes styled per kind, figures, a turbot's arena drawn live. Each
// problem links to its canvas and carries an unobtrusive status mark in the
// number gutter. The semantics (section normalisation, numbering, layout)
// are src/problemSet.ts; the markup renderer is StatementBody.
//
// `ProblemBody` and `ProblemContext` are the two parts the editor panels
// reuse (DataTable's QuestionStatement, FillInPanel, OpenResponsePanel), so a
// problem transcribed PDF-style — "NAND" over a table under a section intro —
// reads correctly on its own canvas too.

import type { MouseEvent, ReactNode } from 'react';
import type { AssignmentData, AssignmentQuestion, Callout, Figure, Placement } from '../types';
import { questionModeLabel } from '../types';
import {
  DEFAULT_CALLOUT_TITLE,
  calloutTitleIsBlock,
  documentSections,
  figureUrl,
  placementOf,
  problemRuns,
  sectionOf,
  type ResolvedProblem,
  type ResolvedSection,
} from '../problemSet';
import { navigate, type Route } from '../routing';
import { hashLink } from './PageShell';
import { StatementBody } from './StatementBody';
import { ArenaCanvas } from './ArenaCanvas';

/** What the margin shows beside a problem: the student's own "done" tick and,
 *  once grades are released, the verdict. */
export interface ProblemStatus {
  done?: boolean;
  verdict?: { text: string; tone: 'pass' | 'fail' | 'pending' | 'none' };
}

const BASE_URL: string = import.meta.env.BASE_URL;

function FigureView({ figure }: { figure: Figure }) {
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

function CalloutView({ callout }: { callout: Callout }) {
  const title = callout.title ?? DEFAULT_CALLOUT_TITLE[callout.kind];
  const block = calloutTitleIsBlock(callout);
  return (
    <div className={`ps-callout ps-callout--${callout.kind}`}>
      {block && title && <div className="ps-callout-title">{title}</div>}
      <StatementBody
        text={callout.body}
        lead={!block && title ? <strong className="ps-callout-lead">{title} </strong> : undefined}
      />
      {(callout.figures ?? []).map((f, i) => <FigureView key={i} figure={f} />)}
    </div>
  );
}

/** The callouts and figures of one owner at one placement, callouts first. */
function Attachments({ callouts, figures, where }: { callouts: Callout[]; figures: Figure[]; where: Placement }) {
  const cs = callouts.filter((c) => placementOf(c) === where);
  const fs = figures.filter((f) => placementOf(f) === where);
  if (cs.length === 0 && fs.length === 0) return null;
  return (
    <div className={`ps-attachments ps-attachments--${where}`}>
      {cs.map((c, i) => <CalloutView key={`c${i}`} callout={c} />)}
      {fs.map((f, i) => <FigureView key={`f${i}`} figure={f} />)}
    </div>
  );
}

/** Cell size that keeps an arena around 220px wide, never below 6px cells. */
function arenaCellSize(width: number): number {
  return Math.max(6, Math.min(22, Math.floor(220 / width)));
}

/**
 * One problem's own content: run-in title, statement, hint, its callouts and
 * figures, and (for a turbot) its first arena. `showArena` is off in the
 * editor, whose right panel already draws the live arena.
 */
export function ProblemBody({ question, showArena = true }: { question: AssignmentQuestion; showArena?: boolean }) {
  const callouts = question.callouts ?? [];
  const figures = question.figures ?? [];
  const arena = showArena && question.buildMode === 'turbot' ? question.turbot_cases?.[0]?.arena : undefined;
  const hasText = question.statement.trim().length > 0;
  const title = question.title?.trim();
  const lead: ReactNode = title ? (
    <strong className="ps-title">{title}{hasText && !/[.!?:]$/.test(title) ? '.' : ''}</strong>
  ) : undefined;
  return (
    <div className="ps-body">
      <Attachments callouts={callouts} figures={figures} where="before" />
      <StatementBody text={question.statement} lead={lead} />
      {question.hint && <div className="ps-hint"><StatementBody text={question.hint} /></div>}
      {arena && (
        <div className="ps-arena">
          <ArenaCanvas arena={arena} cellSize={arenaCellSize(arena.width)} />
          {(question.turbot_cases?.length ?? 0) > 1 && (
            <div className="ps-arena-more">
              Graded on {question.turbot_cases!.length} arenas — this is the first.
            </div>
          )}
        </div>
      )}
      <Attachments callouts={callouts} figures={figures} where="after" />
      {/* A problem has no margin of its own: its asides follow it as notes. */}
      <Attachments callouts={callouts} figures={figures} where="aside" />
    </div>
  );
}

/**
 * A problem's section, as context on its canvas: the heading, the intro that
 * carries the instruction, and the section's callouts and figures behind a
 * disclosure so a long hint box never pushes the problem off the panel.
 */
export function ProblemContext({ assignment, questionId }: { assignment: AssignmentData; questionId: number }) {
  const section = sectionOf(assignment, questionId);
  if (!section) return null;
  const extras = section.callouts.length + section.figures.length;
  if (!section.heading && !section.intro && extras === 0) return null;
  return (
    <div className="ps-context">
      {section.heading && <div className="ps-context-heading">{section.heading}</div>}
      {section.intro && <StatementBody text={section.intro} className="ps-context-intro" />}
      {extras > 0 && (
        <details className="ps-context-more">
          <summary>{extras === 1 ? 'Note for this section' : `Notes for this section (${extras})`}</summary>
          {section.callouts.map((c, i) => <CalloutView key={`c${i}`} callout={c} />)}
          {section.figures.map((f, i) => <FigureView key={`f${i}`} figure={f} />)}
        </details>
      )}
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
          {v.tone === 'pass' ? '✓' : v.tone === 'fail' ? '✗' : '…'}
        </span>
      ) : status.done ? (
        <span className="ps-mark ps-mark--done" title="Marked done">✓</span>
      ) : null}
    </>
  );
}

function ProblemView({
  problem,
  route,
  status,
}: {
  problem: ResolvedProblem;
  route: (index: number) => Route;
  status?: (q: AssignmentQuestion) => ProblemStatus;
}) {
  const target = route(problem.index);
  const link = hashLink(target);
  // The whole block opens the canvas (the PDF idiom has no button); a click
  // that lands on a real link, or carries a modifier, is left to the browser.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (window.getSelection()?.toString()) return;
    navigate(target);
  };
  return (
    <div className={`ps-problem ps-problem--${problem.shape}`} onClick={onClick}>
      <div className="ps-gutter">
        <a className="ps-num" {...link} aria-label={problem.question.label}>{problem.number}.</a>
        <StatusMarks status={status?.(problem.question)} />
      </div>
      <div className="ps-problem-main">
        <span className="tag ps-mode" title="Canvas mode">{questionModeLabel(problem.question)}</span>
        <ProblemBody question={problem.question} />
      </div>
    </div>
  );
}

function SectionView({
  section,
  route,
  status,
}: {
  section: ResolvedSection;
  route: (index: number) => Route;
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
                <ProblemView key={p.question.id} problem={p} route={route} status={status} />
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
 * `route(index)` says where a problem opens (its canvas); `status(q)` what
 * its margin shows.
 */
export function ProblemSetDocument({
  assignment,
  route,
  status,
}: {
  assignment: AssignmentData;
  route: (index: number) => Route;
  status?: (q: AssignmentQuestion) => ProblemStatus;
}) {
  const sections = documentSections(assignment);
  return (
    <article className="ps">
      {assignment.preamble && <div className="ps-preamble"><StatementBody text={assignment.preamble} /></div>}
      {sections.map((s, i) => <SectionView key={i} section={s} route={route} status={status} />)}
      {assignment.questions.length === 0 && <p className="mm-empty">This assignment has no questions yet.</p>}
    </article>
  );
}
