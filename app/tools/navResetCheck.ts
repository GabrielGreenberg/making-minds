// Headless regression check for the store's two reset laws.
//
// Law 1 — every canvas swap must flush EVERY mode's transient sim state AND
// the undo/redo history. The sim slices (SC history/sequences, FSM run state,
// TM tape/history, turbot pose, the I/O table) and the history stacks are
// shared app-wide — they are NOT part of questionCircuits or tabCircuits — so
// anything left in them after navigating shows up against the next canvas
// (e.g. question 1's typed SC input row rendered on question 2, or an undo
// writing question 1's snapshot over question 2).
//
// Law 2 — every principal change (sign-in, sign-out, a 401) resets the WHOLE
// editor store and loads that person's own sandbox (resetForPrincipal).
//
//   cd app && npx tsx tools/navResetCheck.ts
//
// Drives the real Zustand store through the assignment navigation entry
// points (loadAssignment, openAssignment, switchQuestion) and the sandbox
// canvas swaps (enterSandbox, addTab, switchTab, removeTab, newWorkbook,
// importWorkbook) with real runs on the sample SC / FSM / TM circuits,
// asserting `resetAllSimState` leaves every slice fresh and both history
// stacks empty each time — and that removing a background tab (no canvas
// swap) leaves the live run alone. Then [undo scope] (undo never crosses a
// canvas), [principal change] (A's work, clipboard and submissions never
// reach B; stale async resolves apply nothing), [sandbox per person] (one
// sandbox per person per browser; the visitor's moves only to someone with no
// sandbox of their own; the legacy key is adopted as the visitor's), [principal
// change mid-save] (a save in flight swallows none of the leaving person's
// edits) and [auth provider wiring] (both providers report every change).
// Task 034 adds the provenance slice: a principal change drops the mint keys
// and the live editing record (the next person mints under their own key only
// once their open registers it), and [provenance across canvas swaps] — every
// swap carries each question's record through the ONE fold / load helper.

// The store registers window/document listeners at import time (and must NOT
// read the sandbox then — [no load at import]), so install minimal shims
// BEFORE dynamically importing it.
const noop = () => {};
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  // Enumeration, so the local AssignmentStore can list (hydrateSubmissions).
  get length() { return backing.size; },
  key: (i: number) => [...backing.keys()][i] ?? null,
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

// A visitor sandbox already on disk must stay there until the auth provider
// reports who is here — the store may not load it at import.
const VISITOR_KEY = 'making-minds-autosave:visitor';
backing.set(VISITOR_KEY, JSON.stringify({
  formatVersion: 2,
  tabs: [{ id: 'import-tab', title: 'Circuit 1', buildMode: 'CC', activeTask: 'arithmetic' }],
  activeTabId: 'import-tab',
  tabCircuits: { 'import-tab': { components: [{ id: 'import-sentinel', type: 'AND', x: 0, y: 0 }], wires: [], boxes: [] } },
}));

const { useStore, selectTurbotArena, selectAssignmentFrozen, selectQuestionLocked } = await import('../src/store');
const { buildSampleAssignment, scCorrect, fsmCorrect, tmCorrect, turbotCorrect, SAMPLE_ASSIGNMENT_ID } =
  await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');
const { backendMode, workbookStore } = await import('../src/storage/backend');
// The clipboard lives in the provenance seam, not in store state (task 033).
const { peekClipboard, stampText, currentProvenance } = await import('../src/provenance');
// …and the mint keys in the minting seam (task 034).
const { mintKeyFor, mintId, verifyId, deriveMintKey, DEV_MINT_SECRET } = await import('../src/provenance/ids');
/** Both of the seam's slots empty. */
const clipboardEmpty = () => peekClipboard().canvas === null && peekClipboard().text === null;

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
  // The armed palette tool survives repeated background clicks, so a canvas
  // swap must disarm it — otherwise a gate armed on one question drops a
  // component on the first click in the next one.
  check(`${label}: palette tool disarmed`, s.selectedTool === null);
  // Undo writes its snapshot into the CURRENT canvas, so history must not
  // survive a swap either.
  check(`${label}: undo/redo history empty`, s.undoStack.length === 0 && s.redoStack.length === 0);
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
    selectedTool: 'AND',
    undoStack: [{ components: [], wires: [], boxes: [], confirmedBoxes: [] }],
    redoStack: [{ components: [], wires: [], boxes: [], confirmedBoxes: [] }],
  });
}

const assignment = buildSampleAssignment();
const store = useStore.getState();

// ── backend mode: the Node harness must run against the Local stores ──
console.log('[backend mode]');
check('backendMode resolves to local under the Node harness', backendMode === 'local');

// ── the sandbox is NOT loaded at module import ──────────────────
console.log('[no load at import]');
check('a stored visitor sandbox is not in the store before anyone is reported',
  useStore.getState().tabCircuits.size === 0 && useStore.getState().components.length === 0);
