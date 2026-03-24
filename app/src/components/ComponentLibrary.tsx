import { useStore } from '../store';
import type { ComponentType } from '../types';

interface LibraryEntry {
  type: ComponentType | 'TEXT' | 'COMMENT';
  label: string;
  section: string;
}

const CC_LIBRARY_ITEMS: LibraryEntry[] = [
  { type: 'INPUT', label: 'Input', section: 'I/O' },
  { type: 'OUTPUT', label: 'Output', section: 'I/O' },
  { type: 'AND', label: 'AND', section: 'Gates' },
  { type: 'OR', label: 'OR', section: 'Gates' },
  { type: 'NOT', label: 'NOT', section: 'Gates' },
  { type: 'MEM', label: '', section: 'Memory' },
  { type: 'TEXT', label: 'Text', section: 'Annotate' },
  { type: 'COMMENT', label: 'Comment', section: 'Annotate' },
];

const FSM_LIBRARY_ITEMS: LibraryEntry[] = [
  { type: 'STATE', label: 'State', section: 'States' },
  { type: 'TEXT', label: 'Text', section: 'Annotate' },
  { type: 'COMMENT', label: 'Comment', section: 'Annotate' },
];

const SW = '1.5'; // uniform stroke width for all palette icons

function PaletteIcon({ type }: { type: string }) {
  switch (type) {
    case 'AND':
      return (
        <svg viewBox="-2 -2 60 44">
          <path d="M8,4 L28,4 Q48,4 48,20 Q48,36 28,36 L8,36 Z" fill="none" stroke="#333" strokeWidth={SW} />
          <circle cx="6" cy="14" r="2.5" fill="#555" />
          <circle cx="6" cy="26" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="26" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u2227'}</text>
        </svg>
      );
    case 'OR':
      return (
        <svg viewBox="-2 -2 60 44">
          <path d="M8,4 Q18,4 28,4 Q48,4 50,20 Q48,36 28,36 Q18,36 8,36 Q18,20 8,4 Z" fill="none" stroke="#333" strokeWidth={SW} />
          <circle cx="10" cy="14" r="2.5" fill="#555" />
          <circle cx="10" cy="26" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="28" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u2228'}</text>
        </svg>
      );
    case 'NOT':
      return (
        <svg viewBox="-2 -2 60 44">
          <polygon points="8,4 48,20 8,36" fill="none" stroke="#333" strokeWidth={SW} />
          <circle cx="6" cy="20" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="20" y="24" textAnchor="middle" fontSize="14" fontWeight="700" fill="#333">{'\u00AC'}</text>
        </svg>
      );
    case 'INPUT':
      return (
        <svg viewBox="-2 -2 60 44">
          <rect x="8" y="8" width="28" height="24" rx="2" fill="none" stroke="#333" strokeWidth={SW} />
          <line x1="36" y1="20" x2="48" y2="20" stroke="#333" strokeWidth={SW} />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="22" y="25" textAnchor="middle" fontSize="10" fontWeight="500" fill="#333">IN</text>
        </svg>
      );
    case 'OUTPUT':
      return (
        <svg viewBox="-2 -2 60 44">
          <rect x="16" y="8" width="28" height="24" rx="2" fill="none" stroke="#333" strokeWidth={SW} />
          <line x1="6" y1="20" x2="16" y2="20" stroke="#333" strokeWidth={SW} />
          <circle cx="6" cy="20" r="2.5" fill="#555" />
          <text x="30" y="25" textAnchor="middle" fontSize="9" fontWeight="500" fill="#333">OUT</text>
        </svg>
      );
    case 'MEM':
      return (
        <svg viewBox="-2 -2 60 44">
          <rect x="8" y="6" width="40" height="28" rx="3" fill="none" stroke="#333" strokeWidth={SW} />
          <circle cx="6" cy="20" r="2.5" fill="#555" />
          <circle cx="50" cy="20" r="2.5" fill="#555" />
          <text x="28" y="24" textAnchor="middle" fontSize="12" fontWeight="600" fill="#333">M</text>
        </svg>
      );
    case 'TEXT':
      return (
        <svg viewBox="-2 -2 60 44">
          <text x="28" y="30" textAnchor="middle" fontSize="28" fontWeight="600" fontFamily="Georgia, serif" fill="#333">T</text>
        </svg>
      );
    case 'COMMENT':
      return (
        <svg viewBox="4 0 48 44">
          <path d="M16,6 L42,6 Q46,6 46,10 L46,24 Q46,28 42,28 L24,28 L18,35 L18,28 L16,28 Q12,28 12,24 L12,10 Q12,6 16,6 Z" fill="none" stroke="#333" strokeWidth={SW} />
          <line x1="19" y1="14" x2="39" y2="14" stroke="#333" strokeWidth="1" />
          <line x1="19" y1="20" x2="34" y2="20" stroke="#333" strokeWidth="1" />
        </svg>
      );
    case 'STATE':
      return (
        <svg viewBox="-2 -2 60 44">
          <circle cx="28" cy="20" r="16" fill="none" stroke="#333" strokeWidth={SW} />
          <text x="28" y="24" textAnchor="middle" fontSize="11" fontWeight="600" fill="#333">S</text>
        </svg>
      );
    default:
      return (
        <svg viewBox="-2 -2 60 44">
          <rect x="8" y="8" width="40" height="24" rx="3" fill="none" stroke="#333" strokeWidth={SW} />
          <text x="28" y="24" textAnchor="middle" fontSize="10" fill="#333">{type}</text>
        </svg>
      );
  }
}

