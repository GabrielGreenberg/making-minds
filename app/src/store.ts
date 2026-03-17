import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  BuildMode,
  RepSystem,
  DisplayMode,
  Scope,
  CircuitComponent,
  Wire,
  ComponentType,
  HomeworkData,
  TextElement,
  CommentElement,
  BoxDefinition,
  ProblemSetData,
  WireManualSegment,
} from './types';
import {
  getPortsForType,
  GRID_SIZE,
} from './types';

interface HistoryEntry {
  components: CircuitComponent[];
  wires: Wire[];
  textElements: TextElement[];
  comments: CommentElement[];
  boxes: BoxDefinition[];
}

interface AppState {
  // Build mode
  buildMode: BuildMode;
  setBuildMode: (mode: BuildMode) => void;

  // Turbo toggle
  turboEnabled: boolean;
  setTurboEnabled: (v: boolean) => void;

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

  // Component operations
  addComponent: (type: ComponentType, x: number, y: number) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  moveComponentRaw: (id: string, x: number, y: number) => void;
  snapComponentToGrid: (id: string) => void;
  removeComponent: (id: string) => void;
  setInputValue: (id: string, value: number) => void;

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

  // Homework (legacy)
  homework: HomeworkData | null;
  currentProblemIndex: number;
  problemCircuits: Map<number, { components: CircuitComponent[]; wires: Wire[] }>;
  loadHomework: (hw: HomeworkData) => void;
  switchProblem: (index: number) => void;

  // Problem Set Mode
  problemSet: ProblemSetData | null;
  currentProblemPageIndex: number;
  problemPageCircuits: Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>;
  loadProblemSet: (ps: ProblemSetData) => void;
  switchProblemPage: (index: number) => void;
  closeProblemSet: () => void;

  // Save/Load
  exportProject: () => string;
  importProject: (json: string) => void;

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
  placeBoxInstance: (boxId: string, x: number, y: number) => void; // place a copy of a box as a BOXED component

  // Global box library — confirmed boxes available across all tabs
  confirmedBoxLibrary: {
    id: string;
    name: string;
    inputPortIds: string[];
    outputPortIds: string[];
    internalComponents: CircuitComponent[];
    internalWires: Wire[];
  }[];

  // Delete selected
  deleteSelected: () => void;

  // Copy/paste
  clipboard: { components: CircuitComponent[]; wires: Wire[] } | null;
  copySelected: () => void;
  paste: () => void;

  // Tabs
  tabs: { id: string; title: string; buildMode: BuildMode }[];
  activeTabId: string;
  addTab: (title: string, buildMode: BuildMode) => void;
  switchTab: (id: string) => void;
  removeTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  tabCircuits: Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>;

  // Batch move (for efficient multi-component drag)
  moveComponentsBatch: (moves: Map<string, { x: number; y: number }>) => void;
  snapComponentsToGrid: (ids: string[]) => void;

  // Table rows (step-by-step execution model)
  tableRows: { inputBits: number[]; outputBits: number[] }[];
  addTableRow: () => void;
  clearTableRows: () => void;

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
}

function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

