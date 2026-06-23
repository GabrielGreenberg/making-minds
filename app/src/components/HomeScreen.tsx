import { useStore } from '../store';
import { openFile } from '../fileHandle';
import { listAssignments } from '../assignments';

export function HomeScreen() {
  const openAssignment = useStore((s) => s.openAssignment);
  const enterSandbox = useStore((s) => s.enterSandbox);
  const newWorkbook = useStore((s) => s.newWorkbook);
  const importWorkbook = useStore((s) => s.importWorkbook);

  const assignments = listAssignments();

  const handleOpenFile = async () => {
    const result = await openFile();
    if (result) importWorkbook(result.text, result.handle);
  };

  return (
    <div className="welcome-screen">
      <div className="home-card">
        <h1 className="welcome-title">Making Minds</h1>
        <p className="welcome-subtitle">Design circuits, state machines, and more</p>

        <section className="home-section">
          <h2 className="home-section-title">Assignments</h2>
          <div className="home-grid">
            {assignments.map((a) => (
              <button
                key={a.id}
                className="home-tile"
                onClick={() => openAssignment(a.id)}
              >
                <span className="home-tile-title">{a.title}</span>
                <span className="home-tile-meta">
                  {a.questionCount} question{a.questionCount === 1 ? '' : 's'}
                </span>
              </button>
            ))}
            {assignments.length === 0 && (
              <p className="home-empty">No assignments available.</p>
            )}
          </div>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">Explore</h2>
          <div className="home-grid">
            <button className="home-tile" onClick={() => enterSandbox()}>
              <span className="home-tile-title">Sandbox</span>
              <span className="home-tile-meta">A freeform workbook to experiment</span>
            </button>
            <button className="home-tile" onClick={() => newWorkbook()}>
              <span className="home-tile-title">New sandbox</span>
              <span className="home-tile-meta">Start from a blank workbook</span>
            </button>
            <button className="home-tile" onClick={handleOpenFile}>
              <span className="home-tile-title">Open workbook file…</span>
              <span className="home-tile-meta">Load a saved .json workbook</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
