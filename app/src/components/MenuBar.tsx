import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import type { AssignmentData } from '../types';
import { saveToFileAs, openFile } from '../fileHandle';
import { getCurrentUserEmail } from '../auth';
import { navigate } from '../routing';
import { downloadJson } from '../download';

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    undo,
    redo,
    deleteSelected,
    copySelected,
    paste,
    exportProject,
    exportSubmission,
    exportWorkbook,
    importWorkbook,
    loadAssignment,
    assignment,
    importBoxedCircuit,
    newWorkbook,
    submitAssignment,
    submissions,
  } = useStore();

  useEffect(() => {
    const handler = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSub(null);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, []);

  const close = () => { setOpenMenu(null); setOpenSub(null); };

  const handleSaveAs = async () => {
    const json = exportWorkbook();
    const handle = await saveToFileAs(json);
    if (handle) {
      useStore.setState({ workbookFileHandle: handle });
    }
    close();
  };

  const handleOpen = async () => {
    const result = await openFile();
    if (result) {
      importWorkbook(result.text, result.handle);
    }
    close();
  };

  const handleNewWorkbook = async () => {
    const ok = confirm('Create a new workbook? Unsaved changes will be lost.\n\nClick Cancel to go back and save first.');
    if (!ok) return;
    newWorkbook();
    close();
  };

  const handleExportWorksheet = () => {
    const json = exportProject();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    a.click();
    URL.revokeObjectURL(url);
    close();
  };

  const handleExportSubmission = () => {
    const student = getCurrentUserEmail();
    const json = exportSubmission(student);
    if (json == null) {
      alert('Import an assignment before exporting a submission.');
      close();
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'submission.json';
    a.click();
    URL.revokeObjectURL(url);
    close();
  };

  const handleSubmitAssignment = () => {
    if (!assignment) return;
    const ok = confirm(`Submit "${assignment.title}"? This records a snapshot of your current work and downloads it.`);
    if (!ok) return;
    const rec = submitAssignment(assignment.id, getCurrentUserEmail());
    close();
    // Local grading: until there's a server endpoint, the submission is delivered
    // as a downloaded JSON file (the instructor grades it with the CLI).
    if (rec) downloadJson(`submission-${assignment.id}-attempt${rec.attempt}.json`, rec.submission);
  };

  const handleImportCircuit = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then((text) => {
          try {
            const data = JSON.parse(text);
            if (data.circuit) {
              const bm = data.metadata?.buildType || 'CC';
              const title = data.metadata?.title || file.name.replace('.json', '');
              useStore.getState().addTab(title, bm);
              useStore.getState().importProject(text);
            }
          } catch {
            alert('Invalid circuit JSON file.');
          }
        });
      }
    };
    input.click();
    close();
  };

  const handleImportBuild = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const name = file.name.replace('.json', '');
        file.text().then((text) => importBoxedCircuit(name, text));
      }
    };
    input.click();
    close();
  };

  const handleImportAssignment = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then((text) => {
          try {
            const a: AssignmentData = JSON.parse(text);
            loadAssignment(a);
          } catch {
            alert('Invalid assignment JSON file.');
          }
        });
      }
    };
    input.click();
    close();
  };

  return (
    <div className="menu-bar" ref={menuRef}>
      {/* Home — back to the assignment catalog */}
      <div className="menu-item" onClick={() => { navigate({ kind: 'home' }); close(); }}>
        ⌂ Home
      </div>
      {/* File */}
      <div
        className="menu-item"
        onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
      >
        File
        {openMenu === 'file' && (
          <div className="menu-dropdown">
            <div className="menu-dropdown-item" onClick={handleNewWorkbook}>
              New Workbook
            </div>
            <div className="menu-dropdown-item" onClick={handleOpen}>
              Open Workbook
            </div>
            <div className="menu-dropdown-item" onClick={handleSaveAs}>
              Save Workbook As...
            </div>
            <div className="menu-separator" />
            <div
              className="menu-dropdown-item submenu-container"
              onMouseEnter={() => setOpenSub('import')}
              onMouseLeave={() => setOpenSub(null)}
            >
              <span>Import</span>
              <span>&#9656;</span>
              {openSub === 'import' && (
                <div className="submenu-dropdown">
                  <div className="menu-dropdown-item" onClick={handleImportCircuit}>
                    Circuit (as new tab)
                  </div>
                  <div className="menu-dropdown-item" onClick={handleImportBuild}>
                    Build (boxed)
                  </div>
                  <div className="menu-dropdown-item" onClick={handleImportAssignment}>
                    Assignment
                  </div>
                </div>
              )}
            </div>
            <div className="menu-dropdown-item" onClick={handleExportWorksheet}>
              Export Worksheet
            </div>
            {assignment && (
              <div className="menu-dropdown-item" onClick={handleExportSubmission}>
                Export Submission
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit */}
      <div
        className="menu-item"
        onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
      >
        Edit
        {openMenu === 'edit' && (
          <div className="menu-dropdown">
            <div className="menu-dropdown-item" onClick={() => { undo(); close(); }}>
              Undo <span style={{ color: '#999', fontSize: 11 }}>&#8984;Z</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { redo(); close(); }}>
              Redo <span style={{ color: '#999', fontSize: 11 }}>&#8984;&#8679;Z</span>
            </div>
            <div className="menu-separator" />
            <div className="menu-dropdown-item" onClick={() => { copySelected(); close(); }}>
              Copy <span style={{ color: '#999', fontSize: 11 }}>&#8984;C</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { paste(); close(); }}>
              Paste <span style={{ color: '#999', fontSize: 11 }}>&#8984;V</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { deleteSelected(); close(); }}>
              Delete <span style={{ color: '#999', fontSize: 11 }}>&#9003;</span>
            </div>
          </div>
        )}
      </div>

      {/* Submit — record an immutable snapshot of the current assignment.
          Right-aligned (margin-left: auto) now that the workbook title is gone. */}
      {assignment && (
        <div
          className="menu-item menu-submit"
          onClick={handleSubmitAssignment}
          title={
            submissions[assignment.id]
              ? `Last submitted ${new Date(submissions[assignment.id].submittedAt).toLocaleString()}`
              : 'Submit this assignment'
          }
        >
          {submissions[assignment.id] ? 'Submit ✓' : 'Submit'}
        </div>
      )}
    </div>
  );
}
