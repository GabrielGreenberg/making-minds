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
// [sequential boxes] — a box may hold memory and then behaves exactly as
// unboxed (engine pins, every SC reference fixture graded boxed whole, and
// the store: kind 'SC', where it places, runs, local step, undo, save/load,
// resets); and [naming] — default `Box n` names are unique across the whole
// homework (not per canvas), and renameBox validates + sweeps library, drawn
// box and every placed instance's label on every question; and [drawn-across
// boxes] (task 038) — a box drawn across wires, with no IN/OUT of its own,
// computes what it enclosed (engine, every CC/SC reference fixture boxed
// across, the store's repro, run, paste, undo, save/load), and a box saved
// before 038 is re-bound on load by the stated rule, a submitted snapshot
// never; and [memory] (task 045) — a combinatorial canvas holds no memory:
// one rule (types.ts modeHoldsMemory = where a sequential box may go) for the
// palette, addComponent, paste and the grader's Stage 1.
import type { AssignmentState, CircuitComponent, SubmissionRecord } from '../src/types';

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

// ── Sequential boxes (task 004) ─────────────────────────────────
// A box may hold memory. Every clocked run inlines a memory-holding box
// (engine/netlist.ts), so its MEMs advance every tick exactly as unboxed:
// the one-tick delay gives 0101 boxed as unboxed (this pin was 0000 while
// boxing refused MEM). A box holding memory is kind 'SC', placeable only
// where a machine may be sequential.
const { readFileSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/reference');
const { comp, wire, circuit, boxed, boxWhole } = await import('./builder');
const MEM_RL = { memDirection: 'right-to-left' as const, storedValue: 0 };
/** IN1 → MEM → OUT1: the one-tick delay. */
function delayMachine() {
  return circuit(
    [comp('i', 'INPUT', 'IN1'), comp('m', 'MEM', 'M1', 0, 0, MEM_RL), comp('o', 'OUTPUT', 'OUT1')],
    [wire('w1', 'i', 'out', 'm', 'min'), wire('w2', 'm', 'mout', 'o', 'in')],
  );
}
/** The serial-adder full adder around a carry fed by `carry` (a MEM, or a
 *  box holding one): sum on OUT1, carry-out into `carry`'s input. */
function serialAdderMachine(carry: 'mem' | 'box' = 'mem') {
  const c = carry === 'mem' ? comp('c', 'MEM', 'M1', 0, 0, MEM_RL) : boxed('c', 'Carry', delayMachine());
  const [cOut, cIn] = carry === 'mem' ? ['mout', 'min'] : ['out1', 'in1'];
  return circuit(
    [
      comp('a', 'INPUT', 'IN1'), comp('b', 'INPUT', 'IN2'),
      comp('x1', 'XOR', 'XOR'), comp('x2', 'XOR', 'XOR'),
      comp('a1', 'AND', 'AND'), comp('a2', 'AND', 'AND'), comp('or', 'OR', 'OR'),
      c, comp('s', 'OUTPUT', 'OUT1'),
    ],
    [
      wire('w1', 'a', 'out', 'x1', 'in1'), wire('w2', 'b', 'out', 'x1', 'in2'),
      wire('w3', 'x1', 'out', 'x2', 'in1'), wire('w4', 'c', cOut, 'x2', 'in2'),
      wire('w5', 'x2', 'out', 's', 'in'),
      wire('w6', 'a', 'out', 'a1', 'in1'), wire('w7', 'b', 'out', 'a1', 'in2'),
      wire('w8', 'x1', 'out', 'a2', 'in1'), wire('w9', 'c', cOut, 'a2', 'in2'),
      wire('w10', 'a1', 'out', 'or', 'in1'), wire('w11', 'a2', 'out', 'or', 'in2'),
      wire('w12', 'or', 'out', 'c', cIn),
    ],
  );
}

console.log('[sequential boxes]');
{
  const { placeableBoxKinds } = await import('../src/types');
  check('CC places CC boxes; SC places CC and SC boxes; FSM and TM place none (notes/todos.md item 2: FSM boxing refused by design, same reason as TM)',
    placeableBoxKinds('CC').join(',') === 'CC' &&
    placeableBoxKinds('SC').join(',') === 'CC,SC' &&
    placeableBoxKinds('FSM').length === 0 &&
    placeableBoxKinds('TM').length === 0);

  const { evaluateSCSequence } = await import('../src/engine/sc');
  const { hasCombinationalLoop, memorySlots, withMemState } = await import('../src/engine/netlist');
  const { gradingCircuit } = await import('../src/engine/caseRun');
  const { gradeQuestion } = await import('../src/engine/grader');
  type Machine = ReturnType<typeof circuit>;
  const run = (m: Machine, feed: number[][]) =>
    evaluateSCSequence(m.components, m.wires, feed).map((r) => r.join('')).join(' ');
  const M = MEM_RL;

  // The one-tick delay, boxed vs not.
  const delay = delayMachine();
  const feed = [[1], [0], [1], [0]];
  const unboxed = evaluateSCSequence(delay.components, delay.wires, feed).flat().join('');
  const boxedOut = evaluateSCSequence(boxWhole(delay).components, boxWhole(delay).wires, feed).flat().join('');
  check(`an unboxed MEM delays the stream (${unboxed})`, unboxed === '0101');
  check(`the SAME delay boxed advances every tick exactly as unboxed (${boxedOut})`, boxedOut === '0101');

  // A toggle whose loop runs THROUGH the box: the box holds only a MEM, the
  // NOT that feeds it back sits on the canvas. The MEM inside breaks the loop.
  const toggleBoxed = circuit(
    [boxed('b', 'Box 1', delay), comp('n', 'NOT', 'NOT'), comp('o', 'OUTPUT', 'OUT1')],
    [wire('x', 'b', 'out1', 'n', 'in'), wire('y', 'n', 'out', 'b', 'in1'), wire('z', 'b', 'out1', 'o', 'in')],
  );
  const toggleFlat = circuit(
    [comp('m', 'MEM', 'M1', 0, 0, M), comp('n', 'NOT', 'NOT'), comp('o', 'OUTPUT', 'OUT1')],
    [wire('x', 'm', 'mout', 'n', 'in'), wire('y', 'n', 'out', 'm', 'min'), wire('z', 'm', 'mout', 'o', 'in')],
  );
  const ticks = [[], [], [], [], []];
  check(`a toggle fed back across the box boundary matches unboxed (${run(toggleBoxed, ticks)})`,
    run(toggleBoxed, ticks) === run(toggleFlat, ticks) && run(toggleFlat, ticks) === '0 1 0 1 0');
  check('...and is no combinational loop (the boxed MEM breaks it)',
    !hasCombinationalLoop(toggleBoxed.components, toggleBoxed.wires));
  // The local I/O step evaluates a placed box as ONE gate: it must read the
  // memory inside, through a loop around a nested box too.
  const { evaluateBoxedCircuit } = await import('../src/engine/cc');
  const toggleInBox = boxed('tb', 'Toggle', toggleBoxed);
  const holding = (v: number) => ({
    ...toggleInBox,
    internalCircuit: { ...toggleInBox.internalCircuit!, components: withMemState(toggleInBox.internalCircuit!.components, [v]) },
  });
  check('a box evaluated as one gate reads the memory inside it, through a nested loop (0 → 0, 1 → 1)',
    evaluateBoxedCircuit(holding(0), []).join('') === '0' && evaluateBoxedCircuit(holding(1), []).join('') === '1');
  const notBox = circuit(
    [comp('i', 'INPUT', 'IN1'), comp('n', 'NOT', 'NOT'), comp('o', 'OUTPUT', 'OUT1')],
    [wire('a', 'i', 'out', 'n', 'in'), wire('b', 'n', 'out', 'o', 'in')],
  );
  const ccLoop = circuit(
    [boxed('b', 'Box 2', notBox), comp('o', 'OUTPUT', 'OUT1')],
    [wire('x', 'b', 'out1', 'b', 'in1'), wire('z', 'b', 'out1', 'o', 'in')],
  );
  check('a loop through a combinational box is still a loop',
    hasCombinationalLoop(ccLoop.components, ccLoop.wires));

  // A serial adder: full adder + carry MEM. Boxed whole, and with only its
  // carry MEM boxed (the carry loop then runs through the box).
  const serialAdder = serialAdderMachine();
  const carryBoxed = serialAdderMachine('box');
  // Every pair of 3-bit addends, LSB first, plus one drain step.
  const battery: number[][][] = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      battery.push([0, 1, 2, 3].map((t) => [(x >> t) & 1, (y >> t) & 1]));
    }
  }
  const adderAgree = (m: Machine) => battery.every((f) => run(m, f) === run(serialAdder, f));
  check('the serial adder adds (5 + 7 = 12, LSB first)', run(serialAdder, battery[5 * 8 + 7]) === '0 0 1 1');
  check(`a serial adder boxed whole matches unboxed over ${battery.length} input streams`, adderAgree(boxWhole(serialAdder)));
  check('...and so does one whose carry loop runs through a boxed MEM',
    adderAgree(carryBoxed) && !hasCombinationalLoop(carryBoxed.components, carryBoxed.wires));

  // Nesting: a sequential box inside a box; a sequential box holding a CC box.
  const nested = circuit(
    [comp('i', 'INPUT', 'IN1'), boxed('inner', 'Delay', delay), comp('o', 'OUTPUT', 'OUT1')],
    [wire('a', 'i', 'out', 'inner', 'in1'), wire('b', 'inner', 'out1', 'o', 'in')],
  );
  check(`a sequential box inside a box matches unboxed (${run(boxWhole(nested), feed)})`,
    run(boxWhole(nested), feed) === run(delay, feed));
  const notThenDelay = circuit(
    [comp('i', 'INPUT', 'IN1'), comp('n', 'NOT', 'NOT'), comp('m', 'MEM', 'M1', 0, 0, M), comp('o', 'OUTPUT', 'OUT1')],
    [wire('a', 'i', 'out', 'n', 'in'), wire('b', 'n', 'out', 'm', 'min'), wire('c', 'm', 'mout', 'o', 'in')],
  );
  const holdingCcBox = circuit(
    [comp('i', 'INPUT', 'IN1'), boxed('nb', 'Not', notBox), comp('m', 'MEM', 'M1', 0, 0, M), comp('o', 'OUTPUT', 'OUT1')],
    [wire('a', 'i', 'out', 'nb', 'in1'), wire('b', 'nb', 'out1', 'm', 'min'), wire('c', 'm', 'mout', 'o', 'in')],
  );
  check(`a sequential box holding a combinational box matches unboxed (${run(boxWhole(holdingCcBox), feed)})`,
    run(boxWhole(holdingCcBox), feed) === run(notThenDelay, feed) && run(notThenDelay, feed) === '0 0 1 0');

  // Two instances of one box keep their own state: in series, a 2-step delay.
  const twoDelays = circuit(
    [comp('i', 'INPUT', 'IN1'), boxed('d1', 'Delay', delay), boxed('d2', 'Delay', delay), comp('o', 'OUTPUT', 'OUT1')],
    [wire('a', 'i', 'out', 'd1', 'in1'), wire('b', 'd1', 'out1', 'd2', 'in1'), wire('c', 'd2', 'out1', 'o', 'in')],
  );
  const feed6 = [[1], [0], [1], [1], [0], [0]];
  check(`two instances of one delay box in series delay by two (${run(twoDelays, feed6)})`,
    run(twoDelays, feed6) === '0 0 1 0 1 1');
  check('...each instance its own state slot, labelled by box',
    memorySlots(twoDelays.components).map((sl) => sl.label).join(',') === 'Delay·M1,Delay (2)·M1');

  // The grader starts a boxed MEM at rest too.
  const hw3p7 = JSON.parse(readFileSync(join(FIXTURES, 'hw3-p7.json'), 'utf8'));
  const cleanBoxed = boxWhole(hw3p7.correct);
  const dirtyBoxed = {
    ...cleanBoxed,
    components: withMemState(cleanBoxed.components, memorySlots(cleanBoxed.components).map(() => 1)),
  };
  check('a saved boxed MEM can hold scratch state (the dirty fixture holds 1s)',
    memorySlots(dirtyBoxed.components).length > 0 && memorySlots(dirtyBoxed.components).every((sl) => sl.value === 1));
  check('gradingCircuit zeroes a MEM inside a box',
    memorySlots(gradingCircuit(dirtyBoxed).components).every((sl) => sl.value === 0));
  check('...so a dirty boxed machine grades exactly as from rest',
    JSON.stringify(gradeQuestion(hw3p7.question, dirtyBoxed)) === JSON.stringify(gradeQuestion(hw3p7.question, cleanBoxed)));
  check('...and the pin has teeth: the raw engine WOULD run the boxed MEMs from 1',
    run(dirtyBoxed, [[0], [0], [0], [0]]) !== run(cleanBoxed, [[0], [0], [0], [0]]));
}

