import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  BuildMode,
  RepSystem,
  DisplayMode,
  Scope,
  ActiveTask,
  CircuitComponent,
  Wire,
  ComponentType,
  AssignmentData,
  TextElement,
  CommentElement,
  BoxDefinition,
  WireManualSegment,
  FsmHistoryEntry,
  WorkbookData,
  WorksheetData,
  SubmissionData,
  QuestionCircuit,
} from './types';
import {
  getPortsForType,
  getMemOutputPortId,
  getMemInputPortId,
  isMemSinkPort,
  GRID_SIZE,
  toSubscript,
} from './types';
import { topologicalSort, evaluateGate, evaluateCC } from './engine';
import { getAssignment } from './assignments';
import {
  localWorkbookStore,
  emptyQuestionCircuit,
  restoreQuestionCircuits,
} from './storage/workbookStore';

interface HistoryEntry {
  components: CircuitComponent[];
  wires: Wire[];
  textElements: TextElement[];
  comments: CommentElement[];
  boxes: BoxDefinition[];
}


interface AppState {
  // Auto-save status
  autoSaveStatus: 'saved' | 'unsaved' | 'saving';

  // Workbook
  workbookOpen: boolean;
  workbookTitle: string;
  workbookFileHandle: FileSystemFileHandle | null;
  closeWorkbook: () => void;
  newWorkbook: () => void;
  openWorkbook: (json: string, handle?: FileSystemFileHandle | null) => void;
  exportWorkbook: () => string;
  importWorkbook: (json: string, handle?: FileSystemFileHandle | null) => void;

  // Build mode
  buildMode: BuildMode;
  setBuildMode: (mode: BuildMode) => void;

  // Turbo toggle
  turboEnabled: boolean;
  setTurboEnabled: (v: boolean) => void;

  // Active task
  activeTask: ActiveTask;
  setActiveTask: (t: ActiveTask) => void;

  // Table settings
  repSystem: RepSystem;
  displayMode: DisplayMode;
  scope: Scope;
  setRepSystem: (r: RepSystem) => void;
  setDisplayMode: (d: DisplayMode) => void;
  setScope: (s: Scope) => void;

  // Circuit data
  components: CircuitComponent[];
  wires: Wire[];

  // Counters for labeling
  nextInputNum: number;
  nextOutputNum: number;
  nextMemNum: number;

  // Component operations
  addComponent: (type: ComponentType, x: number, y: number) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  moveComponentRaw: (id: string, x: number, y: number) => void;
  snapComponentToGrid: (id: string) => void;
  removeComponent: (id: string) => void;
  setInputValue: (id: string, value: number | undefined) => void;
  setMemStoredValue: (id: string, value: number) => void;

  // Wire operations
  addWire: (
    sourceCompId: string,
    sourcePortId: string,
    targetCompId: string,
    targetPortId: string
  ) => void;
  removeWire: (id: string) => void;
  updateWireManualSegments: (wireId: string, segments: WireManualSegment[]) => void;

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;

  // Canvas
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showWireValues: boolean;
  snapToAlign: boolean;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setShowGrid: (v: boolean) => void;
  setShowWireValues: (v: boolean) => void;
  setSnapToAlign: (v: boolean) => void;

  // Evaluation
  evaluateCircuit: () => void;
  wireValues: Map<string, number>;

  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Assignment mode — one graded, multi-question assignment open at a time.
  assignment: AssignmentData | null;
  currentQuestionIndex: number;
  // Per-question circuit + annotations, keyed by AssignmentQuestion.id.
  questionCircuits: Map<number, QuestionCircuit>;
  loadAssignment: (assignment: AssignmentData) => void;
  // Open a bundled assignment by id and show its workbook. Returns false if unknown.
  openAssignment: (id: string) => boolean;
  switchQuestion: (index: number) => void;
  closeAssignment: () => void;
  // Navigation between the catalog (Home) and the editor.
  goHome: () => void;          // hide the editor, return to the catalog (preserves in-memory work)
  enterSandbox: () => void;    // open the freeform sandbox workbook (clears any active assignment)

  // Save/Load (legacy single-circuit export for "Export Worksheet")
  exportProject: () => string;
  importProject: (json: string) => void;
  // Submission export (null when no assignment is loaded)
  exportSubmission: (student?: string) => string | null;
  // exportWorkbook and importWorkbook are in the Workbook section above

  // Rotation
  rotateComponent: (id: string) => void;

  // Boxed circuits (legacy library-based)
  importBoxedCircuit: (name: string, json: string) => void;
  boxCurrentCircuit: (name: string) => string | null;
  boxedLibrary: { name: string; type: ComponentType; circuit: CircuitComponent[]; wires: Wire[]; ports: import('./types').Port[] }[];

  // Box definitions (new draw-on-canvas boxing)
  boxes: BoxDefinition[];
  addBox: (box: BoxDefinition) => void;
  updateBox: (id: string, updates: Partial<BoxDefinition>) => void;
  removeBox: (id: string) => void;
  confirmBox: (id: string) => string | null; // returns error or null
  removeConfirmedBox: (id: string) => void;
  placeBoxInstance: (boxId: string, x: number, y: number) => void; // place a copy of a box as a BOXED component
  fsmPlaceBoxInstance: (boxId: string, x: number, y: number) => void; // expand FSM box states onto canvas

  // Global box library — confirmed boxes available across all tabs
  confirmedBoxLibrary: {
    id: string;
    name: string;
    kind?: 'CC' | 'FSM';
    inputPortIds: string[];
    outputPortIds: string[];
    internalComponents: CircuitComponent[];
    internalWires: Wire[];
  }[];

  // Clear workspace
  clearWorkspace: () => void;

  // Delete selected
  deleteSelected: () => void;

  // Copy/paste
  clipboard: { components: CircuitComponent[]; wires: Wire[] } | null;
  copySelected: () => void;
  paste: () => void;

  // Tabs (worksheets)
  tabs: { id: string; title: string; buildMode: BuildMode; activeTask: ActiveTask }[];
  activeTabId: string;
  addTab: (title: string, buildMode: BuildMode, activeTask?: ActiveTask) => void;
  switchTab: (id: string) => void;
  removeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  tabCircuits: Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>;

  // Batch move (for efficient multi-component drag)
  moveComponentsBatch: (moves: Map<string, { x: number; y: number }>) => void;
  snapComponentsToGrid: (ids: string[]) => void;

  // Table rows (step-by-step execution model for CC)
  tableRows: { inputBits: number[]; memBits?: number[]; outputBits: number[] }[];
  addTableRow: () => void;
  clearTableRows: () => void;

  // Local I/O stepping (per-component propagation)
  localStepIndex: number;
  localStepSorted: string[];
  localStepPortValues: Record<string, number | undefined>;
  localStepActive: boolean;
  localStepSelectedKey: string | null;
  localStepSelect: (inBits: number[], memBits?: number[]) => void;
  localStepOne: () => boolean;
  localStepReset: () => void;
  localStepClear: () => void;

  // Sequential circuit state
  scTimeStep: number; // current time step (starts at 1)
  scHistory: { t: number; inputBits: number[]; outputBits: number[]; memValues: number[] }[];
  scInputSequence: number[][]; // per-input arrays of bits across time steps
  scRunning: boolean;
  scRunIntervalId: number | null;
  scStep: () => void; // advance one clock cycle
  scRun: () => void; // start continuous execution
  scPause: () => void; // pause continuous execution
  scReset: () => void; // reset to t=1, preserve circuit structure and input sequence
  scGlobalReset: () => void; // reset to t=1, clear all inputs and memory
  setScInputBit: (inputIndex: number, timeStep: number, value: number) => void;

  // Global I/O sequences (each entry = one run with input string and output string)
  scGlobalSequences: { inputStr: string; outputStr: string }[];
  setScGlobalSequenceInput: (index: number, value: string) => void;
  loadScGlobalSequence: (index: number) => void;
  recordScGlobalSequenceOutput: () => void;

  // Selected tool (click-to-place mode)
  selectedTool: ComponentType | 'TEXT' | 'COMMENT' | 'NEW_BOX' | null;
  setSelectedTool: (t: ComponentType | 'TEXT' | 'COMMENT' | 'NEW_BOX' | null) => void;

  // Text elements
  textElements: TextElement[];
  addTextElement: (x: number, y: number) => string; // returns id
  updateTextElement: (id: string, updates: Partial<TextElement>) => void;
  removeTextElement: (id: string) => void;

  // Comments
  comments: CommentElement[];
  showComments: boolean;
  setShowComments: (v: boolean) => void;
  addComment: (targetId: string, text: string) => string; // returns id
  updateComment: (id: string, updates: Partial<CommentElement>) => void;
  removeComment: (id: string) => void;

  // Box drawing mode state
  boxDrawing: {
    phase: 'idle' | 'drawing' | 'adjusting';
    draftBox: BoxDefinition | null;
  };
  setBoxDrawingPhase: (phase: 'idle' | 'drawing' | 'adjusting') => void;
  setDraftBox: (box: BoxDefinition | null) => void;

  // FSM state
  nextStateNum: number;
  fsmCurrentStateId: string | null; // component ID of active state
  fsmInputSequence: number[]; // flat array of input bits
  fsmTimeStep: number; // starts at 1
  fsmHistory: import('./types').FsmHistoryEntry[];
  fsmRunning: boolean;
  fsmRunIntervalId: number | null;
  fsmHalted: boolean;
  setTransitionLabel: (wireId: string, label: string) => void;
  setFsmControlPt: (wireId: string, pt: { x: number; y: number } | undefined) => void;
  fsmStep: () => void;
  fsmRun: () => void;
  fsmPause: () => void;
  fsmReset: () => void;
  fsmGlobalReset: () => void;
  setFsmInputBit: (index: number, value: number) => void;
  setFsmInputSequence: (seq: number[]) => void;
}

function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

// ─── MEM direction auto-resolution ──────────────────────────────────
// Infer memDirection from wiring context. Cascades through MEM chains.
function resolveMemDirections(
  components: CircuitComponent[],
  wires: Wire[]
): CircuitComponent[] {
  const compMap = new Map(components.map((c) => [c.id, c]));
  // Track resolved directions (only for MEMs that were undecided)
  const resolved = new Map<string, 'left-to-right' | 'right-to-left'>();

  // Helper: is this port on a component a known signal source?
  function isKnownSource(comp: CircuitComponent, portId: string): boolean {
    if (comp.type !== 'MEM') {
      // Non-MEM: right-side ports are always sources
      const port = comp.ports.find((p) => p.id === portId);
      return port?.side === 'right';
    }
    // MEM with resolved or explicit direction
    const dir = comp.memDirection ?? resolved.get(comp.id);
    if (!dir) return false;
    const outputPortId = dir === 'left-to-right' ? 'min' : 'mout';
    return portId === outputPortId;
  }

  // Helper: is this port on a component a known signal sink?
  function isKnownSink(comp: CircuitComponent, portId: string): boolean {
    if (comp.type !== 'MEM') {
      const port = comp.ports.find((p) => p.id === portId);
      return port?.side === 'left';
    }
    const dir = comp.memDirection ?? resolved.get(comp.id);
    if (!dir) return false;
    const inputPortId = dir === 'left-to-right' ? 'mout' : 'min';
    return portId === inputPortId;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const comp of components) {
      if (comp.type !== 'MEM') continue;
      if (comp.memDirection || resolved.has(comp.id)) continue;

      let inferred: 'left-to-right' | 'right-to-left' | null = null;

      for (const wire of wires) {
        if (inferred) break;

        // Wire targets this MEM's left port (mout) from a known source → left is input
        if (wire.targetComponentId === comp.id && wire.targetPortId === 'mout') {
          const source = compMap.get(wire.sourceComponentId);
          if (source && isKnownSource(source, wire.sourcePortId)) {
            inferred = 'left-to-right';
          }
        }
        // Wire targets this MEM's right port (min) from a known source → right is input
        if (wire.targetComponentId === comp.id && wire.targetPortId === 'min') {
          const source = compMap.get(wire.sourceComponentId);
          if (source && isKnownSource(source, wire.sourcePortId)) {
            inferred = 'right-to-left';
          }
        }
        // Wire from this MEM's left port (mout) to a known sink → left is output
        if (wire.sourceComponentId === comp.id && wire.sourcePortId === 'mout') {
          const target = compMap.get(wire.targetComponentId);
          if (target && isKnownSink(target, wire.targetPortId)) {
            inferred = 'right-to-left';
          }
        }
        // Wire from this MEM's right port (min) to a known sink → right is output
        if (wire.sourceComponentId === comp.id && wire.sourcePortId === 'min') {
          const target = compMap.get(wire.targetComponentId);
          if (target && isKnownSink(target, wire.targetPortId)) {
            inferred = 'left-to-right';
          }
        }
      }

      if (inferred) {
        resolved.set(comp.id, inferred);
        changed = true; // may cascade to adjacent MEMs
      }
    }
  }

  if (resolved.size === 0) return components;
  return components.map((c) =>
    resolved.has(c.id) ? { ...c, memDirection: resolved.get(c.id) } : c
  );
}

