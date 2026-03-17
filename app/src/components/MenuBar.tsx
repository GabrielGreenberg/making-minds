import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import type { BuildMode, ProblemSetData } from '../types';
import { saveToFile, openFile } from '../fileHandle';

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    addTab,
    undo,
    redo,
    deleteSelected,
    copySelected,
    paste,
    exportProject,
    importProject,
    loadHomework,
    loadProblemSet,
    homework,
    problemSet,
    importBoxedCircuit,
  } = useStore();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSub(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNew = (mode: BuildMode) => {
    const names: Record<BuildMode, string> = {
      CC: 'Circuit',
      SC: 'Sequential Circuit',
      FSM: 'FSM',
      turbot: 'Turbot',
      TM: 'Turing Machine',
    };
    addTab(names[mode], mode);
    setOpenMenu(null);
    setOpenSub(null);
  };

  const handleSave = () => {
    const json = exportProject();
    saveToFile(json);
    setOpenMenu(null);
  };

  const handleOpen = async () => {
    const text = await openFile();
    if (text) {
      importProject(text);
    }
    setOpenMenu(null);
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
    setOpenMenu(null);
    setOpenSub(null);
  };

  const handleImportHomework = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then((text) => {
          try {
            const hw = JSON.parse(text);
            loadHomework(hw);
          } catch {
            alert('Invalid homework JSON file.');
          }
        });
      }
    };
    input.click();
    setOpenMenu(null);
    setOpenSub(null);
  };

  const handleImportProblemSet = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        file.text().then((text) => {
          try {
            const ps: ProblemSetData = JSON.parse(text);
            loadProblemSet(ps);
          } catch {
            alert('Invalid problem set JSON file.');
          }
        });
      }
    };
    input.click();
    setOpenMenu(null);
    setOpenSub(null);
  };

  const handleExportBuild = () => {
    handleSave();
  };

  return (
    <div className="menu-bar" ref={menuRef}>
      {/* File */}
      <div
        className="menu-item"
        onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
      >
        File
        {openMenu === 'file' && (
          <div className="menu-dropdown">
            <div
              className="menu-dropdown-item submenu-container"
              onMouseEnter={() => setOpenSub('new')}
              onMouseLeave={() => setOpenSub(null)}
            >
              <span>New</span>
              <span>▸</span>
              {openSub === 'new' && (
                <div className="submenu-dropdown">
                  <div className="menu-dropdown-item" onClick={() => handleNew('CC')}>
                    Circuit
                  </div>
                  <div className="menu-dropdown-item" onClick={() => handleNew('SC')}>
                    Sequential Circuit
                  </div>
                  <div className="menu-dropdown-item" onClick={() => handleNew('FSM')}>
                    FSM
                  </div>
                  <div className="menu-dropdown-item" onClick={() => handleNew('turbot')}>
                    Turbot
                  </div>
                </div>
              )}
            </div>
            <div className="menu-dropdown-item" onClick={handleOpen}>
              Open File
            </div>
            <div className="menu-dropdown-item" onClick={handleSave}>
              Save
            </div>
            <div className="menu-separator" />
            <div
              className="menu-dropdown-item submenu-container"
              onMouseEnter={() => setOpenSub('import')}
              onMouseLeave={() => setOpenSub(null)}
            >
              <span>Import</span>
              <span>▸</span>
              {openSub === 'import' && (
                <div className="submenu-dropdown">
                  <div className="menu-dropdown-item" onClick={handleImportBuild}>
                    Build
                  </div>
                  <div className="menu-dropdown-item" onClick={handleImportHomework}>
                    Worksheet
                  </div>
                  <div className="menu-dropdown-item" onClick={handleImportProblemSet}>
                    Problem Set
                  </div>
                </div>
              )}
            </div>
            <div
              className="menu-dropdown-item submenu-container"
              onMouseEnter={() => setOpenSub('export')}
              onMouseLeave={() => setOpenSub(null)}
            >
              <span>Export</span>
              <span>▸</span>
              {openSub === 'export' && (
                <div className="submenu-dropdown">
                  <div className="menu-dropdown-item" onClick={handleExportBuild}>
                    Build
                  </div>
                  <div className="menu-dropdown-item" onClick={handleSave}>
                    Worksheet
                  </div>
                </div>
              )}
            </div>
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
            <div className="menu-dropdown-item" onClick={() => { undo(); setOpenMenu(null); }}>
              Undo <span style={{ color: '#999', fontSize: 11 }}>⌘Z</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { redo(); setOpenMenu(null); }}>
              Redo <span style={{ color: '#999', fontSize: 11 }}>⌘⇧Z</span>
            </div>
            <div className="menu-separator" />
            <div className="menu-dropdown-item" onClick={() => { copySelected(); setOpenMenu(null); }}>
              Copy <span style={{ color: '#999', fontSize: 11 }}>⌘C</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { paste(); setOpenMenu(null); }}>
              Paste <span style={{ color: '#999', fontSize: 11 }}>⌘V</span>
            </div>
            <div className="menu-dropdown-item" onClick={() => { deleteSelected(); setOpenMenu(null); }}>
              Delete <span style={{ color: '#999', fontSize: 11 }}>⌫</span>
            </div>
          </div>
        )}
      </div>

      {/* Homework menu (legacy) */}
      {homework && (
        <div
          className="menu-item"
          style={{ color: '#2e7d32', fontWeight: 600 }}
          onClick={() => setOpenMenu(openMenu === 'hw' ? null : 'hw')}
        >
          {homework.title}
          {openMenu === 'hw' && (
            <div className="menu-dropdown">
              {homework.problems.map((p, i) => (
                <div
                  key={p.id}
                  className="menu-dropdown-item"
                  onClick={() => {
                    useStore.getState().switchProblem(i);
                    setOpenMenu(null);
                  }}
                >
                  Q{p.id}: {p.text.substring(0, 40)}...
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Problem Set menu */}
      {problemSet && (
        <div
          className="menu-item"
          style={{ color: '#1565c0', fontWeight: 600 }}
          onClick={() => setOpenMenu(openMenu === 'ps' ? null : 'ps')}
        >
          {problemSet.title}
          {openMenu === 'ps' && (
            <div className="menu-dropdown">
              {problemSet.pages.map((p, i) => (
                <div
                  key={p.id}
                  className="menu-dropdown-item"
                  onClick={() => {
                    useStore.getState().switchProblemPage(i);
                    setOpenMenu(null);
                  }}
                >
                  {p.label}: {p.statement.substring(0, 40)}...
                </div>
              ))}
              <div className="menu-separator" />
              <div
                className="menu-dropdown-item"
                onClick={() => {
                  useStore.getState().closeProblemSet();
                  setOpenMenu(null);
                }}
              >
                Close Problem Set
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