// ── Fixture parity: every SC-semantics reference machine, boxed whole,
// grades exactly as itself (every case field included).
console.log('\n[sequential boxes: fixture parity]');
{
  const { gradeQuestion } = await import('../src/engine/grader');
  let compared = 0;
  const mismatched: string[] = [];
  for (const id of ['hw3-p1', 'hw3-p2', 'hw3-p3', 'hw3-p4', 'hw3-p5', 'hw3-p6', 'hw3-p7', 'hw3-p8', 'hw3-p9',
    'hw3-p11', 'hw3-p12', 'hw3-p13', 'hw3-p14', 'hw3-p15']) {
    const fx = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8'));
    for (const which of ['correct', 'broken'] as const) {
      if (!fx[which]) continue;
      compared++;
      const plain = JSON.stringify(gradeQuestion(fx.question, fx[which]));
      const boxedWhole = JSON.stringify(gradeQuestion(fx.question, boxWhole(fx[which])));
      if (plain !== boxedWhole) mismatched.push(`${id} ${which}`);
    }
  }
  check(`${compared} SC / perception / SC-turbot reference machines grade identically boxed whole` +
    (mismatched.length ? ` (differ: ${mismatched.join(', ')})` : ''),
    compared === 25 && mismatched.length === 0);
}

// ── The store: confirm, place, run, undo, save/load, resets ───────
console.log('\n[sequential boxes: store]');
{
  const { selectPlaceableBoxKinds } = await import('../src/store');
  const { evaluateSCSequence } = await import('../src/engine/sc');
  const { memorySlots, hasMemory, zeroMemState } = await import('../src/engine/netlist');
  const { gradingCircuit } = await import('../src/engine/caseRun');
  const S = () => useStore.getState();
  const clean = () => useStore.setState({ components: [], wires: [], boxes: [], tableRows: [] });

  // IN → MEM → OUT on the live canvas; `lr` wires the MEM left-to-right.
  function buildDelay(lr = false) {
    const before = S().components.length;
    S().addComponent('INPUT', 200, 180);
    S().addComponent('MEM', 320, 180);
    S().addComponent('OUTPUT', 460, 190);
    const [inp, mem, out] = S().components.slice(before);
    if (lr) {
      S().addWire(inp.id, 'out', mem.id, 'mout');
      S().addWire(mem.id, 'min', out.id, 'in');
    } else {
      S().addWire(inp.id, 'out', mem.id, 'min');
      S().addWire(mem.id, 'mout', out.id, 'in');
    }
    return mem.id;
  }
  function drawAndConfirm(): { id: string; err: string | null } {
    const id = `box-${Math.random().toString(36).slice(2)}`;
    S().addBox({ id, name: '', x: 150, y: 120, width: 400, height: 220, componentIds: [], inputPortIds: [], outputPortIds: [] });
    return { id, err: S().confirmBox(id) };
  }
  // Place `boxId` with a fresh IN/OUT wired to its in1/out1; returns the instance.
  async function placeWired(boxId: string) {
    S().placeBoxInstance(boxId, 300, 300);
    await flush();
    const inst = S().components[S().components.length - 1];
    S().addComponent('INPUT', 100, 300);
    S().addComponent('OUTPUT', 500, 300);
    const [inp, out] = S().components.slice(-2);
    S().addWire(inp.id, 'out', inst.id, 'in1');
    S().addWire(inst.id, 'out1', out.id, 'in');
    await flush();
    return inst.id;
  }
  const nestedValues = (instId: string) =>
    memorySlots(S().components).filter((sl) => sl.path[0] === instId).map((sl) => sl.value);
  // Clock `bits` through the live canvas by hand (sandbox: raw bits).
  function stepThrough(bits: number[]): { outs: string; outWire: string } {
    S().scGlobalReset();
    useStore.setState({ scInputSequence: [bits] });
    let outWire = '';
    const inst = S().components.find((c) => c.type === 'BOXED')!;
    const w = S().wires.find((x) => x.sourceComponentId === inst.id)!;
    for (let t = 0; t < bits.length; t++) {
      S().scStep();
      outWire += String(S().wires.find((x) => x.id === w.id)!.value);
    }
    return { outs: S().scHistory.map((h) => h.outputBits.join('')).join(''), outWire };
  }

  // On the SC question (Q2): a MEM boxes, as kind 'SC', internals at rest.
  check('re-opened the assignment', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  S().switchQuestion(1);
  await flush();
  clean();
  const memId = buildDelay();
  S().setMemStoredValue(memId, 1);
  const scBox = drawAndConfirm();
  const scEntry = S().confirmedBoxLibrary.find((b) => b.id === scBox.id);
  check(`an SC canvas confirms a box holding a MEM (${scBox.err ?? 'ok'})`, scBox.err === null && scEntry != null);
  check('...recorded as kind SC', scEntry?.kind === 'SC');
  check('...its internals at rest though the canvas MEM held 1',
    (scEntry?.internalComponents ?? []).filter((c) => c.type === 'MEM').every((c) => c.storedValue === 0));
  clean();
  buildDelay(true);
  const lrMem = S().components.find((c) => c.type === 'MEM');
  const lrBox = drawAndConfirm();
  check(`free-end rule reads a MEM by its role, not its sides (left-to-right MEM boxes: ${lrBox.err ?? 'ok'})`,
    lrMem?.memDirection === 'left-to-right' && lrBox.err === null);

  // A combinational box on the SC canvas is still kind CC.
  clean();
  const ccBox = buildAndBoxAnd();
  check('an SC canvas still confirms a combinational box, recorded as kind CC',
    S().confirmedBoxLibrary.find((b) => b.id === ccBox)?.kind === 'CC');

  // Where SC boxes are placeable.
  check('an SC question places CC and SC boxes', selectPlaceableBoxKinds(S()).join(',') === 'CC,SC');
  S().switchQuestion(5); // Q6: a turbot with an SC brain
  await flush();
  check('a turbot SC brain places SC boxes', selectPlaceableBoxKinds(S()).includes('SC'));
  S().switchQuestion(0); // Q1 is CC
  await flush();
  check('a CC question does not place SC boxes', selectPlaceableBoxKinds(S()).join(',') === 'CC');
  clean();
  const before = S().components.length;
  S().placeBoxInstance(scBox.id, 400, 400);
  await flush();
  check('placeBoxInstance refuses an SC box on a CC question', S().components.length === before);
  clean();
  // A MEM can no longer be placed on a CC canvas ([memory], task 045); a
  // workbook saved before that rule may still hold one, and boxing it there
  // stays refused.
  {
    const { comp, wire } = await import('./builder');
    useStore.setState({
      components: [comp('d-in', 'INPUT', 'IN1', 200, 180), comp('d-mem', 'MEM', 'M1', 320, 180), comp('d-out', 'OUTPUT', 'OUT1', 460, 190)],
      wires: [wire('d-w1', 'd-in', 'out', 'd-mem', 'min'), wire('d-w2', 'd-mem', 'mout', 'd-out', 'in')],
    });
  }
  const ccRefusal = drawAndConfirm();
  check(`a CC question refuses to box a MEM, naming it (${ccRefusal.err})`,
    typeof ccRefusal.err === 'string' &&
    ccRefusal.err.includes('Memory cannot go inside a box here: M1'));
  check('...and nothing was added to the library',
    !S().confirmedBoxLibrary.some((b) => b.id === ccRefusal.id));

  // Back on Q2: place, run the question, undo/redo, save/load, resets.
  S().switchQuestion(1);
  await flush();
  clean();
  const inst = await placeWired(scBox.id);
  const placed = S().components.find((c) => c.id === inst);
  check('the SC box places on the SC question, its MEM at rest',
    placed?.type === 'BOXED' && nestedValues(inst).join(',') === '0');
  const fedAndOut = async () => {
    S().setScGlobalSequenceInput(0, '101');
    S().loadScGlobalSequence(0);
    S().scRun();
    const start = Date.now();
    while ((S().scRunning || S().scHistory.length === 0) && Date.now() - start < 30000) await flush();
    const hist = S().scHistory.slice().sort((a, b) => a.t - b.t);
    return { fed: hist.map((h) => h.inputBits), outs: hist.map((h) => h.outputBits) };
  };
  const q2run = await fedAndOut();
  const q2want = evaluateSCSequence(delayMachine().components, delayMachine().wires, q2run.fed);
  check(`a question run of the boxed delay equals the unboxed delay on the same stream (${q2run.outs.flat().join('')})`,
    q2run.outs.length > 1 && JSON.stringify(q2run.outs) === JSON.stringify(q2want));
  check('...and equals the engine run of the canvas itself',
    JSON.stringify(q2run.outs) === JSON.stringify(evaluateSCSequence(zeroMemState(S().components), S().wires, q2run.fed)));
  check('the nested MEM advanced with the run (holds the last bit fed)',
    nestedValues(inst).join(',') === String(q2run.fed[q2run.fed.length - 1][0]));
  // The run's last fed bit is the codec's padding 0 ('101' is 3 bits, the
  // window 4 steps), so a reset right after a run would pass trivially. Leave
  // the nested MEM holding 1 first: step the loaded stream up to, not into,
  // its padding step.
  const dirty = async () => {
    S().setScGlobalSequenceInput(0, '101');
    S().loadScGlobalSequence(0);
    await flush();
    for (let t = 0; t < 3; t++) S().scStep(); // fed 1, 0, 1
    return nestedValues(inst).join(',');
  };
  check('stopped before its padding step, the nested MEM holds 1', (await dirty()) === '1');
  S().scReset();
  check('scReset zeroes the nested MEM', nestedValues(inst).join(',') === '0');
  check('dirty again (holds 1)', (await dirty()) === '1');
  S().scGlobalReset();
  check('scGlobalReset zeroes the nested MEM', nestedValues(inst).join(',') === '0');
  check('dirty again (holds 1)', (await dirty()) === '1');
  const fromDirty = await fedAndOut();
  check(`loadScGlobalSequence starts a run from rest: the run from dirty memory equals the grader's (${fromDirty.outs.flat().join('')})`,
    JSON.stringify(fromDirty.outs) === JSON.stringify(q2want) &&
    JSON.stringify(fromDirty.outs) === JSON.stringify(evaluateSCSequence(gradingCircuit({ components: S().components, wires: S().wires }).components, S().wires, fromDirty.fed)));

  // Undo / redo of the wiring and placement, then the run again.
  for (let i = 0; i < 5; i++) S().undo(); // 2 wires, OUTPUT, INPUT, placement
  check('undo removes the placed instance', !S().components.some((c) => c.id === inst));
  for (let i = 0; i < 5; i++) S().redo();
  await flush();
  check('redo restores it', S().components.some((c) => c.id === inst));
  const rerun = await fedAndOut();
  check('...and the rerun still delays', JSON.stringify(rerun.outs) === JSON.stringify(q2run.outs));
  check('...leaving its memory advanced', nestedValues(inst).join(',') === String(rerun.fed[rerun.fed.length - 1][0]));

  // Paste must not route around the placement rule: an SC box copied here
  // is refused on the CC question (both are paste kind 'circuit').
  useStore.setState({ selectedIds: [inst] });
  S().copySelected();

  // Canvas swap (law 6): the nested MEM comes back at rest.
  check('dirty before the swap (holds 1)', (await dirty()) === '1');
  S().switchQuestion(0);
  await flush();
  const q1Before = S().components.length;
  const q1Undo = S().undoStack.length;
  const pasteMsg = S().paste();
  check(`pasting the SC box onto the CC question is refused, naming it (${pasteMsg})`,
    typeof pasteMsg === 'string' && pasteMsg.includes('box holding memory') && pasteMsg.includes(placed?.label ?? '?'));
  check(`...adding nothing and leaving no undo entry (${S().components.length - q1Before} added, ${S().undoStack.length - q1Undo} undo)`,
    S().components.length === q1Before && !S().components.some((c) => c.type === 'BOXED' && hasMemory(c.internalCircuit?.components ?? [])) &&
    S().undoStack.length === q1Undo);
  S().switchQuestion(1);
  await flush();
  check('switchQuestion away and back: the nested MEM is re-zeroed', nestedValues(inst).join(',') === '0');

  // Save / load — saved with the nested MEM holding scratch state.
  check('dirty before closing (holds 1)', (await dirty()) === '1');
  S().goHome();
  await flush();
  S().closeAssignment();
  check('reopened after close', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  await flush();
  check('the library keeps the box as kind SC',
    S().confirmedBoxLibrary.find((b) => b.id === scBox.id)?.kind === 'SC');
  S().switchQuestion(1);
  await flush();
  check('the placed instance survives the round-trip', S().components.some((c) => c.id === inst));
  check('...its nested MEM back at rest though it was saved holding 1', nestedValues(inst).join(',') === '0');
  const reloaded = await fedAndOut();
  check('...and reruns the same', JSON.stringify(reloaded.outs) === JSON.stringify(q2run.outs));

  // ── Sandbox: its Logic Circuit tab is the sandbox's SC canvas.
  S().goHome();
  S().newWorkbook();
  await flush();
  check('a sandbox Logic Circuit tab places SC boxes', selectPlaceableBoxKinds(S()).join(',') === 'CC,SC');
  clean();
  buildDelay();
  const sbBox = drawAndConfirm();
  check(`...and confirms one (${sbBox.err ?? 'ok'})`,
    sbBox.err === null && S().confirmedBoxLibrary.find((b) => b.id === sbBox.id)?.kind === 'SC');
  clean();
  const sbInst = await placeWired(sbBox.id);
  check('a canvas holding only a sequential box is a machine with memory',
    !S().components.some((c) => c.type === 'MEM') && hasMemory(S().components));
  const stepped = stepThrough([1, 0, 1, 0]);
  check(`scStep x4 on 1,0,1,0 through the boxed delay: ${stepped.outs}`, stepped.outs === '0101');
  check('...equal to the engine run of the delay', stepped.outs === evaluateSCSequence(delayMachine().components, delayMachine().wires, [[1], [0], [1], [0]]).flat().join(''));
  check(`...and the wire leaving the box carries it (${stepped.outWire})`, stepped.outWire === '0101');
  check('...the boxed MEM is the state each history entry records (pre-step: 0,1,0,1)',
    S().scHistory.map((h) => h.memValues.join('')).join('') === '0101');

  // Local I/O step: the boxed MEM is a state column ('Box n·M1'); a row
  // records under ITS OWN (pre-step) key.
  const slots = memorySlots(S().components);
  check(`the boxed MEM is a state column labelled by its box (${slots.map((sl) => sl.label).join(',')})`,
    slots.length === 1 && /^Box \d+·M1$/.test(slots[0].label));
  const stepRow = (inBits: number[], memBits: number[]) => {
    useStore.setState({ tableRows: [] });
    S().localStepSelect(inBits, memBits);
    const selected = nestedValues(sbInst).join(',');
    while (S().localStepOne()) { /* step to the end */ }
    const row = S().tableRows.find((r) => r.inputBits.join('') === inBits.join('') && (r.memBits ?? []).join('') === memBits.join(''));
    return { selected, rows: S().tableRows.length, out: row?.outputBits.join('') };
  };
  // Each row selected is one whose memory the box does NOT hold at that
  // moment, so the selection itself must write the row's state into the box.
  check('the run left the boxed MEM holding 0', nestedValues(sbInst).join(',') === '0');
  const r11 = stepRow([1], [1]);
  check(`localStepSelect writes the row's memory into the box (0 → ${r11.selected})`, r11.selected === '1');
  check(`row (in=1, m=1) records its output under its own key (out ${r11.out})`, r11.rows === 1 && r11.out === '1');
  check('...and the step left the boxed MEM holding its next value (1)', nestedValues(sbInst).join(',') === '1');
  const r10 = stepRow([1], [0]);
  check(`localStepSelect writes the row's memory into the box (1 → ${r10.selected})`, r10.selected === '0');
  check(`row (in=1, m=0) records its output under its own key (out ${r10.out})`, r10.rows === 1 && r10.out === '0');

  // The same pre-step key on a plain canvas MEM (the bug predates boxes).
  clean();
  buildDelay();
  useStore.setState({ tableRows: [] });
  S().localStepSelect([1], [0]);
  while (S().localStepOne()) { /* step to the end */ }
  check('an unboxed delay\'s row (in=1, m=0) is filed under (1,0), not its next state',
    S().tableRows.length === 1 && S().tableRows[0].memBits?.join('') === '0' && S().tableRows[0].outputBits.join('') === '0');

  // Local step through a loop across the box: every wire annotated, OUTPUT valued.
  clean();
  S().placeBoxInstance(sbBox.id, 300, 300);
  await flush();
  const tInst = S().components[S().components.length - 1];
  S().addComponent('NOT', 500, 200);
  S().addComponent('OUTPUT', 600, 300);
  const [notG, tOut] = S().components.slice(-2);
  S().addWire(tInst.id, 'out1', notG.id, 'in');
  S().addWire(notG.id, 'out', tInst.id, 'in1');
  S().addWire(tInst.id, 'out1', tOut.id, 'in');
  await flush();
  S().localStepSelect([], [0]);
  while (S().localStepOne()) { /* step to the end */ }
  check('local step through a toggle fed back across the box annotates every wire',
    S().wires.every((w) => S().wireValues.has(w.id)));
  check('...gives OUTPUT a value, and advances the boxed MEM (0 → 1)',
    S().components.find((c) => c.id === tOut.id)?.value === 0 && nestedValues(tInst.id).join(',') === '1');

  // A free end on the box's OTHER input must not blank the output its memory
  // alone decides. Internals: IN1 → MEM → OUT1 and IN2 → OUT2; on the canvas
  // only in1 and out1 are wired.
  clean();
  {
    const { scNetlist, evaluateSCStep } = await import('../src/engine/sc');
    buildDelay();
    S().addComponent('INPUT', 200, 260);
    S().addComponent('OUTPUT', 460, 270);
    const [in2, out2] = S().components.slice(-2);
    S().addWire(in2.id, 'out', out2.id, 'in');
    const twoPort = drawAndConfirm();
    check(`a box with a memory output and a pass-through confirms (${twoPort.err ?? 'ok'})`, twoPort.err === null);
    clean();
    const fInst = await placeWired(twoPort.id);
    const outWire = S().wires.find((w) => w.sourceComponentId === fInst)!;
    const outComp = S().components.find((c) => c.type === 'OUTPUT')!;
    const engine = evaluateSCStep(scNetlist(zeroMemState(S().components), S().wires), [1], [1]).outputBits.join('');
    useStore.setState({ tableRows: [] });
    S().localStepSelect([1], [1]);
    while (S().localStepOne()) { /* step to the end */ }
    const row = S().tableRows.find((r) => r.inputBits.join('') === '1' && (r.memBits ?? []).join('') === '1');
    check(`with in2 free, row (in=1, m=1) files the engine's output (${row?.outputBits.join('')} vs ${engine})`,
      engine === '1' && row?.outputBits.join('') === engine);
    check('...OUTPUT shows it, and the wire leaving the box carries it',
      S().components.find((c) => c.id === outComp.id)?.value === 1 && S().wireValues.get(outWire.id) === 1);
  }

  // Drain: a sandbox run flushes one 0-step per MEM, boxed ones included —
  // a boxed serial adder's final carry reaches the output.
  clean();
  {
    const adderMachine = boxWhole(serialAdderMachine());
    useStore.setState({ components: adderMachine.components, wires: adderMachine.wires });
    S().scGlobalReset();
    useStore.setState({ scInputSequence: [[1], [1]] }); // 1 + 1, one bit each
    S().scRun();
    const start = Date.now();
    while (S().scRunning && Date.now() - start < 30000) await flush();
    await flush();
    const outs = S().scHistory.slice().sort((a, b) => a.t - b.t).map((h) => h.outputBits.join('')).join('');
    check(`a sandbox run of a boxed serial adder drains the boxed carry: 1 + 1 → ${outs} (LSB first)`, outs === '01');
  }
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

// ── Drawn-across boxes (task 038) ───────────────────────────────
// A box drawn across wires — no IN/OUT of its own — binds each port to the
// internal endpoint it stands for (Port.bind; engine/netlist.ts boxInterior,
// the one binding model), so placed it computes exactly the circuit it
// enclosed (every output read 0 before). A box enclosing its own IN/OUT binds
// as it always did (every pin above). Design memo:
// docs/buildout/designs/box-port-binding.md.
const { boxAcross, unbind } = await import('./builder');
type Machine = ReturnType<typeof circuit>;

console.log('\n[drawn-across boxes: engine]');
{
  const { evaluateCCInputs, evaluateBoxedCircuit } = await import('../src/engine/cc');
  const { evaluateSCSequence, boxMemoryOutputs, stepBoxedMemory } = await import('../src/engine/sc');
  const { hasCombinationalLoop, memorySlots, withMemState, sortByLabel } = await import('../src/engine/netlist');
  const cc = (m: Machine, bits: number[]) => evaluateCCInputs(m.components, m.wires, bits).join('');
  const allBits = (n: number) =>
    Array.from({ length: 1 << n }, (_, x) => Array.from({ length: n }, (_, i) => (x >> i) & 1));
  const ccAgree = (a: Machine, b: Machine, n: number) => allBits(n).every((bits) => cc(a, bits) === cc(b, bits));
  const sc = (m: Machine, feed: number[][]) =>
    evaluateSCSequence(m.components, m.wires, feed).map((r) => r.join('')).join(' ');
  const boxOf = (m: Machine) => m.components.find((c) => c.type === 'BOXED')!;
  const sides = (m: Machine) => {
    const b = boxOf(m);
    return `${b.ports.filter((p) => p.side === 'left').length}/${b.ports.filter((p) => p.side === 'right').length}`;
  };

  // The task's repro: IN1 → NOT → OUT1 with only the NOT boxed.
  const notM = circuit(
    [comp('i', 'INPUT', 'IN1'), comp('n', 'NOT', 'NOT', 160), comp('o', 'OUTPUT', 'OUT1', 320)],
    [wire('a', 'i', 'out', 'n', 'in'), wire('b', 'n', 'out', 'o', 'in')],
  );
  const notAcross = boxAcross(notM);
  const nb = boxOf(notAcross);
  check(`a box drawn across a NOT's wires holds no IN/OUT, its ports bound to the NOT (${nb.ports.map((p) => p.bind).join(', ')})`,
    !nb.internalCircuit!.components.some((c) => c.type === 'INPUT' || c.type === 'OUTPUT') &&
    nb.ports.map((p) => p.bind).join(',') === 'n:in,n:out');
  check(`...and computes NOT: 0 → ${cc(notAcross, [0])}, 1 → ${cc(notAcross, [1])}, as unboxed`,
    cc(notAcross, [0]) === '1' && cc(notAcross, [1]) === '0' && ccAgree(notAcross, notM, 1));
  check(`...the pin has teeth: by the old label rule the same box reads 0 at 0 (${cc(unbind(notAcross), [0])})`,
    cc(unbind(notAcross), [0]) === '0');

  // Memory: the one-tick delay with only its MEM boxed.
  const delay = delayMachine();
  const feed4 = [[1], [0], [1], [0]];
  const delayAcross = boxAcross(delay);
  check(`the delay with only its MEM boxed across gives ${sc(delayAcross, feed4)}, as unboxed`,
    sc(delayAcross, feed4) === sc(delay, feed4) && sc(delay, feed4) === '0 1 0 1');
  check('...and read 0000 by the old label rule', sc(unbind(delayAcross), feed4) === '0 0 0 0');

  // A toggle whose loop runs through a drawn-across MEM box (NOT outside).
  const toggleFlat = circuit(
    [comp('m', 'MEM', 'M1', 0, 0, MEM_RL), comp('n', 'NOT', 'NOT'), comp('o', 'OUTPUT', 'OUT1')],
    [wire('x', 'm', 'mout', 'n', 'in'), wire('y', 'n', 'out', 'm', 'min'), wire('z', 'm', 'mout', 'o', 'in')],
  );
  const toggleAcross = boxAcross(toggleFlat, 'Box 1', ['m']);
  const ticks = [[], [], [], [], []];
  check(`a toggle fed back through a drawn-across MEM box matches unboxed (${sc(toggleAcross, ticks)})`,
    sc(toggleAcross, ticks) === sc(toggleFlat, ticks) && sc(toggleFlat, ticks) === '0 1 0 1 0');
  check('...and is no combinational loop (the MEM inside breaks it)',
    !hasCombinationalLoop(toggleAcross.components, toggleAcross.wires));

  // Fan-in: a half adder of gates; each input feeds two sinks inside.
  const halfAdder = circuit(
    [
      comp('a', 'INPUT', 'IN1'), comp('b', 'INPUT', 'IN2', 0, 80),
      comp('and', 'AND', 'AND', 160), comp('xor', 'XOR', 'XOR', 160, 80),
      comp('c', 'OUTPUT', 'OUT1', 320), comp('s', 'OUTPUT', 'OUT2', 320, 80),
    ],
    [
      wire('w1', 'a', 'out', 'and', 'in1'), wire('w2', 'b', 'out', 'and', 'in2'),
      wire('w3', 'a', 'out', 'xor', 'in1'), wire('w4', 'b', 'out', 'xor', 'in2'),
      wire('w5', 'and', 'out', 'c', 'in'), wire('w6', 'xor', 'out', 's', 'in'),
    ],
  );
  const haAcross = boxAcross(halfAdder);
  check(`fan-in: one source into two sinks inside is two ports (${sides(haAcross)}), and the half adder still adds`,
    sides(haAcross) === '4/2' && ccAgree(haAcross, halfAdder, 2));

  // Fan-out: a source inside feeding both inside and out is an output port.
  const chain = circuit(
    [
      comp('i', 'INPUT', 'IN1'), comp('n1', 'NOT', 'NOT', 160), comp('n2', 'NOT', 'NOT', 320),
      comp('o1', 'OUTPUT', 'OUT1', 480), comp('o2', 'OUTPUT', 'OUT2', 480, 80),
    ],
    [wire('a', 'i', 'out', 'n1', 'in'), wire('b', 'n1', 'out', 'n2', 'in'), wire('c', 'n1', 'out', 'o1', 'in'), wire('d', 'n2', 'out', 'o2', 'in')],
  );
  const chainAcross = boxAcross(chain);
  check(`fan-out: a source feeding inside and out is a port too (${sides(chainAcross)}), and both outputs read right`,
    sides(chainAcross) === '1/2' && ccAgree(chainAcross, chain, 1));

  // Mixed: a box holding its own IN plus a cut wire into an AND.
  const mixedBox = {
    ...boxed('mx', 'Mixed', circuit([comp('own', 'INPUT', 'IN1', 0, 80), comp('and', 'AND', 'AND', 160)], [wire('w', 'own', 'out', 'and', 'in2')])),
    ports: [
      { id: 'in1', label: 'in1', side: 'left' as const, index: 0, bind: 'own:out' },
      { id: 'in2', label: 'in2', side: 'left' as const, index: 1, bind: 'and:in1' },
      { id: 'out1', label: 'out1', side: 'right' as const, index: 0, bind: 'and:out' },
    ],
  };
  const mixed = circuit(
    [comp('x', 'INPUT', 'IN1'), comp('y', 'INPUT', 'IN2', 0, 80), mixedBox, comp('o', 'OUTPUT', 'OUT1', 320)],
    [wire('a', 'x', 'out', 'mx', 'in1'), wire('b', 'y', 'out', 'mx', 'in2'), wire('c', 'mx', 'out1', 'o', 'in')],
  );
  const andM = circuit(
    [comp('x', 'INPUT', 'IN1'), comp('y', 'INPUT', 'IN2', 0, 80), comp('and', 'AND', 'AND', 160), comp('o', 'OUTPUT', 'OUT1', 320)],
    [wire('a', 'x', 'out', 'and', 'in1'), wire('b', 'y', 'out', 'and', 'in2'), wire('c', 'and', 'out', 'o', 'in')],
  );
  check('a mixed box (its own IN plus a cut wire) computes the AND it encloses', ccAgree(mixed, andM, 2));

  // Nesting: a drawn-across box inside a drawn-across box.
  check('a drawn-across box inside a drawn-across box still computes NOT',
    ccAgree(boxAcross(boxAcross(notM)), notM, 1));
  check(`...and a drawn-across MEM box inside one still delays (${sc(boxAcross(boxAcross(delay)), feed4)})`,
    sc(boxAcross(boxAcross(delay)), feed4) === '0 1 0 1');

  // As one gate (the store's local step): evaluateBoxedCircuit reads the
  // outputs, stepBoxedMemory clocks the box — together they must reproduce
  // the inlined run.
  const driveByHand = (m: Machine, feed: number[][]): string => {
    let box = boxOf(m);
    const ins = sortByLabel(m.components, 'IN');
    const outs = sortByLabel(m.components, 'OUT');
    const rows: string[] = [];
    for (const bits of feed) {
      const value = new Map(ins.map((c, i) => [c.id, bits[i] ?? 0]));
      const fed = box.ports.filter((p) => p.side === 'left').map((p) => {
        const w = m.wires.find((x) => x.targetComponentId === box.id && x.targetPortId === p.id);
        return w ? value.get(w.sourceComponentId) ?? 0 : 0;
      });
      const got = evaluateBoxedCircuit(box, fed);
      const rights = box.ports.filter((p) => p.side === 'right');
      rows.push(outs.map((o) => {
        const w = m.wires.find((x) => x.targetComponentId === o.id);
        if (!w) return 0;
        return w.sourceComponentId === box.id
          ? got[rights.findIndex((p) => p.id === w.sourcePortId)]
          : value.get(w.sourceComponentId) ?? 0;
      }).join(''));
      box = stepBoxedMemory(box, fed);
    }
    return rows.join(' ');
  };
  const adder = serialAdderMachine();
  const adderAcross = boxAcross(adder);
  const streams: number[][][] = [];
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) streams.push([0, 1, 2, 3].map((t) => [(x >> t) & 1, (y >> t) & 1]));
  check(`as one gate, a drawn-across delay stepped by hand matches the inlined run (${driveByHand(delayAcross, feed4)})`,
    driveByHand(delayAcross, feed4) === sc(delayAcross, feed4));
  check(`...and so does a serial adder boxed across (ports ${sides(adderAcross)}) over ${streams.length} streams, equal to unboxed`,
    streams.every((f) => driveByHand(adderAcross, f) === sc(adderAcross, f) && sc(adderAcross, f) === sc(adder, f)));
  const memBox = boxOf(delayAcross);
  const holding = (v: number) => ({
    ...memBox,
    internalCircuit: { ...memBox.internalCircuit!, components: withMemState(memBox.internalCircuit!.components, [v]) },
  });
  check('boxMemoryOutputs reads what a drawn-across MEM box holds, before its input is known (0, 1)',
    boxMemoryOutputs(holding(0)).join(',') === '0' && boxMemoryOutputs(holding(1)).join(',') === '1');
  check('...and stepBoxedMemory stores its port input',
    memorySlots(stepBoxedMemory(holding(0), [1]).internalCircuit!.components)[0].value === 1 &&
    memorySlots(stepBoxedMemory(holding(1), [0]).internalCircuit!.components)[0].value === 0);
}

// Every CC and SC reference machine (HW1–HW3: value, perception and turbot
// brain questions), boxed across, grades exactly as itself.
console.log('\n[drawn-across boxes: fixture parity]');
{
  const { gradeQuestion } = await import('../src/engine/grader');
  const { readdirSync } = await import('node:fs');
  const { rebindLegacyBoxes } = await import('../src/boxPorts');
  let compared = 0;
  const mismatched: string[] = [];
  const unrebound: string[] = [];
  let boxedCount = 0;
  const ids = readdirSync(FIXTURES).filter((f) => /^hw[123]-p\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
  for (const id of ids) {
    const fx = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8'));
    // A cap on BOXED counts the drawn box itself (hw2-p6: one boxed
    // sub-part), so both sides grade without that cap.
    let question = fx.question;
    if (question.component_limits?.BOXED !== undefined) {
      const { BOXED: _cap, ...rest } = question.component_limits;
      question = { ...question, component_limits: rest };
    }
    for (const which of ['correct', 'broken'] as const) {
      if (!fx[which]) continue;
      compared++;
      const across = boxAcross(fx[which]);
      const plain = JSON.stringify(gradeQuestion(question, fx[which]));
      if (plain !== JSON.stringify(gradeQuestion(question, across))) mismatched.push(`${id} ${which}`);
      // The same box saved before 038 (no binding), re-bound on load from its
      // library entry: exactly the placement's bindings back.
      const box = across.components.find((c) => c.type === 'BOXED' && c.id === 'ba-box');
      if (!box) continue; // nothing but IN/OUT wiring: nothing to box
      boxedCount++;
      const entry = {
        id: box.boxedCircuitId!, name: box.label,
        inputPortIds: box.ports.filter((p) => p.side === 'left').map((p) => p.bind!),
        outputPortIds: box.ports.filter((p) => p.side === 'right').map((p) => p.bind!),
        internalComponents: box.internalCircuit!.components, internalWires: box.internalCircuit!.wires,
      };
      if (JSON.stringify(rebindLegacyBoxes(unbind(across).components, [entry])) !== JSON.stringify(across.components)) {
        unrebound.push(`${id} ${which}`);
      }
    }
  }
  check(`${compared} CC / SC reference machines grade identically boxed across` +
    (mismatched.length ? ` (differ: ${mismatched.join(', ')})` : ''),
    compared === 62 && mismatched.length === 0);
  check(`...and saved before 038, each of the ${boxedCount} with a box is re-bound on load to exactly its placement's bindings` +
    (unrebound.length ? ` (differ: ${unrebound.join(', ')})` : ''),
    boxedCount === 61 && unrebound.length === 0);
}

// The store: confirm, place, run, paste, undo, save/load.
console.log('\n[drawn-across boxes: store]');
const S = () => useStore.getState();
const clean = () => useStore.setState({ components: [], wires: [], boxes: [], tableRows: [] });
const valueOf = (id: string) => S().components.find((c) => c.id === id)?.value;
function drawBox(x: number, y: number, width: number, height: number) {
  const id = `box-${Math.random().toString(36).slice(2)}`;
  S().addBox({ id, name: '', x, y, width, height, componentIds: [], inputPortIds: [], outputPortIds: [] });
  return { id, err: S().confirmBox(id) };
}
/** Steps 1–2 of the repro: IN1 → NOT → OUT1, a box drawn around the NOT
 *  only and confirmed. Returns the box id and the NOT's id. */
function reproConfirm(): { id: string; err: string | null; notId: string } {
  S().addComponent('INPUT', 200, 180);
  S().addComponent('NOT', 320, 200);
  S().addComponent('OUTPUT', 460, 210);
  const [i, n, o] = S().components.slice(-3);
  S().addWire(i.id, 'out', n.id, 'in');
  S().addWire(n.id, 'out', o.id, 'in');
  return { ...drawBox(300, 180, 120, 100), notId: n.id };
}
/** Step 3: place `boxId`, a fresh INPUT → in1 and out1 → a fresh OUTPUT. */
async function placeWired(boxId: string) {
  S().placeBoxInstance(boxId, 300, 300);
  await flush();
  const inst = S().components[S().components.length - 1];
  S().addComponent('INPUT', 100, 300);
  S().addComponent('OUTPUT', 500, 300);
  const [pin, pout] = S().components.slice(-2);
  S().addWire(pin.id, 'out', inst.id, 'in1');
  S().addWire(inst.id, 'out1', pout.id, 'in');
  await flush();
  return { inst: inst.id, pin: pin.id, pout: pout.id };
}
/** Step 4: what the OUTPUT reads at input 0, then at input 1. */
async function readsAt01(p: { pin: string; pout: string }) {
  S().setInputValue(p.pin, 0);
  await flush();
  const at0 = valueOf(p.pout);
  S().setInputValue(p.pin, 1);
  await flush();
  return `${at0}${valueOf(p.pout)}`;
}
const bindsOf = (id: string) =>
  (S().components.find((c) => c.id === id)?.ports ?? []).map((p) => `${p.id}=${p.bind ?? '-'}`).join(',');
let reproBinds = '';
{
  const { evaluateBoxedCircuit } = await import('../src/engine/cc');
  const { memorySlots, parsePortKey } = await import('../src/engine/netlist');

  // The task's repro, verbatim, in a sandbox Logic Circuit tab.
  S().goHome();
  S().newWorkbook();
  await flush();
  clean();
  const repro = reproConfirm();
  const entry = S().confirmedBoxLibrary.find((b) => b.id === repro.id);
  check(`the repro confirms (${repro.err ?? 'ok'}) as kind CC, internals [NOT], ports the NOT's cut wires`,
    repro.err === null && entry?.kind === 'CC' &&
    entry.internalComponents.map((c) => c.type).join(',') === 'NOT' &&
    entry.inputPortIds.join(',') === `${repro.notId}:in` && entry.outputPortIds.join(',') === `${repro.notId}:out`);
  clean();
  const placed = await placeWired(repro.id);
  reproBinds = bindsOf(placed.inst);
  check(`placed, its ports carry their bindings (${reproBinds})`,
    reproBinds === `in1=${repro.notId}:in,out1=${repro.notId}:out`);
  const reads = await readsAt01(placed);
  check(`...and the OUTPUT reads NOT: input 0 → ${reads[0]}, input 1 → ${reads[1]} (it read 0 and 0)`, reads === '10');

  // Undo / redo of the placement and its wiring keep the bindings.
  for (let i = 0; i < 5; i++) S().undo();
  check('undo removes the placed instance', !S().components.some((c) => c.id === placed.inst));
  for (let i = 0; i < 5; i++) S().redo();
  await flush();
  check('redo restores it with its bindings, still reading NOT',
    bindsOf(placed.inst) === reproBinds && (await readsAt01(placed)) === '10');

  // A paste mints fresh internal ids, and the bindings follow them.
  useStore.setState({ selectedIds: [placed.inst] });
  S().copySelected();
  const pasteMsg = S().paste();
  const orig = S().components.find((c) => c.id === placed.inst)!;
  const pasted = S().components.find((c) => c.type === 'BOXED' && c.id !== placed.inst);
  const innerIds = new Set((pasted?.internalCircuit?.components ?? []).map((c) => c.id));
  check(`a pasted copy (${pasteMsg ?? 'ok'}) has fresh internal ids, and its bindings name them`,
    pasteMsg === null && pasted != null &&
    !orig.internalCircuit!.components.some((c) => innerIds.has(c.id)) &&
    pasted.ports.every((p) => p.bind !== undefined && innerIds.has(parsePortKey(p.bind).compId)));
  check('...and it still computes NOT',
    pasted != null && evaluateBoxedCircuit(pasted, [0]).join('') === '1' && evaluateBoxedCircuit(pasted, [1]).join('') === '0');

  // Memory: a box around the delay's MEM only.
  clean();
  S().addComponent('INPUT', 200, 180);
  S().addComponent('MEM', 320, 180);
  S().addComponent('OUTPUT', 460, 190);
  const [di, dm, dout] = S().components.slice(-3);
  S().addWire(di.id, 'out', dm.id, 'min');
  S().addWire(dm.id, 'mout', dout.id, 'in');
  const memBox = drawBox(300, 160, 120, 100);
  const memEntry = S().confirmedBoxLibrary.find((b) => b.id === memBox.id);
  check(`a box around the MEM only confirms (${memBox.err ?? 'ok'}) as kind SC, ports the MEM's cut wires`,
    memBox.err === null && memEntry?.kind === 'SC' &&
    memEntry.inputPortIds.join(',') === `${dm.id}:min` && memEntry.outputPortIds.join(',') === `${dm.id}:mout`);
  clean();
  const mp = await placeWired(memBox.id);
  S().scGlobalReset();
  useStore.setState({ scInputSequence: [[1, 0, 1, 0]] });
  let outWire = '';
  const leaving = S().wires.find((x) => x.sourceComponentId === mp.inst)!;
  for (let t = 0; t < 4; t++) {
    S().scStep();
    outWire += String(S().wires.find((x) => x.id === leaving.id)!.value);
  }
  const outs = S().scHistory.map((h) => h.outputBits.join('')).join('');
  check(`scStep ×4 on 1,0,1,0 through the drawn-across MEM box: ${outs}, the wire leaving it ${outWire}`,
    outs === '0101' && outWire === '0101');
  const held = () => memorySlots(S().components).filter((sl) => sl.path[0] === mp.inst).map((sl) => sl.value).join(',');
  const localRow = (inBits: number[], memBits: number[]) => {
    useStore.setState({ tableRows: [] });
    S().localStepSelect(inBits, memBits);
    while (S().localStepOne()) { /* step to the end */ }
    return S().tableRows.find((r) => r.inputBits.join('') === inBits.join('') && (r.memBits ?? []).join('') === memBits.join(''))?.outputBits.join('');
  };
  const r10 = localRow([1], [0]);
  const held10 = held();
  const r01 = localRow([0], [1]);
  check(`the local step: row (in=1, m=0) → ${r10} leaving 1 held (${held10}); row (in=0, m=1) → ${r01} leaving 0 held (${held()})`,
    r10 === '0' && held10 === '1' && r01 === '1' && held() === '0');

  // Port order: two cut wires, the bottom one drawn first — in1 is the top.
  clean();
  S().addComponent('INPUT', 100, 140);
  S().addComponent('INPUT', 100, 340);
  S().addComponent('NOT', 320, 120);
  S().addComponent('NOT', 320, 320);
  S().addComponent('OUTPUT', 560, 130);
  S().addComponent('OUTPUT', 560, 330);
  const [ia, ib, nTop, nBot, oa, ob] = S().components.slice(-6);
  S().addWire(ib.id, 'out', nBot.id, 'in');
  S().addWire(nBot.id, 'out', ob.id, 'in');
  S().addWire(ia.id, 'out', nTop.id, 'in');
  S().addWire(nTop.id, 'out', oa.id, 'in');
  const two = drawBox(300, 100, 140, 300);
  const twoEntry = S().confirmedBoxLibrary.find((b) => b.id === two.id);
  check(`two cut wires drawn bottom-first: in1/out1 are the top NOT's (${two.err ?? 'ok'})`,
    two.err === null &&
    twoEntry?.inputPortIds.join(',') === `${nTop.id}:in,${nBot.id}:in` &&
    twoEntry?.outputPortIds.join(',') === `${nTop.id}:out,${nBot.id}:out`);
  clean();
  S().placeBoxInstance(two.id, 300, 300);
  await flush();
  const twoInst = S().components[S().components.length - 1];
  S().addComponent('INPUT', 100, 280);
  S().addComponent('INPUT', 100, 360);
  S().addComponent('OUTPUT', 520, 280);
  S().addComponent('OUTPUT', 520, 360);
  const [x, y, ox, oy] = S().components.slice(-4);
  S().addWire(x.id, 'out', twoInst.id, 'in1');
  S().addWire(y.id, 'out', twoInst.id, 'in2');
  S().addWire(twoInst.id, 'out1', ox.id, 'in');
  S().addWire(twoInst.id, 'out2', oy.id, 'in');
  S().setInputValue(x.id, 0);
  S().setInputValue(y.id, 1);
  await flush();
  check(`...placed, each port carries its own NOT: in1=0, in2=1 → out1=${valueOf(ox.id)}, out2=${valueOf(oy.id)}`,
    valueOf(ox.id) === 1 && valueOf(oy.id) === 0);

  // A mixed box: its own IN comes first, though it sits below the cut wire.
  clean();
  S().addComponent('INPUT', 100, 180);
  S().addComponent('INPUT', 200, 300);
  S().addComponent('AND', 320, 200);
  S().addComponent('OUTPUT', 500, 210);
  const [ma, mb, mand, mo] = S().components.slice(-4);
  S().addWire(ma.id, 'out', mand.id, 'in1');
  S().addWire(mb.id, 'out', mand.id, 'in2');
  S().addWire(mand.id, 'out', mo.id, 'in');
  const mixed = drawBox(180, 150, 240, 220);
  const mixedEntry = S().confirmedBoxLibrary.find((b) => b.id === mixed.id);
  check(`a mixed box (${mixed.err ?? 'ok'}): its own IN is in1, the cut wire in2`,
    mixed.err === null &&
    mixedEntry?.inputPortIds.join(',') === `${mb.id}:out,${mand.id}:in1` &&
    mixedEntry?.outputPortIds.join(',') === `${mand.id}:out`);
  clean();
  S().placeBoxInstance(mixed.id, 300, 300);
  await flush();
  const mixedInst = S().components[S().components.length - 1];
  const truth = [[0, 0], [0, 1], [1, 0], [1, 1]].map((bits) => evaluateBoxedCircuit(mixedInst, bits).join('')).join('');
  check(`...and placed it computes the AND it encloses (${truth})`, truth === '0001');

  // A box's own IN is always an input, even when it also feeds a wire
  // leaving the box — then it is an output too (a pass-through).
  clean();
  S().addComponent('INPUT', 200, 180);
  S().addComponent('NOT', 320, 200);
  S().addComponent('OUTPUT', 500, 120);
  S().addComponent('OUTPUT', 500, 210);
  const [pi, pn, poA, poB] = S().components.slice(-4);
  S().addWire(pi.id, 'out', pn.id, 'in');
  S().addWire(pi.id, 'out', poA.id, 'in');
  S().addWire(pn.id, 'out', poB.id, 'in');
  const pass = drawBox(180, 150, 240, 130);
  const passEntry = S().confirmedBoxLibrary.find((b) => b.id === pass.id);
  check(`an own IN that also feeds outside is an input AND an output (${pass.err ?? 'ok'})`,
    pass.err === null &&
    passEntry?.inputPortIds.join(',') === `${pi.id}:out` &&
    passEntry?.outputPortIds.join(',') === `${pi.id}:out,${pn.id}:out`);
  clean();
  S().placeBoxInstance(pass.id, 300, 300);
  await flush();
  const passInst = S().components[S().components.length - 1];
  check(`...placed, it passes its input through beside the NOT (0 → ${evaluateBoxedCircuit(passInst, [0]).join('')}, 1 → ${evaluateBoxedCircuit(passInst, [1]).join('')})`,
    evaluateBoxedCircuit(passInst, [0]).join('') === '01' && evaluateBoxedCircuit(passInst, [1]).join('') === '10');

  // An assignment save → reopen keeps the bindings.
  check('re-opened the assignment', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  S().switchQuestion(0);
  await flush();
  clean();
  const qRepro = reproConfirm();
  clean();
  const qPlaced = await placeWired(qRepro.id);
  const qBinds = bindsOf(qPlaced.inst);
  S().goHome();
  await flush();
  S().closeAssignment();
  check('reopened after close', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  S().switchQuestion(0);
  await flush();
  check(`the placed repro box keeps its bindings through save → reopen (${bindsOf(qPlaced.inst)})`,
    qBinds.includes(`${qRepro.notId}:in`) && bindsOf(qPlaced.inst) === qBinds);
  check('...and still reads NOT', (await readsAt01(qPlaced)) === '10');
}

// Boxes saved before 038 (no port bound): re-bound on load by the stated rule
// (boxPorts.ts rebindLegacyBoxes); a submitted snapshot runs as it was graded.
console.log('\n[drawn-across boxes: legacy]');
{
  const { localWorkbookStore } = await import('../src/storage/workbookStore');
  const { unboundBoxes, rebindLegacyBoxes } = await import('../src/boxPorts');
  const { gradedMachineKey } = await import('../src/engine/caseRun');
  const { evaluateCCInputs } = await import('../src/engine/cc');
  const q1 = buildSampleAssignment().questions[0].id;
  const stripAll = (cs: CircuitComponent[]) => unbind({ components: cs, wires: [] }).components;
  // Rewrite the saved workbook the way a pre-038 save holds it.
  async function editSaved(edit: (st: AssignmentState) => void) {
    const st = (await localWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID))!;
    edit(st);
    await localWorkbookStore.saveAssignmentState(SAMPLE_ASSIGNMENT_ID, st);
    return st;
  }
  async function reopenQ1() {
    S().goHome();
    await flush();
    S().closeAssignment();
    const ok = await S().openAssignment(SAMPLE_ASSIGNMENT_ID);
    S().switchQuestion(0);
    await flush();
    return ok;
  }

  // On Q1: the repro box placed fresh — the bindings a placement writes.
  check('opened the assignment', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  S().switchQuestion(0);
  await flush();
  clean();
  const r = reproConfirm();
  clean();
  const p = await placeWired(r.id);
  const fresh = bindsOf(p.inst);
  S().goHome();
  await flush();
  S().closeAssignment();
  const saved = await editSaved((st) => { st.questionCircuits[q1].components = stripAll(st.questionCircuits[q1].components); });
  check('a pre-038 save: the drawn-across instance holds no binding',
    saved.questionCircuits[q1].components.some((c) => c.id === p.inst && c.ports.every((pt) => pt.bind === undefined)));
  check('reopened', (await reopenQ1()) === true);
  check(`...re-bound on reopen from its library entry, as a fresh placement binds it (${bindsOf(p.inst)})`,
    bindsOf(p.inst) === fresh);
  check('...and reads NOT', (await readsAt01(p)) === '10');

  // Its library entry gone: bound from its internals' free ends.
  S().goHome();
  await flush();
  S().closeAssignment();
  await editSaved((st) => {
    st.questionCircuits[q1].components = stripAll(st.questionCircuits[q1].components);
    st.boxLibrary = (st.boxLibrary ?? []).filter((b) => b.id !== r.id);
  });
  await reopenQ1();
  check(`with its library entry removed, re-bound from its internals (${bindsOf(p.inst)})`,
    !S().confirmedBoxLibrary.some((b) => b.id === r.id) && bindsOf(p.inst) === fresh);
  check('...and reads NOT', (await readsAt01(p)) === '10');

  // A fan-out box (a source feeding inside and out) with no library entry:
  // its ports cannot be read off its internals, so it stays unbound — and
  // the canvas names it.
  const chain = circuit(
    [
      comp('i', 'INPUT', 'IN1'), comp('n1', 'NOT', 'NOT', 160), comp('n2', 'NOT', 'NOT', 320),
      comp('o1', 'OUTPUT', 'OUT1', 480), comp('o2', 'OUTPUT', 'OUT2', 480, 80),
    ],
    [wire('a', 'i', 'out', 'n1', 'in'), wire('b', 'n1', 'out', 'n2', 'in'), wire('c', 'n1', 'out', 'o1', 'in'), wire('d', 'n2', 'out', 'o2', 'in')],
  );
  const fan = unbind(boxAcross(chain, 'Fan box'));
  S().goHome();
  await flush();
  S().closeAssignment();
  await editSaved((st) => { st.questionCircuits[q1] = { ...st.questionCircuits[q1], components: fan.components, wires: fan.wires }; });
  await reopenQ1();
  const fanInst = S().components.find((c) => c.label === 'Fan box');
  check('a fan-out box with no library entry stays unbound',
    fanInst != null && fanInst.ports.every((pt) => pt.bind === undefined));
  check(`...and unboundBoxes names it for the canvas warning (${unboundBoxes(S().components).join(', ')})`,
    unboundBoxes(S().components).join(',') === 'Fan box');

  // A box enclosing its own IN/OUT, saved before 038, comes back untouched.
  clean();
  const andBox = buildAndBoxAnd();
  clean();
  S().placeBoxInstance(andBox, 300, 300);
  await flush();
  const andInst = S().components[S().components.length - 1].id;
  S().goHome();
  await flush();
  S().closeAssignment();
  const ownSaved = await editSaved((st) => { st.questionCircuits[q1].components = stripAll(st.questionCircuits[q1].components); });
  const ownBefore = ownSaved.questionCircuits[q1].components.find((c) => c.id === andInst)!;
  const { restoreQuestionCircuits } = await import('../src/storage/workbookStore');
  check('restoring that save re-binds nothing: the question circuit is the saved object itself',
    restoreQuestionCircuits(buildSampleAssignment(), ownSaved).questionCircuits.get(q1) === ownSaved.questionCircuits[q1]);
  await reopenQ1();
  const ownAfter = S().components.find((c) => c.id === andInst)!;
  check('an own-IN box saved before 038 comes back untouched (ports and internals deep-equal, no binding added)',
    JSON.stringify([ownAfter.ports, ownAfter.internalCircuit]) === JSON.stringify([ownBefore.ports, ownBefore.internalCircuit]) &&
    ownAfter.ports.every((pt) => pt.bind === undefined));
  check('...its graded key unchanged (no spurious run restart)',
    gradedMachineKey({ components: [ownAfter], wires: [] }) === gradedMachineKey({ components: [ownBefore], wires: [] }));
  check('...and unboundBoxes does not name it', !unboundBoxes([ownAfter]).includes(ownAfter.label));

  // A submitted snapshot is never re-bound: it runs as it was graded.
  const snap = unbind(boxAcross(circuit(
    [comp('i', 'INPUT', 'IN1'), comp('n', 'NOT', 'NOT', 160), comp('o', 'OUTPUT', 'OUT1', 320)],
    [wire('a', 'i', 'out', 'n', 'in'), wire('b', 'n', 'out', 'o', 'in')],
  ), 'Snap box'));
  const record: SubmissionRecord = {
    assignmentId: SAMPLE_ASSIGNMENT_ID,
    attempt: 99,
    submittedAt: new Date().toISOString(),
    submission: {
      assignmentTitle: 'sample',
      submittedAt: new Date().toISOString(),
      answers: [{ questionId: q1, circuit: snap }],
    },
  };
  useStore.setState({ submissions: { ...S().submissions, [SAMPLE_ASSIGNMENT_ID]: record } });
  const viewed = await S().viewSubmission(99);
  const snapInst = S().components.find((c) => c.label === 'Snap box');
  check('the submitted view shows the snapshot as submitted: its drawn-across box stays unbound',
    viewed && snapInst != null && snapInst.ports.every((pt) => pt.bind === undefined));
  check('...though the load rule WOULD re-bind it (the pin has teeth)',
    rebindLegacyBoxes(snap.components, [])[snap.components.length - 1].ports.every((pt) => pt.bind !== undefined) &&
    evaluateCCInputs(snap.components, snap.wires, [0]).join('') === '0');
  await S().viewSubmission(null);

  // The sandbox: an opened workbook file, and the autosave.
  S().goHome();
  S().newWorkbook();
  await flush();
  clean();
  const sr = reproConfirm();
  clean();
  const sp = await placeWired(sr.id);
  const sFresh = bindsOf(sp.inst);
  const file = JSON.parse(S().exportWorkbook());
  for (const ws of file.worksheets) ws.circuit.components = stripAll(ws.circuit.components);
  const imported = S().importWorkbook(JSON.stringify(file), null, 'legacy.json');
  await flush();
  check(`an opened workbook file's pre-038 box is re-bound (${imported.ok ? bindsOf(sp.inst) : 'refused'})`,
    imported.ok && bindsOf(sp.inst) === sFresh && sFresh.includes(`${sr.notId}:in`));
  check('...and reads NOT', (await readsAt01(sp)) === '10');

  const tabId = S().activeTabId;
  const blob = {
    formatVersion: 2,
    workbookOpen: true,
    workbookTitle: 'Legacy',
    workbookSavedKey: null,
    tabs: S().tabs,
    activeTabId: tabId,
    tabCircuits: {
      [tabId]: { components: stripAll(S().components), wires: S().wires, boxes: S().boxes, confirmedBoxes: S().confirmedBoxLibrary },
    },
    viewPreferences: {},
  };
  localStorage.setItem('making-minds-autosave:legacy-038@example.com', JSON.stringify(blob));
  S().resetForPrincipal('legacy-038@example.com');
  await flush();
  check(`a sandbox autosaved before 038 is re-bound when it loads (${bindsOf(sp.inst)})`,
    bindsOf(sp.inst) === sFresh);

  // The oldest autosave (no formatVersion): its active canvas is re-bound too.
  const oldBlob = {
    tabs: S().tabs,
    activeTabId: tabId,
    buildMode: 'CC',
    components: stripAll(S().components),
    wires: S().wires,
    boxes: S().boxes,
  };
  S().goHome();
  await flush();
  localStorage.setItem('making-minds-autosave:legacy-038-v1@example.com', JSON.stringify(oldBlob));
  S().resetForPrincipal('legacy-038-v1@example.com');
  await flush();
  check(`an autosave from before formatVersion 2 re-binds its canvas as it loads (${bindsOf(sp.inst)})`,
    bindsOf(sp.inst) === sFresh);

  // A pre-038 box placed INSIDE a library entry: the sandbox's library is
  // re-bound as it loads, as an assignment's is (restoreQuestionCircuits), so
  // placing the outer box computes at once — not only after the next reload.
  const { evaluateBoxedCircuit } = await import('../src/engine/cc');
  const notInner = circuit([comp('n', 'NOT', 'NOT', 160)], []);
  const libA = {
    id: 'lib-a', name: 'Lib A', kind: 'CC' as const,
    inputPortIds: ['n:in'], outputPortIds: ['n:out'],
    internalComponents: notInner.components, internalWires: notInner.wires,
  };
  const instA: CircuitComponent = {
    id: 'inst-a', type: 'BOXED', x: 160, y: 0, label: 'Lib A', value: 0, boxedCircuitId: 'lib-a',
    ports: [
      { id: 'in1', label: 'in1', side: 'left', index: 0 },
      { id: 'out1', label: 'out1', side: 'right', index: 0 },
    ],
    internalCircuit: JSON.parse(JSON.stringify(notInner)),
  };
  const libB = {
    id: 'lib-b', name: 'Lib B', kind: 'CC' as const,
    inputPortIds: ['inst-a:in1'], outputPortIds: ['inst-a:out1'],
    internalComponents: [instA], internalWires: [],
  };
  const innerBinds = () => {
    const b = S().confirmedBoxLibrary.find((e) => e.id === 'lib-b');
    return (b?.internalComponents[0]?.ports ?? []).map((pt) => pt.bind ?? '-').join(',');
  };
  const placeB = async () => {
    S().placeBoxInstance('lib-b', 300, 300);
    await flush();
    const inst = S().components[S().components.length - 1];
    return inst.boxedCircuitId === 'lib-b' ? evaluateBoxedCircuit(inst, [0]).join('') + evaluateBoxedCircuit(inst, [1]).join('') : 'not placed';
  };
  const libBlob = {
    formatVersion: 2,
    workbookOpen: true,
    workbookTitle: 'Legacy library',
    workbookSavedKey: null,
    tabs: [{ id: 'lib-tab', title: 'Circuit', buildMode: 'CC', activeTask: 'arithmetic' }],
    activeTabId: 'lib-tab',
    tabCircuits: { 'lib-tab': { components: [], wires: [], boxes: [], confirmedBoxes: [libA, libB] } },
    viewPreferences: {},
  };
  localStorage.setItem('making-minds-autosave:legacy-038-lib@example.com', JSON.stringify(libBlob));
  S().resetForPrincipal('legacy-038-lib@example.com');
  S().enterSandbox();
  await flush();
  check(`a sandbox autosave's library entry holding a pre-038 box is re-bound as it loads (${innerBinds()})`,
    innerBinds() === 'n:in,n:out');
  check('...so the outer box placed from it computes NOT at once (0 → 1, 1 → 0)', (await placeB()) === '10');
  check('...the pin has teeth: the saved entry held that inner box unbound',
    libBlob.tabCircuits['lib-tab'].confirmedBoxes[1].internalComponents[0].ports.every((pt) => !('bind' in pt)));

  const libFile = JSON.parse(S().exportWorkbook());
  for (const ws of libFile.worksheets) ws.confirmedBoxes = [libA, libB];
  const libImported = S().importWorkbook(JSON.stringify(libFile), null, 'legacy-lib.json');
  await flush();
  check(`an opened workbook file's library entry holding a pre-038 box is re-bound (${libImported.ok ? innerBinds() : 'refused'})`,
    libImported.ok && innerBinds() === 'n:in,n:out');
  check('...and the outer box placed from it computes NOT', (await placeB()) === '10');
}

// A box enclosing its own IN/OUT keeps every port the label rule reaches:
// confirmBox before 038 dropped an own IN that also fed a wire leaving the
// box from its inputs (an own OUT fed from outside from its outputs), so its
// recorded order alone would move a live port. Only the dead ports re-bind.
console.log('\n[drawn-across boxes: legacy own IN/OUT]');
{
  const { rebindLegacyBoxes, orderBoxPorts, bindPorts } = await import('../src/boxPorts');
  const { evaluateBoxedCircuit } = await import('../src/engine/cc');
  const placedFrom = (id: string, inner: Machine, nLeft: number, nRight: number): CircuitComponent => ({
    id: `${id}-inst`, type: 'BOXED', x: 0, y: 0, label: id, value: 0, boxedCircuitId: id,
    ports: [
      ...Array.from({ length: nLeft }, (_, i) => ({ id: `in${i + 1}`, label: `in${i + 1}`, side: 'left' as const, index: i })),
      ...Array.from({ length: nRight }, (_, j) => ({ id: `out${j + 1}`, label: `out${j + 1}`, side: 'right' as const, index: j })),
    ],
    internalCircuit: JSON.parse(JSON.stringify(inner)),
  });
  const entryOf = (id: string, inner: Machine, ins: string[], outs: string[]) => ({
    id, name: id, kind: 'CC' as const, inputPortIds: ins, outputPortIds: outs,
    internalComponents: inner.components, internalWires: inner.wires,
  });
  const reads = (b: CircuitComponent, bits: number[]) => evaluateBoxedCircuit(b, bits);

  // Input side (the review's repro): IN1 → NOT → OUT1, IN1·IN2 → AND → OUT2,
  // and IN1 also wired out of the box. Recorded before 038: inputs [IN2],
  // outputs [IN1 (it fed outside), OUT1, OUT2] — one left port, three right.
  const ownFan = circuit(
    [
      comp('i1', 'INPUT', 'IN1'), comp('i2', 'INPUT', 'IN2', 0, 80),
      comp('n', 'NOT', 'NOT', 160), comp('g', 'AND', 'AND', 160, 80),
      comp('o1', 'OUTPUT', 'OUT1', 320), comp('o2', 'OUTPUT', 'OUT2', 320, 80),
    ],
    [
      wire('a', 'i1', 'out', 'n', 'in'), wire('b', 'n', 'out', 'o1', 'in'),
      wire('c', 'i1', 'out', 'g', 'in1'), wire('d', 'i2', 'out', 'g', 'in2'), wire('e', 'g', 'out', 'o2', 'in'),
    ],
  );
  const fanEntry = entryOf('own-fan', ownFan, ['i2:out'], ['i1:out', 'o1:in', 'o2:in']);
  const fanPlaced = placedFrom('own-fan', ownFan, 1, 3);
  const [fanRebound] = rebindLegacyBoxes([fanPlaced], [fanEntry]);
  const fanBinds = fanRebound.ports.map((pt) => pt.bind ?? '-').join(',');
  check(`in1 stays on IN1, the label rule's binding (${fanBinds})`,
    fanBinds === 'i1:out,o1:in,o2:in,i1:out');
  check('...out1 and out2 read exactly what the label rule read, at in1 = 0 and 1',
    [0, 1].every((x) => reads(fanRebound, [x]).slice(0, 2).join('') === reads(fanPlaced, [x]).slice(0, 2).join('')));
  check('...and the dead out3 now carries IN1 out of the box (it read 0)',
    [0, 1].every((x) => reads(fanRebound, [x])[2] === x && (reads(fanPlaced, [x])[2] ?? 0) === 0));
  const fanRecorded = bindPorts(fanPlaced.ports, orderBoxPorts(ownFan.components, fanEntry.inputPortIds, fanEntry.outputPortIds));
  check('...the pin has teeth: the recorded order alone puts in1 on IN2, and out1 then reads 1 at in1 = 1',
    fanRecorded[0].bind === 'i2:out' && reads({ ...fanPlaced, ports: fanRecorded }, [1])[0] === 1 &&
    reads(fanPlaced, [1])[0] === 0);

  // Output side: OUT1 fed from outside, IN1 → NOT → OUT2, and IN1·IN1 → AND
  // wired out of the box. Recorded before 038: inputs [OUT1's input, IN1],
  // outputs [the AND, OUT2] — two left ports, two right.
  const ownSink = circuit(
    [
      comp('i1', 'INPUT', 'IN1'), comp('n', 'NOT', 'NOT', 160), comp('g', 'AND', 'AND', 160, 80),
      comp('o1', 'OUTPUT', 'OUT1', 320), comp('o2', 'OUTPUT', 'OUT2', 320, 80),
    ],
    [
      wire('a', 'i1', 'out', 'n', 'in'), wire('b', 'n', 'out', 'o2', 'in'),
      wire('c', 'i1', 'out', 'g', 'in1'), wire('d', 'i1', 'out', 'g', 'in2'),
    ],
  );
  const sinkEntry = entryOf('own-sink', ownSink, ['o1:in', 'i1:out'], ['g:out', 'o2:in']);
  const sinkPlaced = placedFrom('own-sink', ownSink, 2, 2);
  const [sinkRebound] = rebindLegacyBoxes([sinkPlaced], [sinkEntry]);
  const sinkBinds = sinkRebound.ports.map((pt) => pt.bind ?? '-').join(',');
  const pairs = [[0, 0], [0, 1], [1, 0], [1, 1]];
  check(`out1/out2 stay on OUT1/OUT2, the dead in2 takes OUT1's cut input (${sinkBinds})`,
    sinkBinds === 'i1:out,o1:in,o1:in,o2:in');
  check('...out2 reads exactly what the label rule read (NOT in1), for every input',
    pairs.every((bits) => reads(sinkRebound, bits)[1] === reads(sinkPlaced, bits)[1]));
  check('...and out1, which read 0, now carries in2 through OUT1',
    pairs.every((bits) => reads(sinkRebound, bits)[0] === bits[1] && reads(sinkPlaced, bits)[0] === 0));
  const sinkRecorded = orderBoxPorts(ownSink.components, sinkEntry.inputPortIds, sinkEntry.outputPortIds);
  check('...the pin has teeth: the recorded order alone puts out2 on the AND (IN1, not NOT IN1)',
    sinkRecorded.outputs[1] === 'g:out' &&
    reads({ ...sinkPlaced, ports: bindPorts(sinkPlaced.ports, sinkRecorded) }, [1, 0])[1] !== reads(sinkPlaced, [1, 0])[1]);

  // An own-IN box the label rule fully binds is never touched.
  const fullEntry = entryOf('own-full', ownFan, ['i1:out', 'i2:out'], ['o1:in', 'o2:in']);
  const fullPlaced = placedFrom('own-full', ownFan, 2, 2);
  const fullList = [fullPlaced];
  check('a box the label rule fully binds comes back as the same array, unbound',
    rebindLegacyBoxes(fullList, [fullEntry]) === fullList);
}

// ── [memory] a combinatorial canvas holds none (task 045) ────────────────
// One rule — types.ts modeHoldsMemory, "a canvas may hold memory iff it may
// place a sequential box" — asked by the palette, addComponent, paste, the
// question creator and the grader's Stage 1. Before 045 a CC question's
// palette offered MEM and the grader ran it as a constant 0.
console.log('\n[memory: a combinatorial canvas holds none]');
{
  const { modeHoldsMemory, placeableBoxKinds } = await import('../src/types');
  const { selectMayHoldMemory } = await import('../src/store');
  const { gradeQuestion } = await import('../src/engine');
  const { ccCorrect, scCorrect, turbotCorrect, perceptionEdgeCorrect } = await import('../src/devData/sampleData');
  const { comp } = await import('./builder');

  const modes = ['CC', 'SC', 'FSM', 'TM', 'turbot', 'open'] as const;
  check('the rule: CC holds no memory, SC does',
    !modeHoldsMemory('CC') && modeHoldsMemory('SC'));
  check('...and it IS the sequential-box rule, mode by mode',
    modes.every((m) => modeHoldsMemory(m) === placeableBoxKinds(m).includes('SC')));

  // The store: palette selector, placement, paste.
  check('opened the sample assignment', (await S().openAssignment(SAMPLE_ASSIGNMENT_ID)) === true);
  S().switchQuestion(0); // Q1: CC
  await flush();
  clean();
  check('a CC question may not hold memory (the palette hides MEM)', !selectMayHoldMemory(S()));
  const undo0 = S().undoStack.length;
  S().addComponent('MEM', 300, 300);
  check('...addComponent(MEM) places nothing and leaves no undo entry',
    !S().components.some((c) => c.type === 'MEM') && S().undoStack.length === undo0);
  S().addComponent('AND', 300, 300);
  check('...while a gate still places', S().components.some((c) => c.type === 'AND'));
  S().switchQuestion(4); // Q5: turbot, CC brain
  await flush();
  check('a turbot with a CC brain may not hold memory', !selectMayHoldMemory(S()));
  S().switchQuestion(5); // Q6: turbot, SC brain
  await flush();
  check('a turbot with an SC brain may', selectMayHoldMemory(S()));
  S().switchQuestion(1); // Q2: SC
  await flush();
  check('an SC question may hold memory', selectMayHoldMemory(S()));
  const scBefore = S().components.length;
  S().addComponent('MEM', 640, 420);
  const mem = S().components.slice(scBefore).find((c) => c.type === 'MEM');
  check('...and addComponent(MEM) places one there', mem !== undefined);
  useStore.setState({ selectedIds: [mem!.id] });
  S().copySelected();
  S().deleteSelected();
  S().switchQuestion(0);
  await flush();
  const n0 = S().components.length;
  const u0 = S().undoStack.length;
  const msg = S().paste();
  check(`pasting a bare MEM onto the CC question is refused, naming it (${msg})`,
    typeof msg === 'string' && msg.includes(mem!.label) && msg.includes('combinatorial'));
  check('...adding nothing and leaving no undo entry',
    S().components.length === n0 && S().undoStack.length === u0 && !S().components.some((c) => c.type === 'MEM'));
  clean();
  S().closeAssignment();
  await flush();
  useStore.setState({ buildMode: 'CC' });
  check("the sandbox's Logic Circuit tab (CC mode) keeps memory", selectMayHoldMemory(S()));

  // The grader: Stage 1 refuses memory in every combinatorial machine.
  const qs = buildSampleAssignment().questions;
  const withMem = (c: ReturnType<typeof ccCorrect>) =>
    ({ ...c, components: [...c.components, comp('stray-mem', 'MEM', 'M1', 900, 900)] });
  const reasons = (r: ReturnType<typeof gradeQuestion>): string[] => [
    ...(r.cases ?? []).map((c) => c.reason ?? ''),
    ...(r.turbotCases ?? []).map((c) => c.reason ?? ''),
    ...(r.perceptionCases ?? []).map((c) => c.reason ?? ''),
  ];
  const refused = (r: ReturnType<typeof gradeQuestion>) =>
    r.status === 'graded' && r.total > 0 && r.passed === 0 && reasons(r).every((x) => x.includes('no memory'));
  const passes = (r: ReturnType<typeof gradeQuestion>) => r.status === 'graded' && r.total > 0 && r.passed === r.total;
  const qCC = qs[0], qSC = qs[1], qTurbotCC = qs[4], qPerceptionCC = qs[8];
  check(`sample questions are what the pins assume (${qCC.buildMode}, ${qSC.buildMode}, ${qTurbotCC.buildMode}/${qTurbotCC.innerMode}, ${qPerceptionCC.buildMode}+perception)`,
    qCC.buildMode === 'CC' && qSC.buildMode === 'SC' && qTurbotCC.buildMode === 'turbot' &&
    qTurbotCC.innerMode === 'CC' && qPerceptionCC.buildMode === 'CC' && qPerceptionCC.perception !== undefined);
  check('control: the CC answer passes without the MEM', passes(gradeQuestion(qCC, ccCorrect())));
  check('a CC answer holding a MEM is refused at Stage 1, every case, with the reason',
    refused(gradeQuestion(qCC, withMem(ccCorrect()))));
  check('...likewise a turbot CC brain', refused(gradeQuestion(qTurbotCC, withMem(turbotCorrect()))));
  check('...and a CC perception circuit', refused(gradeQuestion(qPerceptionCC, withMem(perceptionEdgeCorrect()))));
  check('an SC answer with its MEMs still passes', passes(gradeQuestion(qSC, scCorrect())));
}

console.log(`\nboxScopeCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
