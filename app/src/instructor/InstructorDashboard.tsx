import {
  listAssignments,
  getAssignment,
  createAssignment,
  isBundledAssignment,
} from '../assignments';
import { assignmentStore, submissionStore, backendMode } from '../storage/backend';
import { downloadJson } from '../download';
import { navigate } from '../routing';
import { seedSampleData } from '../devData/seed';
import { useAsyncValue } from '../useAsyncValue';

/**
 * Instructor dashboard: lists every assignment (bundled + instructor-authored)
 * with question and submission counts, and the per-assignment actions. Bundled
 * assignments are read-only (no Edit/Delete); custom ones are fully editable.
 */
export function InstructorDashboard() {
  // The list and per-row submission counts come from the async seams; after a
  // mutation (create/delete/seed), reload() re-fetches.
  const {
    value: rows,
    loading,
    error,
    reload,
  } = useAsyncValue(async () => {
    const summaries = await listAssignments();
    const submissionLists = await Promise.all(
      summaries.map((a) => submissionStore.listSubmissions(a.id)),
    );
    return summaries.map((a, i) => ({ ...a, submissionCount: submissionLists[i].length }));
  }, []);
  const assignments = rows ?? [];

  const handleNew = async () => {
    const title = window.prompt('Assignment title:');
    if (title == null) return; // cancelled
    const created = await createAssignment(title);
    navigate({ kind: 'instructor-edit', id: created.id });
  };

  const handleExport = async (id: string) => {
    const data = await getAssignment(id);
    if (data) downloadJson(`assignment-${id}.json`, data);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await assignmentStore.remove(id);
    reload();
  };

  const handleSeed = async () => {
    const { submissionCount } = await seedSampleData();
    reload();
    window.alert(
      `Loaded the sample CC/SC/FSM assignment and ${submissionCount} autograded submissions. ` +
        'Open its Submissions to see the grades.',
    );
  };

  return (
    <div className="instructor-dashboard">
      <div className="instructor-page-head">
        <h2 className="instructor-page-title">Assignments</h2>
        <div className="instructor-head-actions">
          {backendMode === 'local' && (
            <button className="instructor-btn" onClick={() => void handleSeed()} title="Dev: seed a sample assignment and autograded submissions">
              Load sample data
            </button>
          )}
          <button className="instructor-btn instructor-btn--primary" onClick={() => void handleNew()}>
            New Assignment
          </button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <p className="instructor-empty">
          {loading ? 'Loading…'
            : error ? (
                <>
                  Couldn’t load assignments — the server may be unreachable.{' '}
                  <button className="menu-link-button" onClick={reload}>Retry</button>
                </>
              )
            : 'No assignments yet. Create one to get started.'}
        </p>
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
                  <td>{a.submissionCount}</td>
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
                    <button className="instructor-btn" onClick={() => void handleExport(a.id)}>
                      Export JSON
                    </button>
                    {!bundled && (
                      <button
                        className="instructor-btn instructor-btn--danger"
                        onClick={() => void handleDelete(a.id, a.title)}
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
