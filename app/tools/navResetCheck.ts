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
// [viewing a submission] (task 003): a submitted attempt opened read-only at
// any due date is a canvas swap both ways, refuses every edit but runs, and
// never lands in the live workbook (no fold, no save, a submit records the
// live work); [frozen assignment] is the same view, forced on by the freeze.
// [viewing another's attempt] (task 067): an instructor's view of a
// student's attempt (openSubmissionOf, a fetched record) is the same
// read-only view, but NEVER the viewer's workbook — the stored workbook stays
// byte-identical through the view, Home, a submit and a principal change; no
// mint key registers; frozen ignores the viewer's own past-due submission;
// the lock names the student; two students' attempt 1 are different
// attempts; a stale open applies nothing; leaving resets; and the same-id
// resume never resurrects the view's empty map; the viewer's sandbox is
// saved on the way in and put back on the way out, never stored empty (a
// grep pin keeps the record branch off the viewer's own seams).
// [own submissions] (task 037): every student-side submission read — the
// seam's Own pair, the hydrated map, the frozen view, viewSubmission — sees
// only the principal's own attempts (an instructor's Student view too),
// numbered per student; only the gradebook reads everyone's (`listAll`).
// Task 034 adds the provenance slice: a principal change drops the mint keys
// and the live editing record (the next person mints under their own key only
// once their open registers it), and [provenance across canvas swaps] — every
// swap carries each question's record through the ONE fold / load helper.
// [multi-part problem] (task 048): HW1 problem 6 is ONE page — a saved
// index on a later part opens it, old answers under 18 and 19 show there,
// each part's field and record are its own (folded under its own id), one
// done toggle writes every part and the one lock refuses every part's
// setter, a viewed or frozen submission shows every part's submitted
// answer, a follower index is no swap, and a principal change clears all.
// Within it, [worksheet] renders the answer area for real (react-dom/server,
// the store's page and live text handed to WorksheetSheet): the stem, each
// part's prompt directly followed by its field by kind (paragraph, line,
// blank, 079's table set through the store), the closing, the foot; a
// single question likewise; read-only when done; a line part holding a
// line break keeps a paragraph field.
// [edit during run] (task 011) pins the EDIT law beside the two: a machine
// edit (gradedMachineKey changes) restarts every live run — SC, FSM, TM,
// turbot — at t=1 keeping its input and the undo history; moves, rotation,
// the run's own steps and a locked canvas's refused edits restart nothing.
// [canvas gestures] (task 024) pins the canvas's modifier map in its source:
// shift-click rotates through rotateComponent (locked like every edit — the
// live pins sit in [mark as done] and [viewing a submission]) and never a
// STATE, cmd/ctrl-click only toggles, a modifier-click on a wire segment is
// the wire's toggle, the Mac ctrl-click menu is swallowed only after a gesture
// ran, modifiers are tested before the triple-click, and the Rotate button
// shows its hint.
// [turbot goal flash] (task 025): the step that moves the turbot onto a goal
// (from off it) carries the goal-reached event; a Run holds 2 ticks of its
// one interval (Step never), Pause drops the hold, Reset and an edit clear
// both; the Map's pulse is pinned in the source (≤ 600 ms, reduced-motion
// off, the live Map only, no timer).
// [run controls] (task 053): the output panel's ONE control row — one
// descriptor per mode (selectRunControls) and one dispatcher (runControl);
// a combinational circuit's Step/Run play its row's signal flow in the
// store's own loop and Reset zeroes the inputs; an SC circuit's play its
// Global I/O row (store-held); an edit or a canvas swap stops every loop;
// editing a turbot's map stands the controls down.

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

const { useStore, selectTurbotArena, selectAssignmentFrozen, selectQuestionLocked, selectLockNotice, showsSubmission, selectTurbotGoalHit, TURBOT_GOAL_HOLD_TICKS, selectRunControls } =
  await import('../src/store');
const { sortByLabel } = await import('../src/engine');
const { buildSampleAssignment, ccCorrect, scCorrect, fsmCorrect, tmCorrect, turbotCorrect, turbotFsmCorrect, turbotTmCorrect, SAMPLE_ASSIGNMENT_ID } =
  await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');
const { backendMode, workbookStore, submissionStore, gradingStore } = await import('../src/storage/backend');
// The clipboard lives in the provenance seam, not in store state (task 033).
const { peekClipboard, stampText, currentProvenance } = await import('../src/provenance');
// …and the mint keys in the minting seam (task 034).
const { mintKeyFor, mintId, verifyId, deriveMintKey, DEV_MINT_SECRET } = await import('../src/provenance/ids');
/** Both of the seam's slots empty. */
const clipboardEmpty = () => peekClipboard().canvas === null && peekClipboard().text === null;
/** The open page's own question id (its first part, which owns the canvas),
 *  and — task 048: the live answers and records are per part — that part's
 *  live text and live editing record. */
const pageId = (): number => {
  const s = useStore.getState();
  return s.assignment?.questions[s.currentQuestionIndex]?.id ?? -1;
};
const liveResponse = (id = pageId()): string => useStore.getState().liveText[id]?.responseText ?? '';
const liveTrace = (id = pageId()) => useStore.getState().liveTraces[id] ?? null;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
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
    s.turbotStopReason === null && s.turbotLastEvent === null && s.turbotHoldTicks === 0);
  // A graded case loaded into the run ("Run this input") and the arena it
  // put on the Map belong to the canvas they were loaded on.
  check(`${label}: no graded case loaded, primary arena`, s.loadedCase === null && s.turbotCaseIndex === 0);
  // The armed palette tool survives repeated background clicks, so a canvas
  // swap must disarm it — otherwise a gate armed on one question drops a
  // component on the first click in the next one.
  check(`${label}: palette tool disarmed`, s.selectedTool === null);
  // So is the selection (task 052): ids from the last canvas select nothing
  // here, and a stale one would let Delete act on this canvas's namesake.
  check(`${label}: selection cleared`, s.selectedIds.length === 0);
  // Undo writes its snapshot into the CURRENT canvas, so history must not
  // survive a swap either.
  check(`${label}: undo/redo history empty`, s.undoStack.length === 0 && s.redoStack.length === 0);
  // The output panel's run state (task 053): the local-step row and its Run,
  // the Global I/O row a Run plays, the Map editor — all canvas-scoped.
  check(`${label}: no local-step row, no local run`, !s.localStepActive && !s.localStepRunning && s.localStepRunId === null);
  check(`${label}: no Global I/O row picked, Map editor closed`, s.scActiveGlobalIndex === null && !s.turbotEditingMap);
  // The CC table's earned rows (task 075) were earned on the last canvas.
  check(`${label}: no CC row earned`, s.ccRunRows.length === 0);
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
    turbotLastEvent: { kind: 'goal-reached', t: 1 },
    turbotHoldTicks: 2,
    turbotCaseIndex: 2,
    loadedCase: { kind: 'value', questionId: 1, caseIndex: 3, attempt: 1, gradedKey: null, input: [1, 2], recorded: { pass: false } },
    selectedTool: 'AND',
    selectedIds: ['ghost-component', 'ghost-wire'],
    localStepActive: true,
    localStepSelectedKey: '1,0',
    localStepRunning: true,
    scActiveGlobalIndex: 2,
    turbotEditingMap: true,
    ccRunRows: ['1,0'],
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
  // A gate to rotate: rotation (the Rotate button and the canvas's
  // shift-click, task 024 — both call rotateComponent) is an edit, so the
  // lock refuses it too.
  useStore.getState().addComponent('AND', 60, 60);
  const gate = useStore.getState().components.at(-1)!;
  const rotationOf = (id: string) => useStore.getState().components.find((c) => c.id === id)?.rotation ?? 0;
  useStore.getState().toggleCurrentQuestionDone();
  check('toggleCurrentQuestionDone marks it done', isDone());

  {
    const undoBefore = useStore.getState().undoStack.length;
    useStore.getState().rotateComponent(gate.id);
    check('rotateComponent is refused while locked (no turn, no history)',
      rotationOf(gate.id) === 0 && useStore.getState().undoStack.length === undoBefore);
  }

  const before = useStore.getState().components.length;
  useStore.getState().addComponent('AND', 100, 100);
  check('addComponent is refused while locked', useStore.getState().components.length === before);
  useStore.getState().paste();
  useStore.getState().clearWorkspace();
  check('clearWorkspace is refused while locked', useStore.getState().components.length === before);
  const openBefore = liveResponse();
  useStore.getState().setOpenResponse(pageId(), 'sneaking in an edit');
  check('setOpenResponse is refused while locked', liveResponse() === openBefore);

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

  {
    const id = useStore.getState().components.at(-1)!.id;
    const undoBefore = useStore.getState().undoStack.length;
    useStore.getState().rotateComponent(id);
    check('rotateComponent works once unlocked: 90°, exactly one history step',
      rotationOf(id) === 90 && useStore.getState().undoStack.length === undoBefore + 1);
    useStore.getState().undo();
    check('undo restores the rotation', rotationOf(id) === 0);
    for (let i = 0; i < 4; i++) useStore.getState().rotateComponent(id);
    check('four rotations come back to 0°', rotationOf(id) === 0);
  }
}