// Topological sort for circuit evaluation
function topologicalSort(
  components: CircuitComponent[],
  wires: Wire[]
): CircuitComponent[] {
  const compMap = new Map(components.map((c) => [c.id, c]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize all components
  for (const c of components) {
    inDegree.set(c.id, 0);
    adjList.set(c.id, []);
  }

  // Build graph from wires
  for (const w of wires) {
    const targetComp = compMap.get(w.targetComponentId);
    const sourceComp = compMap.get(w.sourceComponentId);
    if (sourceComp && targetComp) {
      inDegree.set(
        w.targetComponentId,
        (inDegree.get(w.targetComponentId) || 0) + 1
      );
      const list = adjList.get(w.sourceComponentId)!;
      list.push(w.targetComponentId);
    }
  }

  // BFS from nodes with in-degree 0 (INPUTs will naturally have 0)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: CircuitComponent[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const comp = compMap.get(id);
    if (comp) sorted.push(comp);
    for (const neighbor of adjList.get(id) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

function evaluateGate(type: ComponentType, inputs: number[], comp?: CircuitComponent): number[] {
  switch (type) {
    case 'NOT':
      return [inputs[0] === 0 ? 1 : 0];
    case 'AND':
      return [inputs[0] === 1 && inputs[1] === 1 ? 1 : 0];
    case 'OR':
      return [inputs[0] === 1 || inputs[1] === 1 ? 1 : 0];
    case 'XOR':
      return [inputs[0] !== inputs[1] ? 1 : 0];
    case 'HA': {
      const sum = inputs[0] !== inputs[1] ? 1 : 0;
      const carry = inputs[0] === 1 && inputs[1] === 1 ? 1 : 0;
      return [sum, carry];
    }
    case 'INPUT':
      return [inputs[0] ?? 0];
    case 'OUTPUT':
      return [inputs[0] ?? 0];
    case 'BOXED':
      return evaluateBoxedCircuit(comp, inputs);
    default:
      return [0];
  }
}

/** Simulate the internal circuit of a BOXED component */
function evaluateBoxedCircuit(comp: CircuitComponent | undefined, externalInputs: number[]): number[] {
  if (!comp?.internalCircuit) return externalInputs.map(() => 0);
  const { components: intComps, wires: intWires } = comp.internalCircuit;
  if (intComps.length === 0) return externalInputs.map(() => 0);

  // Set INPUT component values from external inputs
  const inputComps = intComps
    .filter((c) => c.type === 'INPUT')
    .sort((a, b) => {
      const na = parseInt(a.label.replace('IN', '')) || 0;
      const nb = parseInt(b.label.replace('IN', '')) || 0;
      return na - nb;
    });
  const preppedComps = intComps.map((c) => {
    const idx = inputComps.indexOf(c);
    if (idx >= 0) {
      return { ...c, value: externalInputs[idx] ?? 0 };
    }
    return { ...c };
  });

  // Topologically sort and evaluate the internal circuit
  const sorted = topologicalSort(preppedComps, intWires);
  const portValues = new Map<string, number>();

  for (const ic of sorted) {
    if (ic.type === 'INPUT') {
      portValues.set(`${ic.id}:out`, ic.value ?? 0);
      continue;
    }

    const inputPorts = ic.ports.filter((p) => p.side === 'left');
    const inputVals: number[] = [];
    for (const port of inputPorts) {
      const wire = intWires.find(
        (w) => w.targetComponentId === ic.id && w.targetPortId === port.id
      );
      if (wire) {
        inputVals.push(portValues.get(`${wire.sourceComponentId}:${wire.sourcePortId}`) ?? 0);
      } else {
        inputVals.push(0);
      }
    }

    if (ic.type === 'OUTPUT') {
      portValues.set(`${ic.id}:in`, inputVals[0] ?? 0);
    } else {
      // Recursively evaluate nested BOXED components
      const outputs = evaluateGate(ic.type, inputVals, ic);
      const outputPorts = ic.ports.filter((p) => p.side === 'right');
      for (let i = 0; i < outputPorts.length; i++) {
        portValues.set(`${ic.id}:${outputPorts[i].id}`, outputs[i] ?? 0);
      }
    }
  }

  // Collect outputs from OUTPUT components, sorted by label
  const outputComps = preppedComps
    .filter((c) => c.type === 'OUTPUT')
    .sort((a, b) => {
      const na = parseInt(a.label.replace('OUT', '')) || 0;
      const nb = parseInt(b.label.replace('OUT', '')) || 0;
      return na - nb;
    });

  return outputComps.map((oc) => portValues.get(`${oc.id}:in`) ?? 0);
}

const defaultTabId = 'tab-1';

export const useStore = create<AppState>()((set, get) => ({
  buildMode: 'CC',
  setBuildMode: (mode) => set({ buildMode: mode }),

  turboEnabled: false,
  setTurboEnabled: (v) => set({ turboEnabled: v }),

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

  addComponent: (type, x, y) => {
    const state = get();
    state.pushHistory();
    const sx = snapToGrid(x);
    const sy = snapToGrid(y);
    let label = '';
    let nextInputNum = state.nextInputNum;
    let nextOutputNum = state.nextOutputNum;

    if (type === 'INPUT') {
      label = `IN${nextInputNum}`;
      nextInputNum++;
    } else if (type === 'OUTPUT') {
      label = `OUT${nextOutputNum}`;
      nextOutputNum++;
    } else if (type === 'MEM') {
      label = 'M';
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
      value: 0,
      inputValues: type === 'INPUT' ? [0] : undefined,
      storedValue: type === 'MEM' ? 0 : undefined,
    };

    set({
      components: [...state.components, comp],
      nextInputNum,
      nextOutputNum,
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
    set({
      components: state.components.filter((c) => c.id !== id),
      wires: state.wires.filter(
        (w) => w.sourceComponentId !== id && w.targetComponentId !== id
      ),
      // Also remove comments targeting this component
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
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  addWire: (sourceCompId, sourcePortId, targetCompId, targetPortId) => {
    const state = get();
    // Check: no merging - target port must not already have an incoming wire
    const existing = state.wires.find(
      (w) =>
        w.targetComponentId === targetCompId &&
        w.targetPortId === targetPortId
    );
    if (existing) {
      console.warn('Merge violation: input port already has a connection');
      return;
    }
    state.pushHistory();
    const wire: Wire = {
      id: uuid(),
      sourceComponentId: sourceCompId,
      sourcePortId: sourcePortId,
      targetComponentId: targetCompId,
      targetPortId: targetPortId,
      value: 0,
    };
    set({ wires: [...state.wires, wire] });
    setTimeout(() => get().evaluateCircuit(), 0);
  },

  removeWire: (id) => {
    const state = get();
    state.pushHistory();
    set({
      wires: state.wires.filter((w) => w.id !== id),
      // Also remove comments targeting this wire
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

    const sorted = topologicalSort(components, wires);
    const portValues = new Map<string, number>(); // "compId:portId" -> value
    const newWireValues = new Map<string, number>();

    // Set input values
    for (const comp of sorted) {
      if (comp.type === 'INPUT') {
        const val = comp.value ?? 0;
        portValues.set(`${comp.id}:out`, val);
      }
    }

    // Propagate through sorted components
    for (const comp of sorted) {
      if (comp.type === 'INPUT') continue;

      // Gather inputs from wires
      const inputPorts = comp.ports.filter((p) => p.side === 'left');
      const inputVals: number[] = [];
      for (const port of inputPorts) {
        const incomingWire = wires.find(
          (w) => w.targetComponentId === comp.id && w.targetPortId === port.id
        );
        if (incomingWire) {
          const srcVal =
            portValues.get(
              `${incomingWire.sourceComponentId}:${incomingWire.sourcePortId}`
            ) ?? 0;
          inputVals.push(srcVal);
          newWireValues.set(incomingWire.id, srcVal);
        } else {
          inputVals.push(0);
        }
      }

      // Evaluate
      if (comp.type === 'OUTPUT') {
        portValues.set(`${comp.id}:in`, inputVals[0] ?? 0);
      } else {
        const outputs = evaluateGate(comp.type, inputVals, comp);
        const outputPorts = comp.ports.filter((p) => p.side === 'right');
        for (let i = 0; i < outputPorts.length; i++) {
          portValues.set(`${comp.id}:${outputPorts[i].id}`, outputs[i] ?? 0);
        }
      }
    }

    // Update components with computed values
    const updatedComponents = components.map((c) => {
      if (c.type === 'OUTPUT') {
        const val = portValues.get(`${c.id}:in`) ?? 0;
        return { ...c, value: val };
      }
      if (c.type !== 'INPUT') {
        const outputPort = c.ports.find((p) => p.side === 'right');
        if (outputPort) {
          const val = portValues.get(`${c.id}:${outputPort.id}`) ?? 0;
          return { ...c, value: val };
        }
      }
      return c;
    });

    // Also update wire values for wires coming from INPUTs
    for (const w of wires) {
      if (!newWireValues.has(w.id)) {
        const srcVal =
          portValues.get(`${w.sourceComponentId}:${w.sourcePortId}`) ?? 0;
        newWireValues.set(w.id, srcVal);
      }
    }

    set({
      components: updatedComponents,
      wires: wires.map((w) => ({
        ...w,
        value: newWireValues.get(w.id) ?? 0,
      })),
      wireValues: newWireValues,
    });
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

  // Homework (legacy)
  homework: null,
  currentProblemIndex: 0,
  problemCircuits: new Map(),
  loadHomework: (hw) => {
    const problemCircuits = new Map<
      number,
      { components: CircuitComponent[]; wires: Wire[] }
    >();
    hw.problems.forEach((_, i) => {
      problemCircuits.set(i, { components: [], wires: [] });
    });
    set({
      homework: hw,
      currentProblemIndex: 0,
      problemCircuits,
      components: [],
      wires: [],
      nextInputNum: 1,
      nextOutputNum: 1,
    });
  },
  switchProblem: (index) => {
    const state = get();
    // Save current problem state
    const updatedMap = new Map(state.problemCircuits);
    updatedMap.set(state.currentProblemIndex, {
      components: state.components,
      wires: state.wires,
    });

    // Load new problem state
    const saved = updatedMap.get(index) || { components: [], wires: [] };
    set({
      currentProblemIndex: index,
      problemCircuits: updatedMap,
      components: saved.components,
      wires: saved.wires,
    });
  },

  // Problem Set Mode
  problemSet: null,
  currentProblemPageIndex: 0,
  problemPageCircuits: new Map(),
  loadProblemSet: (ps) => {
    const circuits = new Map<string, { components: CircuitComponent[]; wires: Wire[]; textElements: TextElement[]; comments: CommentElement[]; boxes: BoxDefinition[] }>();
    for (const page of ps.pages) {
      circuits.set(page.id, { components: [], wires: [], textElements: [], comments: [], boxes: [] });
    }
    set({
      problemSet: ps,
      currentProblemPageIndex: 0,
      problemPageCircuits: circuits,
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      nextInputNum: 1,
      nextOutputNum: 1,
      buildMode: ps.pages[0]?.buildMode || 'CC',
    });
  },
  switchProblemPage: (index) => {
    const state = get();
    const ps = state.problemSet;
    if (!ps) return;
    const currentPage = ps.pages[state.currentProblemPageIndex];
    const nextPage = ps.pages[index];
    if (!currentPage || !nextPage) return;

    const updatedMap = new Map(state.problemPageCircuits);
    updatedMap.set(currentPage.id, {
      components: state.components,
      wires: state.wires,
      textElements: state.textElements,
      comments: state.comments,
      boxes: state.boxes,
    });

    const saved = updatedMap.get(nextPage.id) || { components: [], wires: [], textElements: [], comments: [], boxes: [] };
    set({
      currentProblemPageIndex: index,
      problemPageCircuits: updatedMap,
      components: saved.components,
      wires: saved.wires,
      textElements: saved.textElements,
      comments: saved.comments,
      boxes: saved.boxes,
      buildMode: nextPage.buildMode,
    });
  },
  closeProblemSet: () => {
    set({
      problemSet: null,
      currentProblemPageIndex: 0,
      problemPageCircuits: new Map(),
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      nextInputNum: 1,
      nextOutputNum: 1,
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
  importProject: (json) => {
    try {
      const data = JSON.parse(json);
      if (data.circuit) {
        set({
          components: data.circuit.components || [],
          wires: data.circuit.wires || [],
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
      // Sync name changes to global confirmedBoxLibrary
      const updatedLibrary = updates.name
        ? state.confirmedBoxLibrary.map((b) =>
            b.id === id ? { ...b, name: updates.name! } : b
          )
        : state.confirmedBoxLibrary;
      return {
        boxes: updatedBoxes,
        boxDrawing: { ...state.boxDrawing, draftBox: newDraft },
        confirmedBoxLibrary: updatedLibrary,
      };
    });
  },
  removeBox: (id) => {
    const state = get();
    state.pushHistory();
    set({ boxes: state.boxes.filter((b) => b.id !== id) });
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

    const insideIds = new Set(insideComps.map((c) => c.id));

    // Wires fully inside the box (both endpoints inside)
    const internalWires = state.wires.filter((w) =>
      insideIds.has(w.sourceComponentId) && insideIds.has(w.targetComponentId)
    );

    // ── Textbook Rule 1: No loops ──
    // Check for cycles among inside components using internal wires
    {
      const adj = new Map<string, string[]>();
      for (const c of insideComps) adj.set(c.id, []);
      for (const w of internalWires) {
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

  // Delete
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

    set({
      components: state.components.filter((c) => !idsToRemove.has(c.id)),
      wires: state.wires.filter((w) => !wireIdsToRemove.has(w.id) && !idsToRemove.has(w.id)),
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

    const idMap = new Map<string, string>();
    const newComps = state.clipboard.components.map((c) => {
      const newId = uuid();
      idMap.set(c.id, newId);
      return { ...c, id: newId, x: c.x + 40, y: c.y + 40 };
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

  // Tabs
  tabs: [{ id: defaultTabId, title: 'Circuit 1', buildMode: 'CC' as BuildMode }],
  activeTabId: defaultTabId,
  tabCircuits: new Map(),

  addTab: (title, buildMode) => {
    const state = get();
    const newId = uuid();
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
      tabs: [...state.tabs, { id: newId, title, buildMode }],
      activeTabId: newId,
      tabCircuits: updatedTabCircuits,
      components: [],
      wires: [],
      textElements: [],
      comments: [],
      boxes: [],
      buildMode,
      nextInputNum: 1,
      nextOutputNum: 1,
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
}));

// Expose for debugging
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__store = useStore;
}
