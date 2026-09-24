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
// box and every placed instance's label on every question.
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
  buildDelay();
  const ccRefusal = drawAndConfirm();
  check(`a CC question refuses to box a MEM, naming it (${ccRefusal.err})`,
    typeof ccRefusal.err === 'string' && ccRefusal.err.includes('M') &&
    ccRefusal.err.includes('Memory cannot go inside a box here'));
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

console.log(`\nboxScopeCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
