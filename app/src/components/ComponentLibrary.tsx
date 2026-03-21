import { useStore } from '../store';
import type { ComponentType, BuildMode } from '../types';

interface LibraryEntry {
  type: ComponentType;
  label: string;
  section: string;
}

const LIBRARY_ITEMS: LibraryEntry[] = [
  { type: 'INPUT', label: 'Input', section: 'I/O' },
  { type: 'OUTPUT', label: 'Output', section: 'I/O' },
  { type: 'AND', label: 'AND', section: 'Gates' },
  { type: 'OR', label: 'OR', section: 'Gates' },
  { type: 'NOT', label: 'NOT', section: 'Gates' },
  { type: 'MEM', label: 'MEM', section: 'Memory' },
];

function GateIcon({ type }: { type: ComponentType }) {
  switch (type) {
    case 'AND':
      return (
        <svg viewBox="-2 -2 60 44">
          <path
            d="M8,4 L28,4 Q48,4 48,20 Q48,36 28,36 L8,36 Z"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
          />
          <circle cx="6" cy="14" r="2.5" fill="#555" />
          <circle cx="6" cy="26" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="26" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u2227'}</text>
        </svg>
      );
    case 'OR':
      return (
        <svg viewBox="-2 -2 60 44">
          <path
            d="M8,4 Q18,4 28,4 Q48,4 50,20 Q48,36 28,36 Q18,36 8,36 Q18,20 8,4 Z"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
          />
          <circle cx="10" cy="14" r="2.5" fill="#555" />
          <circle cx="10" cy="26" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="28" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u2228'}</text>
        </svg>
      );
    case 'NOT':
      return (
        <svg viewBox="-2 -2 60 44">
          <polygon
            points="8,4 48,20 8,36"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
          />
          <circle cx="6" cy="20" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="20" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u00AC'}</text>
        </svg>
      );
    case 'INPUT':
      return (
        <svg viewBox="0 0 56 40">
          <rect x="8" y="10" width="28" height="20" rx="2" fill="none" stroke="#333" strokeWidth="2" />
          <line x1="36" y1="20" x2="48" y2="20" stroke="#333" strokeWidth="2" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="22" y="24" textAnchor="middle" fontSize="10" fontWeight="500" fill="#333">IN</text>
        </svg>
      );
    case 'OUTPUT':
      return (
        <svg viewBox="0 0 56 40">
          <rect x="16" y="10" width="28" height="20" rx="2" fill="none" stroke="#333" strokeWidth="2" />
          <line x1="6" y1="20" x2="16" y2="20" stroke="#333" strokeWidth="2" />
          <circle cx="6" cy="20" r="2.5" fill="#555" />
          <text x="30" y="24" textAnchor="middle" fontSize="9" fontWeight="500" fill="#333">OUT</text>
        </svg>
      );
    case 'MEM':
      return (
        <svg viewBox="0 0 56 40">
          <rect x="10" y="6" width="36" height="28" rx="3" fill="none" stroke="#333" strokeWidth="2" />
          <circle cx="8" cy="20" r="2.5" fill="#555" />
          <circle cx="48" cy="20" r="2.5" fill="#555" />
          <text x="28" y="24" textAnchor="middle" fontSize="12" fontWeight="600" fill="#333">M</text>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 56 40">
          <rect x="8" y="8" width="40" height="24" rx="3" fill="none" stroke="#333" strokeWidth="2" />
          <text x="28" y="24" textAnchor="middle" fontSize="10" fill="#333">{type}</text>
        </svg>
      );
  }
}

const MACHINE_TYPES: { mode: BuildMode; label: string }[] = [
  { mode: 'CC', label: 'Circuit' },
  { mode: 'FSM', label: 'Finite State Machine' },
  { mode: 'TM', label: 'Turing Machine' },
];

