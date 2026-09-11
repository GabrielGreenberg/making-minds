import { useStore, selectEffectiveMode, selectAllowedComponents } from '../store';
import { isComponentTypeAllowed, disallowedComponentTypes } from '../engine/machineValidation';
import type { ComponentType } from '../types';
import { placeableBoxKinds } from '../types';

interface LibraryEntry {
  type: ComponentType;
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
];

const FSM_LIBRARY_ITEMS: LibraryEntry[] = [
  { type: 'STATE', label: 'State', section: 'States' },
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

// Sandbox tab headers: CC and SC deliberately share 'Logic Circuit' — the SC
// tab is the same circuit workspace, just with MEM available.
const MACHINE_LABELS: Record<string, string> = {
  CC: 'Logic Circuit',
  SC: 'Logic Circuit',
  FSM: 'Finite State Machine',
  TM: 'Turing Machine',
};

// A turbot header names the INNER MACHINE the student is editing, where the
// CC/SC distinction is real — consistent with questionModeLabel's
// "turbot - SC" chips on the assignment overview. Only the turbot context
// overrides SC; the sandbox labels above keep their semantics.
const TURBOT_BRAIN_LABELS: Record<string, string> = {
  ...MACHINE_LABELS,
  SC: 'Sequential Circuit',
};

function ConfirmedBoxItem({ box, numIn, numOut, isSelected, kind }: {
  box: { id: string; name: string; inputPortIds: string[]; outputPortIds: string[] };
  numIn: number;
  numOut: number;
  isSelected: boolean;
  kind?: 'CC' | 'FSM';
}) {
  const isFsm = kind === 'FSM';
  return (
    <div
      className={`library-item${isSelected ? ' library-item-selected' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('componentType', 'BOXED_INSTANCE');
        e.dataTransfer.setData('boxDefinitionId', box.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => {
        if (isFsm) {
          useStore.getState().fsmPlaceBoxInstance(box.id, 200, 200);
        } else {
          useStore.getState().placeBoxInstance(box.id, 200, 200);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {isFsm ? (
        <svg viewBox="0 0 56 40">
          <rect x="8" y="4" width="40" height="32" rx="3" fill="none" stroke="#333" strokeWidth="2" />
          <text x="28" y="24" textAnchor="middle" fontSize="7" fontWeight="600" fill="#333">{box.name}</text>
        </svg>
      ) : (
        <svg viewBox="0 0 56 40">
          <rect x="8" y="4" width="40" height="32" rx="3" fill="none" stroke="#333" strokeWidth="2" />
          {Array.from({ length: numIn }).map((_, i) => {
            const py = 4 + (32 / (numIn + 1)) * (i + 1);
            return (
              <g key={`in-${i}`}>
                <line x1="2" y1={py} x2="8" y2={py} stroke="#333" strokeWidth="1.5" />
                <circle cx="2" cy={py} r="2" fill="#555" />
              </g>
            );
          })}
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
      )}
    </div>
  );
}

export function ComponentLibrary() {
  const buildMode = useStore((s) => s.buildMode);
  // Turbot questions edit the inner brain circuit, so the palette (and
  // boxing rules below) follow the question's innerMode, not 'turbot'.
  const effectiveMode = useStore(selectEffectiveMode);
  const boxedLibrary = useStore((s) => s.boxedLibrary);
  const confirmedBoxLibrary = useStore((s) => s.confirmedBoxLibrary);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  // The open question's component restriction (null = unrestricted). Entries
  // outside the allowed set are hidden. The grader's Stage-1 check enforces
  // the same rule (engine/machineValidation.ts owns the semantics).
  const allowedComponents = useStore(selectAllowedComponents);

  // TM shares the FSM editor palette (STATE nodes + transition wires).
  const allItems = effectiveMode === 'FSM' || effectiveMode === 'TM' ? FSM_LIBRARY_ITEMS : CC_LIBRARY_ITEMS;
  const items = allItems.filter((item) => isComponentTypeAllowed(item.type, allowedComponents));
  const visibleLegacyBoxes = boxedLibrary.filter(
    (b) => disallowedComponentTypes(b.circuit, allowedComponents).length === 0,
  );

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
    <div
      className="component-library"
      onContextMenu={(e) => {
        // Same disarm gesture as on the canvas.
        if (selectedTool !== null) {
          e.preventDefault();
          setSelectedTool(null);
        }
      }}
    >
      <div className="library-machine-label">
        {buildMode === 'turbot'
          ? `Turbot · ${TURBOT_BRAIN_LABELS[effectiveMode] || 'Logic Circuit'}`
          : MACHINE_LABELS[buildMode] || 'Logic Circuit'}
      </div>
      {/* Component sections */}
      {Array.from(sections.entries()).map(([section, entries]) => (
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
                    setSelectedTool(entry.type);
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

      {/* New Box tool */}
      {(effectiveMode === 'CC' || effectiveMode === 'SC' || effectiveMode === 'FSM') && <div>
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

      {/* Box Menu — which kinds this canvas may place is placeableBoxKinds
          (types.ts). Under a component restriction, a box whose internals
          contain a disallowed type is hidden too (a boxed OR must not smuggle
          an OR in). */}
      {(() => {
        const placeableKinds = placeableBoxKinds(effectiveMode);
        const visibleBoxes = confirmedBoxLibrary.filter((b) =>
          placeableKinds.includes(b.kind ?? 'CC') &&
          disallowedComponentTypes(b.internalComponents, allowedComponents).length === 0
        );
        if (visibleBoxes.length === 0) return null;
        return (
          <div>
            <div className="library-section-title">Boxes</div>
            {visibleBoxes.map((box) => (
              <ConfirmedBoxItem
                key={box.id}
                box={box}
                numIn={box.inputPortIds.length}
                numOut={box.outputPortIds.length}
                isSelected={selectedTool === (`BOX:${box.id}` as any)}
                kind={box.kind}
              />
            ))}
          </div>
        );
      })()}

      {/* Legacy boxed library (same restriction rule as the Box Menu above) */}
      {visibleLegacyBoxes.length > 0 && (
        <div>
          <div className="library-section-title">Boxed</div>
          {visibleLegacyBoxes.map((b, i) => (
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
    </div>
  );
}