// ── frozen assignments show the SUBMISSION read-only, not diverged live
// work (notes/todos.md item 3) ──
console.log('[frozen assignment]');
{
  // Submission reads are the principal's own (task 037), so this section and
  // [viewing a submission] run as the student who submits in them.
  useStore.getState().resetForPrincipal('student@example.com');
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
  useStore.getState().setOpenResponse(pageId(), 'sneaking in an edit');
  check('setOpenResponse is refused once frozen', liveResponse() === '');

  useStore.getState().switchQuestion(1);
  useStore.getState().switchQuestion(0);
  check('switching back shows the SUBMITTED circuit, not the diverged live work',
    useStore.getState().components.length === submittedCount);
  check('the freeze forced the submission view on (the latest attempt)',
    useStore.getState().viewingSubmission?.attempt === rec?.attempt);
  // Frozen has no way back: asking for the live workbook shows the latest
  // submission still, locked.
  check('viewSubmission(null) while frozen resolves', (await useStore.getState().viewSubmission(null)) === true);
  check('…and still shows the submission, locked',
    useStore.getState().components.length === submittedCount &&
      useStore.getState().viewingSubmission?.attempt === rec?.attempt &&
      selectQuestionLocked(useStore.getState()));
  const doneBefore = useStore.getState().questionCircuits;
  useStore.getState().toggleCurrentQuestionDone();
  check('the done toggle is refused while frozen (it would fold the submission into the live work)',
    useStore.getState().questionCircuits === doneBefore);
  // Going Home saves the workbook directly: the LIVE work, never a fold of
  // the submission on show (the latent overwrite this pin retires).
  useStore.getState().goHome();
  {
    const stored = await workbookStore.loadAssignmentState(FROZEN_ID);
    check('goHome while frozen leaves the diverged live work in the saved workbook',
      stored?.questionCircuits[frozenAsg.questions[0].id]?.components.length === divergedCount);
  }

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
  check('a fresh open views the latest submission',
    useStore.getState().viewingSubmission?.attempt === rec?.attempt && showsSubmission(useStore.getState()));

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

// ── viewing a submission (task 003): a submitted attempt opened read-only
// at ANY due date — Run/Step live, edits refused, the live workbook never
// written, and a way back ──
console.log('[viewing a submission]');
{
  const VIEW_ID = `${SAMPLE_ASSIGNMENT_ID}-view`;
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const viewAsg = { ...buildSampleAssignment(), id: VIEW_ID, title: 'View Sample', dueDate: futureDate };
  const q1 = viewAsg.questions[0]; // CC
  const SC_INDEX = 1; // Q2 (SC)
  await localAssignmentStore.save(viewAsg);
  await localAssignmentStore.setVisible(VIEW_ID, true);
  useStore.getState().closeAssignment();
  await useStore.getState().openAssignment(VIEW_ID);

  // What gets submitted: an SC circuit on Q2, one gate on Q1.
  useStore.getState().switchQuestion(SC_INDEX);
  useStore.setState({ components: scCorrect().components, wires: scCorrect().wires });
  useStore.getState().switchQuestion(0);
  useStore.getState().addComponent('AND', 100, 100);
  const rec = await useStore.getState().submitAssignment(VIEW_ID, 'student@example.com');
  const n = rec!.attempt;
  check('submitted Q1 with 1 component',
    rec?.submission.answers.find((a) => a.questionId === q1.id)?.circuit?.components.length === 1);
  // Keep working before the deadline: the live work diverges.
  useStore.setState({ selectedIds: [useStore.getState().components[0].id] });
  useStore.getState().copySelected(); // something a paste could land, were it allowed
  useStore.getState().addComponent('OR', 200, 100);
  const q1Trace = liveTrace();
  check('live Q1 diverged to 2 components; not frozen (due in the future)',
    useStore.getState().components.length === 2 && !selectAssignmentFrozen(useStore.getState()));

  // (a) Entering the view is a canvas swap (reset law 1).
  plantSimJunk();
  check(`viewSubmission(${n}) resolves true`, (await useStore.getState().viewSubmission(n)) === true);
  {
    const s = useStore.getState();
    check('the canvas shows the SUBMITTED Q1 (1 component), attempt on record',
      s.components.length === 1 && s.viewingSubmission?.attempt === n && showsSubmission(s));
  }
  checkAllSimFresh('entering a submission');

  // (b) Every edit is refused — through the one lock.
  check('the question reads locked', selectQuestionLocked(useStore.getState()));
  useStore.getState().addComponent('NOT', 300, 100);
  check('addComponent is refused', useStore.getState().components.length === 1);
  useStore.getState().paste();
  check('paste is refused', useStore.getState().components.length === 1);
  {
    const only = useStore.getState().components[0];
    const undoBefore = useStore.getState().undoStack.length;
    useStore.getState().rotateComponent(only.id);
    check('rotateComponent is refused',
      (useStore.getState().components[0].rotation ?? 0) === (only.rotation ?? 0) &&
      useStore.getState().undoStack.length === undoBefore);
  }
  useStore.getState().setOpenResponse(pageId(), 'sneaking in an edit');
  check('setOpenResponse is refused', liveResponse() === '');
  useStore.setState({ undoStack: [{ components: [], wires: [], boxes: [], confirmedBoxes: [] }] });
  useStore.getState().undo();
  check('undo is refused', useStore.getState().components.length === 1 && useStore.getState().undoStack.length === 1);
  useStore.setState({ undoStack: [] });
  {
    const before = useStore.getState().questionCircuits;
    useStore.getState().toggleCurrentQuestionDone();
    check('the done toggle is refused (no fold of the submission)', useStore.getState().questionCircuits === before);
  }

  // (c) Simulation still runs — on the submitted machine of every question.
  useStore.getState().switchQuestion(SC_INDEX);
  {
    const s = useStore.getState();
    check('switching question stays on the attempt: the SUBMITTED SC circuit',
      s.viewingSubmission?.attempt === n && s.components.length === 3 && s.wires.length === 2);
  }
  checkAllSimFresh('switching question in a submission');
  // An INPUT toggle — the one canvas mutation never locked — arms no save of
  // the viewed canvas (the autosave subscriber's showsSubmission guard). The
  // submitted SC circuit has an INPUT, so the toggle really happens.
  await flushTimers();
  {
    const saveBefore = useStore.getState().autoSaveStatus;
    const input = useStore.getState().components.find((c) => c.type === 'INPUT');
    check('the viewed SC canvas has an INPUT to toggle', input !== undefined);
    if (input) useStore.getState().setInputValue(input.id, 1);
    check('…and the toggle lands on the viewed canvas',
      useStore.getState().components.find((c) => c.id === input?.id)?.value === 1);
    check('…which arms no save (the chip stays saved)',
      saveBefore === 'saved' && useStore.getState().autoSaveStatus === 'saved');
    await flushTimers();
    check('the autosave stays idle while viewing', useStore.getState().autoSaveStatus === 'saved');
  }
  useStore.getState().setScGlobalSequenceInput(0, '0110');
  useStore.getState().loadScGlobalSequence(0);
  for (let i = 0; i < 3; i++) useStore.getState().scStep();
  check('an SC run steps on the viewed submission', useStore.getState().scHistory.length === 3);
  useStore.getState().switchQuestion(0);
  check('back on Q1: still the submitted canvas', useStore.getState().components.length === 1);

  // (d) The live work is untouched in memory…
  {
    const live = useStore.getState().questionCircuits.get(q1.id);
    check('questionCircuits holds the diverged live Q1 (2 components)', live?.components.length === 2);
    check("…and the live Q1's editing record, unchanged",
      JSON.stringify(live?.provenance ?? null) === JSON.stringify(q1Trace ?? null));
  }
  // (e) …and in the saved workbook: goHome's direct save writes the live map.
  useStore.getState().goHome();
  {
    const stored = await workbookStore.loadAssignmentState(VIEW_ID);
    check('goHome while viewing: the saved Q1 is the live work (2 components)',
      stored?.questionCircuits[q1.id]?.components.length === 2);
  }
  await useStore.getState().openAssignment(VIEW_ID); // resume (same assignment)
  check('resuming the same assignment keeps the view (the route decides)',
    useStore.getState().viewingSubmission?.attempt === n && useStore.getState().components.length === 1);

  // (f) A submit while viewing records the LIVE work, not the attempt shown.
  const rec2 = await useStore.getState().submitAssignment(VIEW_ID, 'student@example.com');
  check(`a submit while viewing records attempt ${n + 1} from the live work`,
    rec2?.attempt === n + 1 &&
      rec2.submission.answers.find((a) => a.questionId === q1.id)?.circuit?.components.length === 2 &&
      rec2.submission.answers.find((a) => a.questionId === viewAsg.questions[SC_INDEX].id)?.circuit?.components.length === 3);
  check('…and the view stays on the attempt it showed', useStore.getState().viewingSubmission?.attempt === n);

  // (g) The attempt already on show: no swap, the run survives.
  plantSimJunk();
  check(`viewSubmission(${n}) again resolves true`, (await useStore.getState().viewSubmission(n)) === true);
  check('…as a no-op (the planted run survives)',
    useStore.getState().scTimeStep === 7 && useStore.getState().undoStack.length === 1);
  // (h) An attempt that doesn't exist changes nothing.
  check('viewSubmission(999) resolves false', (await useStore.getState().viewSubmission(999)) === false);
  check('…and changes nothing',
    useStore.getState().viewingSubmission?.attempt === n && useStore.getState().components.length === 1 &&
      useStore.getState().scTimeStep === 7);

  // (i) Back to the live work: a canvas swap, unlocked, editable.
  check('viewSubmission(null) resolves true', (await useStore.getState().viewSubmission(null)) === true);
  {
    const s = useStore.getState();
    check('back on the live Q1 (2 components), unlocked',
      s.viewingSubmission === null && s.components.length === 2 && !selectQuestionLocked(s) && !showsSubmission(s));
  }
  checkAllSimFresh('leaving a submission');
  useStore.getState().addComponent('NOT', 300, 100);
  check('editing works again', useStore.getState().components.length === 3);

  // An older attempt (no longer the latest in `submissions`) comes through
  // the submission seam; the live edit just made lands in the map first.
  check(`viewSubmission(${n}) of an older attempt resolves true`, (await useStore.getState().viewSubmission(n)) === true);
  check('…showing that attempt (1 component)', useStore.getState().components.length === 1);
  check('…with the live edit folded into the map on the way in',
    useStore.getState().questionCircuits.get(q1.id)?.components.length === 3);
  await useStore.getState().viewSubmission(null);
  check('…and back to it', useStore.getState().components.length === 3);

  // (j) A seam lookup overtaken by a newer navigation on the SAME assignment
  // (Back/Forward onto an older attempt, then the arrows or "Back to my
  // work" before a slow remote fetch lands) applies nothing: the newer route
  // owns the canvas. The seam is held open here as a remote fetch would be.
  {
    const realList = submissionStore.listOwn.bind(submissionStore);
    let release = () => {};
    submissionStore.listOwn = async (id, email) => {
      await new Promise<void>((r) => { release = r; });
      return realList(id, email);
    };
    try {
      const stale = useStore.getState().viewSubmission(n); // older attempt → the (held) seam
      check('a newer live route on the same assignment resolves true',
        (await useStore.getState().viewSubmission(null)) === true);
      release();
      check('the overtaken lookup resolves true', (await stale) === true);
      {
        const s = useStore.getState();
        check('…and applies nothing: still the live Q1 (3 components), unlocked',
          s.viewingSubmission === null && s.components.length === 3 && !showsSubmission(s));
      }
      // Overtaken by a view of ANOTHER attempt (the latest, found in memory).
      await useStore.getState().viewSubmission(null); // from the live work, whatever happened above
      const stale2 = useStore.getState().viewSubmission(n);
      check(`a newer view of attempt ${n + 1} resolves true`,
        (await useStore.getState().viewSubmission(n + 1)) === true);
      release();
      await stale2;
      {
        const s = useStore.getState();
        check(`…and the overtaken lookup leaves attempt ${n + 1} on show (2 components)`,
          s.viewingSubmission?.attempt === n + 1 && s.components.length === 2);
      }
      // Overtaken by going Home: nothing lands behind the catalog either.
      await useStore.getState().viewSubmission(null);
      const stale3 = useStore.getState().viewSubmission(n);
      useStore.getState().goHome();
      release();
      await stale3;
      check('a lookup overtaken by Home applies nothing',
        useStore.getState().viewingSubmission === null && useStore.getState().components.length === 3);
    } finally {
      submissionStore.listOwn = realList;
    }
  }
  useStore.getState().closeAssignment();
  check('closeAssignment clears the view', useStore.getState().viewingSubmission === null);
  // The sandbox sections below run as the visitor.
  useStore.getState().resetForPrincipal(null);
}

// ── viewing ANOTHER person's attempt (task 067): an instructor opens a
// student's submitted attempt read-only from the grading seam — never the
// viewer's own workbook ──
console.log("[viewing another's attempt]");
{
  const FOREIGN_ID = `${SAMPLE_ASSIGNMENT_ID}-foreign`;
  const INSTR = 'ada.instructor@example.com';
  const STUDENT = 'john.doe@example.com'; // John Doe on the toy roster
  const OTHER = 'jane.roe@example.com'; // Jane Roe
  const { buildCorrectSubmission } = await import('../src/devData/sampleData');
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const asg = { ...buildSampleAssignment(), id: FOREIGN_ID, title: 'Foreign Sample', dueDate: futureDate };
  const q1 = asg.questions[0]; // CC
  const SC_INDEX = 1; // Q2 (SC)
  await localAssignmentStore.save(asg);
  await localAssignmentStore.setVisible(FOREIGN_ID, true);

  // Two students' attempt 1: John's Q1 is the correct CC circuit, Jane's Q1
  // is empty — the same attempt number, different machines.
  const johnSub = { ...buildCorrectSubmission(STUDENT), assignmentId: FOREIGN_ID, submittedAt: new Date().toISOString() };
  const janeBase = buildCorrectSubmission(OTHER);
  const janeSub = {
    ...janeBase,
    assignmentId: FOREIGN_ID,
    submittedAt: new Date().toISOString(),
    answers: janeBase.answers.map((a) => (a.questionId === q1.id ? { ...a, circuit: { components: [], wires: [] } } : a)),
  };
  const johnRec = await submissionStore.submit(FOREIGN_ID, johnSub);
  const janeRec = await submissionStore.submit(FOREIGN_ID, janeSub);
  const johnQ1 = johnSub.answers.find((a) => a.questionId === q1.id)!.circuit!.components.length;
  check("both students' attempts are attempt 1, with different Q1 machines",
    johnRec.attempt === 1 && janeRec.attempt === 1 && johnQ1 > 0);

  // The instructor's OWN work W on the same assignment: submitted (2 parts),
  // then diverged (3 parts), saved by Home; then the deadline passes, so the
  // instructor's own attempt would freeze their own open.
  useStore.getState().resetForPrincipal(INSTR);
  await useStore.getState().openAssignment(FOREIGN_ID);
  useStore.getState().switchQuestion(0);
  useStore.getState().addComponent('NOT', 100, 100);
  useStore.getState().addComponent('NOT', 100, 200);
  const ownRec = await useStore.getState().submitAssignment(FOREIGN_ID, INSTR);
  useStore.getState().addComponent('NOT', 100, 300);
  useStore.getState().goHome();
  await localAssignmentStore.save({ ...asg, dueDate: pastDate });
  const WB_KEY = `mm:asg:${FOREIGN_ID}`;
  const W = backing.get(WB_KEY);
  check("the instructor's own workbook W is stored (Q1: 3 parts)",
    W !== undefined && (await workbookStore.loadAssignmentState(FOREIGN_ID))?.questionCircuits[q1.id]?.components.length === 3);
  const wUnchanged = (label: string) => check(`${label}: the instructor's stored workbook is byte-identical`, backing.get(WB_KEY) === W);

  // A fresh session: no mint keys, the instructor's own (past-due) attempt
  // in the badge map.
  useStore.getState().resetForPrincipal(null);
  useStore.getState().resetForPrincipal(INSTR);
  await useStore.getState().hydrateSubmissions();
  check("the badge map holds the instructor's OWN past-due attempt",
    useStore.getState().submissions[FOREIGN_ID]?.submission.student === INSTR);

  // (a) Open John's attempt 1: a canvas swap onto HIS machine.
  plantSimJunk();
  check('openSubmissionOf resolves true', (await useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1)) === true);
  {
    const s = useStore.getState();
    check("the canvas is John's submitted Q1, on show as John's",
      s.components.length === johnQ1 && s.viewingOwner?.key === STUDENT && s.viewingOwner.name === 'John Doe' &&
        s.viewingSubmission?.submission.student === STUDENT && s.viewingSubmission.attempt === 1);
    check('…open in the editor, on the question', s.workbookOpen && s.assignmentView === 'question' && s.assignment?.id === FOREIGN_ID);
    check("…over an EMPTY map (the viewer's workbook was never loaded)",
      [...s.questionCircuits.values()].every((qc) => qc.components.length === 0));
    check("frozen ignores the viewer's own past-due submission", !selectAssignmentFrozen(s));
    check('the lock notice names the student', selectLockNotice(s) === "Showing John Doe's submission — read-only.");
  }
  checkAllSimFresh("opening another's attempt");
  check('no mint key registered for the assignment (law 8)', mintKeyFor(FOREIGN_ID) === null);

  // (b) Edits refused through the one lock, in the student's name; copying
  // their parts reaches no clipboard.
  useStore.getState().addComponent('AND', 300, 300);
  check('addComponent is refused', useStore.getState().components.length === johnQ1);
  check('a refusal names the student',
    useStore.getState().renameBox('nope', 'X') === "This question shows John Doe's submission, read-only — you can't rename a box here.");
  {
    const clipBefore = peekClipboard().canvas;
    useStore.setState({ selectedIds: [useStore.getState().components[0].id] });
    useStore.getState().copySelected();
    check("copySelected is a no-op (a student's ids never reach the viewer's clipboard)", peekClipboard().canvas === clipBefore);
    useStore.setState({ selectedIds: [] });
  }

  // (c) Simulation runs on the student's machine.
  useStore.getState().switchQuestion(SC_INDEX);
  check("switching question: John's submitted SC circuit",
    useStore.getState().components.length === 3 && useStore.getState().viewingOwner?.key === STUDENT);
  useStore.getState().setScGlobalSequenceInput(0, '0110');
  useStore.getState().loadScGlobalSequence(0);
  for (let i = 0; i < 3; i++) useStore.getState().scStep();
  check('an SC run steps on the viewed attempt', useStore.getState().scHistory.length === 3);
  {
    const input = useStore.getState().components.find((c) => c.type === 'INPUT');
    if (input) useStore.getState().setInputValue(input.id, 1);
  }
  await flushTimers();
  wUnchanged('after running and toggling inputs');
  useStore.getState().switchQuestion(0);

  // (d) The same attempt number of ANOTHER student is a different attempt.
  {
    const jane = await gradingStore.attempt(FOREIGN_ID, OTHER, 1);
    check("Jane's attempt 1 comes from the grading seam", jane?.record.submission.student === OTHER);
    check('viewSubmission(record) of her attempt 1 resolves true',
      (await useStore.getState().viewSubmission({ record: jane!.record, owner: { key: OTHER, name: jane!.student.name } })) === true);
    const s = useStore.getState();
    check("…and swaps the canvas to Jane's (empty) Q1, as Jane's",
      s.components.length === 0 && s.viewingOwner?.key === OTHER && s.viewingSubmission?.submission.student === OTHER);
    check('switching to Jane via openSubmissionOf too',
      (await useStore.getState().openSubmissionOf(FOREIGN_ID, OTHER, 1)) === true && useStore.getState().components.length === 0);
    check('an unknown attempt resolves false', (await useStore.getState().openSubmissionOf(FOREIGN_ID, OTHER, 9)) === false);
  }

  // (e) Nothing of the viewer's is written: Home, a submit, a principal change.
  await useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
  useStore.getState().goHome();
  {
    const s = useStore.getState();
    check('Home from the view closes it (leaving resets)',
      s.assignment === null && s.viewingOwner === null && s.viewingSubmission === null && !s.workbookOpen);
  }
  checkAllSimFresh("Home from another's attempt");
  wUnchanged('after Home');
  await useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
  const submitted = await useStore.getState().submitAssignment(FOREIGN_ID, INSTR);
  check("a submit while viewing records the viewer's OWN work W (3 parts), not the student's or an empty map",
    submitted?.submission.student === INSTR &&
      submitted.submission.answers.find((a) => a.questionId === q1.id)?.circuit?.components.length === 3);
  check('…and the view stays on John', useStore.getState().viewingOwner?.key === STUDENT);
  wUnchanged('after a submit while viewing');
  useStore.getState().resetForPrincipal(null); // a sign-out (or 401) while viewing
  wUnchanged('after a principal change while viewing');
  check('the principal change clears the view', useStore.getState().viewingOwner === null && useStore.getState().assignment === null);
  useStore.getState().resetForPrincipal(INSTR);

  // (f) A stale open overtaken by the viewer's own open applies nothing.
  {
    const stale = useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
    const own = useStore.getState().openAssignment(FOREIGN_ID);
    check('the overtaken openSubmissionOf resolves true', (await stale) === true);
    check('the own open resolves true', (await own) === true);
    const s = useStore.getState();
    check("…and the canvas is the viewer's own (no owner, W's Q1 in the map)",
      s.viewingOwner === null && s.questionCircuits.get(q1.id)?.components.length === 3);
    useStore.getState().goHome();
  }

  // (g) Leaving for another route resets; the same-id resume never
  // resurrects the view's empty map.
  await useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
  plantSimJunk();
  useStore.getState().leaveForeignView(); // routing: any other route
  {
    const s = useStore.getState();
    check('leaving clears the view and the assignment', s.assignment === null && s.viewingOwner === null && !s.workbookOpen);
  }
  checkAllSimFresh("leaving another's attempt");
  await useStore.getState().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
  check('openAssignment(same id) from the view resolves true', (await useStore.getState().openAssignment(FOREIGN_ID)) === true);
  {
    const s = useStore.getState();
    check("…and loads the viewer's own W, never the view's empty map",
      s.viewingOwner === null && s.questionCircuits.get(q1.id)?.components.length === 3);
  }
  useStore.getState().goHome();
  {
    const stored = await workbookStore.loadAssignmentState(FOREIGN_ID);
    check("…whose save still holds W's Q1 (3 parts)", stored?.questionCircuits[q1.id]?.components.length === 3);
  }
  check("the instructor's own earlier attempt is untouched", ownRec?.submission.student === INSTR);
  useStore.getState().closeAssignment();

  // (h) The viewer's SANDBOX survives the view: entered straight from the
  // sandbox (its live canvas folded and saved on the way in) and via Home;
  // leaving puts the sandbox tab back, never an empty canvas the sandbox
  // autosave would store over it.
  {
    const SB_KEY = `making-minds-autosave:${INSTR}`;
    const sbParts = () => {
      const raw = backing.get(SB_KEY);
      if (!raw) return -1;
      const d = JSON.parse(raw);
      return (d.tabCircuits?.[d.activeTabId]?.components ?? []).length;
    };
    const st = () => useStore.getState();
    st().enterSandbox();
    const before = st().components.length;
    st().addComponent('AND', 100, 100);
    st().addComponent('OR', 100, 200);
    const sandboxIds = liveSandboxIds();
    // Straight from the sandbox, no Home (Sandbox → Dashboard → Grading → Open in viewer).
    await st().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
    check('opening a view from the sandbox saves its pending edit first', sbParts() === before + 2);
    check("…and folds the live sandbox canvas into its tab",
      st().tabCircuits.get(st().activeTabId)?.components.length === before + 2);
    st().leaveForeignView();
    check('leaving the view puts the sandbox tab back in the live fields',
      st().assignment === null && st().components.length === before + 2 &&
        JSON.stringify(liveSandboxIds()) === JSON.stringify(sandboxIds));
    // Via Home, then a view, then leave; the leaving save (principal change)
    // stores whatever the live sandbox now is.
    st().goHome();
    await st().openSubmissionOf(FOREIGN_ID, STUDENT, 1);
    st().goHome(); // Home from the view = leaveForeignView
    check('…and via Home too', st().components.length === before + 2);
    st().resetForPrincipal(null);
    check("the viewer's stored sandbox still holds both parts", sbParts() === before + 2);
    st().resetForPrincipal(INSTR);
    st().enterSandbox();
    check('…and re-entering the sandbox shows them', st().components.length === before + 2);
    st().goHome();
  }

  // Grep pin: the record branch of viewSubmission and openSubmissionOf never
  // read the viewer's own seams (listOwn / loadForOpen / getLatestOwn).
  {
    const { readFileSync } = await import('node:fs');
    // Code only: the comments name the seams they stay off.
    const src = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    const open = src.slice(src.indexOf('  openSubmissionOf: async'), src.indexOf('\n  },\n', src.indexOf('  openSubmissionOf: async')));
    const view = src.slice(src.indexOf('  viewSubmission: async'), src.indexOf('  leaveForeignView: () => {'));
    const recordBranch = view.slice(view.indexOf("if (arg != null && typeof arg === 'object') {"), view.indexOf('} else if (attempt == null)'));
    check('openSubmissionOf reads no own seam (loadForOpen, getLatestOwn, listOwn, setMintKey)',
      open.length > 0 && !/loadForOpen|getLatestOwn|listOwn|setMintKey/.test(open));
    check("viewSubmission's record branch reads no own seam",
      recordBranch.length > 0 && !/listOwn|loadForOpen/.test(recordBranch));
  }
  useStore.getState().resetForPrincipal(null);
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

// ═════ The edit law: a machine edit restarts every live run ═════

console.log('[edit during run]');
{
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID); // registers the mint key
  /** Open question `i` with `machine` on its canvas, unlocked. */
  const onQuestion = (i: number, machine: { components: unknown[]; wires: unknown[] }) => {
    useStore.getState().switchQuestion(i);
    const q = useStore.getState().assignment!.questions[i];
    if (useStore.getState().questionCircuits.get(q.id)?.done) useStore.getState().toggleCurrentQuestionDone();
    useStore.setState(JSON.parse(JSON.stringify({ components: machine.components, wires: machine.wires })));
  };
  const mem = () => useStore.getState().components.find((c) => c.type === 'MEM');
  const hasWire = (id: string) => useStore.getState().wires.some((w) => w.id === id);
  /** The typed '0110' loaded and stepped `n` times on the SC question. */
  const scRunSteps = (n: number) => {
    useStore.getState().loadScGlobalSequence(0);
    for (let i = 0; i < n; i++) useStore.getState().scStep();
  };
  const scAtRest = (s = useStore.getState()) =>
    !s.scRunning && s.scRunIntervalId === null && s.scTimeStep === 1 && s.scHistory.length === 0;

  // SC (Q2): the run's own steps, a move, a rotation and a rerouted wire are
  // not edits of the machine — the run carries on.
  onQuestion(1, scCorrect());
  useStore.getState().setScGlobalSequenceInput(0, '0110');
  scRunSteps(3);
  check('SC: the run\'s own steps keep their history (3 steps, MEM 1)',
    useStore.getState().scHistory.length === 3 && useStore.getState().scTimeStep === 4 && mem()?.storedValue === 1);
  useStore.getState().moveComponent('sc-mem', 400, 200);
  useStore.getState().rotateComponent('sc-out1');
  useStore.getState().updateWireManualSegments('sc-w1', [{ segmentIndex: 0, offset: 20, axis: 'y' }]);
  {
    const s = useStore.getState();
    check('SC: a move, a rotation and a rerouted wire mid-run restart nothing',
      s.scHistory.length === 3 && s.scTimeStep === 4 && mem()?.storedValue === 1 &&
        s.scGlobalSequences[0]?.outputStr === '100');
  }

  // …a removed wire, with Run in flight, is.
  useStore.getState().scRun();
  check('(SC: Run is in flight)', useStore.getState().scRunning && useStore.getState().scRunIntervalId !== null);
  const seqBefore = JSON.stringify(useStore.getState().scInputSequence);
  useStore.getState().removeWire('sc-w2');
  {
    const s = useStore.getState();
    check('SC: an edit mid-run stops Run and restarts at t=1 (history empty)', scAtRest(s));
    check('SC: …with every MEM back at 0', mem()?.storedValue === 0);
    check('SC: …keeping the typed input (sequence and row), the old output gone',
      JSON.stringify(s.scInputSequence) === seqBefore &&
        JSON.stringify(s.scGlobalSequences) === JSON.stringify([{ inputStr: '0110', outputStr: '' }]));
    check('SC: …and the edit\'s own undo entry (not a canvas swap)', s.undoStack.length > 0);
  }
  await flushTimers();
  check('SC: the deferred re-evaluation adds no I/O row', useStore.getState().tableRows.length === 0);

  // Undo after the reset lands at rest: the snapshot the edit pushed held the
  // run's MEM contents, which must not come back at t=1.
  useStore.getState().undo();
  check('SC: undo after an edit-restart restores the wire at rest, every MEM 0',
    hasWire('sc-w2') && scAtRest() && mem()?.storedValue === 0);
  useStore.getState().redo(); // sc-w2 removed again, at rest
  scRunSteps(3);
  check('(SC: a second run is live)', useStore.getState().scHistory.length === 3);
  useStore.getState().undo(); // restores sc-w2 — a machine change mid-run
  check('SC: undo mid-run restarts the run', hasWire('sc-w2') && scAtRest() && mem()?.storedValue === 0);

  // Any path that changes the machine — a raw setState, no action involved.
  scRunSteps(3);
  useStore.setState({ wires: useStore.getState().wires.filter((w) => w.id !== 'sc-w2') });
  check('SC: a raw setState of the wires mid-run restarts it too (no action opts in)', scAtRest());

  // A locked question refuses the edit, and its run — never locked — goes on.
  onQuestion(1, scCorrect());
  scRunSteps(2);
  useStore.getState().toggleCurrentQuestionDone();
  check('(SC: the question is locked)', selectQuestionLocked(useStore.getState()));
  useStore.getState().removeWire('sc-w1');
  {
    const s = useStore.getState();
    check('SC: locked — the edit is refused and the run is intact',
      hasWire('sc-w1') && s.scHistory.length === 2 && s.scTimeStep === 3);
  }
  useStore.getState().scStep();
  check('SC: locked — Step still runs', useStore.getState().scHistory.length === 3);
  useStore.getState().toggleCurrentQuestionDone();
  check('(SC: unlocked again)', !selectQuestionLocked(useStore.getState()));

  // FSM (Q3): a relabelled transition restarts the run, input kept.
  onQuestion(2, fsmCorrect());
  useStore.getState().setFsmInputSequence([1, 0, 1]);
  useStore.getState().fsmStep();
  useStore.getState().fsmStep();
  check('(FSM: 2 steps ran)', useStore.getState().fsmHistory.length === 2 && useStore.getState().fsmCurrentStateId !== null);
  useStore.getState().setTransitionLabel('fsm-t1', '0:1');
  {
    const s = useStore.getState();
    check('FSM: an edit mid-run restarts at t=1, input kept',
      s.fsmTimeStep === 1 && s.fsmHistory.length === 0 && s.fsmCurrentStateId === null && !s.fsmHalted &&
        JSON.stringify(s.fsmInputSequence) === '[1,0,1]');
  }
  // A halt is part of the run: supplying the missing transition clears it,
  // so Step works without a manual Reset.
  useStore.setState({ wires: fsmCorrect().wires.filter((w) => w.id === 'fsm-t1') }); // only 0:0
  useStore.getState().setFsmInputSequence([1]);
  useStore.getState().fsmReset();
  useStore.getState().fsmStep();
  check('(FSM: no 1-transition — the machine halts)', useStore.getState().fsmHalted);
  {
    const before = new Set(useStore.getState().wires.map((w) => w.id));
    useStore.getState().addWire('fsm-s0', 'right', 'fsm-s0', 'left');
    const added = useStore.getState().wires.find((w) => !before.has(w.id));
    check('FSM: adding a transition clears the halt', added != null && !useStore.getState().fsmHalted);
    useStore.getState().setTransitionLabel(added!.id, '1:1');
    useStore.getState().fsmStep();
    check('FSM: …and Step advances on the fixed machine', useStore.getState().fsmHistory.length === 1);
  }

  // TM (Q4): back to the tape the run started from.
  onQuestion(3, tmCorrect());
  useStore.getState().setTmCell(0);
  const initialTape = JSON.stringify(useStore.getState().tmInitialTape);
  useStore.getState().tmStep();
  useStore.getState().tmStep();
  check('(TM: 2 steps wrote the tape)', useStore.getState().tmHistory.length === 2 &&
    JSON.stringify(useStore.getState().tmTape) !== initialTape);
  const tmBefore = new Set(useStore.getState().components.map((c) => c.id));
  useStore.getState().addComponent('STATE', 300, 300);
  const tmAdded = useStore.getState().components.find((c) => !tmBefore.has(c.id));
  const tmAtStart = () => {
    const s = useStore.getState();
    return s.tmTimeStep === 1 && s.tmHistory.length === 0 && !s.tmHalted && s.tmCurrentStateId === null &&
      JSON.stringify(s.tmTape) === initialTape && JSON.stringify(s.tmInitialTape) === initialTape &&
      s.tmInitialTape.cells[0] === '1';
  };
  check('TM: an edit mid-run restarts on the initial tape (cell 0 = 1)', tmAdded != null && tmAtStart());
  for (let i = 0; i < 10 && !useStore.getState().tmHalted; i++) useStore.getState().tmStep();
  check('(TM: the machine halted)', useStore.getState().tmHalted);
  useStore.getState().setTmCell(5);
  check('(TM: a halted run refuses tape edits)', JSON.stringify(useStore.getState().tmInitialTape) === initialTape);
  useStore.getState().removeComponent(tmAdded!.id);
  check('TM: an edit after the halt restarts on the initial tape', tmAtStart());
  useStore.getState().setTmCell(1);
  check('TM: …and the tape is editable again', useStore.getState().tmInitialTape.cells[1] === '1');

  // Turbot, CC brain (Q5): back to the arena's start pose.
  onQuestion(4, turbotCorrect());
  const turbotAtStart = () => {
    const s = useStore.getState();
    return s.turbotHistory.length === 0 && !s.turbotHalted && s.turbotStopReason === null && !s.turbotRunning &&
      JSON.stringify(s.turbotState) === JSON.stringify(selectTurbotArena(s).start);
  };
  for (let i = 0; i < 3; i++) useStore.getState().turbotStep();
  check('(turbot: 3 cycles moved it)', useStore.getState().turbotHistory.length === 3 &&
    useStore.getState().turbotState.x === 3);
  useStore.getState().removeWire('tb-w3');
  check('turbot CC: an edit mid-run re-seats it at the start', turbotAtStart());
  useStore.getState().undo();
  useStore.getState().turbotRun();
  for (let i = 0; i < 25 && !useStore.getState().turbotHalted; i++) useStore.getState().turbotStep();
  check('(turbot: it stopped at the wall)', useStore.getState().turbotHalted && useStore.getState().turbotStopReason === 'motor');
  useStore.getState().removeWire('tb-w3');
  check('turbot CC: an edit after the stop re-seats it too (Run stopped)',
    turbotAtStart() && useStore.getState().turbotRunIntervalId === null);

  // Turbot, TM brain (Q8): a state-kind flip is a machine edit.
  onQuestion(7, turbotTmCorrect());
  for (let i = 0; i < 3; i++) useStore.getState().turbotStep();
  check('(turbot TM: 3 cycles ran)', useStore.getState().turbotHistory.length === 3);
  useStore.getState().toggleStateKind('ttm-s2');
  check('turbot TM: toggleStateKind mid-run restarts it', turbotAtStart());

  // CC (Q1) at rest: an edit keeps the INPUT toggles and restarts nothing.
  onQuestion(0, ccCorrect());
  const ccIn = useStore.getState().components.find((c) => c.type === 'INPUT')!;
  useStore.getState().setInputValue(ccIn.id, 1);
  useStore.getState().addComponent('AND', 300, 300);
  {
    const s = useStore.getState();
    check('CC: an edit keeps the INPUT toggle and restarts nothing',
      s.components.find((c) => c.id === ccIn.id)?.value === 1 && s.scTimeStep === 1 && s.undoStack.length > 0);
  }
  await flushTimers();

  // Sandbox: the same law on a scratch sheet.
  useStore.getState().enterSandbox();
  useStore.getState().addTab('Edit law', 'SC', 'arithmetic');
  runScOnLiveCanvas();
  check('(sandbox: an SC run is live)', useStore.getState().scHistory.length === 3);
  useStore.getState().removeWire('sc-w2');
  check('sandbox: an edit mid-run restarts at t=1, input kept',
    scAtRest() && mem()?.storedValue === 0 && useStore.getState().scGlobalSequences[0]?.inputStr === '0110');

  // Nothing typed: the INPUT toggles ARE the run's input — the restart keeps
  // them (so Run again feeds what this run did), memory and history go.
  const in1 = () => useStore.getState().components.find((c) => c.id === 'sc-in1')?.value;
  useStore.getState().scGlobalReset();
  useStore.getState().setInputValue('sc-in1', 1);
  useStore.getState().scStep();
  useStore.getState().scStep();
  check('(sandbox: a toggle-fed run is live, MEM 1)', useStore.getState().scHistory.length === 2 && mem()?.storedValue === 1);
  useStore.getState().addComponent('AND', 500, 500);
  check('sandbox: an edit mid a toggle-fed run restarts it keeping the INPUT toggle',
    scAtRest() && in1() === 1 && mem()?.storedValue === 0);
  await flushTimers();

  // An edit that adds an INPUT re-splits the typed row for the INPUTs now on
  // the canvas: the old split would feed another stream and never record the
  // row's output.
  runScOnLiveCanvas();
  const beforeIn2 = new Set(useStore.getState().components.map((c) => c.id));
  useStore.getState().addComponent('INPUT', 40, 300);
  const in2 = useStore.getState().components.find((c) => !beforeIn2.has(c.id));
  check('sandbox: an INPUT added mid-run restarts on the row split for two INPUTs (t1 = IN1 1, IN2 0)',
    in2?.type === 'INPUT' && scAtRest() && JSON.stringify(useStore.getState().scInputSequence) === '[[1,0],[0,1]]');
  for (let i = 0; i < 3; i++) useStore.getState().scStep();
  {
    const s = useStore.getState();
    check('sandbox: …Run again feeds that stream and records the row\'s output',
      JSON.stringify(s.scHistory.map((h) => h.inputBits)) === '[[1,0],[0,1],[0,0]]' &&
        s.scGlobalSequences[0]?.outputStr === '010');
  }
  useStore.getState().loadScGlobalSequence(0); // at rest, the row loaded
  useStore.getState().removeComponent(in2!.id);
  check('sandbox: an INPUT removed at rest re-splits the loaded row too (nothing restarted)',
    scAtRest() && JSON.stringify(useStore.getState().scInputSequence) === '[[0,1,1,0]]');
  await flushTimers();

  // Undo/redo restore structure, never live values. Mid-run, undoing the
  // snapshot a mousedown pushed (no machine change) leaves the run where it
  // stands: the next step reads the memory the run holds, not the snapshot's.
  runScOnLiveCanvas(); // t=4, MEM 1
  useStore.getState().pushHistory();
  useStore.getState().scStep(); // t4 feeds 0: MEM 0
  useStore.getState().undo();
  {
    const s = useStore.getState();
    check('sandbox: undoing a move mid-run leaves the run as it stands (t=5, MEM 0)',
      s.scTimeStep === 5 && s.scHistory.length === 4 && mem()?.storedValue === 0);
  }
  useStore.getState().scStep();
  check('sandbox: …and the next step reads the run\'s memory (OUT 0)',
    useStore.getState().scHistory[4]?.outputBits.join('') === '0');
  await flushTimers();

  // At rest: a MEM override set after the snapshot, and a local-step row
  // selected before it, both survive undoing a move.
  useStore.getState().scReset();
  await flushTimers();
  useStore.getState().pushHistory();
  useStore.getState().moveComponent('sc-mem', 320, 220);
  useStore.getState().setMemStoredValue('sc-mem', 1);
  useStore.getState().undo();
  check('sandbox: undoing a move at rest keeps a MEM override', scAtRest() && mem()?.storedValue === 1);
  await flushTimers();
  useStore.getState().setMemStoredValue('sc-mem', 0);
  useStore.getState().localStepSelect([1], [1]);
  useStore.getState().pushHistory();
  useStore.getState().moveComponent('sc-mem', 340, 240);
  useStore.getState().undo();
  check('sandbox: …and a selected local-step row (MEM 1, still active)',
    useStore.getState().localStepActive && mem()?.storedValue === 1);
  useStore.getState().localStepClear();
  await flushTimers();
  useStore.getState().removeTab(useStore.getState().activeTabId);
  await flushTimers();
  useStore.getState().goHome();
}