backing.delete(VISITOR_KEY);

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
await localAssignmentStore.save(assignment);
// Assignments are unpublished until released, and a student cannot open one
// that isn't (store.openAssignment). The harness has no logged-in instructor,
// so publish it before driving the student-side navigation below.
await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);
useStore.getState().closeAssignment();
plantSimJunk();
check('openAssignment succeeds', (await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
checkAllSimFresh('after open');

// ── interleaved opens: the newest open wins ─────────────────────
// Open A and immediately open B without awaiting A. A's seam reads resolve
// after B's open has started, so A's resolve is stale and must apply nothing
// (the openAssignmentSeq guard) — B owns the final state.
console.log('[openAssignment interleaving: last open wins]');
const assignmentB = { ...buildSampleAssignment(), id: `${SAMPLE_ASSIGNMENT_ID}-b`, title: 'Sample B' };
await localAssignmentStore.save(assignmentB);
await localAssignmentStore.setVisible(assignmentB.id, true);
useStore.getState().closeAssignment();
const openA = useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
const openB = useStore.getState().openAssignment(assignmentB.id);
const [okA, okB] = await Promise.all([openA, openB]);
check('both interleaved opens resolve true (stale open is a silent no-op)', okA === true && okB === true);
check('the newest open owns the final state (B wins)',
  useStore.getState().assignment?.id === assignmentB.id && useStore.getState().workbookOpen);

// ── an unpublished assignment is not openable ───────────────────
// Hidden means hidden: a student cannot reach an unreleased assignment by URL
// either. (Remotely the server refuses; this is the local-mode rule.)
console.log('[openAssignment refuses an unpublished assignment]');
{
  const draft = { ...buildSampleAssignment(), id: `${SAMPLE_ASSIGNMENT_ID}-draft`, title: 'Draft' };
  await localAssignmentStore.save(draft);
  check('openAssignment resolves false for an unpublished assignment',
    (await useStore.getState().openAssignment(draft.id)) === false);
  check('…and nothing was opened', useStore.getState().assignment?.id !== draft.id);
  await localAssignmentStore.setVisible(draft.id, true);
  check('publishing it makes it openable',
    (await useStore.getState().openAssignment(draft.id)) === true);
  await localAssignmentStore.remove(draft.id);
}

// ── "mark as done" locks a question against edits (notes/todos.md #8) ──
console.log('[mark as done]');
{
  useStore.getState().closeAssignment();
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0); // Q1 (CC)
  const q0 = useStore.getState().assignment!.questions[0];
  const isDone = () => useStore.getState().questionCircuits.get(q0.id)?.done === true;

  check('a fresh question starts NOT done', !isDone());
  useStore.getState().toggleCurrentQuestionDone();
  check('toggleCurrentQuestionDone marks it done', isDone());

  const before = useStore.getState().components.length;
  useStore.getState().addComponent('AND', 100, 100);
  check('addComponent is refused while locked', useStore.getState().components.length === before);
  useStore.getState().paste();
  useStore.getState().clearWorkspace();
  check('clearWorkspace is refused while locked', useStore.getState().components.length === before);
  const openBefore = useStore.getState().openResponse;
  useStore.getState().setOpenResponse('sneaking in an edit');
  check('setOpenResponse is refused while locked', useStore.getState().openResponse === openBefore);

  useStore.getState().switchQuestion(1);
  useStore.getState().switchQuestion(0);
  check('done survives a round trip through switchQuestion', isDone());

  useStore.getState().goHome(); // flushes the immediate (non-debounced) save
  useStore.getState().closeAssignment();
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  check('done survives closeAssignment + a fresh openAssignment (persisted)', isDone());

  useStore.getState().toggleCurrentQuestionDone();
  check('toggling again unlocks it', !isDone());
  const afterUnlock = useStore.getState().components.length;
  useStore.getState().addComponent('AND', 100, 100);
  check('editing works again once unlocked', useStore.getState().components.length === afterUnlock + 1);
}

// ── frozen assignments show the SUBMISSION read-only, not diverged live
// work (notes/todos.md item 3) ──
console.log('[frozen assignment]');
{
  const FROZEN_ID = `${SAMPLE_ASSIGNMENT_ID}-frozen`;
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const frozenAsg = { ...buildSampleAssignment(), id: FROZEN_ID, title: 'Frozen Sample', dueDate: futureDate };
  await localAssignmentStore.save(frozenAsg);
  await localAssignmentStore.setVisible(FROZEN_ID, true);

  useStore.getState().closeAssignment();
  check('opens fine while due date is in the future', (await useStore.getState().openAssignment(FROZEN_ID)) === true);
  useStore.getState().switchQuestion(0); // Q1 (CC)
  check('not frozen: due date in the future, no submission yet', !selectAssignmentFrozen(useStore.getState()));

  useStore.getState().addComponent('AND', 100, 100);
  const submittedCount = useStore.getState().components.length;
  check('built a 1-component circuit to submit', submittedCount === 1);
  const rec = await useStore.getState().submitAssignment(FROZEN_ID, 'student@example.com');
  check('submit captured exactly that circuit',
    rec?.submission.answers.find((a) => a.questionId === frozenAsg.questions[0].id)?.circuit?.components.length === submittedCount);
  check('still not frozen: due date is still in the future', !selectAssignmentFrozen(useStore.getState()));

  // Keep working AFTER submitting (assignment isn't due yet) — this becomes
  // the "latest saved work" that the frozen view below must NOT show.
  useStore.getState().addComponent('OR', 200, 100);
  const divergedCount = useStore.getState().components.length;
  check('kept editing after submitting, before the deadline', divergedCount === submittedCount + 1);

  // The deadline arrives.
  useStore.setState({ assignment: { ...useStore.getState().assignment!, dueDate: pastDate } });
  check('now frozen: past due AND a submission exists', selectAssignmentFrozen(useStore.getState()));

  const beforeRefusedEdit = useStore.getState().components.length;
  useStore.getState().addComponent('NOT', 300, 100);
  check('edits are refused once frozen', useStore.getState().components.length === beforeRefusedEdit);
  useStore.getState().setOpenResponse('sneaking in an edit');
  check('setOpenResponse is refused once frozen', useStore.getState().openResponse === '');

  useStore.getState().switchQuestion(1);
  useStore.getState().switchQuestion(0);
  check('switching back shows the SUBMITTED circuit, not the diverged live work',
    useStore.getState().components.length === submittedCount);

  // A close + reopen re-fetches the assignment DEFINITION from storage, so
  // the persisted copy's dueDate must reflect the passed deadline too — the
  // earlier setState only simulated time passing for the in-memory session.
  await localAssignmentStore.save({ ...frozenAsg, dueDate: pastDate });
  useStore.getState().closeAssignment();
  await useStore.getState().openAssignment(FROZEN_ID);
  check('a fresh close + reopen also shows the frozen submission',
    useStore.getState().components.length === submittedCount);
  check('the frozen tag reads through the selector on a fresh open too',
    selectAssignmentFrozen(useStore.getState()));

  // A never-submitted, past-due assignment is NOT frozen — nothing to freeze
  // (late submissions stay accepted, per dueDates.ts's policy).
  const NEVER_SUBMITTED_ID = `${SAMPLE_ASSIGNMENT_ID}-never-submitted`;
  const overdueNoSubmission = { ...buildSampleAssignment(), id: NEVER_SUBMITTED_ID, dueDate: pastDate };
  await localAssignmentStore.save(overdueNoSubmission);
  await localAssignmentStore.setVisible(NEVER_SUBMITTED_ID, true);
  useStore.getState().closeAssignment();
  await useStore.getState().openAssignment(NEVER_SUBMITTED_ID);
  check('past due with no submission is NOT frozen (late submission stays possible)',
    !selectAssignmentFrozen(useStore.getState()));
  useStore.getState().addComponent('AND', 100, 100);
  check('…and editing still works', useStore.getState().components.length === 1);
}

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

// ═════ Undo/redo is canvas-scoped (reset law 1) ═════════════════

console.log('[undo scope]');
{
  // Q1 edit → Q2 → undo: Q2 is untouched and Q1 keeps its edit.
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0); // Q1 (CC)
  const [q1, q2] = useStore.getState().assignment!.questions;
  // [mark as done]'s last unlock never reached the seam (closeAssignment
  // drops the pending debounced save), so Q1 may come back locked.
  if (useStore.getState().questionCircuits.get(q1.id)?.done) useStore.getState().toggleCurrentQuestionDone();
  const q2Saved = JSON.stringify(useStore.getState().questionCircuits.get(q2.id)?.components ?? []);
  // Something on Q1 BEFORE the edit, so the snapshot a leaked undo would
  // write (Q1 before its last edit) visibly differs from Q2 — an empty Q1
  // over an empty Q2 would prove nothing.
  useStore.getState().addComponent('NOT', 10, 10);
  const before = new Set(useStore.getState().components.map((c) => c.id));
  useStore.getState().addComponent('AND', 40, 40);
  const added = useStore.getState().components.find((c) => !before.has(c.id));
  check('an edit on Q1 pushes history', added != null && useStore.getState().undoStack.length > 0);
  const q1Leak = JSON.stringify(useStore.getState().undoStack.at(-1)?.components);
  check('(a leaked undo would be visible: Q1 before its edit ≠ Q2)', q1Leak !== q2Saved);
  useStore.getState().switchQuestion(1);
  check('switchQuestion empties both history stacks',
    useStore.getState().undoStack.length === 0 && useStore.getState().redoStack.length === 0);
  useStore.getState().undo();
  check('undo on Q2 leaves Q2 unchanged', JSON.stringify(useStore.getState().components) === q2Saved);
  check('…and Q1 still holds its edit',
    useStore.getState().questionCircuits.get(q1.id)?.components.some((c) => c.id === added?.id) === true);
  const q2Count = useStore.getState().components.length;
  useStore.getState().addComponent('OR', 80, 80);
  useStore.getState().undo();
  check('undo still works within one canvas', useStore.getState().components.length === q2Count);

  // Sandbox edit → a question: the sandbox's history does not follow. As
  // above, the sheet holds something before the edit, so the leaked snapshot
  // could not coincide with the question's canvas.
  useStore.getState().enterSandbox();
  useStore.getState().addComponent('NOT', 10, 10);
  useStore.getState().addComponent('OR', 40, 40);
  check('a sandbox edit pushes history', useStore.getState().undoStack.length > 0);
  const sandboxLeak = JSON.stringify(useStore.getState().undoStack.at(-1)?.components);
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  // The seam's copy may have this question marked done (the unlock above
  // never reached it), and a locked question refuses undo outright — which
  // would pass this pin whatever the history held.
  {
    const s = useStore.getState();
    const landed = s.assignment!.questions[s.currentQuestionIndex];
    if (s.questionCircuits.get(landed.id)?.done) s.toggleCurrentQuestionDone();
  }
  check('(the question is unlocked, so undo is not refused outright)', !selectQuestionLocked(useStore.getState()));
  const qBefore = JSON.stringify(useStore.getState().components);
  check('(a leaked undo would be visible: the sandbox before its edit ≠ the question)', sandboxLeak !== qBefore);
  useStore.getState().undo();
  check('sandbox → question: undo is a no-op there', JSON.stringify(useStore.getState().components) === qBefore);

  // Leaving the editor clears history too (goHome resumes the same canvas,
  // but whichever canvas is entered next must start clean).
  useStore.getState().addComponent('AND', 120, 40);
  useStore.getState().goHome();
  check('goHome empties both history stacks',
    useStore.getState().undoStack.length === 0 && useStore.getState().redoStack.length === 0);
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID); // resume
  useStore.getState().addComponent('AND', 160, 40);
  useStore.getState().closeAssignment();
  check('closeAssignment empties both history stacks',
    useStore.getState().undoStack.length === 0 && useStore.getState().redoStack.length === 0);
}

