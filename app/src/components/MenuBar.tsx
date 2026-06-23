import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import type { AssignmentData } from '../types';
import { saveToFileAs, openFile } from '../fileHandle';
import { getCurrentUserEmail } from '../auth';

function EditableWorkbookTitle() {
  const workbookTitle = useStore((s) => s.workbookTitle);
  const closeWorkbook = useStore((s) => s.closeWorkbook);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(workbookTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== workbookTitle) {
      useStore.setState({ workbookTitle: trimmed });
    } else {
      setEditValue(workbookTitle);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="workbook-title-area">
        <input
          ref={inputRef}
          className="workbook-title-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setEditValue(workbookTitle); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <div className="workbook-title-area">
      <span
        className="workbook-title"
        onDoubleClick={() => { setEditValue(workbookTitle); setEditing(true); }}
        title="Double-click to rename"
      >
        {workbookTitle}
      </span>
      <span
        className="workbook-close-btn"
        onClick={() => {
          const ok = confirm('Close this workbook? Unsaved changes will be lost.');
          if (ok) closeWorkbook();
        }}
        title="Close workbook"
      >
        {'\u00D7'}
      </span>
    </div>
  );
}

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
    goHome,
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
      <div className="menu-item" onClick={() => { goHome(); close(); }}>
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

      {/* Workbook title + close button, right-aligned */}
      <EditableWorkbookTitle />

      {/* Assignment menu */}
      {assignment && (
        <div
          className="menu-item"
          style={{ color: '#1565c0', fontWeight: 600 }}
          onClick={() => setOpenMenu(openMenu === 'assignment' ? null : 'assignment')}
        >
          {assignment.title}
          {openMenu === 'assignment' && (
            <div className="menu-dropdown">
              {assignment.questions.map((q, i) => (
                <div
                  key={q.id}
                  className="menu-dropdown-item"
                  onClick={() => {
                    useStore.getState().switchQuestion(i);
                    close();
                  }}
                >
                  {q.label}: {q.statement.substring(0, 40)}...
                </div>
              ))}
              <div className="menu-separator" />
              <div
                className="menu-dropdown-item"
                onClick={() => {
                  useStore.getState().closeAssignment();
                  close();
                }}
              >
                Close Assignment
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
