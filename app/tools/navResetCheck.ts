// Headless regression check: every canvas swap must flush EVERY mode's
// transient sim state. The sim slices (SC history/sequences, FSM run state,
// TM tape/history, turbot pose, the I/O table) are shared app-wide — they are
// NOT part of questionCircuits or tabCircuits — so anything left in them
// after navigating shows up against the next canvas's circuit (e.g. question
// 1's typed SC input row, OUT string, and full timeline rendered on question
// 2, or a sandbox tab's run rendered on the next tab).
//
//   cd app && npx tsx tools/navResetCheck.ts
//
// Drives the real Zustand store through the assignment navigation entry
// points (loadAssignment, openAssignment, switchQuestion) and the sandbox
// canvas swaps (enterSandbox, addTab, switchTab, removeTab, newWorkbook,
// importWorkbook) with real runs on the sample SC / FSM / TM circuits,
// asserting `resetAllSimState` leaves every slice fresh each time — and that
// removing a background tab (no canvas swap) leaves the live run alone.

// The store registers window/document listeners and reads localStorage at
// import time, so install minimal shims BEFORE dynamically importing it.
const noop = () => {};
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};
(globalThis as unknown as Record<string, unknown>).window = {
  setInterval: setInterval.bind(globalThis),
  clearInterval: clearInterval.bind(globalThis),
  addEventListener: noop,
  removeEventListener: noop,
};
(globalThis as unknown as Record<string, unknown>).document = {
  addEventListener: noop,
  removeEventListener: noop,
  visibilityState: 'visible',
};

const { useStore, selectTurbotArena } = await import('../src/store');
const { buildSampleAssignment, scCorrect, fsmCorrect, tmCorrect, turbotCorrect, SAMPLE_ASSIGNMENT_ID } =
  await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

/** Let scGlobalReset's deferred evaluateCircuit fire before asserting. */
const flushTimers = () => new Promise((r) => setTimeout(r, 10));

function checkAllSimFresh(label: string) {
  const s = useStore.getState();
  check(`${label}: SC slice fresh`,
    s.scTimeStep === 1 && s.scHistory.length === 0 && s.scInputSequence.length === 0 &&
    s.scGlobalSequences.length === 0 && !s.scRunning);
  check(`${label}: I/O table empty`, s.tableRows.length === 0);
  check(`${label}: FSM slice fresh`,
    s.fsmCurrentStateId === null && s.fsmInputSequence.length === 0 && s.fsmTimeStep === 1 &&
    s.fsmHistory.length === 0 && !s.fsmRunning && !s.fsmHalted);
  check(`${label}: TM slice fresh`,
    Object.keys(s.tmTape.cells).length === 0 && s.tmTape.head === 0 &&
    Object.keys(s.tmInitialTape.cells).length === 0 && s.tmCurrentStateId === null &&
    s.tmTimeStep === 1 && s.tmHistory.length === 0 && !s.tmRunning && !s.tmHalted);
  check(`${label}: turbot slice fresh`,
    s.turbotHistory.length === 0 && !s.turbotRunning && !s.turbotHalted &&
    s.turbotStopReason === null);
}

// Junk that only navigation (not the actions used to build real runs above)
// would have planted — used to prove the loadAssignment/openAssignment paths
// also flush.
function plantSimJunk() {
  useStore.setState({
    scTimeStep: 7,
    scHistory: [{ t: 1, inputBits: [1], outputBits: [0], memValues: [0] }],
    scInputSequence: [[1, 0]],
    scGlobalSequences: [{ inputStr: '10', outputStr: '01' }],
    tableRows: [{ inputBits: [1], outputBits: [0] }],
    fsmCurrentStateId: 'ghost',
    fsmInputSequence: [1, 0],
    fsmTimeStep: 3,
    fsmHistory: [{ t: 1, stateLabel: 'S', input: 1, output: 0, nextStateLabel: 'S' }],
    fsmHalted: true,
    tmTape: { cells: { 0: '1' }, head: 2 },
    tmInitialTape: { cells: { 0: '1' }, head: 2 },
    tmCurrentStateId: 'ghost',
    tmTimeStep: 4,
    tmHistory: [{ t: 1, stateLabel: 'S', read: '1', action: '1R', headBefore: 0, nextStateLabel: 'S' }],
    tmHalted: true,
    turbotHistory: [{ t: 1, kind: 'external', input: 'E', action: '↑', x: 0, y: 0, facing: 'N' }],
    turbotHalted: true,
    turbotStopReason: 'motor',
  });
}

