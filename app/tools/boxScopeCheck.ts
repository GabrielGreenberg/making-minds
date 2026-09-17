// Store-level regression check: the confirmed-box library (the palette's
// "Boxes" section) is scoped PER CANVAS — a box confirmed on one assignment
// question or sandbox tab must never appear on another. Before 2026-07-12
// `confirmedBoxLibrary` was one global in-memory slice: it leaked across
// questions/tabs/the sandbox↔assignment boundary, and vanished on reload.
// Now it swaps with `boxes` on every canvas navigation and persists in
// QuestionCircuit/WorksheetData `confirmedBoxes`.
//
//   cd app && npx tsx tools/boxScopeCheck.ts
//
// Pins: confirm on Q1 → absent on Q2 → restored (with internals, placeable)
// back on Q1; survives goHome/closeAssignment/openAssignment via the
// workbook seam; sandbox tabs isolated from assignments and each other;
// removeConfirmedBox strips the entry + placed instances and undo restores it;
// and [naming] — default `Box n` names are unique across the whole homework
// (not per canvas), and renameBox validates + sweeps library, drawn box and
// every placed instance's label on every question.
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

const { useStore } = await import('../src/store');
const { buildSampleAssignment, SAMPLE_ASSIGNMENT_ID } = await import(
  '../src/devData/sampleData'
);
const { localAssignmentStore } = await import(
  '../src/storage/AssignmentStore'
);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const flush = () => new Promise((r) => setTimeout(r, 10));

// Build a fully-wired INPUT×2 → AND → OUTPUT circuit on the live canvas,
// draw a box around it, and confirm — returns the confirmed box's id.
function buildAndBoxAnd(): string {
  const countBefore = useStore.getState().components.length;
  useStore.getState().addComponent('INPUT', 200, 180);
  useStore.getState().addComponent('INPUT', 200, 260);
  useStore.getState().addComponent('AND', 320, 200);
  useStore.getState().addComponent('OUTPUT', 460, 210);
  const [in1, in2, and, out] = useStore.getState().components.slice(countBefore);
  useStore.getState().addWire(in1.id, 'out', and.id, 'in1');
  useStore.getState().addWire(in2.id, 'out', and.id, 'in2');
  useStore.getState().addWire(and.id, 'out', out.id, 'in');
  const boxId = `box-${Math.random().toString(36).slice(2)}`;
  useStore.getState().addBox({ id: boxId, name: '', x: 150, y: 120, width: 400, height: 220, componentIds: [], inputPortIds: [], outputPortIds: [] });
  const err = useStore.getState().confirmBox(boxId);
  if (err) throw new Error(`confirmBox failed: ${err}`);
  return boxId;
}

// ── assignment: the library is shared across the homework ───────
const assignment = buildSampleAssignment();
await localAssignmentStore.save(assignment);
// Unpublished assignments aren't openable by a student (store.openAssignment).
await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);
const store = useStore.getState();
const ok = await store.openAssignment(SAMPLE_ASSIGNMENT_ID);
check('sample assignment opened', ok);
useStore.getState().switchQuestion(0); // Q1 is a CC question
await flush();

console.log('[shared across the assignment]');
const boxId = buildAndBoxAnd();
check('confirm added a library entry on Q1', useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));

