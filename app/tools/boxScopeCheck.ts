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

console.log(`\nboxScopeCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
