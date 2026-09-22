import { useEffect, useState } from 'react';
import type { AssignmentData, AssignmentQuestion } from '../types';
import { questionModeLabel } from '../types';
import { getAssignment } from '../assignments';
import { assignmentStore } from '../storage/backend';
import { downloadJson } from '../download';
import { navigate } from '../routing';
import { QuestionCreator } from './QuestionCreator';
import { summarizeQuestion } from './ccSummary';
import { useAsyncValue } from '../useAsyncValue';
import { useDragReorder } from './dragReorder';

/** ISO timestamp → the local wall-clock "YYYY-MM-DDTHH:MM" a datetime-local input wants. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Assignment editor: edit the title and the ordered question list of an
 * assignment. Every mutation persists immediately via the AssignmentStore.
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

  // Questions are reordered by dragging; the hook previews the new order under
  // the cursor and hands back the committed list on drop.
  const drag = useDragReorder<AssignmentQuestion>(assignment?.questions ?? [], (questions) => {
    if (assignment) commit({ ...assignment, questions });
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

  const deleteQuestion = (q: AssignmentQuestion) => {
    if (!window.confirm(`Delete "${q.label}"?`)) return;
    commit({ ...assignment, questions: assignment.questions.filter((x) => x.id !== q.id) });
  };

  // onSave from the creator: replace an existing question (same id) or append.
  const handleSaveQuestion = (q: AssignmentQuestion) => {
    const exists = assignment.questions.some((x) => x.id === q.id);
    const questions = exists
      ? assignment.questions.map((x) => (x.id === q.id ? q : x))
      : [...assignment.questions, q];
    commit({ ...assignment, questions });
    setCreator(null);
  };

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
            ← Dashboard
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
                <span className="instructor-question-summary">{summarizeQuestion(q)}</span>
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
    </div>
  );
}