// ═════ The earned CC table (task 075) ═══════════════════════════
// A CC row's output shows only once the student has run it: the store's
// machine-key subscriber records the row the INPUTs stand at; a machine edit
// forgets every row but the one the canvas is showing now; a canvas swap
// forgets them all (checkAllSimFresh, above, on every swap). Nothing on a
// fresh canvas holds a 0 nobody computed — nor a pasted one, nor one a click
// on ANOTHER input filled in. The canvas's click is driven through its own
// path (CircuitCanvas → the store's toggleInput), not setInputValue alone.

console.log('[earned CC table]');
{
  const rows = () => useStore.getState().ccRunRows.join(' ');
  const comp = (id: string) => useStore.getState().components.find((c) => c.id === id);
  const ins = () => sortByLabel(useStore.getState().components, 'IN').map((c) => `${c.label}=${c.value ?? '_'}`).join(' ');
  const click = async (id: string) => { useStore.getState().toggleInput(id); await flushTimers(); };
  useStore.getState().enterSandbox();
  useStore.getState().addTab('Earned', 'CC');
  check('a fresh CC tab has earned no row', rows() === '');
  useStore.getState().addComponent('OUTPUT', 400, 100);
  useStore.getState().addComponent('AND', 200, 100);
  {
    const s = useStore.getState();
    check('a fresh OUTPUT and gate are unset (no 0 nobody computed)',
      s.components.length === 2 && s.components.every((c) => c.value === undefined));
  }
  await flushTimers();
  useStore.setState(JSON.parse(JSON.stringify(ccCorrect())));
  await flushTimers();
  useStore.getState().evaluateCircuit();
  {
    const s = useStore.getState();
    check('blank INPUTs: no row earned, every wire unset (-1), the OUTPUT unset',
      rows() === '' && s.wires.every((w) => w.value === -1) && comp('cc-out1')?.value === undefined);
  }
  await click('cc-in1');
  check('one canvas click sets the INPUT clicked and no other: IN2 stays blank, no row earned or picked',
    ins() === 'IN1=0 IN2=_' && rows() === '' && !useStore.getState().localStepActive, ins());
  await click('cc-in2');
  check('…the click that completes a row earns it and picks it in the table',
    ins() === 'IN1=0 IN2=0' && rows() === '0,0' && useStore.getState().localStepActive &&
      useStore.getState().localStepSelectedKey === '0,0', `${ins()} / ${rows()}`);
  useStore.getState().localStepSelect([0, 1]);
  check('a row click earns that row', rows() === '0,0 0,1');
  await click('cc-in1');
  check('…a canvas click earns the row the inputs now stand at (1,1)', rows() === '0,0 0,1 1,1');
  await click('cc-in2');
  check('…and the next, keeping the earlier ones (1,0)', rows() === '0,0 0,1 1,1 1,0');
  await click('cc-in2');
  check('…re-reaching an earned row adds nothing', rows() === '0,0 0,1 1,1 1,0');
  useStore.getState().moveComponent('cc-and', 260, 140);
  check('a move is not an edit: the earned rows stay', rows() === '0,0 0,1 1,1 1,0');
  useStore.getState().removeWire('cc-w3');
  check('a machine edit forgets the earned rows but the one the inputs stand at now', rows() === '1,1');
  useStore.getState().runControl('reset');
  check('CC Reset sets the inputs to 0…0 — that row is run', rows() === '1,1 0,0');
  await flushTimers();

  // A paste lands its INPUTs blank: the values they held on the canvas they
  // were copied from were never set on this one.
  await click('cc-in1');
  check('(the copied canvas holds IN1=1)', ins() === 'IN1=1 IN2=0', ins());
  useStore.setState({ selectedIds: useStore.getState().components.map((c) => c.id) });
  useStore.getState().copySelected();
  useStore.getState().addTab('Earned paste', 'CC');
  const refused = useStore.getState().paste();
  await flushTimers();
  {
    const s = useStore.getState();
    check('a paste lands every INPUT blank — no 0/1 carried over, no OUTPUT value, no row earned',
      refused === null && ins() === 'IN1=_ IN2=_' &&
        s.components.filter((c) => c.type === 'INPUT').every((c) => c.inputValues?.[0] == null) &&
        s.components.filter((c) => c.type === 'OUTPUT').every((c) => c.value === undefined) && rows() === '',
      `${ins()} / ${rows()}`);
  }
  await flushTimers();

  // An SC canvas never earns CC rows: its table runs step by step.
  useStore.getState().addTab('Earned SC', 'SC');
  useStore.setState(JSON.parse(JSON.stringify(scCorrect())));
  useStore.getState().setInputValue('sc-in1', 1);
  check('an SC canvas (MEM present) earns no CC row', rows() === '');
  await flushTimers();
  for (let i = 0; i < 3; i++) {
    useStore.getState().removeTab(useStore.getState().activeTabId);
    await flushTimers();
  }
  useStore.getState().goHome();
}

