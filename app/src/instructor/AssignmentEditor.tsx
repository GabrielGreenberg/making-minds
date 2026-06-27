import { useState } from 'react';
import type { AssignmentData, AssignmentQuestion } from '../types';
import { getAssignment, isBundledAssignment } from '../assignments';
import { localAssignmentStore } from '../storage/AssignmentStore';
import { downloadJson } from '../download';
import { navigate } from '../routing';
import { QuestionCreator } from './QuestionCreator';
import { summarizeQuestion } from './ccSummary';

/**
 * Assignment editor: edit the title and the ordered question list of an
 * instructor-authored assignment. Every mutation persists immediately via the
 * AssignmentStore. Bundled assignments are read-only and cannot be opened here.
 */
export function AssignmentEditor({ id }: { id: string }) {
  const [assignment, setAssignment] = useState<AssignmentData | undefined>(() =>
    getAssignment(id),
  );
  // null = creator closed; { existing? } = creator open (editing or adding).
  const [creator, setCreator] = useState<{ existing?: AssignmentQuestion } | null>(null);

  if (!assignment) {
    return (
      <div className="instructor-error">
        <p>Assignment not found.</p>
        <button className="instructor-btn" onClick={() => navigate({ kind: 'instructor' })}>
          Back to dashboard
        </button>
      </div>
    );
  }

  if (isBundledAssignment(id)) {
    return (
      <div className="instructor-error">
        <p>
          <strong>{assignment.title}</strong> is a bundled assignment and cannot be edited.
        </p>
        <button className="instructor-btn" onClick={() => navigate({ kind: 'instructor' })}>
          Back to dashboard
        </button>
      </div>
    );
  }

  // Persist and reflect a new assignment value.
  const commit = (next: AssignmentData) => {
    localAssignmentStore.save(next);
    setAssignment(next);
  };

  const handleTitleBlur = (value: string) => {
    const title = value.trim() || 'Untitled assignment';
    if (title !== assignment.title) commit({ ...assignment, title });
  };

  const moveQuestion = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= assignment.questions.length) return;
    const questions = [...assignment.questions];
    [questions[index], questions[target]] = [questions[target], questions[index]];
    commit({ ...assignment, questions });
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
        assignmentId={id}
        existingQuestion={creator.existing}
        onSave={handleSaveQuestion}
        onCancel={() => setCreator(null)}
      />
    );
  }

  return (
    <div className="instructor-editor">
      <div className="instructor-page-head">
        <button className="instructor-link" onClick={() => navigate({ kind: 'instructor' })}>
          ← Dashboard
        </button>
        <button
          className="instructor-btn"
          onClick={() => downloadJson(`assignment-${id}.json`, assignment)}
        >
          Export Assignment JSON
        </button>
      </div>

      <label className="instructor-field">
        <span className="instructor-field-label">Title</span>
        <input
          className="instructor-input instructor-title-input"
          defaultValue={assignment.title}
          onBlur={(e) => handleTitleBlur(e.target.value)}
        />
      </label>

      <div className="instructor-section-head">
        <h3 className="instructor-section-title">Questions</h3>
        <button
          className="instructor-btn instructor-btn--primary"
          onClick={() => setCreator({})}
        >
          Add Question
        </button>
      </div>

      {assignment.questions.length === 0 ? (
        <p className="instructor-empty">No questions yet. Add one to build the assignment.</p>
      ) : (
        <ol className="instructor-question-list">
          {assignment.questions.map((q, i) => (
            <li key={q.id} className="instructor-question-row">
              <div className="instructor-question-main">
                <span className="instructor-question-label">{q.label}</span>
                <span className="instructor-badge instructor-badge--mode">{q.buildMode}</span>
                <span className="instructor-question-summary">{summarizeQuestion(q)}</span>
              </div>
              <div className="instructor-question-actions">
                <button
                  className="instructor-btn instructor-btn--icon"
                  disabled={i === 0}
                  onClick={() => moveQuestion(i, -1)}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="instructor-btn instructor-btn--icon"
                  disabled={i === assignment.questions.length - 1}
                  onClick={() => moveQuestion(i, 1)}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="instructor-btn"
                  onClick={() => setCreator({ existing: q })}
                >
                  Edit
                </button>
                <button
                  className="instructor-btn instructor-btn--danger"
                  onClick={() => deleteQuestion(q)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
