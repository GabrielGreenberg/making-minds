import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { navigate } from '../routing';
import type { BuildMode } from '../types';

const MACHINE_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC',  label: 'Logic Circuit' },
  { mode: 'FSM', label: 'Finite State Machine' },
  { mode: 'TM',  label: 'Turing Machine' },
];

function EditableTabTitle({
  tabId,
  title,
  isActive,
}: {
  tabId: string;
  title: string;
  isActive: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameTab = useStore((s) => s.renameTab);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      renameTab(tabId, trimmed);
    } else {
      setEditValue(title);
    }
    setEditing(false);
  };

  if (editing && isActive) {
    return (
      <input
        ref={inputRef}
        className="tab-rename-input"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setEditValue(title);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="tab-title"
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (isActive) {
          setEditValue(title);
          setEditing(true);
        }
      }}
    >
      {title}
    </span>
  );
}

function AddTabButton() {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { tabs, addTab } = useStore();

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 2, left: rect.left });
    }
    setOpen((o) => !o);
  };

  const handleSelect = (mode: BuildMode, label: string) => {
    const count = tabs.filter((t) => t.buildMode === mode).length + 1;
    addTab(`${label} ${count}`, mode, 'arithmetic');
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        className="tab-add-btn"
        onClick={handleOpen}
        title="New worksheet"
      >
        +
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            minWidth: 190,
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {MACHINE_OPTIONS.map((opt) => (
            <div
              key={opt.mode}
              onPointerDown={() => handleSelect(opt.mode, opt.label)}
              style={{
                padding: '9px 16px',
                fontSize: 13,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    switchTab,
    removeTab,
    assignment,
    currentQuestionIndex,
  } = useStore();

  if (assignment) {
    return (
      <div className="tab-bar">
        {assignment.questions.map((q, i) => (
          <div
            key={q.id}
            className={`tab ${i === currentQuestionIndex ? 'active' : ''}`}
            onClick={() => navigate({ kind: 'assignment', id: assignment.id, questionIndex: i }, { replace: true })}
          >
            {q.label}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => switchTab(tab.id)}
        >
          <EditableTabTitle
            tabId={tab.id}
            title={tab.title}
            isActive={tab.id === activeTabId}
          />
          {tabs.length > 1 && (
            <span
              className="close-tab"
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
            >
              {'×'}
            </span>
          )}
        </div>
      ))}
      <AddTabButton />
    </div>
  );
}