// ═════ The goal-reached cue and the Run's hold (task 025) ═══════

console.log('[turbot goal flash]');
{
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  // Q5: the CC corridor — 1×5, goal at x=4, start (0,0) facing E,
  // reach-and-stop; the sample brain walks until blocked, then stops.
  useStore.getState().switchQuestion(4);
  {
    const q = useStore.getState().assignment!.questions[4];
    if (useStore.getState().questionCircuits.get(q.id)?.done) useStore.getState().toggleCurrentQuestionDone();
  }
  useStore.setState(JSON.parse(JSON.stringify({ components: turbotCorrect().components, wires: turbotCorrect().wires })));
  const tb = () => useStore.getState();

  // Step: the event names the step that moved onto the goal; Step never holds.
  for (let i = 0; i < 3; i++) tb().turbotStep();
  check('steps 1-3 (off the goal): no event', tb().turbotHistory.length === 3 && tb().turbotLastEvent === null);
  tb().turbotStep();
  check('step 4 lands on the goal: goal-reached at t=4, selectTurbotGoalHit',
    tb().turbotState.x === 4 && tb().turbotLastEvent?.kind === 'goal-reached' && tb().turbotLastEvent?.t === 4 &&
      selectTurbotGoalHit(tb()));
  check('…and Step never holds', tb().turbotHoldTicks === 0);
  tb().turbotStep();
  check('step 5 (motor 00 on the goal — goal to goal is no arrival): event cleared, halted',
    tb().turbotHistory.length === 5 && tb().turbotHalted && tb().turbotStopReason === 'motor' &&
      tb().turbotLastEvent === null && !selectTurbotGoalHit(tb()));
  // Reset from a LIVE event (steps 1-4 again, onto the goal): event gone,
  // back to the start pose. (The hold is Run-only — pinned mid-hold below.)
  tb().turbotReset();
  for (let i = 0; i < 4; i++) tb().turbotStep();
  const liveStepEvent = tb().turbotLastEvent;
  tb().turbotReset();
  check('turbotReset clears a live event (Step path)',
    liveStepEvent?.kind === 'goal-reached' && liveStepEvent.t === 4 &&
      tb().turbotLastEvent === null && !selectTurbotGoalHit(tb()) &&
      tb().turbotHistory.length === 0 && tb().turbotState.x === 0);

  // Run: the hold is skipped ticks of the ONE interval — tick it by hand.
  const win = (globalThis as unknown as { window: { setInterval: (fn: () => void, ms: number) => number } }).window;
  const realSetInterval = win.setInterval;
  let tick: (() => void) | null = null;
  let armed = 0;
  win.setInterval = (fn: () => void) => { tick = fn; armed++; return 90210; };
  try {
    const runTicks = (n: number) => { for (let i = 0; i < n; i++) tick!(); };
    tb().turbotRun();
    check('(Run armed one interval)', armed === 1 && tb().turbotRunning && tb().turbotRunIntervalId === 90210);
    runTicks(4);
    check('Run: ticks 1-4 reach the goal (t=4) and arm a 2-tick hold',
      tb().turbotHistory.length === 4 && tb().turbotState.x === 4 && selectTurbotGoalHit(tb()) &&
        tb().turbotHoldTicks === TURBOT_GOAL_HOLD_TICKS && TURBOT_GOAL_HOLD_TICKS === 2);
    runTicks(1);
    check('Run: tick 5 holds (no step, hold 1)', tb().turbotHistory.length === 4 && tb().turbotHoldTicks === 1);
    runTicks(1);
    check('Run: tick 6 holds (no step, hold 0), the pulse still live',
      tb().turbotHistory.length === 4 && tb().turbotHoldTicks === 0 && selectTurbotGoalHit(tb()));
    runTicks(1);
    check('Run: tick 7 steps on (motor 00: halted on the goal), no new hold',
      tb().turbotHistory.length === 5 && tb().turbotHalted && tb().turbotStopReason === 'motor' && tb().turbotHoldTicks === 0);
    runTicks(1);
    check('Run: tick 8 sees the halt and stops the loop',
      !tb().turbotRunning && tb().turbotRunIntervalId === null && tb().turbotHistory.length === 5);

    // Reset mid-hold (event live, hold 2) clears both and stops the loop.
    tb().turbotReset();
    tb().turbotRun();
    runTicks(4);
    check('(Run: at the goal, holding, event live)',
      tb().turbotHoldTicks === 2 && tb().turbotLastEvent?.kind === 'goal-reached' && tb().turbotRunning);
    tb().turbotReset();
    check('turbotReset mid-hold clears the event and the hold, stops the run',
      tb().turbotLastEvent === null && tb().turbotHoldTicks === 0 && !tb().turbotRunning &&
        tb().turbotRunIntervalId === null && tb().turbotHistory.length === 0);

    // Pause mid-hold drops the rest of it; Run again steps on its first tick.
    tb().turbotRun();
    runTicks(4);
    check('(Run: at the goal, holding)', tb().turbotHoldTicks === 2 && tb().turbotRunning);
    tb().turbotPause();
    check('Pause mid-hold: hold 0, not running', tb().turbotHoldTicks === 0 && !tb().turbotRunning);
    tick = null;
    tb().turbotRun();
    check('(Run again armed a fresh interval)', armed === 4 && tick !== null);
    runTicks(1);
    check('Run after a mid-hold Pause steps on its first tick', tb().turbotHistory.length === 5);
    tb().turbotReset();

    // A machine edit right after a goal hit clears the event and the hold
    // (the edit law restarts the run through turbotReset).
    tb().turbotRun();
    runTicks(4);
    check('(Run: at the goal again, holding)', selectTurbotGoalHit(tb()) && tb().turbotHoldTicks === 2);
    tb().removeWire('tb-w3');
    check('an edit mid-hold restarts the run: no event, no hold, not running',
      tb().turbotLastEvent === null && tb().turbotHoldTicks === 0 && !tb().turbotRunning &&
        tb().turbotHistory.length === 0 && tb().turbotRunIntervalId === null);

    // Sandbox: an arena with two goals side by side — only the arrival counts.
    tb().enterSandbox();
    tb().addTab('Turbot g', 'turbot', 'turbot', 'CC');
    tb().setTabArena({
      width: 4,
      height: 1,
      cells: [['empty', 'goal', 'goal', 'empty']],
      start: { x: 0, y: 0, facing: 'E' },
    });
    useStore.setState(JSON.parse(JSON.stringify({ components: turbotCorrect().components, wires: turbotCorrect().wires })));
    tb().turbotStep();
    check('sandbox: step 1 onto the first goal is an arrival (t=1)',
      tb().turbotLastEvent?.kind === 'goal-reached' && tb().turbotLastEvent?.t === 1 && selectTurbotGoalHit(tb()));
    tb().turbotStep();
    check('sandbox: step 2, goal to goal, is not', tb().turbotState.x === 2 && tb().turbotLastEvent === null);
    tb().removeTab(tb().activeTabId);

    // A brain that halts right after arriving (FSM, no transition on a
    // block): the halting tick records no entry, so the event stays live —
    // the pulse is not cut — and must not re-arm the hold.
    tb().addTab('Turbot h', 'turbot', 'turbot', 'FSM');
    tb().setTabArena({ width: 2, height: 1, cells: [['empty', 'goal']], start: { x: 0, y: 0, facing: 'E' } });
    const forwardOnly = turbotFsmCorrect();
    useStore.setState(JSON.parse(JSON.stringify({
      components: forwardOnly.components,
      wires: forwardOnly.wires.filter((w) => w.id === 'tfsm-t1'), // 0:11 only
    })));
    tb().turbotRun();
    runTicks(1);
    check('(FSM: tick 1 arrives, holding)', selectTurbotGoalHit(tb()) && tb().turbotHoldTicks === 2);
    runTicks(3);
    check('Run: the brain\'s halt after the hold keeps the event (same t) and arms no second hold',
      tb().turbotHalted && tb().turbotStopReason === 'brain' && tb().turbotHistory.length === 1 &&
        selectTurbotGoalHit(tb()) && tb().turbotHoldTicks === 0);
    runTicks(1);
    check('…and the next tick stops the loop', !tb().turbotRunning && tb().turbotRunIntervalId === null);
    tb().removeTab(tb().activeTabId);
  } finally {
    win.setInterval = realSetInterval;
  }
  await flushTimers();
  tb().goHome();

  // The Map's side, pinned in the source (no DOM here).
  const { readFileSync } = await import('node:fs');
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const css = read('../src/index.css');
  const pulseMs = Number(css.match(/\.arena-goal--hit\s*\{\s*animation:\s*arena-goal-hit\s+(\d+)ms/)?.[1] ?? NaN);
  // The whole rule: name, duration, easing and nothing else, so no repeat count
  // (`infinite`, `2`) can slip in and the pulse plays exactly once.
  const pulseRule = css.match(/\.arena-goal--hit\s*\{([^}]*)\}/)?.[1] ?? '';
  check(`index.css: .arena-goal--hit pulses once in ≤ 600 ms (${pulseMs} ms)`,
    pulseMs > 0 && pulseMs <= 600 &&
      /^\s*animation:\s*arena-goal-hit\s+\d+ms\s+[a-z-]+;\s*$/.test(pulseRule) &&
      !/iteration-count/.test(pulseRule));
  check('index.css: prefers-reduced-motion turns the pulse off',
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.arena-goal--hit\s*\{\s*animation:\s*none;\s*\}\s*\}/.test(css));
  check('TurbotArenaPanel: an event already live at mount is suppressed (no replay on return)',
    /useState<TurbotEvent \| null>\(\s*\(\) => useStore\.getState\(\)\.turbotLastEvent,?\s*\)/
      .test(read('../src/components/TurbotArenaPanel.tsx')));
  const canvas = read('../src/components/ArenaCanvas.tsx');
  check('ArenaCanvas: the class only under highlightGoal, on the turbot\'s cell, never with onCellClick',
    canvas.split("' arena-goal--hit'").length === 2 &&
      /highlightGoal && hasTurbot && !onCellClick \? ' arena-goal--hit'/.test(canvas));
  const panel = read('../src/components/TurbotArenaPanel.tsx');
  check('TurbotArenaPanel: highlightGoal gated on !editingMap, and no timer of its own',
    /highlightGoal=\{!editingMap && goalHit && /.test(panel) && !/setTimeout|setInterval/.test(panel));
  check('the instructor arena editor and the problem-set document never pass highlightGoal',
    !read('../src/instructor/TurbotArenasEditor.tsx').includes('highlightGoal') &&
      !read('../src/components/ProblemSetDocument.tsx').includes('highlightGoal'));
  const storeSrc = read('../src/store.ts');
  const sliceAt = storeSrc.indexOf('// ─── Turbot state');
  const slice = sliceAt < 0 ? '' : storeSrc.slice(sliceAt, storeSrc.indexOf('// ─── Graded-case replay', sliceAt));
  check('the turbot slice runs on ONE timer (turbotRun\'s interval), no setTimeout',
    slice.split('window.setInterval(').length === 2 && !slice.includes('setTimeout'));
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

// ═════ The output panel's one control row (task 053) ═════════════

console.log('[run controls]');
{
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  const st = () => useStore.getState();
  const rc = () => selectRunControls(st());
  const open = (i: number, machine: { components: unknown; wires: unknown }) => {
    st().switchQuestion(i);
    const q = st().assignment!.questions[i];
    if (st().questionCircuits.get(q.id)?.done) st().toggleCurrentQuestionDone();
    useStore.setState(JSON.parse(JSON.stringify({ components: machine.components, wires: machine.wires })));
  };

  // A combinational circuit: its local step (the signal-flow animation).
  open(0, ccCorrect());
  check('CC: the row is the local step, idle and ready',
    rc()?.kind === 'cc' && rc()!.canRun && rc()!.canStep && rc()!.canReset && !rc()!.running);
  st().runControl('step');
  check('CC Step with no row picked picks the current inputs\' row and plays one step',
    st().localStepActive && st().localStepIndex === 1 && rc()!.status === `1/${st().localStepSorted.length}`);
  st().runControl('run', { intervalMs: 5 });
  check('CC Run plays in the store\'s one loop', st().localStepRunning && st().localStepRunId !== null && rc()!.running && !rc()!.canRun);
  st().runControl('stop');
  check('Stop pauses it', !st().localStepRunning && st().localStepRunId === null);
  st().runControl('run', { intervalMs: 5 });
  st().addComponent('NOT', 600, 600);
  check('a machine edit mid-run stops the CC run and drops the row (the edit law)',
    !st().localStepRunning && !st().localStepActive);
  st().runControl('reset');
  {
    const ins = sortByLabel(st().components, 'IN');
    check('CC Reset: every input 0, the canvas un-run on that row',
      ins.length > 0 && ins.every((c) => c.value === 0) && st().localStepActive && st().localStepIndex === 0 &&
        st().localStepSelectedKey === ins.map(() => 0).join(','));
  }
  st().runControl('run', { intervalMs: 5 });
  for (let i = 0; i < 200 && st().localStepRunning; i++) await flushTimers();
  check('a Run plays to the end of the row and stops itself',
    !st().localStepRunning && st().localStepIndex >= st().localStepSorted.length);
  st().runControl('step');
  check('…and Step after the end plays the row again from the top', st().localStepIndex === 1);
  st().runControl('run', { intervalMs: 50 });
  st().switchQuestion(2);
  check('a canvas swap stops the CC run and forgets the row', !st().localStepRunning && !st().localStepActive);

  // An FSM.
  open(2, fsmCorrect());
  st().setFsmInputSequence([1, 0, 1]);
  check('FSM: the row is the FSM\'s run', rc()?.kind === 'fsm' && rc()!.canStep);
  st().runControl('step');
  check('FSM Step steps, and the readout says t and the state',
    st().fsmTimeStep === 2 && st().fsmHistory.length === 1 && /^t=1 · \S+/.test(rc()!.status ?? ''));
  st().runControl('reset');
  check('FSM Reset: back to t=1', st().fsmTimeStep === 1 && st().fsmHistory.length === 0);

  // A TM.
  open(3, tmCorrect());
  check('TM: the row is the TM\'s run', rc()?.kind === 'tm' && rc()!.canStep);
  st().runControl('step');
  check('TM Step steps', st().tmTimeStep === 2 || st().tmHalted);
  st().runControl('reset');
  check('TM Reset: back to t=1', st().tmTimeStep === 1 && !st().tmHalted);

  // An SC circuit: the Global I/O row (the grader's run).
  open(1, scCorrect());
  st().setScGlobalSequenceInput(0, '0110');
  check('SC: the row plays the Global I/O row', rc()?.kind === 'sc' && rc()!.canStep);
  st().runControl('step');
  check('SC Step loads the first typed Global row and steps it', st().scActiveGlobalIndex === 0 && st().scTimeStep === 2);
  st().runControl('reset');
  check('SC Reset: back to t=1 on the same row', st().scTimeStep === 1 && st().scInputSequence.length > 0 && st().scActiveGlobalIndex === 0);
  st().switchQuestion(0);
  check('a canvas swap forgets the Global row', st().scActiveGlobalIndex === null);

  // A turbot.
  open(4, turbotCorrect());
  check('turbot: the row is the turbot\'s run', rc()?.kind === 'turbot' && rc()!.canRun && rc()!.canStep);
  st().runControl('step');
  check('turbot Step steps', st().turbotHistory.length === 1);
  st().setTurbotEditingMap(true);
  check('editing the Map stands the run controls down', !rc()!.canRun && !rc()!.canStep && !rc()!.canReset);
  st().runControl('step');
  check('…and a Step then does nothing', st().turbotHistory.length === 1);
  st().switchQuestion(0);
  check('a canvas swap closes the Map editor', !st().turbotEditingMap);
  st().goHome();
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
  check('…and the edit started a live editing record', liveTrace() != null);
  useStore.setState({ selectedIds: [aGate.id] });
  useStore.getState().copySelected();
  // …and a sentence copied in an answer field (usePasteGuard's text slot).
  stampText("A's sentence", currentProvenance({ kind: 'assignment', assignmentId: SAMPLE_ASSIGNMENT_ID }));
  // A's own submission (the map holds only the principal's own — task 037).
  // The sample has no due date, so this never freezes it.
  await useStore.getState().submitAssignment(SAMPLE_ASSIGNMENT_ID, A);
  await useStore.getState().hydrateSubmissions();
  {
    const s = useStore.getState();
    check('A has a gate, a clipboard (both seam slots), history and a submissions map',
      aGate != null && peekClipboard().canvas != null && peekClipboard().text != null && s.undoStack.length > 0 && Object.keys(s.submissions).length > 0);
  }

  // Sign out exactly as SessionControls.signOut does: Home first, then the
  // provider reports the visitor. (A's run slices hold junk — a graded case
  // loaded, a second arena on the Map — which must not reach the visitor.)
  useStore.getState().goHome();
  plantSimJunk();
  // …and one of A's submissions on show (task 003).
  useStore.setState({ viewingSubmission: Object.values(useStore.getState().submissions)[0] ?? null });
  check('A has a submission on show', useStore.getState().viewingSubmission != null);
  useStore.getState().resetForPrincipal(null);
  {
    const s = useStore.getState();
    check('sign-out: no assignment in memory', s.assignment === null && s.questionCircuits.size === 0);
    check("sign-out: no submission on show (it was A's)", s.viewingSubmission === null);
    check('sign-out: live canvas empty', s.components.length === 0 && s.wires.length === 0 && s.boxes.length === 0);
    check('sign-out: box library empty', s.confirmedBoxLibrary.length === 0);
    check('sign-out: clipboard empty (both seam slots)', clipboardEmpty());
    check('sign-out: selection empty', s.selectedIds.length === 0);
    check('sign-out: submissions map empty', Object.keys(s.submissions).length === 0);
    check('sign-out: back to the welcome state', !s.workbookOpen && s.autoSaveStatus === 'saved');
    check("sign-out: the mint keys are gone (they were A's)", mintKeyFor(SAMPLE_ASSIGNMENT_ID) === null);
    check('sign-out: no live answer text or editing record (task 048: every part\'s)',
      Object.keys(s.liveText).length === 0 && Object.keys(s.liveTraces).length === 0);
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
  // The stale hydrate starts under A, who owns a submission (above): hydrate
  // reads only the principal's own (task 037), so under anyone who never
  // submitted it would write {} with or without the epoch guard.
  useStore.getState().resetForPrincipal(A);
  await useStore.getState().hydrateSubmissions();
  check("(control) a hydration under A that runs to completion writes A's submission",
    Object.keys(useStore.getState().submissions).length > 0);
  const staleHydrate = useStore.getState().hydrateSubmissions();
  useStore.getState().resetForPrincipal(B);
  await staleHydrate;
  check("a hydration started before the change writes nothing after it", Object.keys(useStore.getState().submissions).length === 0);
  const EPOCH_ID = `${SAMPLE_ASSIGNMENT_ID}-epoch`;
  await localAssignmentStore.save({ ...buildSampleAssignment(), id: EPOCH_ID, dueDate: new Date(Date.now() + 86_400_000).toISOString() });
  await localAssignmentStore.setVisible(EPOCH_ID, true);
  useStore.getState().resetForPrincipal(A);
  const staleSubmit = useStore.getState().submitAssignment(EPOCH_ID, A);
  useStore.getState().resetForPrincipal(B);
  check('a submit started before the change still records', (await staleSubmit) != null);
  check("…but does not badge the next person's submissions map", Object.keys(useStore.getState().submissions).length === 0);
}

// ═════ Every student-side read sees only the principal's own (task 037) ═══

console.log('[own submissions]');
{
  const { buildCorrectSubmission } = await import('../src/devData/sampleData');
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const OWN_ID = `${SAMPLE_ASSIGNMENT_ID}-own`;
  const A = 'own-a@x.test';
  const B = 'own-b@x.test';
  const C = 'own-c@x.test'; // never submits
  const I = 'ada.instructor@example.com';
  const dayMs = 24 * 60 * 60 * 1000;
  const ownAsg = { ...buildSampleAssignment(), id: OWN_ID, title: 'Own Sample', dueDate: new Date(Date.now() + dayMs).toISOString() };
  await localAssignmentStore.save(ownAsg);
  await localAssignmentStore.setVisible(OWN_ID, true);

  // Law 5: local mode never touches the network — count every fetch.
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls++;
    return realFetch(...args);
  }) as typeof fetch;
  try {
    // Seam level. B submits first, so a read of everyone's list would meet
    // B's attempt 1 before A's.
    const sub = (who: string) =>
      submissionStore.submit(OWN_ID, { ...buildCorrectSubmission(who), submittedAt: new Date().toISOString() });
    const b1 = await sub(B);
    const a1 = await sub(A);
    const a2 = await sub(A);
    const i1 = await sub(I);
    const anon = await sub(''); // a dev-seed style anonymous attempt
    check('attempts count per (assignment, student): B 1; A 1, 2 (not 2, 3); I 1; anonymous 1',
      b1.attempt === 1 && a1.attempt === 1 && a2.attempt === 2 && i1.attempt === 1 && anon.attempt === 1);
    const ownA = await submissionStore.listOwn(OWN_ID, A);
    check("listOwn(A) is exactly A's two attempts, in order",
      ownA.length === 2 && ownA.map((r) => r.attempt).join() === '1,2' &&
        ownA.every((r) => r.submission.student === A));
    const latestB = await submissionStore.getLatestOwn(OWN_ID, B);
    check("getLatestOwn(B) is B's attempt 1", latestB?.attempt === 1 && latestB.submission.student === B);
    const latestAUpper = await submissionStore.getLatestOwn(OWN_ID, ` ${A.toUpperCase()} `);
    check('the email matches trimmed and case-insensitively',
      latestAUpper?.attempt === 2 && latestAUpper.submission.student === A);
    check('a visitor (null) owns nothing — not even the anonymous attempt',
      (await submissionStore.listOwn(OWN_ID, null)).length === 0 &&
        (await submissionStore.getLatestOwn(OWN_ID, null)) === null);
    check('C, who never submitted, owns nothing', (await submissionStore.getLatestOwn(OWN_ID, C)) === null);
    check("listAll (the gradebook's read) holds everyone's five attempts",
      (await submissionStore.listAll(OWN_ID)).length === 5);

    // A human grade (task 063) lands on the named student's work only, and
    // comes back WITH that student's records — student-safe in their own
    // copy, in full (grader, version, studentKey) in the gradebook's.
    const openQ = b1.result?.questions.find((q) => q.status === 'pending')?.questionId;
    check('the sample has a pending open question to grade', openQ != null);
    const wrote = await gradingStore.setGrade(OWN_ID, B.toLowerCase(), openQ!, { points: 1, note: 'ok', version: null });
    check('setGrade(B) writes version 1', wrote.ok && wrote.grade?.version === 1 && wrote.grade.points === 1);
    const b1After = await submissionStore.getLatestOwn(OWN_ID, B);
    const a1After = (await submissionStore.listOwn(OWN_ID, A))[0];
    check("…B's own copy carries it, student-safe (no grader, no version); A's carries none",
      b1After?.grades?.length === 1 && b1After.grades[0].points === 1 && b1After.grades[0].grader === undefined &&
        b1After.grades[0].version === undefined && a1After.grades === undefined);
    const allAfter = await submissionStore.listAll(OWN_ID);
    const bInAll = allAfter.find((r) => r.submission.student === B);
    check("…the gradebook's copy carries it in full, with the studentKey that addresses B",
      allAfter.length === 5 && bInAll?.studentKey === B.toLowerCase() && bInAll.grades?.[0].version === 1 &&
        typeof bInAll.grades?.[0].grader === 'string');
    const stale = await gradingStore.setGrade(OWN_ID, B.toLowerCase(), openQ!, { points: 0, version: null });
    check('a write that read no grade, now that there is one, is a conflict carrying it',
      !stale.ok && stale.conflict && stale.current?.version === 1);

    // Store level: the hydrated map, the open, viewSubmission.
    useStore.getState().resetForPrincipal(A);
    await useStore.getState().hydrateSubmissions();
    {
      const r = useStore.getState().submissions[OWN_ID];
      check("A's hydrated map holds A's own latest (attempt 2)", r?.attempt === 2 && r.submission.student === A);
    }
    check('A opens the assignment', (await useStore.getState().openAssignment(OWN_ID)) === true);
    check('A views attempt 1 through the seam', (await useStore.getState().viewSubmission(1)) === true);
    {
      const v = useStore.getState().viewingSubmission;
      check("…and it is A's own attempt 1, never B's", v?.attempt === 1 && v.submission.student === A);
    }
    await useStore.getState().viewSubmission(null);
    useStore.getState().closeAssignment();

    // The deadline passes: a freeze needs the principal's OWN submission.
    await localAssignmentStore.save({ ...ownAsg, dueDate: new Date(Date.now() - dayMs).toISOString() });
    useStore.getState().resetForPrincipal(C);
    await useStore.getState().hydrateSubmissions();
    check("C's hydrated map has no entry (no \"Last submitted\" from anyone else's)",
      !(OWN_ID in useStore.getState().submissions));
    check('C opens the past-due assignment', (await useStore.getState().openAssignment(OWN_ID)) === true);
    {
      const s = useStore.getState();
      check("…still no entry, not frozen by others' submissions, nothing on show",
        !(OWN_ID in s.submissions) && !selectAssignmentFrozen(s) && s.viewingSubmission === null);
    }
    useStore.getState().closeAssignment();
    useStore.getState().resetForPrincipal(A);
    await useStore.getState().openAssignment(OWN_ID);
    {
      const s = useStore.getState();
      check("A's past-due open freezes on A's own latest (attempt 2)",
        selectAssignmentFrozen(s) && s.viewingSubmission?.attempt === 2 && s.viewingSubmission.submission.student === A);
    }
    useStore.getState().closeAssignment();

    // An instructor's Student view is a student-side read too.
    useStore.getState().resetForPrincipal(I);
    await useStore.getState().hydrateSubmissions();
    {
      const r = useStore.getState().submissions[OWN_ID];
      check("the instructor's Student view sees only the instructor's own attempt",
        r?.attempt === 1 && r.submission.student === I);
    }
    useStore.getState().resetForPrincipal(null);
  } finally {
    globalThis.fetch = realFetch;
  }
  check('…all with zero network traffic (law 5)', fetchCalls === 0);

  // Only the gradebook may read everyone's: `listAll(` appears under
  // instructor/ (the gradebook, the dashboard's counts) and storage/ (the
  // seam) alone, so no student surface can reach it.
  const srcRoot = new URL('../src/', import.meta.url);
  const walk = (dir: URL, rel = ''): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = new URL(name, dir);
      return statSync(path).isDirectory()
        ? walk(new URL(`${name}/`, dir), `${rel}${name}/`)
        : /\.tsx?$/.test(name) ? [`${rel}${name}`] : [];
    });
  const callers = walk(srcRoot).filter((f) => readFileSync(new URL(f, srcRoot), 'utf8').includes('listAll('));
  check('listAll( appears only under instructor/ and storage/',
    callers.length > 0 && callers.every((f) => f.startsWith('instructor/') || f.startsWith('storage/')));
  // The API client's own everyone-read reaches /submissions/all directly, so it
  // is gated too: only the client (which defines it) and the remote seam use it.
  const rawCallers = walk(srcRoot).filter((f) => f !== 'api/client.ts' &&
    readFileSync(new URL(f, srcRoot), 'utf8').includes('listAllSubmissions'));
  check('listAllSubmissions appears only in api/client.ts and storage/ (the remote seam)',
    rawCallers.length > 0 && rawCallers.every((f) => f.startsWith('storage/')), rawCallers.join(', '));
  // The instructor views read the GradingStore's summaries (task 065), which
  // read listAll themselves (storage/) — no view reads every attempt.
  check('…and no instructor view calls it (they read the GradingStore summaries)',
    callers.some((f) => f.startsWith('storage/')) && !callers.some((f) => f.startsWith('instructor/')), callers.join(', '));
}

