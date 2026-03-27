import { useStore } from '../store';
import { openFile } from '../fileHandle';

export function WelcomeScreen() {
  const newWorkbook = useStore((s) => s.newWorkbook);
  const importWorkbook = useStore((s) => s.importWorkbook);

  const handleOpen = async () => {
    const result = await openFile();
    if (result) {
      importWorkbook(result.text, result.handle);
    }
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-card">
        <h1 className="welcome-title">Making Minds</h1>
        <p className="welcome-subtitle">Design circuits, state machines, and more</p>
        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={() => newWorkbook()}>
            New Workbook
          </button>
          <button className="welcome-btn welcome-btn-secondary" onClick={handleOpen}>
            Open Workbook
          </button>
        </div>
      </div>
    </div>
  );
}
