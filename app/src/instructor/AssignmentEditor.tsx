import { useEffect, useRef, useState } from 'react';
import type { AssignmentData, AssignmentQuestion, AssignmentSection, SectionLayout } from '../types';
import { questionModeLabel } from '../types';
import { getAssignment } from '../assignments';
import { assignmentStore } from '../storage/backend';
import { downloadJson } from '../download';
import { navigate } from '../routing';
import { QuestionCreator } from './QuestionCreator';
import { summarizeQuestion } from './ccSummary';
import { useAsyncValue } from '../useAsyncValue';
import { useDragReorder } from './dragReorder';
import { CalloutsEditor, FiguresEditor } from './DocumentEditors';
import { ProblemSetDocument } from '../components/ProblemSetDocument';

/** ISO timestamp → the local wall-clock "YYYY-MM-DDTHH:MM" a datetime-local input wants. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const LAYOUTS: { value: SectionLayout; label: string }[] = [
  { value: 'auto', label: 'auto (tables in a grid, one-liners in columns)' },
  { value: 'list', label: 'one per line' },
  { value: 'columns', label: 'two columns' },
  { value: 'grid', label: 'grid' },
];

/** Sections as stored, with the invariants the document relies on restored:
 *  every id exists, each is listed once (first section wins), and within a
 *  section the problems follow the flat order — so dragging a question in the
 *  list reorders it inside its section too. An empty list means "no
 *  structure" and is stored as absent. */
