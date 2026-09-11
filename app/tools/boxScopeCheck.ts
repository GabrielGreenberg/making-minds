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
// removeConfirmedBox strips the entry + placed instances and undo restores it.
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

// ── assignment: per-question isolation ──────────────────────────
const assignment = buildSampleAssignment();
await localAssignmentStore.save(assignment);
// Unpublished assignments aren't openable by a student (store.openAssignment).
await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);
const store = useStore.getState();
const ok = await store.openAssignment(SAMPLE_ASSIGNMENT_ID);
check('sample assignment opened', ok);
useStore.getState().switchQuestion(0); // Q1 is a CC question
await flush();

console.log('[per-question isolation]');
const boxId = buildAndBoxAnd();
check('confirm added a library entry on Q1', useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));

useStore.getState().switchQuestion(1);
await flush();
check('Q2 library is empty (no leak)', useStore.getState().confirmedBoxLibrary.length === 0);

useStore.getState().switchQuestion(0);
await flush();
check('back on Q1 the library is restored', useStore.getState().confirmedBoxLibrary.some((b) => b.id === boxId));
check('restored entry has internals', (useStore.getState().confirmedBoxLibrary.find((b) => b.id === boxId)?.internalComponents.length ?? 0) > 0);

// place an instance from the restored library
const before = useStore.getState().components.length;
useStore.getState().placeBoxInstance(boxId, 400, 400);
await flush();
check('instance placeable from restored library', useStore.getState().components.length === before + 1);

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
  check('CC and SC place CC boxes; FSM places FSM boxes; TM places none',
    placeableBoxKinds('CC').join(',') === 'CC' &&
    placeableBoxKinds('SC').join(',') === 'CC' &&
    placeableBoxKinds('FSM').join(',') === 'FSM' &&
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
    (entry?.kind ?? 'CC') === 'CC' && placeableBoxKinds('SC').includes(entry?.kind ?? 'CC'));
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

console.log(`\nboxScopeCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
