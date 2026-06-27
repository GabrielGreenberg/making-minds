import { useState } from 'react';
import {
  listAssignments,
  getAssignment,
  createAssignment,
  isBundledAssignment,
} from '../assignments';
import { localAssignmentStore } from '../storage/AssignmentStore';
import { localSubmissionStore } from '../storage/submissionStore';
import { downloadJson } from '../download';
import { navigate } from '../routing';

/**
 * Instructor dashboard: lists every assignment (bundled + instructor-authored)
 * with question and submission counts, and the per-assignment actions. Bundled
 * assignments are read-only (no Edit/Delete); custom ones are fully editable.
 */
export function InstructorDashboard() {
  // Local counter to force a re-render after a mutation (create/delete), since
  // the assignment list comes from stores, not React state.
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const assignments = listAssignments();

  const handleNew = () => {
    const title = window.prompt('Assignment title:');
    if (title == null) return; // cancelled
    const created = createAssignment(title);
    navigate({ kind: 'instructor-edit', id: created.id });
  };

  const handleExport = (id: string) => {
    const data = getAssignment(id);
    if (data) downloadJson(`assignment-${id}.json`, data);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    localAssignmentStore.remove(id);
    rerender();
  };

  return (
    <div className="instructor-dashboard">
      <div className="instructor-page-head">
        <h2 className="instructor-page-title">Assignments</h2>
        <button className="instructor-btn instructor-btn--primary" onClick={handleNew}>
          New Assignment
        </button>
      </div>

      {assignments.length === 0 ? (
        <p className="instructor-empty">No assignments yet. Create one to get started.</p>
      ) : (
        <table className="instructor-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Questions</th>
              <th>Submissions</th>
              <th className="instructor-table-actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const bundled = isBundledAssignment(a.id);
              const submissionCount = localSubmissionStore.listSubmissions(a.id).length;
              return (
                <tr key={a.id}>
                  <td>
                    <span className="instructor-asg-title">{a.title}</span>
                    {bundled ? (
                      <span className="instructor-badge instructor-badge--bundled">bundled</span>
                    ) : (
                      <span className="instructor-badge instructor-badge--custom">custom</span>
                    )}
                  </td>
                  <td>{a.questionCount}</td>
                  <td>{submissionCount}</td>
                  <td className="instructor-table-actions">
                    {!bundled && (
                      <button
                        className="instructor-btn"
                        onClick={() => navigate({ kind: 'instructor-edit', id: a.id })}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      className="instructor-btn"
                      onClick={() => navigate({ kind: 'instructor-submissions', id: a.id })}
                    >
                      Submissions
                    </button>
                    <button className="instructor-btn" onClick={() => handleExport(a.id)}>
                      Export JSON
                    </button>
                    {!bundled && (
                      <button
                        className="instructor-btn instructor-btn--danger"
                        onClick={() => handleDelete(a.id, a.title)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