// Q2 is the SC question: a CC box follows the student there (it is placeable
// on an SC canvas — placeableBoxKinds('SC') includes 'CC').
useStore.getState().switchQuestion(1);
await flush();
check('the box is available on Q2 as well (same homework)',
  useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
check('it arrives with its internals, so it can be stamped',
  (useStore.getState().confirmedBoxLibrary.find((b) => b.id === boxId)?.internalComponents.length ?? 0) > 0);
const beforeQ2 = useStore.getState().components.length;
useStore.getState().placeBoxInstance(boxId, 400, 400);
await flush();
check('an instance is placeable on Q2 from the shared library',
  useStore.getState().components.length === beforeQ2 + 1);
// The DRAWN box rectangles stay per question — only the library is shared.
check('Q2 has no drawn box of its own', useStore.getState().boxes.length === 0);

useStore.getState().switchQuestion(0);
await flush();
check('back on Q1 the library still has it', useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
check('…and Q1 kept its own drawn box', useStore.getState().boxes.some((b) => b.id === boxId));
check('…while Q2 instance did not follow the canvas back',
  !useStore.getState().components.some((c) => c.boxedCircuitId === boxId && c.x === 400));

const before = useStore.getState().components.length;
useStore.getState().placeBoxInstance(boxId, 500, 400);
await flush();
check('instance placeable on Q1 too', useStore.getState().components.length === before + 1);

// Removing a library entry sweeps the LIVE canvas only. Instances already
// stamped into another question keep working: a placed BOXED component carries
// its own internals, so it still simulates and grades — and silently deleting
// work in a question the student isn't looking at would be worse.
{
  useStore.getState().switchQuestion(1);
  await flush();
  const doomed = buildAndBoxAnd();
  useStore.getState().switchQuestion(0);
  await flush();
  const q1Before = useStore.getState().components.length;
  useStore.getState().placeBoxInstance(doomed, 700, 500);
  await flush();
  check('the new box is placeable on Q1 too', useStore.getState().components.length === q1Before + 1);
  useStore.getState().switchQuestion(1);
  await flush();
  useStore.getState().removeConfirmedBox(doomed);
  await flush();
  check('removeConfirmedBox drops the shared library entry',
    !useStore.getState().confirmedBoxLibrary.some((b) => b.id === doomed));
  useStore.getState().switchQuestion(0);
  await flush();
  check('an instance already stamped on another question survives, internals intact',
    useStore.getState().components.some(
      (c) => c.boxedCircuitId === doomed && (c.internalCircuit?.components ?? []).length > 0,
    ));
  // Clean up so the persistence round-trip below starts from a known canvas.
  useStore.setState({
    components: useStore.getState().components.filter((c) => c.boxedCircuitId !== doomed),
  });
}

// ── persistence: autosave → close → reopen ──────────────────────
console.log('[persistence round-trip]');
useStore.getState().goHome();
await flush();
useStore.getState().closeAssignment();
check('closeAssignment clears the live library', useStore.getState().confirmedBoxLibrary.length === 0);
const reopened = await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID);
check('assignment reopened', reopened);
await flush();
check('reopen lands on Q1 with the library restored from storage', useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
// The shared library survives the round-trip as AssignmentState.boxLibrary,
// and is still shared (not re-scoped to the question it was reloaded on).
useStore.getState().switchQuestion(1);
await flush();
check('after a reload it is still shared with Q2',
  useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
useStore.getState().switchQuestion(0);
await flush();

// A DIFFERENT assignment must not inherit it.
{
  const other = { ...buildSampleAssignment(), id: `${SAMPLE_ASSIGNMENT_ID}-other`, title: 'Other HW' };
  await localAssignmentStore.save(other);
  await localAssignmentStore.setVisible(other.id, true);
  check('other assignment opened', (await useStore.getState().openAssignment(other.id)) === true);
  await flush();
  check('a different homework does NOT inherit the library',
    !useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
  check('…and back in the first homework it is there again',
    (await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true &&
    useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
  await flush();
}

// Legacy saves kept one library PER QUESTION; those merge into the shared one.
{
  const { restoreBoxLibrary } = await import('../src/storage/workbookStore');
  const legacy = new Map([
    [1, { components: [], wires: [], boxes: [], confirmedBoxes: [{ id: 'a' }, { id: 'b' }] }],
    [2, { components: [], wires: [], boxes: [], confirmedBoxes: [{ id: 'b' }, { id: 'c' }] }],
  ] as never);
  const merged = restoreBoxLibrary(null, legacy as never);
  check('legacy per-question libraries merge, de-duped, in question order',
    merged.map((b) => b.id).join(',') === 'a,b,c');
  check('an explicit boxLibrary wins over the legacy per-question copies',
    restoreBoxLibrary({ currentQuestionIndex: 0, questionCircuits: {}, boxLibrary: [] } as never, legacy as never)
      .length === 0);
}

// ── sandbox: per-tab isolation + assignment↔sandbox boundary ────
console.log('[sandbox isolation]');
useStore.getState().goHome();
useStore.getState().newWorkbook();
await flush();
check('fresh sandbox tab has no assignment boxes', useStore.getState().confirmedBoxLibrary.length === 0);
const sbBox = buildAndBoxAnd();
check('sandbox tab 1 has its box', useStore.getState().confirmedBoxLibrary.some((b) => b.id === sbBox));
useStore.getState().addTab('Circuit 2', 'CC');
await flush();
check('new tab 2 library is empty', useStore.getState().confirmedBoxLibrary.length === 0);
const tab1 = useStore.getState().tabs[0].id;
useStore.getState().switchTab(tab1);
await flush();
check('switching back to tab 1 restores its box', useStore.getState().confirmedBoxLibrary.some((b) => b.id === sbBox));

// removeConfirmedBox removes entry + instances on this canvas
useStore.getState().placeBoxInstance(sbBox, 500, 300);
useStore.getState().removeConfirmedBox(sbBox);
await flush();
check('removeConfirmedBox clears entry', !useStore.getState().confirmedBoxLibrary.some((b) => b.id === sbBox));
check('removeConfirmedBox strips placed instances', !useStore.getState().components.some((c) => c.boxedCircuitId === sbBox));
useStore.getState().undo();
check('undo restores the confirmed box', useStore.getState().confirmedBoxLibrary.some((b) => b.id === sbBox));

// ── SC boxing (notes/pset_updates.md item 23) ───────────────────
// An SC canvas can box its COMBINATIONAL sub-circuits. MEM is refused, and the
// reason is an engine fact rather than a policy choice: a boxed circuit is
// evaluated statelessly and evaluateSCSequence only clocks top-level MEMs, so
// a boxed MEM would never advance. The first checks below are that evidence.
console.log('[SC boxing]');
{
  const { placeableBoxKinds, getPortsForType } = await import('../src/types');
  check('CC and SC place CC boxes; FSM and TM place none (notes/todos.md item 2: FSM boxing refused by design, same reason as TM)',
    placeableBoxKinds('CC').join(',') === 'CC' &&
    placeableBoxKinds('SC').join(',') === 'CC' &&
    placeableBoxKinds('FSM').length === 0 &&
    placeableBoxKinds('TM').length === 0);

  // WHY MEM is refused: the same one-tick delay, boxed vs not.
  const { evaluateSCSequence } = await import('../src/engine/sc');
  const mk = (id: string, type: 'INPUT' | 'OUTPUT' | 'MEM', label: string) => ({
    id, type, x: 0, y: 0, label, ports: getPortsForType(type), value: 0,
    storedValue: type === 'MEM' ? 0 : undefined,
    ...(type === 'MEM' ? { memDirection: 'right-to-left' as const } : {}),
  });
  const wr = (id: string, src: string, sp: string, tgt: string, tp: string) =>
    ({ id, sourceComponentId: src, sourcePortId: sp, targetComponentId: tgt, targetPortId: tp, value: 0 });
  const delayComps = [mk('i', 'INPUT', 'IN1'), mk('m', 'MEM', 'M1'), mk('o', 'OUTPUT', 'OUT1')];
  const delayWires = [wr('w1', 'i', 'out', 'm', 'min'), wr('w2', 'm', 'mout', 'o', 'in')];
  const feed = [[1], [0], [1], [0]];
  const unboxed = evaluateSCSequence(delayComps, delayWires, feed).flat().join('');
  const boxedDelay = {
    id: 'b', type: 'BOXED' as const, x: 0, y: 0, label: 'Delay', value: 0,
    ports: [
      { id: 'in1', label: 'in1', side: 'left' as const, index: 0 },
      { id: 'out1', label: 'out1', side: 'right' as const, index: 0 },
    ],
    internalCircuit: { components: delayComps, wires: delayWires },
  };
  const boxedOut = evaluateSCSequence(
    [mk('i', 'INPUT', 'IN1'), boxedDelay, mk('o', 'OUTPUT', 'OUT1')],
    [wr('w1', 'i', 'out', 'b', 'in1'), wr('w2', 'b', 'out1', 'o', 'in')],
    feed,
  ).flat().join('');
  check(`an unboxed MEM delays the stream (${unboxed})`, unboxed === '0101');
  check(`the SAME delay boxed never advances (${boxedOut}) - why MEM may not be boxed`,
    boxedOut === '0000');

  // The sandbox section above left the assignment closed and its canvas
  // populated; come back to the assignment's SC question (Q2) on a clean sheet.
  check('re-opened the assignment', (await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  useStore.getState().switchQuestion(1);
  await flush();
  useStore.setState({ components: [], wires: [], boxes: [] });

  // A combinational sub-circuit on the SC canvas boxes fine.
  const scBox = buildAndBoxAnd();
  const entry = useStore.getState().confirmedBoxLibrary.find((b) => b.id === scBox);
  check('an SC canvas can confirm a combinational box', entry != null);
  check('...recorded as a CC box, so it is placeable on either canvas',
    (entry?.kind ?? 'CC') === 'CC' && placeableBoxKinds('SC').includes('CC'));
  useStore.getState().placeBoxInstance(scBox, 620, 300);
  await flush();
  check('...and places on the SC canvas with its internals',
    useStore.getState().components.some(
      (c) => c.boxedCircuitId === scBox && (c.internalCircuit?.components ?? []).length > 0,
    ));

  // But a selection containing MEM is refused, by name, with the reason.
  useStore.setState({ components: [], wires: [], boxes: [] });
  useStore.getState().addComponent('INPUT', 200, 180);
  useStore.getState().addComponent('MEM', 320, 180);
  useStore.getState().addComponent('OUTPUT', 460, 190);
  const [inp, mem, out] = useStore.getState().components;
  useStore.getState().addWire(inp.id, 'out', mem.id, 'min');
  useStore.getState().addWire(mem.id, 'mout', out.id, 'in');
  const memBoxId = 'scbox-mem';
  useStore.getState().addBox({ id: memBoxId, name: '', x: 150, y: 120, width: 400, height: 220, componentIds: [], inputPortIds: [], outputPortIds: [] });
  const memErr = useStore.getState().confirmBox(memBoxId);
  check('boxing a MEM is refused, naming the block',
    typeof memErr === 'string' && memErr.includes('M1') &&
    memErr.includes('Memory cannot go inside a box'));
  check('...and nothing was added to the library',
    !useStore.getState().confirmedBoxLibrary.some((b) => b.id === memBoxId));
}

// ── default names are unique across the whole homework ──────────
// The library is assignment-wide, so counting only the boxes drawn on the live
// canvas handed out "Box 1" once per question (fixed 2026-09-10).
console.log('\n[naming]');
{
  check('re-opened the assignment for naming checks',
    (await useStore.getState().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  useStore.setState({ confirmedBoxLibrary: [], questionCircuits: new Map() });
  useStore.getState().switchQuestion(0);
  await flush();
  useStore.setState({ components: [], wires: [], boxes: [] });
  const nameOf = (id: string) =>
    useStore.getState().confirmedBoxLibrary.find((b) => b.id === id)?.name;

  const first = buildAndBoxAnd();
  check('the first box on Q1 is "Box 1"', nameOf(first) === 'Box 1');

  useStore.getState().switchQuestion(1);
  await flush();
  useStore.setState({ components: [], wires: [], boxes: [] });
  const second = buildAndBoxAnd();
  check('a box confirmed on Q2 does NOT reuse "Box 1"', nameOf(second) === 'Box 2');

  useStore.getState().switchQuestion(0);
  await flush();
  const third = buildAndBoxAnd();
  check('a second box back on Q1 is "Box 3"', nameOf(third) === 'Box 3');
  check('every library name is distinct',
    new Set(useStore.getState().confirmedBoxLibrary.map((b) => b.name)).size ===
      useStore.getState().confirmedBoxLibrary.length);

  // ── renaming ──────────────────────────────────────────────────
  useStore.getState().placeBoxInstance(first, 520, 420);
  await flush();
  check('renameBox accepts a fresh name',
    useStore.getState().renameBox(first, '  XOR box  ') === null);
  check('...trimmed, on the library entry', nameOf(first) === 'XOR box');
  check('...on the drawn box on this canvas',
    useStore.getState().boxes.find((b) => b.id === first)?.name === 'XOR box');
  check('...and on every placed instance label',
    useStore.getState().components
      .filter((c) => c.boxedCircuitId === first)
      .every((c) => c.label === 'XOR box'));

  useStore.getState().undo();
  await flush();
  check('undo restores the previous name', nameOf(first) === 'Box 1');
  useStore.getState().redo();
  await flush();
  check('redo puts the new one back', nameOf(first) === 'XOR box');

  check('a duplicate name is refused, naming the clash',
    (useStore.getState().renameBox(third, 'XOR box') ?? '').includes('XOR box'));
  check('...leaving the box as it was', nameOf(third) === 'Box 3');
  check('an empty name is refused', useStore.getState().renameBox(third, '   ') !== null);
  check('renaming a box to its own name is a no-op, not a clash',
    useStore.getState().renameBox(third, 'Box 3') === null);

  // A renamed box frees its old number, but the taken ones are stepped over.
  const fourth = buildAndBoxAnd();
  check('the next default name skips taken numbers', nameOf(fourth) === 'Box 1');

  // An instance stamped on ANOTHER question is relabelled too: the library is
  // shared, so one box must not answer to two names.
  useStore.getState().switchQuestion(1);
  await flush();
  useStore.getState().placeBoxInstance(first, 300, 300);
  await flush();
  check('renamed from the other question', useStore.getState().renameBox(first, 'Half adder') === null);
  useStore.getState().switchQuestion(0);
  await flush();
  check('an instance on the question that was away is relabelled',
    useStore.getState().components
      .filter((c) => c.boxedCircuitId === first)
      .every((c) => c.label === 'Half adder'));
}

console.log(`\nboxScopeCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