const assignment = buildSampleAssignment();
const store = useStore.getState();

// ── loadAssignment lands fresh ──────────────────────────────────
console.log('[loadAssignment]');
store.loadAssignment(assignment);
check('opens at question index 0', useStore.getState().currentQuestionIndex === 0);
checkAllSimFresh('after load');

// ── SC: run on Q2, switch away, nothing follows ─────────────────
console.log('[SC leak across switchQuestion]');
useStore.getState().switchQuestion(1); // Q2 (SC)
useStore.setState({ components: scCorrect().components, wires: scCorrect().wires });
useStore.getState().setScGlobalSequenceInput(0, '0110');
useStore.getState().loadScGlobalSequence(0);
for (let i = 0; i < 3; i++) useStore.getState().scStep();
{
  const s = useStore.getState();
  check('SC run recorded history', s.scHistory.length === 3 && s.scTimeStep === 4);
  check('SC global row holds typed input + OUT string',
    s.scGlobalSequences[0]?.inputStr === '0110' && s.scGlobalSequences[0]?.outputStr === '100');
  check('SC run populated the I/O table', s.tableRows.length > 0);
  const mem = s.components.find((c) => c.type === 'MEM');
  check('MEM holds a mid-run value before switching', mem?.storedValue === 1);
}
useStore.getState().switchQuestion(2); // Q3 (FSM)
checkAllSimFresh('after SC→FSM switch');
await flushTimers();
check('deferred evaluate adds no ghost I/O row', useStore.getState().tableRows.length === 0);

// ── FSM: run on Q3, switch away ─────────────────────────────────
console.log('[FSM leak across switchQuestion]');
useStore.setState({ components: fsmCorrect().components, wires: fsmCorrect().wires });
useStore.getState().setFsmInputSequence([1, 0, 1]);
for (let i = 0; i < 3; i++) useStore.getState().fsmStep();
{
  const s = useStore.getState();
  check('FSM run recorded history',
    s.fsmHistory.length === 3 && s.fsmTimeStep === 4 && s.fsmCurrentStateId !== null);
}
useStore.getState().switchQuestion(3); // Q4 (TM)
checkAllSimFresh('after FSM→TM switch');

// ── TM: edit tape + step on Q4, switch away ─────────────────────
console.log('[TM leak across switchQuestion]');
useStore.setState({ components: tmCorrect().components, wires: tmCorrect().wires });
useStore.getState().setTmCell(0); // one stroke on the tape
for (let i = 0; i < 2; i++) useStore.getState().tmStep();
{
  const s = useStore.getState();
  check('TM run wrote tape + history',
    Object.keys(s.tmTape.cells).length > 0 && s.tmHistory.length === 2 && s.tmTimeStep === 3);
}
useStore.getState().switchQuestion(1); // back to Q2 (SC)
checkAllSimFresh('after TM→SC switch');
await flushTimers();
{
  // The restored SC canvas was saved mid-run (MEM = 1, inputs set); entry must
  // hand back a machine at t=1: memory zeroed, input values cleared.
  const s = useStore.getState();
  const mem = s.components.find((c) => c.type === 'MEM');
  const input = s.components.find((c) => c.type === 'INPUT');
  check('re-entered SC question: MEM re-zeroed', mem?.storedValue === 0);
  check('re-entered SC question: input values cleared', input?.value == null);
  check('re-entered SC question: circuit itself preserved',
    s.components.length === 3 && s.wires.length === 2);
}

// ── loadAssignment flushes planted junk ─────────────────────────
console.log('[loadAssignment flushes junk]');
plantSimJunk();
useStore.getState().loadAssignment(buildSampleAssignment());
checkAllSimFresh('after re-load');