export function ComponentLibrary() {
  const buildMode = useStore((s) => s.buildMode);
  const setBuildMode = useStore((s) => s.setBuildMode);
  const boxedLibrary = useStore((s) => s.boxedLibrary);
  const confirmedBoxLibrary = useStore((s) => s.confirmedBoxLibrary);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  const items = LIBRARY_ITEMS;

  // Group by section
  const sections = new Map<string, LibraryEntry[]>();
  for (const item of items) {
    const list = sections.get(item.section) || [];
    list.push(item);
    sections.set(item.section, list);
  }

  const handleDragStart = (e: React.DragEvent, type: ComponentType) => {
    e.dataTransfer.setData('componentType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="component-library">
      {/* Machine Type Selector */}
      <div className="machine-type-selector">
        <select
          className="machine-type-dropdown"
          value={buildMode}
          onChange={(e) => setBuildMode(e.target.value as BuildMode)}
        >
          {MACHINE_TYPES.map((mt) => (
            <option key={mt.mode} value={mt.mode}>{mt.label}</option>
          ))}
        </select>
      </div>

      {/* Component sections */}
      {Array.from(sections.entries()).map(([section, entries]) => (
        <div key={section}>
          <div className="library-section-title">{section}</div>
          {entries.map((entry) => (
            <div
              key={entry.type}
              className={`library-item${selectedTool === entry.type ? ' library-item-selected' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, entry.type)}
              onClick={() => {
                if (selectedTool === entry.type) {
                  setSelectedTool(null);
                } else {
                  setSelectedTool(entry.type);
                }
              }}
            >
              <GateIcon type={entry.type} />
              <span className="library-item-label">{entry.label}</span>
            </div>
          ))}
        </div>
      ))}

      {/* New Box tool */}
      <div>
        <div className="library-section-title">Boxing</div>
        <div
          className={`library-item${selectedTool === 'NEW_BOX' ? ' library-item-selected' : ''}`}
          onClick={() => {
            if (selectedTool === 'NEW_BOX') {
              setSelectedTool(null);
            } else {
              setSelectedTool('NEW_BOX');
            }
          }}
        >
          <svg viewBox="0 0 56 40">
            <rect
              x="6" y="4" width="44" height="32" rx="3"
              fill="none"
              stroke="#333"
              strokeWidth="2"
              strokeDasharray="4,3"
            />
            <text x="28" y="26" textAnchor="middle" fontSize="20" fontWeight="400" fill="#555">+</text>
          </svg>
          <span className="library-item-label">New Box</span>
        </div>
      </div>

      {/* Box Menu — confirmed boxes available across all tabs */}
      {confirmedBoxLibrary.length > 0 && (
        <div>
          <div className="library-section-title">Boxes</div>
          {confirmedBoxLibrary.map((box) => {
            const numIn = box.inputPortIds.length;
            const numOut = box.outputPortIds.length;
            return (
              <div
                key={box.id}
                className={`library-item${selectedTool === (`BOX:${box.id}` as any) ? ' library-item-selected' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('componentType', 'BOXED_INSTANCE');
                  e.dataTransfer.setData('boxDefinitionId', box.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  useStore.getState().placeBoxInstance(box.id, 200, 200);
                }}
                style={{ cursor: 'pointer' }}
              >
                <svg viewBox="0 0 56 40">
                  {/* Solid box outline */}
                  <rect x="8" y="4" width="40" height="32" rx="3" fill="none" stroke="#333" strokeWidth="2" />
                  {/* Input ports (left side) */}
                  {Array.from({ length: numIn }).map((_, i) => {
                    const py = 4 + (32 / (numIn + 1)) * (i + 1);
                    return (
                      <g key={`in-${i}`}>
                        <line x1="2" y1={py} x2="8" y2={py} stroke="#333" strokeWidth="1.5" />
                        <circle cx="2" cy={py} r="2" fill="#555" />
                      </g>
                    );
                  })}
                  {/* Output ports (right side) */}
                  {Array.from({ length: numOut }).map((_, i) => {
                    const py = 4 + (32 / (numOut + 1)) * (i + 1);
                    return (
                      <g key={`out-${i}`}>
                        <line x1="48" y1={py} x2="54" y2={py} stroke="#333" strokeWidth="1.5" />
                        <circle cx="54" cy={py} r="2" fill="#555" />
                      </g>
                    );
                  })}
                  <text x="28" y="24" textAnchor="middle" fontSize="8" fontWeight="600" fill="#333">{box.name}</text>
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy boxed library */}
      {boxedLibrary.length > 0 && (
        <div>
          <div className="library-section-title">Boxed</div>
          {boxedLibrary.map((b, i) => (
            <div
              key={i}
              className="library-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('componentType', 'BOXED');
                e.dataTransfer.setData('boxedName', b.name);
              }}
            >
              <GateIcon type="BOXED" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
