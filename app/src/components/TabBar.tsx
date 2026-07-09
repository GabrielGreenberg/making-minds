import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { navigate } from '../routing';
import type { BuildMode } from '../types';

const MACHINE_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC',  label: 'Logic Circuit' },
  { mode: 'FSM', label: 'Finite State Machine' },
  { mode: 'TM',  label: 'Turing Machine' },
];

// A turbot's brain is one of the four machine kinds (spec §9.3). The CC/SC
// distinction is real inside a turbot (it picks the brain's step semantics),
// so — unlike the sandbox machine list above, where SC is just "a Logic
// Circuit with MEM" — the brain picker names all four.
const TURBOT_BRAIN_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC',  label: 'Logic Circuit brain' },
  { mode: 'SC',  label: 'Sequential Circuit brain' },
  { mode: 'FSM', label: 'Finite State Machine brain' },
  { mode: 'TM',  label: 'Turing Machine brain' },
];

const menuItemStyle: CSSProperties = {
  padding: '9px 16px',
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
};

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
  // Two-page menu: the machine list, then (after picking "Turbot") the
  // brain-kind list for the turbot's inner machine.
  const [brainPicker, setBrainPicker] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { tabs, addTab } = useStore();

  useEffect(() => {
    if (!open) {
      setBrainPicker(false);
      return;
    }
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

  const handleSelectTurbot = (innerMode: BuildMode) => {
    const count = tabs.filter((t) => t.buildMode === 'turbot').length + 1;
    addTab(`Turbot ${count}`, 'turbot', 'turbot', innerMode);
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
          {!brainPicker ? (
            <>
              {MACHINE_OPTIONS.map((opt) => (
                <div
                  key={opt.mode}
                  onPointerDown={() => handleSelect(opt.mode, opt.label)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                >
                  {opt.label}
                </div>
              ))}
              <div
                onPointerDown={() => setBrainPicker(true)}
                style={{ ...menuItemStyle, display: 'flex', justifyContent: 'space-between', gap: 12 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                <span>Turbot</span>
                <span style={{ color: '#999' }}>{'›'}</span>
              </div>
            </>
          ) : (
            <>
              <div
                onPointerDown={() => setBrainPicker(false)}
                style={{ ...menuItemStyle, color: '#666', borderBottom: '1px solid #eee' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                {'‹'} Turbot — pick its brain
              </div>
              {TURBOT_BRAIN_OPTIONS.map((opt) => (
                <div
                  key={opt.mode}
                  onPointerDown={() => handleSelectTurbot(opt.mode)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                >
                  {opt.label}
                </div>
              ))}
            </>
          )}
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
    // Per-question navigation: back to the assignment's question list, or to
    // the previous/next question — one dedicated canvas per question.
    const q = assignment.questions[currentQuestionIndex];
    const count = assignment.questions.length;
    const go = (i: number) =>
      navigate({ kind: 'assignment', id: assignment.id, questionIndex: i }, { replace: true });
    return (
      <div className="tab-bar question-nav">
        <button
          className="question-nav-back"
          onClick={() => navigate({ kind: 'assignment', id: assignment.id })}
          title="Back to the question list"
        >
          ‹ Questions
        </button>
        <span className="question-nav-arrows">
          <button
            className="question-nav-btn"
            disabled={currentQuestionIndex === 0}
            onClick={() => go(currentQuestionIndex - 1)}
            title="Previous question"
          >
            ←
          </button>
          <button
            className="question-nav-btn"
            disabled={currentQuestionIndex >= count - 1}
            onClick={() => go(currentQuestionIndex + 1)}
            title="Next question"
          >
            →
          </button>
        </span>
        <span className="question-nav-label">
          {q?.label ?? '?'}
          <span className="question-nav-count"> · {currentQuestionIndex + 1} of {count}</span>
        </span>
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