// ═════ Principal change resets the whole editor store (reset law 2) ═══

const SANDBOX_PREFIX = 'making-minds-autosave';
const keyOf = (p: string | null) => `${SANDBOX_PREFIX}:${p ?? 'visitor'}`;
/** Component ids across every sheet of the sandbox blob stored under `key`. */
function storedSandboxIds(key: string): string[] {
  const raw = backing.get(key);
  if (!raw) return [];
  const data = JSON.parse(raw);
  return Object.values(data.tabCircuits ?? {}).flatMap(
    (c) => ((c as { components?: { id: string }[] }).components ?? []).map((x) => x.id));
}
/** Component ids across every sheet of the LIVE sandbox (live canvas folded in). */
function liveSandboxIds(): string[] {
  const s = useStore.getState();
  const sheets = new Map(s.tabCircuits);
  if (!s.assignment) sheets.set(s.activeTabId, { components: s.components, wires: s.wires, boxes: s.boxes, confirmedBoxes: s.confirmedBoxLibrary });
  return [...sheets.values()].flatMap((c) => c.components.map((x) => x.id));
}

console.log('[principal change]');
{
  const A = 'a@x.test';
  const B = 'b@x.test';
  useStore.getState().resetForPrincipal(A);
  check('A signs in: nothing open', useStore.getState().assignment === null && !useStore.getState().workbookOpen);
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0);
  if (useStore.getState().questionCircuits.get(useStore.getState().assignment!.questions[0].id)?.done) {
    useStore.getState().toggleCurrentQuestionDone();
  }
  const before = new Set(useStore.getState().components.map((c) => c.id));
  useStore.getState().addComponent('AND', 200, 200);
  const aGate = useStore.getState().components.find((c) => !before.has(c.id))!;
  const keyOf = (who: string) => deriveMintKey(DEV_MINT_SECRET, who, SAMPLE_ASSIGNMENT_ID);
  check("A's open registered A's mint key: A's gate binds to A",
    mintKeyFor(SAMPLE_ASSIGNMENT_ID) != null && verifyId(aGate.id, keyOf(A)));
  check('…and the edit started a live editing record', useStore.getState().questionTrace != null);
  useStore.setState({ selectedIds: [aGate.id] });
  useStore.getState().copySelected();
  // …and a sentence copied in an answer field (usePasteGuard's text slot).
  stampText("A's sentence", currentProvenance({ kind: 'assignment', assignmentId: SAMPLE_ASSIGNMENT_ID }));
  await useStore.getState().hydrateSubmissions();
  {
    const s = useStore.getState();
    check('A has a gate, a clipboard (both seam slots), history and a submissions map',
      aGate != null && peekClipboard().canvas != null && peekClipboard().text != null && s.undoStack.length > 0 && Object.keys(s.submissions).length > 0);
  }

  // Sign out exactly as SessionControls.signOut does: Home first, then the
  // provider reports the visitor.
  useStore.getState().goHome();
  useStore.getState().resetForPrincipal(null);
  {
    const s = useStore.getState();
    check('sign-out: no assignment in memory', s.assignment === null && s.questionCircuits.size === 0);
    check('sign-out: live canvas empty', s.components.length === 0 && s.wires.length === 0 && s.boxes.length === 0);
    check('sign-out: box library empty', s.confirmedBoxLibrary.length === 0);
    check('sign-out: clipboard empty (both seam slots)', clipboardEmpty());
    check('sign-out: selection empty', s.selectedIds.length === 0);
    check('sign-out: submissions map empty', Object.keys(s.submissions).length === 0);
    check('sign-out: back to the welcome state', !s.workbookOpen && s.autoSaveStatus === 'saved');
    check("sign-out: the mint keys are gone (they were A's)", mintKeyFor(SAMPLE_ASSIGNMENT_ID) === null);
    check('sign-out: no live editing record', s.questionTrace === null);
  }
  checkAllSimFresh('after sign-out');
  useStore.getState().resetForPrincipal(null);
  check('a repeat report of the same principal is a no-op', useStore.getState().assignment === null);

  // B's own stored workbook (the local seam is per-browser; it stands in for
  // the per-user remote store here): a sentinel gate on Q1.
  const asg = buildSampleAssignment();
  const sentinel = { ...aGate, id: 'b-sentinel' };
  await workbookStore.saveAssignmentState(SAMPLE_ASSIGNMENT_ID, {
    currentQuestionIndex: 0,
    questionCircuits: { [asg.questions[0].id]: { components: [sentinel], wires: [], boxes: [] } },
    boxLibrary: [],
  });
  useStore.getState().resetForPrincipal(B);
  {
    const early = mintId({ kind: 'assignment', assignmentId: SAMPLE_ASSIGNMENT_ID });
    check("before B's open, an assignment mint binds to nobody (never A's key)",
      !verifyId(early, keyOf(A)) && !verifyId(early, keyOf(B)));
  }
  check('B opens HW', (await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  {
    const seen = new Set(useStore.getState().components.map((c) => c.id));
    useStore.getState().addComponent('OR', 300, 300);
    const bGate = useStore.getState().components.find((c) => !seen.has(c.id))!;
    check("after B's open, B's ids bind to B's own key, not A's",
      verifyId(bGate.id, keyOf(B)) && !verifyId(bGate.id, keyOf(A)));
    useStore.getState().undo();
  }
  {
    const s = useStore.getState();
    check("B sees B's stored workbook", s.components.some((c) => c.id === 'b-sentinel'));
    check("…and none of A's work", !s.components.some((c) => c.id === aGate.id));
    check('B starts with an empty clipboard (both seam slots)', clipboardEmpty());
    useStore.getState().paste();
    check("pasting as B brings nothing of A's", useStore.getState().components.length === s.components.length);
  }

  // Async resolves that started under the previous principal apply nothing.
  useStore.getState().resetForPrincipal(A);
  const staleOpen = useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().resetForPrincipal(B);
  check('an open started before the change resolves as a no-op', (await staleOpen) === true);
  check('…and opens nothing for the next person', useStore.getState().assignment === null && !useStore.getState().workbookOpen);
  const staleHydrate = useStore.getState().hydrateSubmissions();
  useStore.getState().resetForPrincipal(A);
  await staleHydrate;
  check("a hydration started before the change writes nothing after it", Object.keys(useStore.getState().submissions).length === 0);
  const EPOCH_ID = `${SAMPLE_ASSIGNMENT_ID}-epoch`;
  await localAssignmentStore.save({ ...buildSampleAssignment(), id: EPOCH_ID, dueDate: new Date(Date.now() + 86_400_000).toISOString() });
  await localAssignmentStore.setVisible(EPOCH_ID, true);
  const staleSubmit = useStore.getState().submitAssignment(EPOCH_ID, A);
  useStore.getState().resetForPrincipal(B);
  check('a submit started before the change still records', (await staleSubmit) != null);
  check("…but does not badge the next person's submissions map", Object.keys(useStore.getState().submissions).length === 0);
}

// ═════ Each question's editing record rides every canvas swap ═══

console.log('[provenance across canvas swaps]');
{
  // The fold and the load are written ONCE (store.ts foldLiveQuestion /
  // loadQuestionFields), so no swap can drop a live field on the way.
  const { readFileSync } = await import('node:fs');
  const storeSrc = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
  const folds = storeSrc.match(/boxes: \w+\.boxes,\s*\n\s*responseText: \w+\.openResponse/g) ?? [];
  check('one fold: the live canvas + text are folded into a container in one place only', folds.length === 1);
  check('one load: a container is loaded into the live text in one place only',
    storeSrc.split('openResponse: saved.responseText').length - 1 === 1 &&
    !storeSrc.includes('openResponse: activeCircuit.responseText'));

  useStore.getState().resetForPrincipal('swap@x.test');
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  const asg = useStore.getState().assignment!;
  const [q1, q2] = [asg.questions[0].id, asg.questions[1].id];
  const trace = () => JSON.stringify(useStore.getState().questionTrace);
  const saved = (qid: number) => JSON.stringify(useStore.getState().questionCircuits.get(qid)?.provenance ?? null);
  useStore.getState().switchQuestion(0);
  if (useStore.getState().questionCircuits.get(q1)?.done) useStore.getState().toggleCurrentQuestionDone();
  useStore.getState().addComponent('AND', 120, 120);
  const t1 = trace();
  check('an edit on P1 writes its live record', useStore.getState().questionTrace != null);
  useStore.getState().switchQuestion(1);
  check('switchQuestion folds P1\'s record into its container', saved(q1) === t1);
  check('…and loads P2\'s own (none yet), not P1\'s', trace() !== t1);
  useStore.getState().addComponent('AND', 140, 140);
  const t2 = trace();
  useStore.getState().switchQuestion(0);
  check('P1 → P2 → P1 keeps P1\'s record byte-equal', trace() === t1);
  check('…and P2\'s is kept in its container', saved(q2) === t2);
  useStore.getState().toggleCurrentQuestionDone();
  check('the done toggle folds the record too', saved(q1) === t1);
  useStore.getState().toggleCurrentQuestionDone();
  const exported = JSON.parse(useStore.getState().exportSubmission('swap@x.test') ?? '{}');
  check('the submission build carries each record beside its answer',
    JSON.stringify(exported.answers?.find((a: { questionId: number }) => a.questionId === q1)?.provenance) === t1 &&
    JSON.stringify(exported.answers?.find((a: { questionId: number }) => a.questionId === q2)?.provenance) === t2);
  useStore.getState().goHome();
  check('goHome folds the live record', saved(q1) === t1);
  useStore.getState().closeAssignment();
  check('closeAssignment drops the live record', useStore.getState().questionTrace === null);
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0);
  check('openAssignment loads each record back from the workbook seam, byte-equal',
    trace() === t1 && saved(q2) === t2);
  useStore.getState().goHome();
}

