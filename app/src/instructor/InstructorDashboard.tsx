import {
  listAssignments,
  getAssignment,
  createAssignment,
  isBundledAssignment,
} from '../assignments';
import type { AssignmentSummary } from '../assignments';
import { assignmentStore, submissionStore, backendMode } from '../storage/backend';
import { downloadJson } from '../download';
import { navigate } from '../routing';
import { seedSampleData } from '../devData/seed';
import { seedHomeworks } from '../devData/homeworks';
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

  // Reordering writes an explicit position onto EVERY assignment, not just the
  // pair that swapped: the list may still hold assignments that have never
  // been moved (order absent, sorted last), and renumbering the whole list is
  // what makes the new arrangement the one that comes back. Bundled
  // assignments live outside the store and cannot be renumbered, so they are
  // pinned in place and the buttons skip over them.
  const handleMove = async (index: number, delta: number) => {
    const rows = assignments;
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    if (isBundledAssignment(rows[index].id) || isBundledAssignment(rows[target].id)) return;
    const reordered = rows.slice();
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await Promise.all(
      reordered.map(async (row, i) => {
        if (isBundledAssignment(row.id)) return;
        const data = await getAssignment(row.id);
        if (!data || data.order === i) return;
        await assignmentStore.save({ ...data, order: i });
      }),
    );
    reload();
  };

  const canMove = (rows: AssignmentSummary[], index: number, delta: number) => {
    const target = index + delta;
    return (
      target >= 0 &&
      target < rows.length &&
      !isBundledAssignment(rows[index].id) &&
      !isBundledAssignment(rows[target].id)
    );
  };

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

  const handleSeedHomeworks = async () => {
    const { seeded, skipped, submissionCount } = await seedHomeworks();
    reload();
    window.alert(
      (seeded.length
        ? `Loaded ${seeded.length} homework assignment${seeded.length === 1 ? '' : 's'} (${seeded.join(', ')})`
        : 'All homework assignments already exist — none reloaded') +
        ` and reseeded ${submissionCount} autograded sample submissions.` +
        (skipped.length
          ? ` Skipped ${skipped.join(', ')} (already present; delete one first to restore its pristine copy).`
          : ''),
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
          {backendMode === 'local' && (
            <button className="instructor-btn" onClick={() => void handleSeedHomeworks()} title="Load the real PHIL 133 homeworks (HW1–HW7) as editable assignments; existing copies are never overwritten">
              Load HW1–HW7
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
              <th className="instructor-table-order-head">Order</th>
              <th>Title</th>
              <th>Questions</th>
              <th>Submissions</th>
              <th className="instructor-table-actions-head">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a, i) => {
              const bundled = isBundledAssignment(a.id);
              return (
                <tr key={a.id}>
                  <td className="instructor-table-order">
                    <button
                      className="instructor-btn instructor-btn--icon"
                      disabled={!canMove(assignments, i, -1)}
                      title="Move up"
                      onClick={() => void handleMove(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="instructor-btn instructor-btn--icon"
                      disabled={!canMove(assignments, i, 1)}
                      title="Move down"
                      onClick={() => void handleMove(i, 1)}
                    >
                      ↓
                    </button>
                  </td>
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