const MACHINE_LABELS: Record<string, string> = {
  CC: 'Logic Circuit',
  SC: 'Logic Circuit',
  FSM: 'Finite State Machine',
  TM: 'Turing Machine',
};

export function ComponentLibrary() {
  const buildMode = useStore((s) => s.buildMode);
  const boxedLibrary = useStore((s) => s.boxedLibrary);
  const confirmedBoxLibrary = useStore((s) => s.confirmedBoxLibrary);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  const items = buildMode === 'FSM' ? FSM_LIBRARY_ITEMS : CC_LIBRARY_ITEMS;

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
      <div className="library-machine-label">{MACHINE_LABELS[buildMode] || 'Logic Circuit'}</div>
      {/* Component sections (non-Annotate) */}
      {Array.from(sections.entries()).filter(([section]) => section !== 'Annotate').map(([section, entries]) => (
        <div key={section}>
          <div className="library-section-title">{section}</div>
          {entries.map((entry) => {
            return (
              <div
                key={entry.type}
                className={`library-item${selectedTool === entry.type ? ' library-item-selected' : ''}`}
                draggable
                onDragStart={(e) => { handleDragStart(e, entry.type as ComponentType); }}
                onClick={() => {
                  if (selectedTool === entry.type) {
                    setSelectedTool(null);
                  } else {
                    setSelectedTool(entry.type as ComponentType | 'TEXT' | 'COMMENT');
                  }
                }}
              >
                <PaletteIcon type={entry.type} />
                {entry.label && <span className="library-item-label">{entry.label}</span>}
              </div>
            );
          })}
        </div>
      ))}

      {/* New Box tool (hidden in FSM mode) */}
      {buildMode !== 'FSM' && <div>
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
      </div>}

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
              <PaletteIcon type="BOXED" />
            </div>
          ))}
        </div>
      )}

      {/* Annotate section */}
      {sections.has('Annotate') && (
        <div>
          <div className="library-section-title">Annotate</div>
          {sections.get('Annotate')!.map((entry) => (
            <div
              key={entry.type}
              className={`library-item${selectedTool === entry.type ? ' library-item-selected' : ''}`}
              onClick={() => {
                if (selectedTool === entry.type) {
                  setSelectedTool(null);
                } else {
                  setSelectedTool(entry.type as ComponentType | 'TEXT' | 'COMMENT');
                }
              }}
            >
              <PaletteIcon type={entry.type} />
              {entry.label && <span className="library-item-label">{entry.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