// ═════ One sandbox per person per browser ═══════════════════════

console.log('[sandbox per person]');
{
  const A = 'a@x.test';
  const B = 'b@x.test';
  // A clean slate: the visitor in charge, no sandbox stored for anyone.
  useStore.getState().resetForPrincipal(null);
  for (const k of [...backing.keys()]) if (k.startsWith(SANDBOX_PREFIX)) backing.delete(k);
  const build = (type: 'AND' | 'OR' | 'NOT') => {
    useStore.getState().enterSandbox();
    const before = new Set(liveSandboxIds());
    useStore.getState().addComponent(type, 40, 40);
    const id = liveSandboxIds().find((x) => !before.has(x))!;
    useStore.getState().goHome();
    return id;
  };

  useStore.getState().resetForPrincipal(A);
  const aId = build('AND');
  useStore.getState().resetForPrincipal(null); // A signs out
  check("A's sandbox is saved under A's key", storedSandboxIds(keyOf(A)).includes(aId));
  check('the visitor sandbox is empty after A signs out', liveSandboxIds().length === 0);
  useStore.getState().resetForPrincipal(B);
  useStore.getState().enterSandbox();
  check('B signs in and sees an empty sandbox', liveSandboxIds().length === 0);
  useStore.getState().goHome();
  useStore.getState().resetForPrincipal(null);
  useStore.getState().resetForPrincipal(A);
  check("A signs back in and sees A's sandbox", liveSandboxIds().includes(aId));

  // A visitor's sandbox moves to a first-time signer-in.
  const C = 'c@x.test';
  useStore.getState().resetForPrincipal(null);
  const vId = build('OR');
  useStore.getState().resetForPrincipal(C);
  check("a first-time signer-in receives the visitor's sandbox", liveSandboxIds().includes(vId));
  check('…MOVED: the visitor key is gone', !backing.has(keyOf(null)));
  useStore.getState().resetForPrincipal(null);
  check('the next visitor sees an empty sandbox', liveSandboxIds().length === 0);

  // A person whose stored sandbox is EMPTY still counts as having none.
  const D = 'd@x.test';
  useStore.getState().resetForPrincipal(D);
  useStore.getState().enterSandbox();
  useStore.getState().goHome();
  useStore.getState().resetForPrincipal(null);
  check("D's empty sandbox was stored", backing.has(keyOf(D)) && storedSandboxIds(keyOf(D)).length === 0);
  const v2Id = build('NOT');
  useStore.getState().resetForPrincipal(D);
  check("an empty stored sandbox still receives the visitor's work", liveSandboxIds().includes(v2Id));

  // …but a sandbox with no components can still be someone's: a named
  // turbot tab with a hand-edited map (its only tab), or a renamed tab, is
  // never overwritten by a visitor's.
  const F = 'f@x.test';
  useStore.getState().resetForPrincipal(F);
  useStore.getState().enterSandbox();
  const fBaseTab = useStore.getState().activeTabId;
  useStore.getState().addTab('My custom map', 'turbot', 'turbot', 'CC');
  const fArena = structuredClone(selectTurbotArena(useStore.getState()));
  fArena.cells[1][1] = fArena.cells[1][1] === 'block' ? 'empty' : 'block';
  useStore.getState().setTabArena(fArena);
  useStore.getState().removeTab(fBaseTab);
  useStore.getState().goHome();
  useStore.getState().resetForPrincipal(null);
  const v3Id = build('AND');
  useStore.getState().resetForPrincipal(F);
  {
    const s = useStore.getState();
    const tab = s.tabs.find((t) => t.title === 'My custom map');
    check("a component-free sandbox (one named turbot tab, an edited map) is kept on sign-in",
      s.tabs.length === 1 && tab?.arena?.cells[1][1] === fArena.cells[1][1]);
    check("…and the visitor's sandbox is not moved over it",
      !liveSandboxIds().includes(v3Id) && storedSandboxIds(keyOf(null)).includes(v3Id));
  }
  const G = 'g@x.test';
  backing.delete(keyOf(null)); // G is a first-time signer-in: nothing to receive
  useStore.getState().resetForPrincipal(G);
  useStore.getState().enterSandbox();
  useStore.getState().renameTab(useStore.getState().activeTabId, 'Scratch');
  useStore.getState().goHome();
  useStore.getState().resetForPrincipal(null);
  build('OR');
  useStore.getState().resetForPrincipal(G);
  check('a sandbox that is only a renamed tab is kept on sign-in',
    useStore.getState().tabs.map((t) => t.title).join() === 'Scratch' && liveSandboxIds().length === 0);


  // The legacy one-per-browser key is adopted as the visitor sandbox.
  useStore.getState().resetForPrincipal(null);
  backing.delete(keyOf(null));
  backing.set(SANDBOX_PREFIX, JSON.stringify({
    formatVersion: 2,
    tabs: [{ id: 'legacy-tab', title: 'Circuit 1', buildMode: 'CC', activeTask: 'arithmetic' }],
    activeTabId: 'legacy-tab',
    tabCircuits: { 'legacy-tab': { components: [{ id: 'legacy-sentinel', type: 'AND', x: 0, y: 0, inputs: [], outputs: [] }], wires: [], boxes: [], confirmedBoxes: [] } },
  }));
  useStore.getState().resetForPrincipal(A); // A has work, so no visitor move fires
  check('the legacy key becomes the visitor sandbox',
    storedSandboxIds(keyOf(null)).includes('legacy-sentinel') && !backing.has(SANDBOX_PREFIX));
  check("…and A still sees A's own", liveSandboxIds().includes(aId) && !liveSandboxIds().includes('legacy-sentinel'));
  useStore.getState().resetForPrincipal(null);
  check('a visitor sees the adopted legacy sandbox', liveSandboxIds().includes('legacy-sentinel'));

  // closeWorkbook removes the current principal's key only.
  useStore.getState().closeWorkbook();
  check("closeWorkbook removes the current principal's sandbox", !backing.has(keyOf(null)));
  check("…and nobody else's", backing.has(keyOf(A)) && backing.has(keyOf(C)) && backing.has(keyOf(D)));

  // A principal change with the sandbox ON SCREEN (a 401, a session restore
  // resolving) keeps a sandbox on screen — the arriving person's own.
  useStore.getState().resetForPrincipal(A);
  useStore.getState().enterSandbox();
  check("A's sandbox is open", useStore.getState().workbookOpen && liveSandboxIds().includes(aId));
  useStore.getState().resetForPrincipal(null);
  {
    const s = useStore.getState();
    check('a principal change keeps an open sandbox open',
      s.workbookOpen && s.assignment === null);
    check("…showing the arriving person's sandbox, not the leaving one's", !liveSandboxIds().includes(aId));
  }
  useStore.getState().goHome();
}

