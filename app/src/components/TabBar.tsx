import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';

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

export function TabBar() {
  const {
    tabs,
    activeTabId,
    switchTab,
    removeTab,
    addTab,
    homework,
    currentProblemIndex,
    switchProblem,
    problemSet,
    currentProblemPageIndex,
    switchProblemPage,
  } = useStore();

  // Problem Set mode tabs
  if (problemSet) {
    return (
      <div className="tab-bar">
        {problemSet.pages.map((p, i) => (
          <div
            key={p.id}
            className={`tab ${i === currentProblemPageIndex ? 'active' : ''}`}
            onClick={() => switchProblemPage(i)}
          >
            {p.label}
          </div>
        ))}
      </div>
    );
  }

  // Legacy homework mode tabs
  if (homework) {
    return (
      <div className="tab-bar">
        {homework.problems.map((p, i) => (
          <div
            key={p.id}
            className={`tab ${i === currentProblemIndex ? 'active' : ''}`}
            onClick={() => switchProblem(i)}
          >
            Q{p.id}
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
              {'\u00D7'}
            </span>
          )}
        </div>
      ))}
      <button
        className="tab-add-btn"
        onClick={() => addTab(`Circuit ${tabs.length + 1}`, 'CC', 'arithmetic')}
        title="New worksheet"
      >
        +
      </button>
    </div>
  );
}