// ── openAssignment flushes planted junk ─────────────────────────
console.log('[openAssignment flushes junk]');
localAssignmentStore.save(assignment);
useStore.getState().closeAssignment();
plantSimJunk();
check('openAssignment succeeds', useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID) === true);
checkAllSimFresh('after open');

// ═════ Sandbox tabs share the same fresh-machine contract ═══════

/** A real SC run on the live canvas: scCorrect circuit, '0110' in, 3 steps. */
function runScOnLiveCanvas() {
  useStore.setState({ components: scCorrect().components, wires: scCorrect().wires });
  useStore.getState().setScGlobalSequenceInput(0, '0110');
  useStore.getState().loadScGlobalSequence(0);
  for (let i = 0; i < 3; i++) useStore.getState().scStep();
}

// ── enterSandbox (leaving the assignment) lands fresh ───────────
console.log('[enterSandbox flushes assignment sim state]');
plantSimJunk();
useStore.getState().enterSandbox();
check('sandbox is open without an assignment',
  useStore.getState().assignment === null && useStore.getState().workbookOpen);
checkAllSimFresh('after enterSandbox');

// ── SC run on tab 1, addTab: the new blank tab starts fresh ─────
console.log('[SC leak across addTab]');
const tab1Id = useStore.getState().activeTabId;
runScOnLiveCanvas();
{
  const s = useStore.getState();
  check('sandbox SC run recorded history', s.scHistory.length === 3 && s.scTimeStep === 4);
  const mem = s.components.find((c) => c.type === 'MEM');
  check('sandbox MEM holds a mid-run value before adding a tab', mem?.storedValue === 1);
}
useStore.getState().addTab('Scratch 2', 'SC', 'arithmetic');
check('addTab switched to the new tab', useStore.getState().activeTabId !== tab1Id);
check('new tab starts with an empty canvas', useStore.getState().components.length === 0);
checkAllSimFresh('after addTab');
await flushTimers();
check('deferred evaluate adds no ghost I/O row on the new tab',
  useStore.getState().tableRows.length === 0);

// ── switchTab back: fresh machine, circuit preserved ────────────
console.log('[switchTab back to the run tab]');
plantSimJunk();
useStore.getState().switchTab(tab1Id);
checkAllSimFresh('after switchTab');
{
  const s = useStore.getState();
  const mem = s.components.find((c) => c.type === 'MEM');
  const input = s.components.find((c) => c.type === 'INPUT');
  check('re-entered tab: MEM re-zeroed', mem?.storedValue === 0);
  check('re-entered tab: input values cleared', input?.value == null);
  check('re-entered tab: circuit itself preserved',
    s.components.length === 3 && s.wires.length === 2);
}

// ── removeTab (active): the surviving tab starts fresh ──────────
console.log('[removeTab active-tab branch]');
runScOnLiveCanvas();
check('run recorded before removing the active tab', useStore.getState().scHistory.length === 3);
useStore.getState().removeTab(tab1Id);
check('removal switched to the surviving tab', useStore.getState().activeTabId !== tab1Id);
checkAllSimFresh('after removing the active tab');

// ── removeTab (background): the live run is left alone ──────────
console.log('[removeTab background-tab branch preserves the live run]');
const survivorId = useStore.getState().activeTabId;
useStore.getState().addTab('Scratch 3', 'SC', 'arithmetic');
runScOnLiveCanvas();
useStore.getState().removeTab(survivorId); // a tab we are NOT looking at
{
  const s = useStore.getState();
  check('background removal keeps the tab list right',
    s.tabs.length === 1 && s.tabs[0].title === 'Scratch 3');
  const mem = s.components.find((c) => c.type === 'MEM');
  check('background removal does not reset the in-progress run',
    s.scHistory.length === 3 && s.scTimeStep === 4 && mem?.storedValue === 1);
}

// ── newWorkbook flushes planted junk ────────────────────────────
console.log('[newWorkbook flushes junk]');
plantSimJunk();
useStore.getState().newWorkbook();
checkAllSimFresh('after newWorkbook');