// ═════ A save in flight at the change swallows nothing ══════════

console.log('[principal change mid-save]');
{
  // The reset cancels the debounced save's trailing rerun, so a seam save
  // still in flight when the principal changes must not be what carries the
  // leaving person's newer edits. The stub keeps the local seam's synchronous
  // write but confirms late — the shape of a slow remote PUT.
  const E = 'e@x.test';
  const seam = workbookStore as { saveAssignmentState: typeof workbookStore.saveAssignmentState };
  const realSave = seam.saveAssignmentState.bind(workbookStore);
  const inFlight: Promise<void>[] = [];
  seam.saveAssignmentState = (id, st, o) => {
    const p = realSave(id, st, o).then(() => new Promise<void>((r) => setTimeout(r, 40)));
    inFlight.push(p);
    return p;
  };
  const openQ1 = async () => {
    await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
    useStore.getState().switchQuestion(0);
    const q1 = useStore.getState().assignment!.questions[0];
    if (useStore.getState().questionCircuits.get(q1.id)?.done) useStore.getState().toggleCurrentQuestionDone();
    return q1;
  };
  /** Edit, then re-open (resume): its flush starts a seam save that is still in flight after. */
  const startSlowSave = async () => {
    useStore.getState().addComponent('AND', 240, 240);
    const before = inFlight.length;
    await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
    return inFlight.length > before;
  };
  try {
    useStore.getState().resetForPrincipal(E);
    const q1 = await openQ1();
    check('a seam save is in flight', await startSlowSave());
    const before = new Set(useStore.getState().components.map((c) => c.id));
    useStore.getState().addComponent('OR', 280, 280);
    const newer = useStore.getState().components.find((c) => !before.has(c.id))!;
    useStore.getState().resetForPrincipal(null); // a 401 mid-save: no goHome
    const stored = await workbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID);
    check('an assignment edit made while a save was in flight reaches the seam',
      stored?.questionCircuits[q1.id]?.components.some((c) => c.id === newer.id) === true);
    await Promise.all(inFlight); // settled, so the next round starts its own

    useStore.getState().resetForPrincipal(E);
    await openQ1();
    check('a seam save is in flight again', await startSlowSave());
    useStore.getState().goHome();
    const sbBefore = new Set(liveSandboxIds());
    useStore.getState().enterSandbox();
    useStore.getState().addComponent('OR', 40, 40);
    const sbId = liveSandboxIds().find((x) => !sbBefore.has(x))!;
    useStore.getState().goHome();
    useStore.getState().resetForPrincipal(null); // sign-out
    check("a sandbox edit made while a save was in flight is stored under the leaving person's key",
      storedSandboxIds(keyOf(E)).includes(sbId));
  } finally {
    seam.saveAssignmentState = realSave;
    await Promise.all(inFlight);
  }
}