function normalizeSections(questions: AssignmentQuestion[], sections: AssignmentSection[]): AssignmentSection[] | undefined {
  if (sections.length === 0) return undefined;
  const position = new Map(questions.map((q, i) => [q.id, i]));
  const seen = new Set<number>();
  return sections.map((s) => {
    const ids = s.questionIds.filter((id) => position.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    ids.sort((a, b) => position.get(a)! - position.get(b)!);
    return { ...s, questionIds: ids };
  });
}

function sectionName(s: AssignmentSection, i: number): string {
  return s.heading.trim() || `(continuation ${i + 1})`;
}

/**
 * Assignment editor: the title, due date and the document around the
 * questions (preamble, source PDF, sections with their intros, callouts and
 * figures), plus the ordered question list, each question filed into a
 * section. Every mutation persists via the AssignmentStore — text fields on
 * blur, the structured editors debounced — and a live preview shows the
 * problem set as students will see it.
 */
export function AssignmentEditor({ id }: { id: string }) {
  const { value: loaded, loading } = useAsyncValue(() => getAssignment(id), [id]);
  // Local edits layered over the fetched value: `commit` persists through the
  // seam and updates the draft, so the editor reflects mutations immediately
  // without re-fetching.
  const [draft, setDraft] = useState<AssignmentData | null>(null);
  useEffect(() => setDraft(null), [id]);
  const assignment = draft ?? loaded;
  // null = creator closed; { existing? } = creator open (editing or adding).
  const [creator, setCreator] = useState<{ existing?: AssignmentQuestion } | null>(null);
  // Persist and reflect a new assignment value. Fire-and-forget: the draft
  // updates immediately either way (local writes land synchronously; a
  // remote PUT settles in the background).
  const commit = (next: AssignmentData) => {
    void assignmentStore.save(next);
    setDraft(next);
  };
  // The structured editors (callouts, figures, section text) are controlled
  // inputs: the draft follows every keystroke, the save waits for a pause.
  const pending = useRef<{ timer: number; next: AssignmentData } | null>(null);
  const commitSoon = (next: AssignmentData) => {
    setDraft(next);
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = { next, timer: window.setTimeout(() => { pending.current = null; void assignmentStore.save(next); }, 600) };
  };
  useEffect(() => () => {
    if (pending.current) { window.clearTimeout(pending.current.timer); void assignmentStore.save(pending.current.next); }
  }, []);

  // Questions are reordered by dragging; the hook previews the new order under
  // the cursor and hands back the committed list on drop.
  const drag = useDragReorder<AssignmentQuestion>(assignment?.questions ?? [], (questions) => {
    if (assignment) commit(withSections(assignment, questions, assignment.sections ?? []));
  });

  if (!assignment) {
    if (loading) {
      return <p className="mm-empty">Loading…</p>;
    }
    return (
      <div className="instructor-error">
        <p>Assignment not found.</p>
        <button className="mm-btn" onClick={() => navigate({ kind: 'instructor' })}>
          Back to dashboard
        </button>
      </div>
    );
  }

  const handleTitleBlur = (value: string) => {
    const title = value.trim() || 'Untitled assignment';
    if (title !== assignment.title) commit({ ...assignment, title });
  };

  // The datetime-local input speaks local wall-clock time; the stored dueDate
  // is a canonical ISO timestamp. Empty input clears the due date.
  const handleDueDateBlur = (value: string) => {
    if (!value) {
      if (assignment.dueDate !== undefined) {
        const { dueDate: _cleared, ...rest } = assignment;
        commit(rest);
      }
      return;
    }
    const iso = new Date(value).toISOString();
    if (iso !== assignment.dueDate) commit({ ...assignment, dueDate: iso });
  };

  // Optional text fields: an empty value removes the key.
  const handleOptionalBlur = (key: 'preamble' | 'sourcePdf', value: string) => {
    const v = value.trim();
    if ((assignment[key] ?? '') === v) return;
    const next = { ...assignment };
    if (v) next[key] = v;
    else delete next[key];
    commit(next);
  };

  const deleteQuestion = (q: AssignmentQuestion) => {
    if (!window.confirm(`Delete "${q.label}"?`)) return;
    const questions = assignment.questions.filter((x) => x.id !== q.id);
    commit(withSections(assignment, questions, assignment.sections ?? []));
  };

  // onSave from the creator: replace an existing question (same id) or append.
  const handleSaveQuestion = (q: AssignmentQuestion) => {
    const exists = assignment.questions.some((x) => x.id === q.id);
    const questions = exists
      ? assignment.questions.map((x) => (x.id === q.id ? q : x))
      : [...assignment.questions, q];
    commit(withSections(assignment, questions, assignment.sections ?? []));
    setCreator(null);
  };

  // ── Sections ──
  const sections = assignment.sections ?? [];
  const setSections = (next: AssignmentSection[], soon = false) => {
    (soon ? commitSoon : commit)(withSections(assignment, assignment.questions, next));
  };
  const updateSection = (i: number, patch: Partial<AssignmentSection>, soon = false) =>
    setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)), soon);
  const addSection = () => setSections([...sections, { heading: `Section ${sections.length + 1}`, questionIds: [] }]);
  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const deleteSection = (i: number) => {
    const s = sections[i];
    if (!window.confirm(`Delete section "${sectionName(s, i)}"? Its problems stay in the assignment.`)) return;
    setSections(sections.filter((_, j) => j !== i));
  };
  // File a question into a section (index) or into none (-1).
  const fileQuestion = (qid: number, into: number) => {
    setSections(sections.map((s, j) => ({
      ...s,
      questionIds: j === into ? [...s.questionIds.filter((x) => x !== qid), qid] : s.questionIds.filter((x) => x !== qid),
    })));
  };
  const sectionIndexOf = (qid: number) => sections.findIndex((s) => s.questionIds.includes(qid));

  if (creator) {
    return (
      <QuestionCreator
        assignment={assignment}
        existingQuestion={creator.existing}
        onSave={handleSaveQuestion}
        onCancel={() => setCreator(null)}
      />
    );
  }

  return (
    <div className="instructor-editor">
      <div className="mm-head mm-head--row">
        <div>
          <a
            className="eyebrow"
            href="#/instructor"
            onClick={(e) => { e.preventDefault(); navigate({ kind: 'instructor' }); }}
          >
            ← Assignments
          </a>
          <h1>{assignment.title}</h1>
        </div>
        <button className="mm-btn" onClick={() => downloadJson(`assignment-${id}.json`, assignment)}>
          Export Assignment JSON
        </button>
      </div>

      <div className="mm-form mm-form--inline">
      <label className="mm-field">
        <span className="mm-label">Title</span>
        <input
          className="mm-input mm-input--title"
          defaultValue={assignment.title}
          onBlur={(e) => handleTitleBlur(e.target.value)}
        />
      </label>

      <label className="mm-field">
        <span className="mm-label">Due date</span>
        <input
          className="mm-input"
          type="datetime-local"
          key={assignment.dueDate ?? 'no-due-date'}
          defaultValue={assignment.dueDate ? toLocalInputValue(assignment.dueDate) : ''}
          onBlur={(e) => handleDueDateBlur(e.target.value)}
        />
      </label>
      </div>

      <div className="mm-form">
        <label className="mm-field">
          <span className="mm-label">Preamble (optional — shown under the title, before the first section)</span>
          <textarea
            className="mm-input mm-input--area"
            rows={2}
            key={`preamble-${assignment.preamble ?? ''}`}
            defaultValue={assignment.preamble ?? ''}
            onBlur={(e) => handleOptionalBlur('preamble', e.target.value)}
          />
        </label>
        <label className="mm-field">
          <span className="mm-label">Original PDF (optional — a URL, or a path under the app such as problem-sets/hw1.pdf)</span>
          <input
            className="mm-input mm-input--title"
            key={`pdf-${assignment.sourcePdf ?? ''}`}
            defaultValue={assignment.sourcePdf ?? ''}
            onBlur={(e) => handleOptionalBlur('sourcePdf', e.target.value)}
          />
        </label>
      </div>

      <div className="mm-section-head">
        <h2>Sections</h2>
        <button className="mm-btn" onClick={addSection}>Add section</button>
      </div>
      {sections.length === 0 ? (
        <p className="mm-empty">
          No sections: the problems are listed in order. Add a section to give a run of problems a
          heading and an instruction of its own, as the printed problem sets do.
        </p>
      ) : (
        sections.map((s, i) => (
          <div key={i} className="instructor-section-card">
            <div className="instructor-section-top">
              <label className="mm-field mm-field--grow">
                <span className="mm-label">Heading (empty = a continuation with no heading)</span>
                <input
                  className="mm-input mm-input--title"
                  key={`h-${i}-${s.heading}`}
                  defaultValue={s.heading}
                  placeholder="I. Combinatorial Circuits"
                  onBlur={(e) => { if (e.target.value !== s.heading) updateSection(i, { heading: e.target.value }); }}
                />
              </label>
              <label className="mm-inline-field">
                Layout
                <select className="mm-input" value={s.layout ?? 'auto'} onChange={(e) => updateSection(i, { layout: e.target.value as SectionLayout })}>
                  {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>
              <div className="instructor-section-actions">
                <button className="mm-btn mm-btn--small" disabled={i === 0} onClick={() => moveSection(i, -1)} title="Move up">↑</button>
                <button className="mm-btn mm-btn--small" disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)} title="Move down">↓</button>
                <button className="mm-btn mm-btn--small mm-btn--danger" onClick={() => deleteSection(i)}>Delete</button>
              </div>
            </div>
            <label className="mm-field">
              <span className="mm-label">Intro (optional — the instruction for this run of problems)</span>
              <textarea
                className="mm-input mm-input--area"
                rows={2}
                key={`intro-${i}-${s.intro ?? ''}`}
                defaultValue={s.intro ?? ''}
                placeholder="Design SCs that compute the following functions."
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (s.intro ?? '')) {
                    const { intro: _old, ...rest } = s;
                    setSections(sections.map((x, j) => (j === i ? (v ? { ...rest, intro: v } : rest) : x)));
                  }
                }}
              />
            </label>
            <p className="mm-note">
              Problems: {s.questionIds.length === 0
                ? 'none yet — file them from the question list below.'
                : s.questionIds.map((qid) => assignment.questions.find((q) => q.id === qid)?.label ?? `#${qid}`).join(' · ')}
            </p>
            <CalloutsEditor
              callouts={s.callouts ?? []}
              onChange={(callouts) => updateSection(i, callouts.length ? { callouts } : { callouts: undefined }, true)}
            />
            <FiguresEditor
              figures={s.figures ?? []}
              onChange={(figures) => updateSection(i, figures.length ? { figures } : { figures: undefined }, true)}
            />
          </div>
        ))
      )}

      <div className="mm-section-head">
        <h2>Questions</h2>
        <button
          className="mm-btn mm-btn--primary"
          onClick={() => setCreator({})}
        >
          Add Question
        </button>
      </div>

      {assignment.questions.length === 0 ? (
        <p className="mm-empty">No questions yet. Add one to build the assignment.</p>
      ) : (
        <ol className="instructor-question-list">
          {drag.items.map((q, i) => {
            const { draggable, onDragStart, ...rowDrop } = drag.rowProps(i);
            return (
            <li
              key={q.id}
              {...rowDrop}
              className={`instructor-question-row${drag.draggingIndex === i ? ' is-dragging' : ''}`}
            >
              <div className="instructor-question-main">
                <span
                  className="instructor-drag-handle"
                  draggable={draggable}
                  onDragStart={onDragStart}
                  title="Drag to reorder"
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span className="instructor-question-label">{q.label}</span>
                <span className="tag tag--accent">{questionModeLabel(q)}</span>
                <span className="instructor-question-summary">{q.title ? `${q.title}. ` : ''}{summarizeQuestion(q)}</span>
                {sections.length > 0 && (
                  <label className="mm-inline-field instructor-question-section">
                    Section
                    <select
                      className="mm-input"
                      value={sectionIndexOf(q.id)}
                      onChange={(e) => fileQuestion(q.id, Number(e.target.value))}
                    >
                      <option value={-1}>(none)</option>
                      {sections.map((s, si) => <option key={si} value={si}>{sectionName(s, si)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="instructor-question-actions">
                <button
                  className="mm-btn"
                  onClick={() => setCreator({ existing: q })}
                >
                  Edit
                </button>
                <button
                  className="mm-btn mm-btn--danger"
                  onClick={() => deleteQuestion(q)}
                >
                  Delete
                </button>
              </div>
            </li>
            );
          })}
        </ol>
      )}

      <details className="instructor-doc-preview">
        <summary>Preview — the problem set as students see it (click a problem to edit it)</summary>
        <ProblemSetDocument
          assignment={assignment}
          onOpen={(index) => setCreator({ existing: assignment.questions[index] })}
        />
      </details>
    </div>
  );
}

/** The assignment with `questions` and normalised `sections` (absent when
 *  there are none) — the ONE place the two are written together. */
function withSections(assignment: AssignmentData, questions: AssignmentQuestion[], sections: AssignmentSection[]): AssignmentData {
  const normalized = normalizeSections(questions, sections);
  const { sections: _old, ...rest } = assignment;
  return normalized ? { ...rest, questions, sections: normalized } : { ...rest, questions };
}