// ═════ Each question's editing record rides every canvas swap ═══

console.log('[provenance across canvas swaps]');
{
  // The fold and the load are written ONCE (store.ts foldLiveProblem /
  // loadProblemFields — every part of the open problem, task 048), so no
  // swap can drop a live field on the way.
  const { readFileSync } = await import('node:fs');
  const storeSrc = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
  const folds = storeSrc.match(/responseText: \w+\.responseText,\s*\n\s*fillAnswers: \w+\.fillAnswers,\s*\n\s*done: /g) ?? [];
  check('one fold: the live canvas + text are folded into a container in one place only',
    folds.length === 1 && (storeSrc.match(/\bfunction foldLiveProblem\(/g) ?? []).length === 1);
  check('one load: a container is loaded into the live text in one place only',
    (storeSrc.match(/responseText: saved\.responseText \?\? ''/g) ?? []).length === 1 &&
    (storeSrc.match(/\bfunction loadProblemFields\(/g) ?? []).length === 1);
  check('…and the single-question fields are gone (openResponse, fillAnswers, questionTrace)',
    !/\b(openResponse|questionTrace|foldLiveQuestion|loadQuestionFields)\b|\bs(tate)?\.fillAnswers\b/.test(storeSrc));

  useStore.getState().resetForPrincipal('swap@x.test');
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  const asg = useStore.getState().assignment!;
  const [q1, q2] = [asg.questions[0].id, asg.questions[1].id];
  const trace = () => JSON.stringify(liveTrace());
  const saved = (qid: number) => JSON.stringify(useStore.getState().questionCircuits.get(qid)?.provenance ?? null);
  useStore.getState().switchQuestion(0);
  if (useStore.getState().questionCircuits.get(q1)?.done) useStore.getState().toggleCurrentQuestionDone();
  useStore.getState().addComponent('AND', 120, 120);
  const t1 = trace();
  check('an edit on P1 writes its live record', liveTrace() != null);
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
  check('closeAssignment drops the live record', liveTrace() === null);
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0);
  check('openAssignment loads each record back from the workbook seam, byte-equal',
    trace() === t1 && saved(q2) === t2);
  useStore.getState().goHome();
}

// ═════ A multi-part problem is ONE page (task 048) ═══════════════

console.log('[multi-part problem]');
{
  // The real HW1 (its problems 6, 9, 10 and 13 have parts), undated so it
  // freezes only when this section says so.
  const { readFileSync } = await import('node:fs');
  const hw1 = JSON.parse(readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'));
  const PARTS_ID = 'hw1-parts';
  const who = 'parts@x.test';
  const def = { ...hw1, id: PARTS_ID, dueDate: undefined };
  await localAssignmentStore.save(def);
  await localAssignmentStore.setVisible(PARTS_ID, true);
  const idx = (id: number) => def.questions.findIndex((q: { id: number }) => q.id === id);
  const st = () => useStore.getState();
  const saved = (id: number) => st().questionCircuits.get(id);

  // A workbook saved before the fold (task 046's lettered questions): the
  // student was on "6b", with answers under 18 and 19.
  await workbookStore.saveAssignmentState(PARTS_ID, {
    currentQuestionIndex: idx(18),
    questionCircuits: {
      18: { components: [], wires: [], boxes: [], responseText: 'It maps x, y, z to 3 + xyz.' },
      19: { components: [], wires: [], boxes: [], fillAnswers: ['3'] },
    },
  });
  st().resetForPrincipal(who);
  check('HW1 opens', (await st().openAssignment(PARTS_ID)) === true);
  check('a saved index on part b opens problem 6\'s page (its first part)', st().currentQuestionIndex === idx(6));
  check('the old answers under 18 and 19 show on that page',
    liveResponse(18) === 'It maps x, y, z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3' && liveResponse(6) === '');
  check('the page holds exactly its three parts', Object.keys(st().liveText).map(Number).sort((a, b) => a - b).join() === '6,18,19');

  // Each part's field is its own; navigating away folds every part.
  st().setOpenResponse(6, 'Apply m to three arguments; it returns 3 plus their product.');
  st().setOpenResponse(18, 'm maps x, y and z to 3 + xyz.');
  st().setFillAnswer(19, 0, '3');
  st().setOpenResponse(7, 'not on this page');
  check('a part not on the open page is refused', st().liveText[7] === undefined && saved(7)?.responseText === undefined);
  check('each part keeps its own editing record, signed under its own id',
    liveTrace(6) != null && liveTrace(18) != null && liveTrace(19) != null &&
    JSON.stringify(liveTrace(6)) !== JSON.stringify(liveTrace(18)));

  // [worksheet] Done when 0, rendered for real (react-dom/server) from the
  // store's own page, live text and lock, as the Worksheet connector hands
  // them over: the stem, then each part's letter and prompt DIRECTLY followed
  // by that part's field (by its kind, holding that part's answer), then the
  // closing, then the one foot line.
  console.log('[worksheet]');
  // KaTeX (the statements' math) asks the document for standards mode.
  (globalThis as unknown as { document: Record<string, unknown> }).document.compatMode = 'CSS1Compat';
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { WorksheetSheet } = await import('../src/components/Worksheet');
  // tsx compiles .tsx with the classic JSX transform: a global React.
  (globalThis as unknown as Record<string, unknown>).React = React;
  const sheet = (): string => renderToStaticMarkup(React.createElement(WorksheetSheet, {
    assignment: st().assignment!,
    index: st().currentQuestionIndex,
    liveText: st().liveText,
    lockNotice: selectLockNotice(st()),
    pasteNotice: null,
    saveFailing: false,
    pasteGuardRef: () => undefined,
    onText: st().setOpenResponse,
    onFill: st().setFillAnswer,
  }));
  /** Every piece found, each after the one before it (null = in order). */
  const outOfOrder = (html: string, pieces: string[]): string | null => {
    let at = 0;
    for (const p of pieces) {
      const i = html.indexOf(p, at);
      if (i < 0) return `"${p}" missing after offset ${at}`;
      at = i + p.length;
    }
    return null;
  };
  const count = (html: string, piece: string) => html.split(piece).length - 1;
  const letter = (x: string) => `<strong class="wb-sheet-letter">${x}.</strong>`;
  const LINE = '<input class="wb-sheet-line"';
  const PARAGRAPH = '<textarea class="wb-answer-text wb-sheet-paragraph"';
  const BLANK = '<input class="wb-fill-input"';
  const CELL = '<input class="wb-fill-cell"';
  const FOOT = '<div class="wb-answer-foot">Saved as you type.</div>';
  {
    const html = sheet();
    const order = outOfOrder(html, [
      'Problem 6', 'defined by the following', // the stem
      letter('a'), 'Define the function in English', PARAGRAPH, '>Apply m to three arguments', '</textarea>',
      letter('b'), 'Describe the function with another English sentence', LINE, 'value="m maps x, y and z to 3 + xyz."',
      letter('c'), 'How many', BLANK, 'value="3"',
      FOOT,
    ]);
    check('problem 6 reads as a worksheet: the stem, then a, b, c — each prompt directly followed by its own field and answer, then the foot',
      order === null, order ?? undefined);
    check('…each part\'s field by its kind: a paragraph (6a), a line (6b), a blank (6c) — one each, nothing else',
      count(html, PARAGRAPH) === 1 && count(html, LINE) === 1 && count(html, BLANK) === 1 && count(html, CELL) === 0);
    check('…the stem once, above every part (not restated per part)',
      count(html, 'defined by the following') === 1 && html.indexOf('defined by the following') < html.indexOf(letter('a')));
    check('…and nothing on it is read-only while the problem is open', !/readOnly|readonly/.test(html));
  }
  // A single written question reads the same way: its statement, then its field.
  st().switchQuestion(idx(7));
  st().setOpenResponse(7, 'k(x, y) = xy + 1');
  {
    const html = sheet();
    const order = outOfOrder(html, ['Problem 7', 'successor', PARAGRAPH, '>k(x, y) = xy + 1</textarea>', FOOT]);
    check('a single written question (7): its statement, then its one paragraph field, then the foot — no letter',
      order === null && !html.includes('wb-sheet-letter') && count(html, PARAGRAPH) === 1, order ?? undefined);
  }
  // Problem 9: a line and 079's table, then the closing. The table part is
  // set through the store like any part (cell (r, c) is fillAnswers[r·3 + c]).
  st().switchQuestion(idx(20));
  check('opening 9b lands on problem 9\'s page', st().currentQuestionIndex === idx(9));
  st().setOpenResponse(9, 'j(x, y) = x times y');
  for (const [i, v] of [[0, '0'], [1, '0'], [2, '0'], [24, '2'], [25, '2'], [26, '4']] as const) st().setFillAnswer(20, i, v);
  check('the table part (9b) takes its cells through the store, under its own id',
    st().liveText[20]?.fillAnswers.slice(0, 3).join() === '0,0,0' && st().liveText[20]?.fillAnswers[26] === '4' &&
      liveTrace(20) != null && liveResponse(9) === 'j(x, y) = x times y');
  {
    const html = sheet();
    const order = outOfOrder(html, [
      'Problem 9', 'maps two integers', // the stem
      letter('a'), 'with an equation', LINE, 'value="j(x, y) = x times y"',
      letter('b'), 'with a table', '<table class="mm-table wb-fill-table">', '>x</th>', '>y</th>', '>j(x, y)</th>',
      CELL, 'value="0"', 'aria-label="j(x, y), row 9"', 'value="4"', '</table>',
      'partial functions', // the closing, after the last part
      FOOT,
    ]);
    check('problem 9 reads as a worksheet: the stem, a\'s line, b\'s table (headers, then its 9 rows of cells), then the closing',
      order === null, order ?? undefined);
    check('…the table draws exactly its authored 9 rows × 3 columns of cells, from no key',
      count(html, CELL) === 27 && count(html, LINE) === 1 && count(html, PARAGRAPH) === 0);
  }
  // A line part holding a line break (an answer saved while 9a was a
  // paragraph) keeps a paragraph field: an <input> would flatten the break.
  st().setOpenResponse(9, 'j(x, y) = x times y for x, y from 0 to 2\nundefined otherwise');
  {
    const html = sheet();
    check('a line part whose answer already holds a line break renders a paragraph field, the break intact',
      count(html, LINE) === 0 && count(html, PARAGRAPH) === 1 &&
        html.includes('>j(x, y) = x times y for x, y from 0 to 2\nundefined otherwise</textarea>'));
  }
  st().switchQuestion(idx(6));
  check('leaving problem 9 folds the table part under its own id',
    saved(20)?.fillAnswers?.[26] === '4' && saved(20)?.provenance != null && saved(9)?.responseText?.includes('\n') === true);
  check('back on problem 6, its parts load back', liveResponse(18) === 'm maps x, y and z to 3 + xyz.');

  st().switchQuestion(idx(7));
  check('navigating away folds every part under its own id',
    saved(6)?.responseText?.startsWith('Apply m') === true && saved(18)?.responseText === 'm maps x, y and z to 3 + xyz.' &&
      saved(19)?.fillAnswers?.[0] === '3' && saved(18)?.provenance != null && saved(19)?.provenance != null);
  st().switchQuestion(idx(19));
  check('switchQuestion(part c) lands on the first part\'s page', st().currentQuestionIndex === idx(6));
  const textBefore = st().liveText;
  st().switchQuestion(idx(18));
  check('…and another part of the open page is no swap at all', st().liveText === textBefore && st().currentQuestionIndex === idx(6));
  check('its parts load back', liveResponse(18) === 'm maps x, y and z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3');

  // One Mark done covers the problem: the toggle writes every part, and the
  // one lock (isCurrentQuestionLocked) refuses every part's setter.
  st().toggleCurrentQuestionDone();
  check('the done toggle writes every part', [6, 18, 19].every((id) => saved(id)?.done === true));
  check('the problem reads locked', selectQuestionLocked(st()));
  {
    const html = sheet();
    const notice = selectLockNotice(st());
    check('[worksheet] done: every part\'s field renders read-only, and the foot says why',
      notice !== null && count(html, 'readOnly=""') === 3 && html.includes(`<div class="wb-answer-foot">${notice}</div>`) &&
        !html.includes(FOOT));
  }
  st().setOpenResponse(18, 'sneaking in an edit');
  st().setFillAnswer(19, 0, '4');
  st().setOpenResponse(6, 'sneaking in an edit');
  check('every part\'s setter is refused while done',
    liveResponse(18) === 'm maps x, y and z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3' && liveResponse(6).startsWith('Apply m'));
  st().toggleCurrentQuestionDone();
  check('toggling again unlocks every part', [6, 18, 19].every((id) => saved(id)?.done === false) && !selectQuestionLocked(st()));
  // A legacy save with only some parts done (each part had its own mark):
  // the problem is not done until every part is, and the toggle marks all.
  useStore.setState({ questionCircuits: new Map(st().questionCircuits).set(18, { ...saved(18)!, done: true }) });
  check('one part done of three: the problem is not done (not locked)', !selectQuestionLocked(st()));
  st().toggleCurrentQuestionDone();
  check('…and the toggle then marks every part', [6, 18, 19].every((id) => saved(id)?.done === true));
  st().toggleCurrentQuestionDone();

  // A submission on show shows every part's SUBMITTED answer, read-only.
  const rec = await st().submitAssignment(PARTS_ID, who);
  const n = rec!.attempt;
  check('the submission carries each part as its own answer',
    rec?.submission.answers.find((a) => a.questionId === 18)?.responseText === 'm maps x, y and z to 3 + xyz.' &&
      rec?.submission.answers.find((a) => a.questionId === 19)?.fillAnswers?.[0] === '3');
  st().setOpenResponse(18, 'changed after submitting');
  check('(b edited after submitting)', liveResponse(18) === 'changed after submitting');
  check(`viewSubmission(${n}) resolves`, (await st().viewSubmission(n)) === true);
  check('the view shows every part\'s submitted answer',
    liveResponse(18) === 'm maps x, y and z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3' && liveResponse(6).startsWith('Apply m'));
  st().setOpenResponse(18, 'sneaking in an edit');
  st().setFillAnswer(19, 0, '9');
  check('…read-only: every part\'s setter is refused', liveResponse(18) === 'm maps x, y and z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3');
  await st().viewSubmission(null);
  check('back to the live work: part b as last edited', liveResponse(18) === 'changed after submitting');

  // Frozen (past due + submitted): every part shows the submission.
  useStore.setState({ assignment: { ...st().assignment!, dueDate: new Date(Date.now() - 86_400_000).toISOString() } });
  check('now frozen', selectAssignmentFrozen(st()));
  st().setOpenResponse(18, 'sneaking in an edit');
  check('every part is locked once frozen', liveResponse(18) === 'changed after submitting');
  st().switchQuestion(idx(7));
  st().switchQuestion(idx(18));
  check('the frozen page shows every part\'s submitted answer',
    st().currentQuestionIndex === idx(6) && liveResponse(18) === 'm maps x, y and z to 3 + xyz.' && st().liveText[19]?.fillAnswers[0] === '3');

  st().goHome();
  st().resetForPrincipal(null);
  check('a principal change clears every part\'s live text and record',
    Object.keys(st().liveText).length === 0 && Object.keys(st().liveTraces).length === 0);
  // It has a submission now, so it is hidden rather than removed.
  await localAssignmentStore.setVisible(PARTS_ID, false);
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
    await Promise.all(inFlight);

    // Task 003: a submission VIEWED at the change. Entering the view only
    // flushes the live save, which, with a save already in flight, waits as
    // the trailing rerun the reset cancels — the leaving save must still land
    // the live work (its snapshot never folds the viewed canvas).
    useStore.getState().resetForPrincipal(E);
    const qv = await openQ1();
    const vrec = await useStore.getState().submitAssignment(SAMPLE_ASSIGNMENT_ID, E);
    check('a seam save is in flight a third time', await startSlowSave());
    const beforeV = new Set(useStore.getState().components.map((c) => c.id));
    useStore.getState().addComponent('OR', 320, 320);
    const newerV = useStore.getState().components.find((c) => !beforeV.has(c.id))!;
    check('the submission opens for viewing with that live edit unsaved',
      vrec != null && (await useStore.getState().viewSubmission(vrec.attempt)) === true &&
        showsSubmission(useStore.getState()));
    useStore.getState().resetForPrincipal(null); // a 401 while viewing: no goHome
    const storedV = await workbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID);
    check('a live edit left unsaved behind a viewed submission reaches the seam at the change',
      storedV?.questionCircuits[qv.id]?.components.some((c) => c.id === newerV.id) === true);
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

// ═════ The canvas's pointer gestures (task 024) ═════════════════

console.log('[canvas gestures]');
{
  // No DOM here, so the gesture layer (React pointer events) is pinned in the
  // source; what shift-click DOES is rotateComponent, pinned live above in
  // [mark as done] and [viewing a submission].
  const { readFileSync } = await import('node:fs');
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const canvas = read('../src/components/CircuitCanvas.tsx');
  const start = canvas.indexOf('const handlePointerDown = useCallback(');
  const handler = start < 0 ? '' : canvas.slice(start, canvas.indexOf('\n  );\n', start));
  const mapAt = handler.indexOf('// ── Modifier map');
  const map = mapAt < 0 ? '' : (handler.slice(mapAt).match(/^(?:\s*\/\/.*\n)+/)?.[0] ?? '');
  check('handlePointerDown opens with the ONE modifier map (shift, cmd/ctrl, alt, detail)',
    mapAt >= 0 && mapAt < handler.indexOf('if (e.button !== 0') &&
    ['shift', 'cmd/ctrl', 'alt', 'detail'].every((word) => map.includes(word)));
  // modifierClick: the shift branch connects (STATE → STATE), refuses a
  // STATE, then rotates; the cmd/ctrl branch only toggles. Rotation happens
  // nowhere else in the handler.
  const mcAt = handler.indexOf('const modifierClick = ');
  const mc = mcAt < 0 ? '' : handler.slice(mcAt, handler.indexOf('\n      };\n', mcAt));
  const shiftAt = mc.indexOf('if (e.shiftKey) {');
  const modAt = mc.indexOf('if (mod) {');
  const shiftBranch = shiftAt >= 0 && modAt > shiftAt ? mc.slice(shiftAt, modAt) : '';
  const modBranch = modAt >= 0 ? mc.slice(modAt) : '';
  const at = (s: string) => shiftBranch.indexOf(s);
  check('shift-click rotates through the store (rotateComponent), after the STATE connect and the STATE guard',
    at('tryShiftConnect(') >= 0 &&
    at('tryShiftConnect(') < at("if (comp.type === 'STATE') return false;") &&
    at("if (comp.type === 'STATE') return false;") < at('state.rotateComponent(comp.id)'));
  check('cmd/ctrl-click only toggles the selection (never rotates)',
    modBranch.includes('state.toggleSelected(comp.id)') && !modBranch.includes('rotateComponent'));
  check('rotateComponent is called once in the handler: the shift branch of modifierClick',
    handler.split('rotateComponent(').length === 2);
  // A modifier-click on a wire's middle segment (whose hit line lies over the
  // wire) is the wire's toggle, not a segment drag.
  check('a modifier-click on a wire segment reaches the wire toggle, not the segment drag',
    handler.includes("if (hit.type === 'wiresegment' && !e.shiftKey && !mod)") &&
    handler.includes("if (hit.type === 'wire' || hit.type === 'wiresegment')"));
  // The Mac ctrl-click menu: armed only where a cmd/ctrl gesture ran, never
  // for every ctrl press; right-click's disarm still runs when it swallows.
  const menuWrites = [...handler.matchAll(/menuSuppressRef\.current = ([^;]+);/g)].map((m) => m[1]);
  const menuArms = menuWrites.every((v) => v === 'true' || v === 'false')
    ? menuWrites.filter((v) => v === 'true').length : -1;
  const ctxAt = canvas.indexOf('onContextMenu={(e) => {');
  const ctx = ctxAt < 0 ? '' : canvas.slice(ctxAt, canvas.indexOf('\n        }}', ctxAt));
  check('the Mac ctrl-click menu is swallowed only after a gesture ran (swallowMacMenu), and right-click still disarms',
    menuArms === 1 && /const swallowMacMenu = \(\) => \{\s*if \(!e\.ctrlKey\) return;/.test(handler) &&
    mc.includes('swallowMacMenu()') &&
    ctx.includes('state.setSelectedTool(null)') && !/\breturn\b/.test(ctx));
  check('the canvas holds no lock of its own (law 3: the store\'s one lock)',
    !/isCurrentQuestionLocked|selectQuestionLocked|selectAssignmentFrozen/.test(canvas));
  const compAt = handler.indexOf("if (hit.type === 'component')");
  const compBranch = compAt < 0 ? '' : handler.slice(compAt, handler.indexOf('// ─── Canvas background', compAt));
  check('the component branch tests the modifiers BEFORE the triple-click (rapid shift-clicks count up e.detail)',
    compBranch.includes('modifierClick(') && compBranch.includes('e.detail >= 3') &&
    compBranch.indexOf('modifierClick(') < compBranch.indexOf('e.detail >= 3'));
  const portAt = handler.indexOf("if (hit.type === 'port')");
  const wireAt = handler.indexOf("if (hit.type === 'wire' ", portAt);
  check('the port branch routes modifier-clicks the same way (port circles cover small parts)',
    portAt >= 0 && wireAt > portAt && handler.slice(portAt, wireAt).includes('modifierClick('));
  // The Rotate button lives in the canvas's action group since task 053.
  const actions = read('../src/components/CanvasActions.tsx');
  const css = read('../src/workbench.css');
  check('the Rotate button carries the muted "(shift+click to ↻)" hint',
    /↻ Rotate/.test(actions) && /<span className="cv-hint">\(shift\+click to ↻\)<\/span>/.test(actions) &&
    /\.cv-hint\s*\{[^}]*color:\s*var\(--mm-ink-3\)/.test(css));
}

// Task 055: the view is not the canvas. Every canvas swap bumps the store's
// canvasSwapSeq (the canvas answers it with Fit); zooming and panning — what
// Fit writes — never touch the circuit, its history or its runs (law 6).
console.log('[view: Fit is a view change, never a reset]');
{
  await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
  useStore.getState().switchQuestion(0);
  if (useStore.getState().questionCircuits.get(useStore.getState().assignment!.questions[0].id)?.done) {
    useStore.getState().toggleCurrentQuestionDone();
  }
  const seq0 = useStore.getState().canvasSwapSeq;
  useStore.getState().switchQuestion(1);
  check('a question change bumps canvasSwapSeq (the canvas fits the new one)', useStore.getState().canvasSwapSeq === seq0 + 1);
  useStore.getState().switchQuestion(0);
  useStore.getState().addComponent('AND', 80, 80);
  const undoBefore = useStore.getState().undoStack.length;
  const redoBefore = useStore.getState().redoStack.length;
  const comps = useStore.getState().components;
  const wiresBefore = useStore.getState().wires;
  const seq1 = useStore.getState().canvasSwapSeq;
  useStore.getState().setZoom(0.8);
  useStore.getState().setPan(123, -45);
  const st = useStore.getState();
  check('zoom and pan leave the circuit, its undo/redo and the swap counter alone',
    st.components === comps && st.wires === wiresBefore && st.undoStack.length === undoBefore &&
      st.redoStack.length === redoBefore && st.canvasSwapSeq === seq1 && st.zoom === 0.8 && st.panX === 123 && st.panY === -45);
  useStore.getState().setZoom(0.1);
  const lo = useStore.getState().zoom;
  useStore.getState().setZoom(40);
  check('setZoom clamps to the one range (25%–300%)', lo === 0.25 && useStore.getState().zoom === 3);
  useStore.getState().setZoom(1);
  useStore.getState().undo();
}

// ═════ The submit dialog's group listing, through the local seam (task 062) ═══
console.log('\n[submit group]');
{
  const { SESSION_KEY } = await import('../src/auth/accounts');
  const { SubmitRefused } = await import('../src/submissionGroup');
  const GROUP_ID = `${SAMPLE_ASSIGNMENT_ID}-group`;
  await localAssignmentStore.save({ ...buildSampleAssignment(), id: GROUP_ID, dueDate: new Date(Date.now() + 86_400_000).toISOString() });
  await localAssignmentStore.setVisible(GROUP_ID, true);
  const JOHN = 'john.doe@example.com';
  backing.set(SESSION_KEY, 'student-john');
  useStore.getState().resetForPrincipal(JOHN);
  const mates = await submissionStore.listClassmates();
  check("a student's class list is the other students — names and keys only, self and instructors left out",
    JSON.stringify(mates) === JSON.stringify([{ key: 'student-jane', name: 'Jane Roe' }]));
  backing.set(SESSION_KEY, 'instructor-ada');
  const all = await submissionStore.listClassmates();
  check("an instructor's is every student (the gradebook maps group keys by it)",
    all.map((c) => c.key).join() === 'student-john,student-jane');
  backing.set(SESSION_KEY, 'student-john');
  const withGroup = await useStore.getState().submitAssignment(GROUP_ID, JOHN, { group: ['student-jane'] });
  check('a listed classmate is recorded on the submission', JSON.stringify(withGroup?.submission.group) === '["student-jane"]');
  const alone = await useStore.getState().submitAssignment(GROUP_ID, JOHN, { group: [] });
  check('no group listed → no group field at all', alone != null && !('group' in alone.submission));
  const refused = async (group: string[]) => {
    const before = (await submissionStore.listOwn(GROUP_ID, JOHN)).length;
    let err: unknown = null;
    try { await useStore.getState().submitAssignment(GROUP_ID, JOHN, { group }); } catch (e) { err = e; }
    const after = (await submissionStore.listOwn(GROUP_ID, JOHN)).length;
    return err instanceof SubmitRefused && after === before;
  };
  check('listing yourself is refused, and nothing is recorded', await refused(['student-john']));
  check('listing an instructor is refused', await refused(['instructor-ada']));
  check('listing someone off the roster is refused', await refused(['student-nobody']));
  check('listing the same classmate twice is refused', await refused(['student-jane', 'student-jane']));
  check('the badge map shows the latest recorded attempt, not a refused one',
    useStore.getState().submissions[GROUP_ID]?.attempt === alone?.attempt);
  backing.delete(SESSION_KEY);
}

await flushTimers();
console.log(`\nnavResetCheck: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