// ── importWorkbook flushes planted junk ─────────────────────────
console.log('[importWorkbook flushes junk]');
plantSimJunk();
useStore.getState().importWorkbook(JSON.stringify({
  formatVersion: 2,
  metadata: { title: 'Imported' },
  activeWorksheetId: 'ws-1',
  worksheets: [{
    id: 'ws-1',
    title: 'Sheet 1',
    buildMode: 'SC',
    activeTask: 'arithmetic',
    circuit: { components: [], wires: [] },
    textElements: [],
    comments: [],
    boxes: [],
  }],
}));
check('import landed on the imported worksheet', useStore.getState().activeTabId === 'ws-1');
checkAllSimFresh('after importWorkbook');

// ── Sandbox turbot tab: run, switch away, switch back ───────────
// The turbot tab is the sandbox analog of a turbot question: the tab record
// carries innerMode + its own arena, read through the same selectors the
// question path uses, and tab switches hold the fresh-machine contract.
console.log('[sandbox turbot tab]');
const baseTabId = useStore.getState().activeTabId;
useStore.getState().addTab('Turbot 1', 'turbot', 'turbot', 'CC');
const turbotTabId = useStore.getState().activeTabId;
{
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === turbotTabId);
  check('turbot tab carries buildMode/innerMode', tab?.buildMode === 'turbot' && tab?.innerMode === 'CC');
  check('turbot tab was seeded with the bordered sandbox arena',
    tab?.arena?.width === 10 && tab?.arena?.height === 8 &&
    tab?.arena?.cells[0][0] === 'block' && tab?.arena?.cells.some((row) => row.includes('goal')) === true);
  check('selectTurbotArena reads the tab arena in the sandbox',
    selectTurbotArena(s) === tab?.arena);
  check('turbot pose starts at the tab arena start',
    s.turbotState.x === tab?.arena?.start.x && s.turbotState.y === tab?.arena?.start.y &&
    s.turbotState.facing === tab?.arena?.start.facing);
  checkAllSimFresh('fresh turbot tab');
}
// Drive the sample walk-until-blocked CC brain a few cycles in the tab arena.
useStore.setState({ components: turbotCorrect().components, wires: turbotCorrect().wires });
for (let i = 0; i < 3; i++) useStore.getState().turbotStep();
{
  const s = useStore.getState();
  const start = selectTurbotArena(s).start;
  check('turbot run recorded history', s.turbotHistory.length === 3);
  check('turbot moved off the start', s.turbotState.x !== start.x || s.turbotState.y !== start.y);
}
useStore.getState().switchTab(baseTabId);
checkAllSimFresh('after leaving the turbot tab');
useStore.getState().switchTab(turbotTabId);
checkAllSimFresh('after re-entering the turbot tab');
{
  const s = useStore.getState();
  const start = selectTurbotArena(s).start;
  check('re-entered turbot tab: pose back at the arena start',
    s.turbotState.x === start.x && s.turbotState.y === start.y);
  check('re-entered turbot tab: brain circuit preserved',
    s.components.length === 4 && s.wires.length === 3);
}

// ── removeTab (active turbot tab): survivor's mode comes back ───
// Removing the ACTIVE tab is a canvas swap; the surviving tab's buildMode
// must swap in with its circuit (previously buildMode leaked from the removed
// tab, leaving e.g. an SC sheet rendered as a turbot workspace).
console.log('[removeTab active turbot tab restores the survivor mode]');
useStore.getState().addTab('Turbot 2', 'turbot', 'turbot', 'FSM');
check('second turbot tab is active', useStore.getState().buildMode === 'turbot');
useStore.getState().removeTab(useStore.getState().activeTabId);
{
  const s = useStore.getState();
  const survivor = s.tabs.find((t) => t.id === s.activeTabId);
  check('removal landed on the first surviving tab', survivor?.id === s.tabs[0].id);
  check('survivor buildMode swapped in with its canvas', s.buildMode === survivor?.buildMode);
  checkAllSimFresh('after removing the active turbot tab');
}

await flushTimers();
console.log(`\nnavResetCheck: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