// ═════ The auth provider reports every principal change ═════════

console.log('[auth provider wiring]');
{
  // resetForPrincipal only guards anything if the auth provider calls it on
  // every change, in both modes. The provider is React (no DOM here), so its
  // wiring is pinned in the source: each provider reports from its boot
  // initializer, and from the ONE wrapper every later user change goes
  // through, before React state moves.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/auth/authProvider.tsx', import.meta.url), 'utf8');
  /** The balanced {…} block opening at the first '{' after `marker` in `text`. */
  const block = (text: string, marker: string): string => {
    const at = text.indexOf(marker);
    if (at < 0) return '';
    const open = text.indexOf('{', at + marker.length);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
    }
    return '';
  };
  /** A top-level function's source, up to the next top-level declaration. */
  const topLevel = (name: string): string => {
    const at = src.indexOf(`\nfunction ${name}(`);
    if (at < 0) return '';
    const next = src.slice(at + 1).search(/\n(export )?(function|const|let) /);
    return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
  };
  check('reportPrincipal hands the store to resetForPrincipal',
    /useStore\.getState\(\)\.resetForPrincipal\(/.test(block(src, 'function reportPrincipal(')));
  for (const [name, wrapper] of [
    ['LocalAuthProvider', 'const changeUser = useCallback('],
    ['RemoteAuthProvider', 'const setUser = useCallback('],
  ] as const) {
    const provider = topLevel(name);
    const init = block(provider, 'useState<AuthUser | null>(() =>');
    const wrap = block(provider, wrapper);
    check(`${name}: the boot initializer reports the principal`, /reportPrincipal\(/.test(init));
    check(`${name}: the user-change wrapper reports before React state moves`,
      wrap.includes('reportPrincipal(') && wrap.indexOf('reportPrincipal(') < wrap.indexOf('setUserState('));
    check(`${name}: every user change goes through that wrapper`,
      provider.split('setUserState(').length - 1 === 1 && wrap.includes('setUserState('));
  }
  check('RemoteAuthProvider boots as the stored token\'s owner, never a bare visitor',
    /reportPrincipal\(readPrincipalHint\(\)\)/.test(block(topLevel('RemoteAuthProvider'), 'useState<AuthUser | null>(() =>')));
}

await flushTimers();
console.log(`\nnavResetCheck: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