const defaultTabId = 'tab-1';

export const useStore = create<AppState>()((set, get) => ({
  autoSaveStatus: 'saved' as const,

  // Workbook state
  workbookOpen: false,
  workbookTitle: 'Untitled Workbook',
  workbookFileHandle: null,

  closeWorkbook: () => {
    set({
      workbookOpen: false,
      workbookTitle: 'Untitled Workbook',
      workbookFileHandle: null,
      tabs: [{ id: defaultTabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
      activeTabId: defaultTabId,
      tabCircuits: new Map(),
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      buildMode: 'CC',
      activeTask: 'arithmetic',
      undoStack: [],
      redoStack: [],
    });
    // Clear auto-save so next load shows welcome screen
    try { localStorage.removeItem('making-minds-autosave'); } catch { /* ignore */ }
  },

  newWorkbook: () => {
    const tabId = uuid();
    set({
      assignment: null,
      workbookOpen: true,
      workbookTitle: 'Untitled Workbook',
      workbookFileHandle: null,
      tabs: [{ id: tabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
      activeTabId: tabId,
      tabCircuits: new Map(),
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      buildMode: 'CC',
      activeTask: 'arithmetic',
      undoStack: [],
      redoStack: [],
    });
  },

  openWorkbook: (json, handle) => {
    get().importWorkbook(json, handle);
  },

  exportWorkbook: () => {
    const state = get();
    // Save current tab's circuit into tabCircuits for serialization
    const allTabCircuits = new Map(state.tabCircuits);
    allTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      textElements: state.textElements,
      comments: state.comments,
      boxes: state.boxes,
    });

    const worksheets: WorksheetData[] = state.tabs.map((tab) => {
      const circuit = allTabCircuits.get(tab.id) || { components: [], wires: [], textElements: [], comments: [], boxes: [] };
      return {
        id: tab.id,
        title: tab.title,
        buildMode: tab.buildMode,
        activeTask: tab.activeTask,
        circuit: { components: circuit.components, wires: circuit.wires },
        textElements: circuit.textElements,
        comments: circuit.comments,
        boxes: circuit.boxes,
      };
    });

    const workbook: WorkbookData = {
      formatVersion: 2,
      metadata: {
        title: state.workbookTitle,
        author: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      worksheets,
      activeWorksheetId: state.activeTabId,
      viewPreferences: {
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        showGrid: state.showGrid,
        showWireValues: state.showWireValues,
        snapToAlign: state.snapToAlign,
        repSystem: state.repSystem,
      },
    };
    return JSON.stringify(workbook, null, 2);
  },

  importWorkbook: (json, handle) => {
    try {
      const data = JSON.parse(json);

      if (data.formatVersion === 2) {
        // New workbook format
        const wb = data as WorkbookData;
        const tabCircuits = new Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>();
        const tabs = wb.worksheets.map((ws) => {
          const resolvedComponents = resolveMemDirections(ws.circuit.components || [], ws.circuit.wires || []);
          tabCircuits.set(ws.id, {
            components: resolvedComponents,
            wires: ws.circuit.wires || [],
            textElements: ws.textElements || [],
            comments: ws.comments || [],
            boxes: ws.boxes || [],
          });
          return {
            id: ws.id,
            title: ws.title,
            buildMode: ws.buildMode || 'CC' as BuildMode,
            activeTask: ws.activeTask || 'arithmetic' as ActiveTask,
          };
        });

        const activeId = wb.activeWorksheetId || tabs[0]?.id || defaultTabId;
        const activeCircuit = tabCircuits.get(activeId) || { components: [], wires: [], textElements: [], comments: [], boxes: [] };
        const activeTab = tabs.find((t) => t.id === activeId);

        set({
          assignment: null,
          workbookOpen: true,
          workbookTitle: wb.metadata?.title || 'Untitled Workbook',
          workbookFileHandle: handle || null,
          tabs,
          activeTabId: activeId,
          tabCircuits,
          components: activeCircuit.components,
          wires: activeCircuit.wires,
          textElements: activeCircuit.textElements,
          comments: activeCircuit.comments,
          boxes: activeCircuit.boxes,
          buildMode: activeTab?.buildMode || 'CC',
          activeTask: activeTab?.activeTask || 'arithmetic',
          zoom: wb.viewPreferences?.zoom ?? 1,
          panX: wb.viewPreferences?.panX ?? 0,
          panY: wb.viewPreferences?.panY ?? 0,
          showGrid: wb.viewPreferences?.showGrid ?? true,
          showWireValues: wb.viewPreferences?.showWireValues ?? true,
          snapToAlign: wb.viewPreferences?.snapToAlign ?? true,
          repSystem: wb.viewPreferences?.repSystem || 'binary',
          undoStack: [],
          redoStack: [],
        });
        setTimeout(() => get().evaluateCircuit(), 0);
      } else if (data.circuit) {
        // Legacy single-circuit format — wrap in a one-worksheet workbook
        const wsId = uuid();
        const importedComponents = data.circuit.components || [];
        const importedWires = data.circuit.wires || [];
        const resolvedComponents = resolveMemDirections(importedComponents, importedWires);
        const tabCircuits = new Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>();
        tabCircuits.set(wsId, {
          components: resolvedComponents,
          wires: importedWires,
          textElements: data.textElements || [],
          comments: data.comments || [],
          boxes: data.boxes || [],
        });
        const bm = data.metadata?.buildType || 'CC';
        set({
          assignment: null,
          workbookOpen: true,
          workbookTitle: data.metadata?.title || 'Imported Circuit',
          workbookFileHandle: handle || null,
          tabs: [{ id: wsId, title: data.metadata?.title || 'Circuit 1', buildMode: bm, activeTask: 'arithmetic' as ActiveTask }],
          activeTabId: wsId,
          tabCircuits,
          components: resolvedComponents,
          wires: importedWires,
          textElements: data.textElements || [],
          comments: data.comments || [],
          boxes: data.boxes || [],
          buildMode: bm,
          activeTask: 'arithmetic',
          repSystem: data.repSystem || 'binary',
          undoStack: [],
          redoStack: [],
        });
        setTimeout(() => get().evaluateCircuit(), 0);
      } else {
        alert('Invalid file format. Expected a workbook or circuit file.');
      }
    } catch (e) {
      console.error('Invalid workbook JSON:', e);
      alert('Invalid file. Please check the JSON format.');
    }
  },

  buildMode: 'CC',
  setBuildMode: (mode) => set({ buildMode: mode }),

  turboEnabled: false,
  setTurboEnabled: (v) => set({ turboEnabled: v }),

  activeTask: 'arithmetic',
  setActiveTask: (t) => {
    const state = get();
    set({
      activeTask: t,
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, activeTask: t } : tab
      ),
    });
  },

  repSystem: 'binary',
  displayMode: 'IO',
  scope: 'local',
  setRepSystem: (r) => set({ repSystem: r }),
  setDisplayMode: (d) => set({ displayMode: d }),
  setScope: (s) => set({ scope: s }),

  components: [],
  wires: [],
  nextInputNum: 1,
  nextOutputNum: 1,
  nextMemNum: 1,
  nextStateNum: 0,

  addComponent: (type, x, y) => {
    const state = get();
    state.pushHistory();
    const sx = snapToGrid(x);
    const sy = snapToGrid(y);
    let label = '';

    // Compute next available number from existing components on canvas
    if (type === 'INPUT') {
      const existing = state.components.filter((c) => c.type === 'INPUT');
      const usedNums = existing.map((c) => parseInt(c.label.replace('IN', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `IN${next}`;
    } else if (type === 'OUTPUT') {
      const existing = state.components.filter((c) => c.type === 'OUTPUT');
      const usedNums = existing.map((c) => parseInt(c.label.replace('OUT', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `OUT${next}`;
    } else if (type === 'MEM') {
      const existing = state.components.filter((c) => c.type === 'MEM');
      const usedNums = existing.map((c) => parseInt(c.label.replace('M', '')) || 0);
      const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
      label = `M${next}`;
    } else if (type === 'STATE') {
      const existing = state.components.filter((c) => c.type === 'STATE');
      // Extract numeric part from labels like "S₀", "S₁"
      const subDigits = '₀₁₂₃₄₅₆₇₈₉';
      const usedNums = existing.map((c) => {
        const numStr = c.label.replace('S', '').split('').map(ch => {
          const idx = subDigits.indexOf(ch);
          return idx >= 0 ? String(idx) : ch;
        }).join('');
        return parseInt(numStr) || 0;
      });
      const next = usedNums.length === 0 ? 0 : Math.max(...usedNums) + 1;
      label = `S${toSubscript(next)}`;
    } else {
      label = type;
    }

    const comp: CircuitComponent = {
      id: uuid(),
      type,
      x: sx,
      y: sy,
      label,
      ports: getPortsForType(type),
      value: type === 'INPUT' ? undefined : 0,
      inputValues: type === 'INPUT' ? [undefined as unknown as number] : undefined,
      storedValue: type === 'MEM' ? 0 : undefined,
    };

    set({
      components: [...state.components, comp],
    });
    // Evaluate after adding
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  moveComponent: (id, x, y) => {
    const snappedX = snapToGrid(x);
    const snappedY = snapToGrid(y);
    set((state) => {
      // Skip update if position hasn't actually changed after snapping
      const comp = state.components.find((c) => c.id === id);
      if (comp && comp.x === snappedX && comp.y === snappedY) return state;
      return {
        components: state.components.map((c) =>
          c.id === id ? { ...c, x: snappedX, y: snappedY } : c
        ),
      };
    });
  },

  moveComponentRaw: (id, x, y) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, x, y } : c
      ),
    }));
  },

  snapComponentToGrid: (id) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, x: snapToGrid(c.x), y: snapToGrid(c.y) } : c
      ),
    }));
  },

  removeComponent: (id) => {
    const state = get();
    state.pushHistory();
    const newWires = state.wires.filter(
      (w) => w.sourceComponentId !== id && w.targetComponentId !== id
    );
    // Reset MEM directions and re-resolve with remaining wires
    const remainingComps = state.components.filter((c) => c.id !== id);
    const resetComps = remainingComps.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComps = resolveMemDirections(resetComps, newWires);
    set({
      components: resolvedComps,
      wires: newWires,
      comments: state.comments.filter((c) => c.targetId !== id),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  setInputValue: (id, value) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, value, inputValues: [value] } : c
      ),
    }));
    if (!get().localStepActive) {
      setTimeout(() => get().evaluateCircuit(), 0);
    }
  },

  setMemStoredValue: (id, value) => {
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, storedValue: value } : c
      ),
    }));
    if (!get().localStepActive) {
      setTimeout(() => get().evaluateCircuit(), 0);
    }
  },

  addWire: (sourceCompId, sourcePortId, targetCompId, targetPortId) => {
    const state = get();
    const sourceComp = state.components.find((c) => c.id === sourceCompId);
    const targetComp = state.components.find((c) => c.id === targetCompId);
    const isFsmTransition = sourceComp?.type === 'STATE' && targetComp?.type === 'STATE';

    // Check: no merging - target port must not already have an incoming wire
    // (Except in FSM mode where STATE ports accept multiple transitions)
    if (!isFsmTransition) {
      const existing = state.wires.find(
        (w) =>
          w.targetComponentId === targetCompId &&
          w.targetPortId === targetPortId
      );
      if (existing) {
        console.warn('Merge violation: input port already has a connection');
        return;
      }
    }

    state.pushHistory();
    const wire: Wire = {
      id: uuid(),
      sourceComponentId: sourceCompId,
      sourcePortId: sourcePortId,
      targetComponentId: targetCompId,
      targetPortId: targetPortId,
      value: 0,
      transitionLabel: isFsmTransition ? '0:0' : undefined,
    };
    const newWires = [...state.wires, wire];
    const resolvedComponents = resolveMemDirections(state.components, newWires);
    set({ wires: newWires, components: resolvedComponents });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  removeWire: (id) => {
    const state = get();
    state.pushHistory();
    const newWires = state.wires.filter((w) => w.id !== id);
    // Reset all MEM directions, then re-resolve from remaining wires
    const resetComponents = state.components.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComponents = resolveMemDirections(resetComponents, newWires);
    set({
      wires: newWires,
      components: resolvedComponents,
      comments: state.comments.filter((c) => c.targetId !== id),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  updateWireManualSegments: (wireId, segments) => {
    set((state) => ({
      wires: state.wires.map((w) =>
        w.id === wireId ? { ...w, manualSegments: segments } : w
      ),
    }));
  },

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((i) => i !== id)
        : [...state.selectedIds, id],
    })),
  clearSelection: () => set({ selectedIds: [] }),

  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showWireValues: true,
  snapToAlign: true,
  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(3, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowWireValues: (v) => set({ showWireValues: v }),
  setSnapToAlign: (v) => set({ snapToAlign: v }),

  wireValues: new Map(),

  evaluateCircuit: () => {
    const state = get();
    const { components, wires } = state;
    if (components.length === 0) return;

    // Pure evaluation lives in the framework-agnostic engine; the store keeps
    // the UI-facing work below (writing .value, the -1 wire sentinel, tableRows).
    const { portValues, wireValues: newWireValues } = evaluateCC(components, wires);

    // Update components with computed values
    const updatedComponents = components.map((c) => {
      if (c.type === 'OUTPUT') {
        const val = portValues.has(`${c.id}:in`)
          ? portValues.get(`${c.id}:in`)
          : undefined;
        return { ...c, value: val };
      }
      if (c.type !== 'INPUT') {
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) {
          const val = portValues.get(`${c.id}:${outputPort.id}`);
          return { ...c, value: val };
        }
      }
      return c;
    });

    const updates: Record<string, unknown> = {
      components: updatedComponents,
      wires: wires.map((w) => ({
        ...w,
        // Use -1 as sentinel for "undefined/blank" since Wire.value is number
        value: newWireValues.has(w.id) ? newWireValues.get(w.id)! : -1,
      })),
      wireValues: newWireValues,
    };

    // CC mode: auto-populate the I/O table with the current input→output row
    // Auto-populate the I/O table with the current input→output row
    const hasMem = updatedComponents.some((c) => c.type === 'MEM');
    if (state.buildMode === 'CC' || hasMem) {
      const inputs = updatedComponents
        .filter((c) => c.type === 'INPUT')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('IN', ''));
          const numB = parseInt(b.label.replace('IN', ''));
          return numA - numB;
        });
      const outputs = updatedComponents
        .filter((c) => c.type === 'OUTPUT')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('OUT', ''));
          const numB = parseInt(b.label.replace('OUT', ''));
          return numA - numB;
        });
      const mems = updatedComponents
        .filter((c) => c.type === 'MEM')
        .sort((a, b) => {
          const numA = parseInt(a.label.replace('M', ''));
          const numB = parseInt(b.label.replace('M', ''));
          return numA - numB;
        });

      const allInputsSet = inputs.every((c) => c.value != null);
      if (inputs.length > 0 && outputs.length > 0 && allInputsSet) {
        const inputBits = inputs.map((c) => c.value!);
        const memBits = mems.map((c) => c.storedValue ?? 0);
        const outputBits = outputs.map((c) => c.value != null ? c.value : 0);
        const key = [...inputBits, ...memBits].join(',');

        // Upsert: replace existing row for this input+mem combo, or append
        const existing = state.tableRows;
        const idx = existing.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === key);
        if (idx >= 0) {
          const newRows = [...existing];
          newRows[idx] = { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits };
          updates.tableRows = newRows;
        } else {
          updates.tableRows = [...existing, { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits }];
        }
      }
    }

    set(updates as any);
  },

  // Undo/Redo
  undoStack: [],
  redoStack: [],
  pushHistory: () => {
    const state = get();
    set({
      undoStack: [
        ...state.undoStack.slice(-49),
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          textElements: JSON.parse(JSON.stringify(state.textElements)),
          comments: JSON.parse(JSON.stringify(state.comments)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
        },
      ],
      redoStack: [],
    });
  },
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    set({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [
        ...state.redoStack,
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          textElements: JSON.parse(JSON.stringify(state.textElements)),
          comments: JSON.parse(JSON.stringify(state.comments)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
        },
      ],
      components: prev.components,
      wires: prev.wires,
      textElements: prev.textElements,
      comments: prev.comments,
      boxes: prev.boxes,
    });
  },
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [
        ...state.undoStack,
        {
          components: JSON.parse(JSON.stringify(state.components)),
          wires: JSON.parse(JSON.stringify(state.wires)),
          textElements: JSON.parse(JSON.stringify(state.textElements)),
          comments: JSON.parse(JSON.stringify(state.comments)),
          boxes: JSON.parse(JSON.stringify(state.boxes)),
        },
      ],
      components: next.components,
      wires: next.wires,
      textElements: next.textElements,
      comments: next.comments,
      boxes: next.boxes,
    });
  },

  // Assignment mode
  assignment: null,
  currentQuestionIndex: 0,
  questionCircuits: new Map(),
  loadAssignment: (assignment) => {
    const questionCircuits = new Map<number, QuestionCircuit>();
    for (const q of assignment.questions) {
      questionCircuits.set(q.id, emptyQuestionCircuit());
    }
    set({
      assignment,
      currentQuestionIndex: 0,
      questionCircuits,
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      buildMode: assignment.questions[0]?.buildMode || 'CC',
    });
  },
  openAssignment: (id) => {
    const def = getAssignment(id);
    if (!def) return false;
    // Same assignment already in memory → resume without wiping in-progress work.
    if (get().assignment?.id === id) {
      set({ workbookOpen: true });
      return true;
    }
    get().loadAssignment(def);

    // Restore any saved work for this assignment (merged by question id).
    const saved = localWorkbookStore.loadAssignmentState(id);
    const { questionCircuits, currentQuestionIndex } = restoreQuestionCircuits(def, saved);
    const activeQ = def.questions[currentQuestionIndex];
    const activeCircuit = activeQ
      ? questionCircuits.get(activeQ.id) ?? emptyQuestionCircuit()
      : emptyQuestionCircuit();
    set({
      questionCircuits,
      currentQuestionIndex,
      components: activeCircuit.components,
      wires: activeCircuit.wires,
      textElements: activeCircuit.textElements,
      comments: activeCircuit.comments,
      boxes: activeCircuit.boxes,
      buildMode: activeQ?.buildMode || 'CC',
      workbookOpen: true,
    });
    return true;
  },
  goHome: () => {
    const state = get();
    // Sync the live canvas into its container so nothing in memory is lost.
    if (state.assignment) {
      const q = state.assignment.questions[state.currentQuestionIndex];
      if (q) {
        const qc = new Map(state.questionCircuits);
        qc.set(q.id, {
          components: state.components,
          wires: state.wires,
          textElements: state.textElements,
          comments: state.comments,
          boxes: state.boxes,
        });
        set({ questionCircuits: qc });
      }
      // Flush immediately so a quick Home click persists (don't wait for debounce).
      saveAssignmentState();
    } else {
      const tc = new Map(state.tabCircuits);
      tc.set(state.activeTabId, {
        components: state.components,
        wires: state.wires,
        textElements: state.textElements,
        comments: state.comments,
        boxes: state.boxes,
      });
      set({ tabCircuits: tc });
    }
    set({ workbookOpen: false });
  },
  enterSandbox: () => {
    const state = get();
    if (state.tabs.length === 0) {
      get().newWorkbook();
      return;
    }
    // Fall back to an empty circuit (NOT the live components, which may belong
    // to an assignment we're leaving) when this tab has no saved canvas yet.
    const saved = state.tabCircuits.get(state.activeTabId) ?? {
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
    };
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    set({
      assignment: null,
      workbookOpen: true,
      components: saved.components,
      wires: saved.wires,
      textElements: saved.textElements,
      comments: saved.comments,
      boxes: saved.boxes,
      buildMode: tab?.buildMode || 'CC',
      activeTask: tab?.activeTask || 'arithmetic',
    });
  },
  switchQuestion: (index) => {
    const state = get();
    const a = state.assignment;
    if (!a) return;
    const currentQ = a.questions[state.currentQuestionIndex];
    const nextQ = a.questions[index];
    if (!currentQ || !nextQ) return;

    // Save the live question's canvas, load the target question's.
    const updatedMap = new Map(state.questionCircuits);
    updatedMap.set(currentQ.id, {
      components: state.components,
      wires: state.wires,
      textElements: state.textElements,
      comments: state.comments,
      boxes: state.boxes,
    });

    const saved = updatedMap.get(nextQ.id) ?? emptyQuestionCircuit();
    set({
      currentQuestionIndex: index,
      questionCircuits: updatedMap,
      components: saved.components,
      wires: saved.wires,
      textElements: saved.textElements,
      comments: saved.comments,
      boxes: saved.boxes,
      buildMode: nextQ.buildMode,
    });
  },
  closeAssignment: () => {
    set({
      assignment: null,
      currentQuestionIndex: 0,
      questionCircuits: new Map(),
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
    });
  },

  // Save/Load
  exportProject: () => {
    const state = get();
    return JSON.stringify(
      {
        metadata: {
          title: 'Untitled',
          author: '',
          date: new Date().toISOString(),
          buildType: state.buildMode,
        },
        circuit: {
          components: state.components,
          wires: state.wires,
        },
        textElements: state.textElements,
        comments: state.comments,
        boxes: state.boxes,
        repSystem: state.repSystem,
      },
      null,
      2
    );
  },
  exportSubmission: (student) => {
    const state = get();
    const assignment = state.assignment;
    if (!assignment) return null;

    // Sync the live question into the map (same save step as switchQuestion),
    // so the currently-open question's latest circuit is captured.
    const circuits = new Map(state.questionCircuits);
    const currentQ = assignment.questions[state.currentQuestionIndex];
    if (currentQ) {
      circuits.set(currentQ.id, {
        components: state.components,
        wires: state.wires,
        textElements: state.textElements,
        comments: state.comments,
        boxes: state.boxes,
      });
    }

    const submission: SubmissionData = {
      assignmentTitle: assignment.title,
      student: student?.trim() || undefined,
      submittedAt: new Date().toISOString(),
      answers: assignment.questions.map((q) => {
        const saved = circuits.get(q.id) ?? emptyQuestionCircuit();
        return {
          questionId: q.id,
          circuit: { components: saved.components, wires: saved.wires },
        };
      }),
    };
    return JSON.stringify(submission, null, 2);
  },
  importProject: (json) => {
    try {
      const data = JSON.parse(json);
      if (data.circuit) {
        const importedComponents = data.circuit.components || [];
        const importedWires = data.circuit.wires || [];
        const resolvedComponents = resolveMemDirections(importedComponents, importedWires);
        set({
          components: resolvedComponents,
          wires: importedWires,
          textElements: data.textElements || [],
          comments: data.comments || [],
          boxes: data.boxes || [],
          buildMode: data.metadata?.buildType || 'CC',
          repSystem: data.repSystem || 'binary',
        });
        setTimeout(() => get().evaluateCircuit(), 0);
      }
    } catch (e) {
      console.error('Invalid project JSON:', e);
      alert('Invalid project file. Please check the JSON format.');
    }
  },

  // Rotation
  rotateComponent: (id) => {
    const state = get();
    state.pushHistory();
    set({
      components: state.components.map((c) => {
        if (c.id !== id) return c;
        const current = c.rotation ?? 0;
        const next = (current + 90) % 360;
        return { ...c, rotation: next };
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Boxed circuits (legacy library)
  boxedLibrary: [],
  importBoxedCircuit: (name, json) => {
    try {
      const data = JSON.parse(json);
      const circuit = data.circuit || data;
      set((state) => ({
        boxedLibrary: [
          ...state.boxedLibrary,
          { name, type: 'BOXED' as ComponentType, circuit: circuit.components || circuit, wires: circuit.wires || [], ports: [] },
        ],
      }));
    } catch (e) {
      console.error('Invalid boxed circuit JSON:', e);
    }
  },

  boxCurrentCircuit: (name) => {
    const state = get();
    const { components, wires } = state;

    const inputs = components.filter((c) => c.type === 'INPUT');
    const outputs = components.filter((c) => c.type === 'OUTPUT');

    if (inputs.length === 0) return 'Circuit must have at least 1 INPUT.';
    if (outputs.length === 0) return 'Circuit must have at least 1 OUTPUT.';

    // Check for free ends: every input port on non-INPUT components should be connected
    for (const comp of components) {
      if (comp.type === 'INPUT') continue;
      const inputPorts = comp.ports.filter((p) => p.side === 'left');
      for (const port of inputPorts) {
        const connected = wires.some(
          (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
        );
        if (!connected) {
          return `Free end: port "${port.id}" on component "${comp.label}" is not connected.`;
        }
      }
    }

    // Build boxed circuit ports: inputs become left ports, outputs become right ports
    const sortedInputs = [...inputs].sort((a, b) => {
      const numA = parseInt(a.label.replace('IN', ''));
      const numB = parseInt(b.label.replace('IN', ''));
      return numA - numB;
    });
    const sortedOutputs = [...outputs].sort((a, b) => {
      const numA = parseInt(a.label.replace('OUT', ''));
      const numB = parseInt(b.label.replace('OUT', ''));
      return numA - numB;
    });

    const boxedPorts: import('./types').Port[] = [
      ...sortedInputs.map((inp, i) => ({
        id: `in${i + 1}`,
        label: inp.label,
        side: 'left' as const,
        index: i,
      })),
      ...sortedOutputs.map((out, i) => ({
        id: `out${i + 1}`,
        label: out.label,
        side: 'right' as const,
        index: i,
      })),
    ];

    set((s) => ({
      boxedLibrary: [
        ...s.boxedLibrary,
        {
          name,
          type: 'BOXED' as ComponentType,
          circuit: JSON.parse(JSON.stringify(components)),
          wires: JSON.parse(JSON.stringify(wires)),
          ports: boxedPorts,
        },
      ],
    }));

    return null;
  },

  // Box definitions (new draw-on-canvas boxing)
  boxes: [],
  confirmedBoxLibrary: [],
  addBox: (box) => {
    const state = get();
    state.pushHistory();
    set({ boxes: [...state.boxes, box] });
  },
  updateBox: (id, updates) => {
    set((state) => {
      const updatedBoxes = state.boxes.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      );
      // Keep draftBox in sync if it's the one being updated
      const draftBox = state.boxDrawing.draftBox;
      const newDraft = draftBox && draftBox.id === id
        ? { ...draftBox, ...updates }
        : draftBox;
      // Sync name changes to global confirmedBoxLibrary and placed instances
      const updatedLibrary = updates.name
        ? state.confirmedBoxLibrary.map((b) =>
            b.id === id ? { ...b, name: updates.name! } : b
          )
        : state.confirmedBoxLibrary;
      const updatedComponents = updates.name
        ? state.components.map((c) =>
            c.boxedCircuitId === id ? { ...c, label: updates.name! } : c
          )
        : state.components;
      return {
        boxes: updatedBoxes,
        boxDrawing: { ...state.boxDrawing, draftBox: newDraft },
        confirmedBoxLibrary: updatedLibrary,
        components: updatedComponents,
      };
    });
  },
  removeBox: (id) => {
    const state = get();
    state.pushHistory();
    set({ boxes: state.boxes.filter((b) => b.id !== id) });
  },
  removeConfirmedBox: (id) => {
    const state = get();
    state.pushHistory();

    // Helper: strip all instances of this box from a circuit snapshot
    const stripBox = (comps: CircuitComponent[], wires: Wire[]) => {
      const removedIds = new Set(
        comps.filter((c) => c.boxedCircuitId === id).map((c) => c.id)
      );
      return {
        components: comps.filter((c) => !removedIds.has(c.id)),
        wires: wires.filter(
          (w) => !removedIds.has(w.sourceComponentId) && !removedIds.has(w.targetComponentId)
        ),
        removedIds,
      };
    };

    // Sweep the active tab
    const { components: newComponents, wires: newWires, removedIds } =
      stripBox(state.components, state.wires);

    // Sweep all inactive tabs stored in tabCircuits
    const newTabCircuits = new Map(state.tabCircuits);
    for (const [tabId, circuit] of newTabCircuits) {
      const { components, wires } = stripBox(circuit.components, circuit.wires);
      newTabCircuits.set(tabId, { ...circuit, components, wires });
    }

    set({
      confirmedBoxLibrary: state.confirmedBoxLibrary.filter((b) => b.id !== id),
      components: newComponents,
      wires: newWires,
      boxes: state.boxes.filter((b) => b.id !== id),
      selectedIds: state.selectedIds.filter((sid) => !removedIds.has(sid)),
      tabCircuits: newTabCircuits,
    });
  },
  confirmBox: (id) => {
    const state = get();
    const box = state.boxes.find((b) => b.id === id);
    if (!box) return 'Box not found.';

    // Find components inside the box (use actual component dimensions)
    const insideComps = state.components.filter((c) => {
      const w = (c.type === 'INPUT' || c.type === 'OUTPUT') ? 40 : 80;
      const h = (c.type === 'INPUT' || c.type === 'OUTPUT') ? 40 : (c.type === 'HA' ? 70 : 60);
      const cx = c.x + w / 2;
      const cy = c.y + h / 2;
      return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height;
    });

    if (insideComps.length === 0) return 'No components inside the box.';

    // ── FSM boxing ────────────────────────────────────────────────
    if (state.buildMode === 'FSM') {
      const fsmComps = insideComps.filter((c) => c.type === 'STATE');
      if (fsmComps.length === 0) return 'No states inside the box.';

      const fsmIds = new Set(fsmComps.map((c) => c.id));

      // All FSM transition wires among the boxed states
      const internalWires = state.wires.filter(
        (w) => fsmIds.has(w.sourceComponentId) && fsmIds.has(w.targetComponentId) && w.transitionLabel !== undefined
      );

      // No transitions may leave the box — S_B is terminal (no outputs)
      const crossingOutWires = state.wires.filter(
        (w) => fsmIds.has(w.sourceComponentId) && !fsmIds.has(w.targetComponentId) && w.transitionLabel !== undefined
      );
      if (crossingOutWires.length > 0) {
        const culprits = [...new Set(crossingOutWires.map((w) => fsmComps.find((c) => c.id === w.sourceComponentId)?.label ?? ''))].join(', ');
        return `State(s) ${culprits} have transitions leaving the box. The terminal state (S_B) must have no outgoing transitions — remove them before boxing.`;
      }

      // Rule 3: Exactly one terminal state S_B — the state with no outgoing transitions
      const statesWithNoOutgoing = fsmComps.filter(
        (c) => internalWires.filter((w) => w.sourceComponentId === c.id).length === 0
      );
      if (statesWithNoOutgoing.length === 0)
        return 'No terminal state (S_B) found. Exactly one state must have no outgoing transitions — it becomes the exit point of the boxed machine.';
      if (statesWithNoOutgoing.length > 1)
        return `Multiple terminal states found (${statesWithNoOutgoing.map((c) => c.label).join(', ')}). Only one state may have no outgoing transitions (S_B).`;

      // Rule 1: Every state except S_B must have exactly 2 outgoing transitions (completeness)
      const sB = statesWithNoOutgoing[0];
      for (const comp of fsmComps) {
        if (comp.id === sB.id) continue;
        const outgoing = internalWires.filter((w) => w.sourceComponentId === comp.id);
        const inputs = outgoing.map((w) => w.transitionLabel!.split(':')[0]);
        if (!inputs.includes('0')) return `State ${comp.label} is missing a transition for input 0. Every non-terminal state must handle all inputs.`;
        if (!inputs.includes('1')) return `State ${comp.label} is missing a transition for input 1. Every non-terminal state must handle all inputs.`;
      }

      // Rule 2: S_A is the lowest-numbered state — must have at least one state inside
      // (already satisfied since fsmComps.length > 0)

      // Auto-name
      const existingNames = state.confirmedBoxLibrary.map((b) => b.name);
      let name = `FSM Box ${state.confirmedBoxLibrary.filter((b) => b.kind === 'FSM').length + 1}`;
      let n = 1;
      while (existingNames.includes(name)) { n++; name = `FSM Box ${n}`; }

      const componentIds = fsmComps.map((c) => c.id);
      set((s) => ({
        boxes: s.boxes.map((b) => b.id === id ? { ...b, name, componentIds, inputPortIds: [], outputPortIds: [] } : b),
        boxDrawing: { phase: 'idle', draftBox: null },
        confirmedBoxLibrary: [
          ...s.confirmedBoxLibrary,
          {
            id,
            name,
            kind: 'FSM' as const,
            inputPortIds: [],
            outputPortIds: [],
            internalComponents: JSON.parse(JSON.stringify(fsmComps)),
            internalWires: JSON.parse(JSON.stringify(internalWires)),
          },
        ],
      }));
      return null;
    }

    const insideIds = new Set(insideComps.map((c) => c.id));

    // Wires fully inside the box (both endpoints inside)
    const internalWires = state.wires.filter((w) =>
      insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
    );

    // ── Textbook Rule 1: No loops ──
    // Check for cycles among inside components using internal wires.
    // MEM blocks break feedback loops (like in topological sort), so skip
    // wires feeding into a MEM's input port.
    {
      const compMap = new Map(insideComps.map((c) => [c.id, c]));
      const adj = new Map<string, string[]>();
      for (const c of insideComps) adj.set(c.id, []);
      for (const w of internalWires) {
        // Skip wires into MEM input ports — MEM breaks the cycle
        const targetComp = compMap.get(w.targetComponentId);
        if (targetComp?.type === 'MEM' && isMemSinkPort(targetComp, w.targetPortId)) continue;
        const list = adj.get(w.sourceComponentId);
        if (list) list.push(w.targetComponentId);
      }
      const visited = new Set<string>();
      const recStack = new Set<string>();
      function hasCycle(nodeId: string): boolean {
        visited.add(nodeId);
        recStack.add(nodeId);
        for (const next of adj.get(nodeId) || []) {
          if (!visited.has(next) && hasCycle(next)) return true;
          if (recStack.has(next)) return true;
        }
        recStack.delete(nodeId);
        return false;
      }
      for (const c of insideComps) {
        if (!visited.has(c.id) && hasCycle(c.id)) {
          return 'Loop detected: boxed circuits cannot contain loops.';
        }
      }
    }

    // ── Textbook Rule 2: No merged links ──
    // No input port on any inside component may have more than one incoming wire
    {
      const portInCount = new Map<string, number>();
      for (const w of internalWires) {
        const key = `${w.targetComponentId}:${w.targetPortId}`;
        portInCount.set(key, (portInCount.get(key) || 0) + 1);
      }
      // Also count wires entering from outside
      const crossingIn = state.wires.filter((w) =>
        !insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
      );
      for (const w of crossingIn) {
        const key = `${w.targetComponentId}:${w.targetPortId}`;
        portInCount.set(key, (portInCount.get(key) || 0) + 1);
      }
      for (const [key, count] of portInCount) {
        if (count > 1) {
          const [compId, portId] = key.split(':');
          const comp = insideComps.find((c) => c.id === compId);
          return `Merged link: port "${portId}" on "${comp?.label || compId}" has ${count} incoming connections.`;
        }
      }
    }

    // ── Textbook Rule 3: Every free end is either an input or output ──
    // A "free end" is an unconnected port on a component inside the box.
    // For it to be valid, every such free end must be a box input (left port
    // with a wire crossing in from outside) or a box output (right port with
    // a wire crossing out to outside). Truly unconnected ports are errors.
    const crossingWires = state.wires.filter((w) => {
      const srcInside = insideIds.has(w.sourceComponentId);
      const tgtInside = insideIds.has(w.targetComponentId);
      return srcInside !== tgtInside;
    });

    // Build sets of ports connected via crossing wires
    const crossingInputKeys = new Set<string>(); // ports inside receiving from outside
    const crossingOutputKeys = new Set<string>(); // ports inside sending to outside
    for (const w of crossingWires) {
      if (insideIds.has(w.targetComponentId)) {
        crossingInputKeys.add(`${w.targetComponentId}:${w.targetPortId}`);
      } else {
        crossingOutputKeys.add(`${w.sourceComponentId}:${w.sourcePortId}`);
      }
    }

    // Check every port on every inside component
    for (const comp of insideComps) {
      for (const port of comp.ports) {
        const key = `${comp.id}:${port.id}`;

        if (port.side === 'left') {
          // Input port: must have an internal wire OR a crossing wire coming in
          const hasInternal = internalWires.some(
            (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
          );
          const hasCrossing = crossingInputKeys.has(key);
          if (!hasInternal && !hasCrossing) {
            return `Free end: input port "${port.id}" on "${comp.label}" is not connected. Every free end must be a box input or output.`;
          }
        } else {
          // Output port: must have an internal wire OR a crossing wire going out
          // (output ports are allowed to be unconnected if they just don't lead anywhere,
          // but per the textbook, free ends must be designated as box outputs)
          const hasInternal = internalWires.some(
            (w) => w.sourceComponentId === comp.id && w.sourcePortId === port.id
          );
          const hasCrossing = crossingOutputKeys.has(key);
          if (!hasInternal && !hasCrossing) {
            return `Free end: output port "${port.id}" on "${comp.label}" is not connected. Every free end must be a box input or output.`;
          }
        }
      }
    }

    // Identify box inputs and outputs
    // Crossing wires define ports at the boundary
    const inputPortIds = Array.from(crossingInputKeys);
    const outputPortIds = Array.from(crossingOutputKeys);

    // Additionally, INPUT components inside the box serve as box inputs
    // and OUTPUT components inside serve as box outputs
    for (const comp of insideComps) {
      if (comp.type === 'INPUT') {
        const key = `${comp.id}:out`;
        if (!outputPortIds.includes(key) && !inputPortIds.includes(key)) {
          inputPortIds.push(key);
        }
      }
      if (comp.type === 'OUTPUT') {
        const key = `${comp.id}:in`;
        if (!inputPortIds.includes(key) && !outputPortIds.includes(key)) {
          outputPortIds.push(key);
        }
      }
    }

    // Auto-suggest name
    const existingNames = state.boxes.filter((b) => b.id !== id).map((b) => b.name);
    let suggestedName = `Box ${state.boxes.indexOf(box) + 1}`;
    let counter = 1;
    while (existingNames.includes(suggestedName)) {
      counter++;
      suggestedName = `Box ${counter}`;
    }

    // Update the box as confirmed and add to global library
    const componentIds = insideComps.map((c) => c.id);
    set((s) => ({
      boxes: s.boxes.map((b) =>
        b.id === id
          ? { ...b, name: suggestedName, componentIds, inputPortIds, outputPortIds }
          : b
      ),
      boxDrawing: { phase: 'idle', draftBox: null },
      confirmedBoxLibrary: [
        ...s.confirmedBoxLibrary,
        {
          id,
          name: suggestedName,
          inputPortIds,
          outputPortIds,
          internalComponents: JSON.parse(JSON.stringify(insideComps)),
          internalWires: JSON.parse(JSON.stringify(internalWires)),
        },
      ],
    }));

    return null;
  },

  placeBoxInstance: (boxId, x, y) => {
    const state = get();

    // Look up from global library first, then fall back to current tab's boxes
    const libEntry = state.confirmedBoxLibrary.find((b) => b.id === boxId);
    const localBox = state.boxes.find((b) => b.id === boxId);
    const name = libEntry?.name || localBox?.name;
    const inPortIds = libEntry?.inputPortIds || localBox?.inputPortIds || [];
    const outPortIds = libEntry?.outputPortIds || localBox?.outputPortIds || [];

    if (!name) return;
    state.pushHistory();

    // Get internal circuit from library snapshot, or gather from current tab
    let internalComps: CircuitComponent[];
    let internalWires: Wire[];
    if (libEntry) {
      internalComps = libEntry.internalComponents;
      internalWires = libEntry.internalWires;
    } else if (localBox) {
      const insideIds = new Set(localBox.componentIds);
      internalComps = state.components.filter((c) => insideIds.has(c.id));
      internalWires = state.wires.filter(
        (w) => insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
      );
    } else {
      return;
    }

    // Build ports: inputs on left, outputs on right
    const inputPorts: import('./types').Port[] = inPortIds.map((_, i) => ({
      id: `in${i + 1}`,
      label: `in${i + 1}`,
      side: 'left' as const,
      index: i,
    }));
    const outputPorts: import('./types').Port[] = outPortIds.map((_, i) => ({
      id: `out${i + 1}`,
      label: `out${i + 1}`,
      side: 'right' as const,
      index: i,
    }));

    const comp: CircuitComponent = {
      id: uuid(),
      type: 'BOXED',
      x: snapToGrid(x),
      y: snapToGrid(y),
      label: name,
      ports: [...inputPorts, ...outputPorts],
      value: 0,
      boxedCircuitId: boxId,
      internalCircuit: {
        components: JSON.parse(JSON.stringify(internalComps)),
        wires: JSON.parse(JSON.stringify(internalWires)),
      },
    };

    set({
      components: [...state.components, comp],
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  fsmPlaceBoxInstance: (boxId, x, y) => {
    const state = get();
    const entry = state.confirmedBoxLibrary.find((b) => b.id === boxId && b.kind === 'FSM');
    if (!entry) return;
    state.pushHistory();

    // Place as a single box-shaped STATE component that represents the sub-machine
    const comp: CircuitComponent = {
      id: uuid(),
      type: 'STATE',
      x: snapToGrid(x),
      y: snapToGrid(y),
      label: entry.name,
      ports: getPortsForType('STATE'),
      boxedCircuitId: boxId,
    };

    set({ components: [...state.components, comp] });
  },

  // Delete
  clearWorkspace: () => {
    const state = get();
    state.pushHistory();
    set({
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      selectedIds: [],
      boxDrawing: { phase: 'idle', draftBox: null },
      nextInputNum: 1,
      nextOutputNum: 1,
      nextMemNum: 1,
      nextStateNum: 0,
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  deleteSelected: () => {
    const state = get();
    if (state.selectedIds.length === 0) return;
    state.pushHistory();
    const idsToRemove = new Set(state.selectedIds);

    // Also remove wires that are selected
    const wireIdsToRemove = new Set(
      state.wires
        .filter(
          (w) =>
            idsToRemove.has(w.id) ||
            idsToRemove.has(w.sourceComponentId) ||
            idsToRemove.has(w.targetComponentId)
        )
        .map((w) => w.id)
    );

    const newWires = state.wires.filter((w) => !wireIdsToRemove.has(w.id) && !idsToRemove.has(w.id));
    const remainingComps = state.components.filter((c) => !idsToRemove.has(c.id));
    // Reset MEM directions and re-resolve with remaining wires
    const resetComps = remainingComps.map((c) =>
      c.type === 'MEM' ? { ...c, memDirection: undefined } : c
    );
    const resolvedComps = resolveMemDirections(resetComps, newWires);
    set({
      components: resolvedComps,
      wires: newWires,
      textElements: state.textElements.filter((t) => !idsToRemove.has(t.id)),
      comments: state.comments.filter((c) => !idsToRemove.has(c.id) && !idsToRemove.has(c.targetId)),
      boxes: state.boxes.filter((b) => !idsToRemove.has(b.id)),
      selectedIds: [],
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Copy/Paste
  clipboard: null,
  copySelected: () => {
    const state = get();
    const selectedComps = state.components.filter((c) =>
      state.selectedIds.includes(c.id)
    );
    const selectedCompIds = new Set(selectedComps.map((c) => c.id));
    const selectedWires = state.wires.filter(
      (w) =>
        selectedCompIds.has(w.sourceComponentId) &&
        selectedCompIds.has(w.targetComponentId)
    );
    set({
      clipboard: {
        components: JSON.parse(JSON.stringify(selectedComps)),
        wires: JSON.parse(JSON.stringify(selectedWires)),
      },
    });
  },
  paste: () => {
    const state = get();
    if (!state.clipboard) return;
    state.pushHistory();

    // Compute next available label numbers from existing components on canvas
    const inNums = state.components.filter((c) => c.type === 'INPUT').map((c) => parseInt(c.label.replace('IN', '')) || 0);
    const outNums = state.components.filter((c) => c.type === 'OUTPUT').map((c) => parseInt(c.label.replace('OUT', '')) || 0);
    const memNums = state.components.filter((c) => c.type === 'MEM').map((c) => parseInt(c.label.replace('M', '')) || 0);
    let nextIn = inNums.length === 0 ? 1 : Math.max(...inNums) + 1;
    let nextOut = outNums.length === 0 ? 1 : Math.max(...outNums) + 1;
    let nextMem = memNums.length === 0 ? 1 : Math.max(...memNums) + 1;

    const idMap = new Map<string, string>();
    const newComps = state.clipboard.components.map((c) => {
      const newId = uuid();
      idMap.set(c.id, newId);
      let label = c.label;
      if (c.type === 'INPUT') {
        label = `IN${nextIn}`;
        nextIn++;
      } else if (c.type === 'OUTPUT') {
        label = `OUT${nextOut}`;
        nextOut++;
      } else if (c.type === 'MEM') {
        label = `M${nextMem}`;
        nextMem++;
      }
      return { ...c, id: newId, x: c.x + 40, y: c.y + 40, label };
    });
    const newWires = state.clipboard.wires.map((w) => ({
      ...w,
      id: uuid(),
      sourceComponentId: idMap.get(w.sourceComponentId) || w.sourceComponentId,
      targetComponentId: idMap.get(w.targetComponentId) || w.targetComponentId,
    }));

    set({
      components: [...state.components, ...newComps],
      wires: [...state.wires, ...newWires],
      selectedIds: newComps.map((c) => c.id),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  // Tabs (worksheets)
  tabs: [{ id: defaultTabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode, activeTask: 'arithmetic' as ActiveTask }],
  activeTabId: defaultTabId,
  tabCircuits: new Map(),

  addTab: (title, buildMode, activeTask) => {
    const state = get();
    const newId = uuid();
    const task = activeTask || 'arithmetic';
    // Save current tab
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      textElements: state.textElements,
      comments: state.comments,
      boxes: state.boxes,
    });
    set({
      tabs: [...state.tabs, { id: newId, title, buildMode, activeTask: task }],
      activeTabId: newId,
      tabCircuits: updatedTabCircuits,
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      buildMode,
      activeTask: task,
    });
  },

  switchTab: (id) => {
    const state = get();
    if (id === state.activeTabId) return;
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.set(state.activeTabId, {
      components: state.components,
      wires: state.wires,
      textElements: state.textElements,
      comments: state.comments,
      boxes: state.boxes,
    });
    const saved = updatedTabCircuits.get(id) || { components: [], wires: [], textElements: [], comments: [], boxes: [] };
    const tab = state.tabs.find((t) => t.id === id);
    set({
      activeTabId: id,
      tabCircuits: updatedTabCircuits,
      components: saved.components,
      wires: saved.wires,
      textElements: saved.textElements,
      comments: saved.comments,
      boxes: saved.boxes,
      buildMode: tab?.buildMode || 'CC',
      activeTask: tab?.activeTask || 'arithmetic',
    });
  },

  removeTab: (id) => {
    const state = get();
    if (state.tabs.length <= 1) return;
    const newTabs = state.tabs.filter((t) => t.id !== id);
    const updatedTabCircuits = new Map(state.tabCircuits);
    updatedTabCircuits.delete(id);
    if (id === state.activeTabId) {
      const newActiveId = newTabs[0].id;
      const saved = updatedTabCircuits.get(newActiveId) || {
        components: [],
        wires: [],
        textElements: [],
        comments: [],
        boxes: [],
      };
      set({
        tabs: newTabs,
        activeTabId: newActiveId,
        tabCircuits: updatedTabCircuits,
        components: saved.components,
        wires: saved.wires,
        textElements: saved.textElements,
        comments: saved.comments,
        boxes: saved.boxes,
      });
    } else {
      set({ tabs: newTabs, tabCircuits: updatedTabCircuits });
    }
  },

  renameTab: (id, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  // Batch move — single state update for moving multiple components
  moveComponentsBatch: (moves) => {
    set((state) => {
      const movedIds = new Set(moves.keys());
      return {
        components: state.components.map((c) => {
          const pos = moves.get(c.id);
          return pos ? { ...c, x: pos.x, y: pos.y } : c;
        }),
        // Clear manual wire segments on wires connected to moved components
        wires: state.wires.map((w) => {
          if (
            (movedIds.has(w.sourceComponentId) || movedIds.has(w.targetComponentId)) &&
            w.manualSegments && w.manualSegments.length > 0
          ) {
            return { ...w, manualSegments: undefined };
          }
          return w;
        }),
      };
    });
  },

  snapComponentsToGrid: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      components: state.components.map((c) =>
        idSet.has(c.id)
          ? { ...c, x: snapToGrid(c.x), y: snapToGrid(c.y) }
          : c
      ),
    }));
  },

  // Step-by-step table rows
  tableRows: [],

  addTableRow: () => {
    const state = get();
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('IN', ''));
        const numB = parseInt(b.label.replace('IN', ''));
        return numA - numB;
      });
    const outputs = state.components
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('OUT', ''));
        const numB = parseInt(b.label.replace('OUT', ''));
        return numA - numB;
      });

    const inputBits = inputs.map((c) => c.value ?? 0);
    const outputBits = outputs.map((c) => c.value ?? 0);

    set((s) => ({
      tableRows: [...s.tableRows, { inputBits, outputBits }],
    }));
  },

  clearTableRows: () => {
    set({ tableRows: [] });
  },

  // Local I/O stepping state
  localStepIndex: 0,
  localStepSorted: [],
  localStepPortValues: {},
  localStepActive: false,
  localStepSelectedKey: null,

  localStepSelect: (inBits, memBits) => {
    const state = get();
    const { components, wires } = state;

    const inputs = components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const mems = components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));

    // Set INPUT values and MEM stored values; clear everything else
    const updatedComps = components.map((c) => {
      if (c.type === 'INPUT') {
        const idx = inputs.indexOf(c);
        const val = idx >= 0 && idx < inBits.length ? inBits[idx] : 0;
        return { ...c, value: val, inputValues: [val] };
      }
      if (c.type === 'MEM') {
        const idx = mems.indexOf(c);
        const val = memBits && idx >= 0 && idx < memBits.length ? memBits[idx] : (c.storedValue ?? 0);
        return { ...c, storedValue: val, value: undefined };
      }
      return { ...c, value: undefined };
    });

    // Initialize port values with INPUT and MEM outputs only
    const portValues: Record<string, number | undefined> = {};
    for (const comp of updatedComps) {
      if (comp.type === 'INPUT') {
        portValues[`${comp.id}:out`] = comp.value;
      } else if (comp.type === 'MEM') {
        portValues[`${comp.id}:${getMemOutputPortId(comp)}`] = comp.storedValue ?? 0;
      }
    }

    // Build wire evaluation order: follow topological sort of components.
    // For each component in topo order, collect its outgoing wires.
    // Inputs come first, then memories, then gates — all via topo sort.
    const sorted = topologicalSort(updatedComps, wires);
    // Separate: INPUTs first, then MEMs, then the rest (topo order handles the rest)
    const inputComps = sorted.filter((c) => c.type === 'INPUT');
    const memComps = sorted.filter((c) => c.type === 'MEM');
    const otherComps = sorted.filter((c) => c.type !== 'INPUT' && c.type !== 'MEM');
    const orderedSources = [...inputComps, ...memComps, ...otherComps];

    const wireOrder: string[] = [];
    const addedWires = new Set<string>();
    for (const comp of orderedSources) {
      // Collect all outgoing wires from this component
      const outgoing: Wire[] = [];
      for (const w of wires) {
        if (w.sourceComponentId === comp.id && !addedWires.has(w.id)) {
          // Skip feedback wires into MEM min ports
          if (comp.type !== 'INPUT' && comp.type !== 'MEM') {
            const targetComp = updatedComps.find((c) => c.id === w.targetComponentId);
            if (targetComp?.type === 'MEM' && w.targetPortId === getMemInputPortId(targetComp)) continue;
          }
          outgoing.push(w);
        }
      }
      // Sort fan-out wires: last in render order (highest z-index, on top) first,
      // so the visually closest wire gets annotated first, working backwards.
      if (outgoing.length > 1) {
        outgoing.reverse();
      }
      for (const w of outgoing) {
        wireOrder.push(w.id);
        addedWires.add(w.id);
      }
    }

    // MEM feedback wires (value going INTO memory) — fill memories before outputs
    for (const w of wires) {
      if (!addedWires.has(w.id)) {
        const targetComp = updatedComps.find((c) => c.id === w.targetComponentId);
        if (targetComp?.type === 'MEM' && w.targetPortId === getMemInputPortId(targetComp)) {
          wireOrder.push(w.id);
          addedWires.add(w.id);
        }
      }
    }
    // MEM update steps (show value being received)
    for (const mem of mems) {
      wireOrder.push(`comp:${mem.id}`);
    }

    // OUTPUT evaluations come last
    const outputComps = updatedComps
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => parseInt(a.label.replace('OUT', '')) - parseInt(b.label.replace('OUT', '')));
    for (const out of outputComps) {
      wireOrder.push(`comp:${out.id}`);
    }

    // Build selected key
    const keyBits = [...inBits, ...(memBits || mems.map((m) => m.storedValue ?? 0))];
    const selectedKey = keyBits.join(',');

    // Clear all wire values
    const clearedWires = wires.map((w) => ({ ...w, value: -1 }));

    set({
      components: updatedComps,
      wires: clearedWires,
      wireValues: new Map(),
      localStepIndex: 0,
      localStepSorted: wireOrder, // now stores wire IDs, not component IDs
      localStepPortValues: portValues,
      localStepActive: true,
      localStepSelectedKey: selectedKey,
    });
  },

  localStepOne: () => {
    const state = get();
    const { localStepIndex, localStepSorted, localStepPortValues, components, wires } = state;

    if (localStepIndex >= localStepSorted.length) {
      return false;
    }

    // Check if this step is a component evaluation (comp:ID) or a wire annotation
    const stepId = localStepSorted[localStepIndex];

    if (stepId.startsWith('comp:')) {
      // Evaluate the component directly (e.g. OUTPUT)
      const compId = stepId.slice(5);
      const comp = components.find((c) => c.id === compId);
      if (!comp) {
        set({ localStepIndex: localStepIndex + 1 });
        return localStepIndex + 1 < localStepSorted.length;
      }
      const newPortValues = { ...localStepPortValues };
      const inputPorts = comp.ports.filter((p) => p.side === 'left');
      const inputVals: (number | undefined)[] = [];
      let hasUndefined = false;
      for (const port of inputPorts) {
        const inWire = wires.find((w) => w.targetComponentId === comp.id && w.targetPortId === port.id);
        if (inWire) {
          const val = state.wireValues.has(inWire.id) ? state.wireValues.get(inWire.id) : undefined;
          inputVals.push(val != null ? val : undefined);
          if (val == null) hasUndefined = true;
        } else {
          inputVals.push(undefined);
          hasUndefined = true;
        }
      }
      if (comp.type === 'OUTPUT') {
        newPortValues[`${comp.id}:in`] = hasUndefined ? undefined : (inputVals[0] ?? 0);
      } else if (comp.type === 'MEM') {
        // MEM "evaluation" at end of cycle: read value from the feedback wire
        // into the MEM input port and record it as the next stored value.
        const memInputPortId = getMemInputPortId(comp);
        const feedbackWire = wires.find(
          (w) => w.targetComponentId === comp.id && w.targetPortId === memInputPortId
        );
        const feedbackVal = feedbackWire
          ? (state.wireValues.get(feedbackWire.id) ?? 0)
          : 0;
        newPortValues[`${comp.id}:${memInputPortId}`] = feedbackVal;
      } else if (!hasUndefined) {
        const outputs = evaluateGate(comp.type, inputVals as number[], comp);
        const outputPorts = comp.ports.filter((p) => p.side === 'right');
        for (let i = 0; i < outputPorts.length; i++) {
          newPortValues[`${comp.id}:${outputPorts[i].id}`] = outputs[i] ?? 0;
        }
      }
      const updatedComps = components.map((c) => {
        if (c.id !== compId) return c;
        if (c.type === 'OUTPUT') return { ...c, value: newPortValues[`${c.id}:in`] };
        if (c.type === 'MEM') {
          // Show the incoming value visually on the MEM block
          const memInputPortId = getMemInputPortId(c);
          const inVal = newPortValues[`${c.id}:${memInputPortId}`];
          return { ...c, storedValue: inVal != null ? inVal : (c.storedValue ?? 0) };
        }
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) return { ...c, value: newPortValues[`${c.id}:${outputPort.id}`] };
        return c;
      });

      // When an OUTPUT is evaluated, upsert the I/O table row with current output values
      const updates: Record<string, unknown> = { components: updatedComps, localStepIndex: localStepIndex + 1, localStepPortValues: newPortValues };
      if (comp.type === 'OUTPUT') {
        const hasMem = components.some((c) => c.type === 'MEM');
        const sortedInputs = components
          .filter((c) => c.type === 'INPUT')
          .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
        const sortedOutputs = components
          .filter((c) => c.type === 'OUTPUT')
          .sort((a, b) => parseInt(a.label.replace('OUT', '')) - parseInt(b.label.replace('OUT', '')));
        const sortedMems = components
          .filter((c) => c.type === 'MEM')
          .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));

        const inputBits = sortedInputs.map((c) => c.value ?? 0);
        const outputBits = sortedOutputs.map((c) => {
          const val = newPortValues[`${c.id}:in`];
          return val !== undefined ? val : 0;
        });
        const memBitsVal = hasMem ? sortedMems.map((c) => c.storedValue ?? 0) : undefined;

        const localKey = [...inputBits, ...(memBitsVal || [])].join(',');
        const existingRows = state.tableRows;
        const localIdx = existingRows.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === localKey);
        let newTableRows = existingRows;
        if (localIdx >= 0) {
          newTableRows = [...existingRows];
          newTableRows[localIdx] = { inputBits, memBits: memBitsVal, outputBits };
        } else {
          newTableRows = [...existingRows, { inputBits, memBits: memBitsVal, outputBits }];
        }
        updates.tableRows = newTableRows;
      }
      set(updates);
      return localStepIndex + 1 < localStepSorted.length;
    }

    // Annotate one wire
    const wireId = stepId;
    const wire = wires.find((w) => w.id === wireId);
    if (!wire) {
      set({ localStepIndex: localStepIndex + 1 });
      return localStepIndex + 1 < localStepSorted.length;
    }

    const newPortValues = { ...localStepPortValues };
    const newWireValues = new Map(state.wireValues);

    // Get the source port value and annotate this wire
    const srcVal = newPortValues[`${wire.sourceComponentId}:${wire.sourcePortId}`];
    if (srcVal != null) {
      newWireValues.set(wire.id, srcVal);
    }

    // Update the wire object
    const updatedWires = wires.map((w) =>
      w.id === wireId ? { ...w, value: srcVal != null ? srcVal : -1 } : w
    );

    // Check if the target component now has ALL its input wires annotated.
    // If so, evaluate it so its output port values are available for downstream wires.
    const targetComp = components.find((c) => c.id === wire.targetComponentId);
    let updatedComps = components;

    if (targetComp && targetComp.type !== 'INPUT' && targetComp.type !== 'MEM' && targetComp.type !== 'OUTPUT') {
      const inputPorts = targetComp.ports.filter((p) => p.side === 'left');
      const allInputsReady = inputPorts.every((port) => {
        const inWire = wires.find((w) => w.targetComponentId === targetComp.id && w.targetPortId === port.id);
        if (!inWire) return true; // unconnected = ready (undefined)
        // Check if this wire has been annotated (either just now or previously)
        return inWire.id === wireId ? srcVal != null : newWireValues.has(inWire.id);
      });

      if (allInputsReady) {
        // Gather input values and evaluate
        const inputVals: (number | undefined)[] = [];
        let hasUndefined = false;
        for (const port of inputPorts) {
          const inWire = wires.find((w) => w.targetComponentId === targetComp.id && w.targetPortId === port.id);
          if (inWire) {
            const val = inWire.id === wireId ? srcVal : newWireValues.get(inWire.id);
            inputVals.push(val != null ? val : undefined);
            if (val == null) hasUndefined = true;
          } else {
            inputVals.push(undefined);
            hasUndefined = true;
          }
        }

        if (hasUndefined) {
          const outputPorts = targetComp.ports.filter((p) => p.side === 'right');
          for (const op of outputPorts) {
            newPortValues[`${targetComp.id}:${op.id}`] = undefined;
          }
        } else {
          const outputs = evaluateGate(targetComp.type, inputVals as number[], targetComp);
          const outputPorts = targetComp.ports.filter((p) => p.side === 'right');
          for (let i = 0; i < outputPorts.length; i++) {
            newPortValues[`${targetComp.id}:${outputPorts[i].id}`] = outputs[i] ?? 0;
          }
        }

        // Update the target component's displayed value
        updatedComps = components.map((c) => {
          if (c.id !== targetComp.id) return c;
          if (c.type === 'OUTPUT') {
            return { ...c, value: newPortValues[`${c.id}:in`] };
          }
          const outputPort = c.ports.find((p) => p.side === 'right');
          if (outputPort) {
            return { ...c, value: newPortValues[`${c.id}:${outputPort.id}`] };
          }
          return c;
        });
      }
    }

    set({
      components: updatedComps,
      wires: updatedWires,
      wireValues: newWireValues,
      localStepIndex: localStepIndex + 1,
      localStepPortValues: newPortValues,
    });
    return localStepIndex + 1 < localStepSorted.length;
  },

  localStepReset: () => {
    const state = get();
    if (!state.localStepActive) return;
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const mems = state.components
      .filter((c) => c.type === 'MEM')
      .sort((a, b) => parseInt(a.label.replace('M', '')) - parseInt(b.label.replace('M', '')));
    const inBits = inputs.map((c) => c.value ?? 0);
    const memBits = mems.length > 0 ? mems.map((c) => c.storedValue ?? 0) : undefined;

    // Remove the output for this row from tableRows
    const key = [...inBits, ...(memBits || [])].join(',');
    const newTableRows = state.tableRows.filter((r) =>
      [...r.inputBits, ...(r.memBits || [])].join(',') !== key
    );
    set({ tableRows: newTableRows });

    get().localStepSelect(inBits, memBits);
  },

  localStepClear: () => {
    set({
      localStepActive: false,
      localStepSelectedKey: null,
      localStepIndex: 0,
      localStepSorted: [],
      localStepPortValues: {},
    });
  },

  // Sequential circuit state
  scTimeStep: 1,
  scHistory: [],
  scInputSequence: [],
  scRunning: false,
  scRunIntervalId: null,
  scGlobalSequences: [],

  scStep: () => {
    const state = get();
    const { components, wires, scTimeStep, scHistory, scInputSequence } = state;

    // Gather sorted inputs, outputs, MEM blocks
    const inputs = components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('IN', ''));
        const numB = parseInt(b.label.replace('IN', ''));
        return numA - numB;
      });
    const outputs = components
      .filter((c) => c.type === 'OUTPUT')
      .sort((a, b) => {
        const numA = parseInt(a.label.replace('OUT', ''));
        const numB = parseInt(b.label.replace('OUT', ''));
        return numA - numB;
      });
    const mems = components.filter((c) => c.type === 'MEM');

    // Set input values from the input sequence for this time step
    const tIdx = scTimeStep - 1; // 0-based index
    const updatedComps = components.map((c) => {
      if (c.type === 'INPUT') {
        const inputIdx = inputs.indexOf(c);
        const seqVal = (inputIdx >= 0 && scInputSequence[inputIdx] && scInputSequence[inputIdx][tIdx] !== undefined)
          ? scInputSequence[inputIdx][tIdx]
          : (c.value ?? 0);
        return { ...c, value: seqVal, inputValues: [seqVal] };
      }
      return c;
    });

    // Step 1: Read M_OUT from all MEM blocks (current stored values)
    // Step 2: Evaluate combinational logic
    // For topological sort, treat MEM as having only an output (mout).
    // MEM's min port is a sink that receives the new value.
    const sorted = topologicalSort(updatedComps, wires);
    const portValues = new Map<string, number>();

    // Set MEM block M_OUT values from stored values
    for (const comp of updatedComps) {
      if (comp.type === 'MEM') {
        portValues.set(`${comp.id}:${getMemOutputPortId(comp)}`, comp.storedValue ?? 0);
      }
    }

    // Set input values
    for (const comp of sorted) {
      if (comp.type === 'INPUT') {
        const idx = inputs.findIndex((inp) => inp.id === comp.id);
        const val = idx >= 0 && scInputSequence[idx] && scInputSequence[idx][tIdx] !== undefined
          ? scInputSequence[idx][tIdx]
          : (comp.value ?? 0);
        portValues.set(`${comp.id}:out`, val);
      }
    }

    // Propagate through sorted components
    for (const comp of sorted) {
      if (comp.type === 'INPUT' || comp.type === 'MEM') continue;

      const inputPorts = comp.ports.filter((p) => p.side === 'left');
      const inputVals: number[] = [];
      for (const port of inputPorts) {
        const incomingWire = wires.find(
          (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
        );
        if (incomingWire) {
          const srcVal = portValues.get(
            `${incomingWire.sourceComponentId}:${incomingWire.sourcePortId}`
          ) ?? 0;
          inputVals.push(srcVal);
        } else {
          inputVals.push(0);
        }
      }

      if (comp.type === 'OUTPUT') {
        portValues.set(`${comp.id}:in`, inputVals[0] ?? 0);
      } else {
        const evalOutputs = evaluateGate(comp.type, inputVals, comp);
        const outputPorts = comp.ports.filter((p) => p.side === 'right');
        for (let i = 0; i < outputPorts.length; i++) {
          portValues.set(`${comp.id}:${outputPorts[i].id}`, evalOutputs[i] ?? 0);
        }
      }
    }

    // Step 3: Determine M_IN values and write into MEM blocks for next cycle
    const newComponents = updatedComps.map((c) => {
      if (c.type === 'MEM') {
        // Find the wire feeding into M_IN (input port based on direction)
        const minWire = wires.find(
          (w) => w.targetComponentId === c.id && w.targetPortId === getMemInputPortId(c)
        );
        const newStoredValue = minWire
          ? (portValues.get(`${minWire.sourceComponentId}:${minWire.sourcePortId}`) ?? 0)
          : 0;
        return { ...c, storedValue: newStoredValue };
      }
      if (c.type === 'OUTPUT') {
        return { ...c, value: portValues.get(`${c.id}:in`) ?? 0 };
      }
      if (c.type !== 'INPUT') {
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) {
          return { ...c, value: portValues.get(`${c.id}:${outputPort.id}`) ?? 0 };
        }
      }
      return c;
    });

    // Update wire values
    const newWireValues = new Map<string, number>();
    for (const w of wires) {
      const srcVal = portValues.get(`${w.sourceComponentId}:${w.sourcePortId}`) ?? 0;
      newWireValues.set(w.id, srcVal);
    }

    // Build history entry
    const inputBits = inputs.map((inp) => {
      const idx = inputs.indexOf(inp);
      return idx >= 0 && scInputSequence[idx] && scInputSequence[idx][tIdx] !== undefined
        ? scInputSequence[idx][tIdx]
        : (inp.value ?? 0);
    });
    const outputBits = outputs.map((o) => portValues.get(`${o.id}:in`) ?? 0);
    const memValues = mems.map((m) => m.storedValue ?? 0); // values BEFORE this step

    const newHistory = [...scHistory, { t: scTimeStep, inputBits, outputBits, memValues }];

    // Also update the local I/O tableRows for this input+mem→output combo
    const memBits = memValues; // values BEFORE step = what determined the output
    const localKey = [...inputBits, ...memBits].join(',');
    const existingRows = state.tableRows;
    const localIdx = existingRows.findIndex((r) => [...r.inputBits, ...(r.memBits || [])].join(',') === localKey);
    let newTableRows = existingRows;
    if (localIdx >= 0) {
      newTableRows = [...existingRows];
      newTableRows[localIdx] = { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits };
    } else {
      newTableRows = [...existingRows, { inputBits, memBits: mems.length > 0 ? memBits : undefined, outputBits }];
    }

    set({
      components: newComponents,
      wires: wires.map((w) => ({ ...w, value: newWireValues.get(w.id) ?? 0 })),
      wireValues: newWireValues,
      scTimeStep: scTimeStep + 1,
      scHistory: newHistory,
      tableRows: newTableRows,
    });

    // Update matching global sequence output
    const updState = get();
    const numInputs = inputs.length;
    // Build currentInputStr reversed: earliest time step → rightmost position
    let currentInputStr = '';
    const maxSeqLen = Math.max(...updState.scInputSequence.map((s) => s.length), 0);
    for (let t = maxSeqLen - 1; t >= 0; t--) {
      for (let ii = 0; ii < numInputs; ii++) {
        currentInputStr += String(updState.scInputSequence[ii]?.[t] ?? 0);
      }
    }
    // Build output string right-to-left: earliest output → rightmost position
    const outputStr = newHistory
      .slice()
      .sort((a, b) => b.t - a.t)
      .map((h) => h.outputBits.join(''))
      .join('');
    const seqIdx = updState.scGlobalSequences.findIndex((s) => s.inputStr === currentInputStr);
    if (seqIdx >= 0) {
      const seqs = [...updState.scGlobalSequences];
      seqs[seqIdx] = { ...seqs[seqIdx], outputStr };
      set({ scGlobalSequences: seqs });
    }
  },

  scRun: () => {
    const state = get();
    if (state.scRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      // Stop if we've consumed all input
      const maxLen = Math.max(...s.scInputSequence.map((seq) => seq.length), 0);
      if (s.scTimeStep > maxLen && maxLen > 0) {
        s.scPause();
        return;
      }
      s.scStep();
    }, 300);
    set({ scRunning: true, scRunIntervalId: intervalId });
  },

  scPause: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    set({ scRunning: false, scRunIntervalId: null });
  },

  scReset: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    // Reset MEM blocks to 0 and inputs to undefined, keep input sequence
    set({
      scTimeStep: 1,
      scHistory: [],
      scRunning: false,
      scRunIntervalId: null,
      tableRows: [],
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  scGlobalReset: () => {
    const state = get();
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }
    // Reset everything: MEM to 0, inputs to 0, clear input sequence
    set({
      scTimeStep: 1,
      scHistory: [],
      scInputSequence: [],
      scRunning: false,
      scRunIntervalId: null,
      tableRows: [],
      scGlobalSequences: [],
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  setScInputBit: (inputIndex, timeStep, value) => {
    set((state) => {
      const newSeq = [...state.scInputSequence];
      // Ensure the array for this input exists
      while (newSeq.length <= inputIndex) {
        newSeq.push([]);
      }
      // Ensure the array is long enough for this time step
      const arr = [...newSeq[inputIndex]];
      while (arr.length < timeStep) {
        arr.push(0);
      }
      arr[timeStep - 1] = value;
      newSeq[inputIndex] = arr;
      return { scInputSequence: newSeq };
    });
  },

  setScGlobalSequenceInput: (index, value) => {
    set((state) => {
      const seqs = [...state.scGlobalSequences];
      while (seqs.length <= index) seqs.push({ inputStr: '', outputStr: '' });
      seqs[index] = { ...seqs[index], inputStr: value };
      return { scGlobalSequences: seqs };
    });
  },

  loadScGlobalSequence: (index) => {
    const state = get();
    const seq = state.scGlobalSequences[index];
    if (!seq || seq.inputStr.length === 0) return;

    // Reset circuit state first
    if (state.scRunIntervalId !== null) {
      window.clearInterval(state.scRunIntervalId);
    }

    // Parse the input string into per-input sequences
    // For a single input: "0110" → scInputSequence[0] = [0,1,1,0]
    // For multiple inputs: each char is a time step, bits split across inputs
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const numInputs = inputs.length;
    const chars = seq.inputStr.replace(/[^01]/g, '');
    const stepsCount = numInputs > 0 ? Math.floor(chars.length / numInputs) : 0;

    const newSeq: number[][] = [];
    for (let i = 0; i < numInputs; i++) {
      newSeq.push([]);
    }
    // Read right-to-left: rightmost character is first time step
    for (let t = 0; t < stepsCount; t++) {
      const srcT = stepsCount - 1 - t; // reverse: last char group → first step
      for (let i = 0; i < numInputs; i++) {
        newSeq[i].push(parseInt(chars[srcT * numInputs + i]) || 0);
      }
    }

    set({
      scTimeStep: 1,
      scHistory: [],
      scRunning: false,
      scRunIntervalId: null,
      scInputSequence: newSeq,
      components: state.components.map((c) => {
        if (c.type === 'MEM') return { ...c, storedValue: 0 };
        if (c.type === 'INPUT') return { ...c, value: undefined, inputValues: [undefined as unknown as number] };
        return c;
      }),
    });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  recordScGlobalSequenceOutput: () => {
    const state = get();
    // Find the active global sequence (the one whose inputStr matches current scInputSequence)
    const inputs = state.components
      .filter((c) => c.type === 'INPUT')
      .sort((a, b) => parseInt(a.label.replace('IN', '')) - parseInt(b.label.replace('IN', '')));
    const numInputs = inputs.length;

    // Build output string from scHistory (reversed: earliest → rightmost)
    const outputStr = state.scHistory
      .sort((a, b) => b.t - a.t)
      .map((h) => h.outputBits.join(''))
      .join('');

    // Build current input string from scInputSequence (reversed: earliest → rightmost)
    let inputStr = '';
    const maxLen = Math.max(...state.scInputSequence.map((s) => s.length), 0);
    for (let t = maxLen - 1; t >= 0; t--) {
      for (let i = 0; i < numInputs; i++) {
        inputStr += String(state.scInputSequence[i]?.[t] ?? 0);
      }
    }

    // Find and update matching sequence
    const seqs = [...state.scGlobalSequences];
    const idx = seqs.findIndex((s) => s.inputStr === inputStr);
    if (idx >= 0) {
      seqs[idx] = { ...seqs[idx], outputStr };
      set({ scGlobalSequences: seqs });
    }
  },

  // Selected tool (click-to-place mode)
  selectedTool: null,
  setSelectedTool: (t) => set({ selectedTool: t }),

  // Text elements
  textElements: [],
  addTextElement: (x, y) => {
    const state = get();
    state.pushHistory();
    const id = uuid();
    const elem: TextElement = {
      id,
      x: snapToGrid(x),
      y: snapToGrid(y),
      width: 160,
      height: 60,
      text: '',
      fontSize: 14,
      fontColor: '#333',
      bold: false,
      italic: false,
    };
    set({ textElements: [...state.textElements, elem] });
    return id;
  },
  updateTextElement: (id, updates) => {
    set((state) => ({
      textElements: state.textElements.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },
  removeTextElement: (id) => {
    const state = get();
    state.pushHistory();
    set({ textElements: state.textElements.filter((t) => t.id !== id) });
  },

  // Comments
  comments: [],
  showComments: true,
  setShowComments: (v) => set({ showComments: v }),
  addComment: (targetId, text) => {
    const state = get();
    state.pushHistory();
    const id = uuid();
    const comment: CommentElement = {
      id,
      targetId,
      text,
      x: 20,
      y: -20,
    };
    set({ comments: [...state.comments, comment] });
    return id;
  },
  updateComment: (id, updates) => {
    set((state) => ({
      comments: state.comments.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }));
  },
  removeComment: (id) => {
    const state = get();
    state.pushHistory();
    set({ comments: state.comments.filter((c) => c.id !== id) });
  },

  // Box drawing mode state
  boxDrawing: {
    phase: 'idle',
    draftBox: null,
  },
  setBoxDrawingPhase: (phase) => {
    set((state) => ({
      boxDrawing: { ...state.boxDrawing, phase },
    }));
  },
  setDraftBox: (box) => {
    set((state) => ({
      boxDrawing: { ...state.boxDrawing, draftBox: box },
    }));
  },

  // ─── FSM state ──────────────────────────────────────────────────
  fsmCurrentStateId: null,
  fsmInputSequence: [],
  fsmTimeStep: 1,
  fsmHistory: [],
  fsmRunning: false,
  fsmRunIntervalId: null,
  fsmHalted: false,

  setTransitionLabel: (wireId, label) => {
    if (!/^[01]:[01]$/.test(label)) return;
    const state = get();
    state.pushHistory();
    set({
      wires: state.wires.map((w) =>
        w.id === wireId ? { ...w, transitionLabel: label } : w
      ),
    });
  },

  setFsmControlPt: (wireId, pt) => {
    set({
      wires: get().wires.map((w) =>
        w.id === wireId ? { ...w, fsmControlPt: pt } : w
      ),
    });
  },

  setFsmInputBit: (index, value) => {
    set((state) => {
      const seq = [...state.fsmInputSequence];
      while (seq.length <= index) seq.push(0);
      seq[index] = value;
      return { fsmInputSequence: seq };
    });
  },

  setFsmInputSequence: (seq) => {
    set({ fsmInputSequence: seq });
  },

  fsmStep: () => {
    const state = get();
    const { components, wires, fsmTimeStep, fsmHistory, fsmInputSequence, fsmHalted } = state;
    if (fsmHalted) return;

    const states = components
      .filter((c) => c.type === 'STATE')
      .sort((a, b) => {
        // Sort by label number (S₀ < S₁ < S₂...)
        const subDigits = '₀₁₂₃₄₅₆₇₈₉';
        const numA = parseInt(a.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        const numB = parseInt(b.label.replace('S', '').split('').map(ch => { const idx = subDigits.indexOf(ch); return idx >= 0 ? String(idx) : ch; }).join('')) || 0;
        return numA - numB;
      });

    if (states.length === 0) return;

    // Determine current state
    let currentStateId = state.fsmCurrentStateId;
    if (!currentStateId) {
      // Start at S₀ (first state by label order)
      currentStateId = states[0].id;
    }

    const currentState = components.find((c) => c.id === currentStateId);
    if (!currentState) return;

    // Get current input bit
    const tIdx = fsmTimeStep - 1;
    if (tIdx >= fsmInputSequence.length) return; // no more input
    const inputBit = fsmInputSequence[tIdx];

    // Find matching transition: wire from current state with matching input
    const transitions = wires.filter((w) => w.sourceComponentId === currentStateId);
    let matchedTransition: Wire | null = null;
    for (const t of transitions) {
      if (!t.transitionLabel) continue;
      const parts = t.transitionLabel.split(':');
      if (parts.length !== 2 || (parts[0] !== '0' && parts[0] !== '1') || (parts[1] !== '0' && parts[1] !== '1')) continue;
      const tInput = parts[0] === '1' ? 1 : 0;
      if (tInput === inputBit) {
        matchedTransition = t;
        break;
      }
    }

    if (!matchedTransition) {
      // No transition — machine halts
      set({ fsmHalted: true });
      return;
    }

    const parts = matchedTransition.transitionLabel!.split(':');
    const output = parts[1] === '1' ? 1 : 0;
    const nextStateId = matchedTransition.targetComponentId;
    const nextState = components.find((c) => c.id === nextStateId);

    const entry: FsmHistoryEntry = {
      t: fsmTimeStep,
      stateLabel: currentState.label,
      input: inputBit,
      output,
      nextStateLabel: nextState?.label || '?',
    };

    set({
      fsmCurrentStateId: nextStateId,
      fsmTimeStep: fsmTimeStep + 1,
      fsmHistory: [...fsmHistory, entry],
    });
  },

  fsmRun: () => {
    const state = get();
    if (state.fsmRunning) return;
    const intervalId = window.setInterval(() => {
      const s = get();
      if (s.fsmHalted || s.fsmTimeStep > s.fsmInputSequence.length) {
        s.fsmPause();
        return;
      }
      s.fsmStep();
    }, 300);
    set({ fsmRunning: true, fsmRunIntervalId: intervalId });
  },

  fsmPause: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({ fsmRunning: false, fsmRunIntervalId: null });
  },

  fsmReset: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({
      fsmCurrentStateId: null,
      fsmTimeStep: 1,
      fsmHistory: [],
      fsmRunning: false,
      fsmRunIntervalId: null,
      fsmHalted: false,
    });
  },

  fsmGlobalReset: () => {
    const state = get();
    if (state.fsmRunIntervalId !== null) {
      window.clearInterval(state.fsmRunIntervalId);
    }
    set({
      fsmCurrentStateId: null,
      fsmInputSequence: [],
      fsmTimeStep: 1,
      fsmHistory: [],
      fsmRunning: false,
      fsmRunIntervalId: null,
      fsmHalted: false,
    });
  },
}));

// Expose for debugging
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__store = useStore;
}

// ─── Auto-save to localStorage ─────────────────────────────────────
const AUTO_SAVE_KEY = 'making-minds-autosave';
const AUTO_SAVE_DELAY = 1500; // ms debounce

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function getAutoSaveData() {
  const s = useStore.getState();
  // Use the workbook export format for auto-save
  // Save current tab circuit into tabCircuits
  const allTabCircuits = new Map(s.tabCircuits);
  allTabCircuits.set(s.activeTabId, {
    components: s.components,
    wires: s.wires,
    textElements: s.textElements,
    comments: s.comments,
    boxes: s.boxes,
  });
  return {
    formatVersion: 2,
    workbookOpen: s.workbookOpen,
    workbookTitle: s.workbookTitle,
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    tabCircuits: Object.fromEntries(allTabCircuits),
    viewPreferences: {
      zoom: s.zoom,
      panX: s.panX,
      panY: s.panY,
      showGrid: s.showGrid,
      showWireValues: s.showWireValues,
      snapToAlign: s.snapToAlign,
      repSystem: s.repSystem,
    },
  };
}

// Persist the open assignment's work (syncing the live question first) via the
// storage seam, keyed by assignment id — separate from the sandbox blob.
function saveAssignmentState() {
  const s = useStore.getState();
  const a = s.assignment;
  if (!a) return;
  const qc = new Map(s.questionCircuits);
  const q = a.questions[s.currentQuestionIndex];
  if (q) {
    qc.set(q.id, {
      components: s.components,
      wires: s.wires,
      textElements: s.textElements,
      comments: s.comments,
      boxes: s.boxes,
    });
  }
  localWorkbookStore.saveAssignmentState(a.id, {
    currentQuestionIndex: s.currentQuestionIndex,
    questionCircuits: Object.fromEntries(qc) as Record<number, QuestionCircuit>,
  });
}

function performAutoSave() {
  try {
    useStore.setState({ autoSaveStatus: 'saving' });
    if (useStore.getState().assignment) {
      saveAssignmentState();
    } else {
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(getAutoSaveData()));
    }
    useStore.setState({ autoSaveStatus: 'saved' });
  } catch {
    // localStorage full or unavailable — silent fail
    useStore.setState({ autoSaveStatus: 'saved' });
  }
}

// Subscribe to state changes that should trigger auto-save. Routes by context:
// assignment mode → per-assignment storage; sandbox mode → the sandbox blob.
useStore.subscribe((state, prev) => {
  const canvasChanged =
    state.components !== prev.components ||
    state.wires !== prev.wires ||
    state.textElements !== prev.textElements ||
    state.comments !== prev.comments ||
    state.boxes !== prev.boxes;

  let changed: boolean;
  if (state.assignment) {
    changed =
      canvasChanged ||
      state.currentQuestionIndex !== prev.currentQuestionIndex ||
      state.questionCircuits !== prev.questionCircuits ||
      state.assignment !== prev.assignment;
  } else {
    changed =
      canvasChanged ||
      state.tabs !== prev.tabs ||
      state.activeTabId !== prev.activeTabId ||
      state.buildMode !== prev.buildMode ||
      state.tabCircuits !== prev.tabCircuits ||
      state.workbookOpen !== prev.workbookOpen ||
      state.workbookTitle !== prev.workbookTitle;
  }
  if (!changed) return;

  useStore.setState({ autoSaveStatus: 'unsaved' });
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(performAutoSave, AUTO_SAVE_DELAY);
});

// Load from localStorage on startup
type TabCircuitData = { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] };

function loadAutoSave() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return; // No saved data — stay on welcome screen (workbookOpen: false)
    const data = JSON.parse(raw);

    if (data.formatVersion === 2) {
      // New workbook auto-save format
      const tabCircuits = new Map<string, TabCircuitData>();
      if (data.tabCircuits) {
        for (const [k, v] of Object.entries(data.tabCircuits)) {
          tabCircuits.set(k, v as TabCircuitData);
        }
      }
      // Ensure tabs have activeTask field (migration for old auto-saves)
      const tabs = (data.tabs || []).map((t: { id: string; title: string; buildMode: BuildMode; activeTask?: ActiveTask }) => ({
        ...t,
        activeTask: t.activeTask || 'arithmetic',
      }));
      const activeId = data.activeTabId || tabs[0]?.id || defaultTabId;
      const activeCircuit = tabCircuits.get(activeId) || { components: [], wires: [], textElements: [], comments: [], boxes: [] };
      const activeTab = tabs.find((t: { id: string }) => t.id === activeId);
      const vp = data.viewPreferences || {};

      useStore.setState({
        workbookOpen: false, // home-first: restore the sandbox into memory but land on Home
        workbookTitle: data.workbookTitle || 'Untitled Workbook',
        tabs,
        activeTabId: activeId,
        tabCircuits,
        components: activeCircuit.components || [],
        wires: activeCircuit.wires || [],
        textElements: activeCircuit.textElements || [],
        comments: activeCircuit.comments || [],
        boxes: activeCircuit.boxes || [],
        buildMode: activeTab?.buildMode || 'CC',
        activeTask: activeTab?.activeTask || 'arithmetic',
        repSystem: vp.repSystem || 'binary',
        zoom: vp.zoom ?? 1,
        panX: vp.panX ?? 0,
        panY: vp.panY ?? 0,
        showGrid: vp.showGrid ?? true,
        showWireValues: vp.showWireValues ?? true,
        snapToAlign: vp.snapToAlign ?? true,
      });
      setTimeout(() => useStore.getState().evaluateCircuit(), 0);
    } else if (data.tabs) {
      // Legacy auto-save format (has tabs but no formatVersion)
      const tabCircuits = new Map<string, TabCircuitData>();
      if (data.tabCircuits) {
        for (const [k, v] of Object.entries(data.tabCircuits)) {
          tabCircuits.set(k, v as TabCircuitData);
        }
      }
      const tabs = (data.tabs || []).map((t: { id: string; title?: string; name?: string; buildMode?: BuildMode }) => ({
        id: t.id,
        title: t.title || t.name || 'Circuit',
        buildMode: t.buildMode || 'CC',
        activeTask: 'arithmetic' as ActiveTask,
      }));
      useStore.setState({
        workbookOpen: false, // home-first: restore the sandbox but land on Home
        workbookTitle: 'Untitled Workbook',
        buildMode: data.buildMode || 'CC',
        repSystem: data.repSystem || 'binary',
        components: data.components || [],
        wires: data.wires || [],
        textElements: data.textElements || [],
        comments: data.comments || [],
        boxes: data.boxes || [],
        tabs,
        activeTabId: data.activeTabId || tabs[0]?.id || defaultTabId,
        ...(tabCircuits.size > 0 ? { tabCircuits } : {}),
      });
      setTimeout(() => useStore.getState().evaluateCircuit(), 0);
    }
  } catch {
    // Corrupted data — ignore, stay on welcome screen
  }
}

loadAutoSave();
