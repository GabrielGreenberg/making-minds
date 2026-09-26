import type { CircuitComponent } from '../src/types';

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
const { buildSampleAssignment, SAMPLE_ASSIGNMENT_ID } = await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const flush = () => new Promise((r) => setTimeout(r, 10));
const S = () => useStore.getState();
const added = (before: number) => S().components.slice(before);
const byLabel = (label: string) => S().components.find((c) => c.label === label)!;

function truthTable(): string {
  const [a, b] = [byLabel('IN1'), byLabel('IN2')];
  let out = '';
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    S().setInputValue(a.id, x);
    S().setInputValue(b.id, y);
    S().evaluateCircuit();
    out += String(byLabel('OUT1').value ?? '?');
  }
  return out;
}

const assignment = buildSampleAssignment();
await localAssignmentStore.save(assignment);
await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);
check('sample assignment opened', await S().openAssignment(SAMPLE_ASSIGNMENT_ID));
S().switchQuestion(0);
await flush();
useStore.setState({ components: [], wires: [], boxes: [] });

console.log('[box selection: the XOR case]');
S().addComponent('INPUT', 100, 100);
S().addComponent('INPUT', 100, 220);
S().addComponent('OR', 260, 60);
S().addComponent('AND', 260, 200);
S().addComponent('NOT', 380, 200);
S().addComponent('AND', 500, 120);
S().addComponent('OUTPUT', 640, 130);
const [in1, in2, or, and1, not, and2, out] = S().components;
S().addWire(in1.id, 'out', or.id, 'in1');
S().addWire(in2.id, 'out', or.id, 'in2');
S().addWire(in1.id, 'out', and1.id, 'in1');
S().addWire(in2.id, 'out', and1.id, 'in2');
S().addWire(and1.id, 'out', not.id, 'in');
S().addWire(or.id, 'out', and2.id, 'in1');
S().addWire(not.id, 'out', and2.id, 'in2');
S().addWire(and2.id, 'out', out.id, 'in');
check('the unboxed gates compute XOR', truthTable() === '0110');

const libBefore = S().confirmedBoxLibrary.length;
S().setSelectedIds([in1.id, or.id, and1.id, not.id, and2.id, out.id]);
const err = S().boxSelection();
check(`box selection succeeds (${err})`, err === null);
const entry = S().confirmedBoxLibrary[S().confirmedBoxLibrary.length - 1];
check('one library entry added', S().confirmedBoxLibrary.length === libBefore + 1);
check('2 inputs, 1 output: one port per distinct outside source',
  entry.inputPortIds.length === 2 && entry.outputPortIds.length === 1);
check('the editor opens on the new box', S().boxEditor?.boxId === entry.id);
check('the editor shows the gates plus IN1, IN2, OUT1',
  S().components.length === 7 && ['IN1', 'IN2', 'OUT1'].every((l) => S().components.some((c) => c.label === l)));
const stash = S().boxEditor!.stash;
const inst = stash.components.find((c) => c.type === 'BOXED')!;
check('the canvas keeps IN1, IN2, OUT1 and one box in place of the gates',
  stash.components.length === 4 && stash.components.filter((c) => c.type === 'INPUT').length === 2 && inst !== undefined);
check('the copy is wired: 2 wires in, 1 out',
  stash.wires.filter((w) => w.targetComponentId === inst.id).length === 2 &&
  stash.wires.filter((w) => w.sourceComponentId === inst.id).length === 1);

check(`save succeeds (${S().saveBoxEditor('XOR')})`, S().boxEditor === null);
check('the canvas is the question again', S().components.length === 4);
check('the box is named XOR everywhere',
  S().confirmedBoxLibrary.some((b) => b.id === entry.id && b.name === 'XOR') &&
  S().components.find((c) => c.type === 'BOXED')!.label === 'XOR');
check('boxed, the circuit still computes XOR', truthTable() === '0110');

S().undo();
check('undo steps back over the editor (the box, unsaved name)', S().components.length === 4);
S().undo();
check('a second undo restores the loose gates', S().components.length === 7 && truthTable() === '0110');
check('…and the library without the box', !S().confirmedBoxLibrary.some((b) => b.id === entry.id));
S().redo();
S().redo();
check('redo brings the named box back', S().confirmedBoxLibrary.some((b) => b.id === entry.id && b.name === 'XOR'));

console.log('[edit reaches every copy]');
S().switchQuestion(1);
await flush();
const q2Before = S().components.length;
S().placeBoxInstance(entry.id, 300, 300);
const q2Copy = S().components[q2Before];
check('a copy placed on Q2', q2Copy?.boxedCircuitId === entry.id);
S().switchQuestion(0);
await flush();

check(`open the editor by box id (${S().openBoxEditor(entry.id)})`, S().boxEditor?.boxId === entry.id);
check('it opens with IN1, IN2, OUT1 and the gates', S().components.length === 7);
const keep = new Set(S().components.filter((c) => c.type === 'INPUT' || c.type === 'OUTPUT').map((c) => c.id));
S().setSelectedIds(S().components.filter((c) => !keep.has(c.id)).map((c) => c.id));
S().deleteSelected();
const n = S().components.length;
S().addComponent('OR', 260, 120);
const [newOr] = added(n);
S().addWire(byLabel('IN1').id, 'out', newOr.id, 'in1');
S().addWire(byLabel('IN2').id, 'out', newOr.id, 'in2');
S().addWire(newOr.id, 'out', byLabel('OUT1').id, 'in');
check(`save the edit (${S().saveBoxEditor()})`, S().boxEditor === null);
check('this canvas\'s copy now computes OR', truthTable() === '0111');
const q2Saved = S().questionCircuits.get(assignment.questions[1].id)!;
const q2Now = q2Saved.components.find((c: CircuitComponent) => c.id === q2Copy.id)!;
check('Q2\'s copy took the edit too', q2Now.internalCircuit!.components.some((c) => c.type === 'OR') &&
  !q2Now.internalCircuit!.components.some((c) => c.type === 'NOT'));

console.log('[a done question keeps its copy]');
S().switchQuestion(1);
await flush();
S().toggleCurrentQuestionDone();
S().switchQuestion(0);
await flush();
S().openBoxEditor(entry.id);
const n2 = S().components.length;
S().addComponent('NOT', 400, 300);
const [extraNot] = added(n2);
S().addWire(S().components.find((c) => c.type === 'OR')!.id, 'out', extraNot.id, 'in');
S().removeWire(S().wires.find((w) => w.targetComponentId === byLabel('OUT1').id)!.id);
S().addWire(extraNot.id, 'out', byLabel('OUT1').id, 'in');
check(`save NOR (${S().saveBoxEditor()})`, S().boxEditor === null);
check('this canvas computes NOR', truthTable() === '1000');
const q2Done = S().questionCircuits.get(assignment.questions[1].id)!.components.find((c: CircuitComponent) => c.id === q2Copy.id)!;
check('the done question\'s copy is unchanged', !q2Done.internalCircuit!.components.some((c) => c.type === 'NOT'));

console.log('[new box from scratch]');
const lib0 = S().confirmedBoxLibrary.length;
const live0 = S().components.map((c) => c.id).join();
check('open a new box', S().openBoxEditor(null) === null && S().components.length === 0 && S().boxEditor?.isNew === true);
S().addComponent('INPUT', 100, 100);
S().addComponent('INPUT', 100, 200);
S().addComponent('AND', 240, 130);
S().addComponent('OUTPUT', 380, 140);
const [a1, a2, g, o] = S().components;
check('the editor numbers its own inputs from IN1', a1.label === 'IN1' && a2.label === 'IN2');
S().addWire(a1.id, 'out', g.id, 'in1');
S().addWire(a2.id, 'out', g.id, 'in2');
check('an unwired output is refused', (S().saveBoxEditor('Both') ?? '').includes('Free end'));
S().addWire(g.id, 'out', o.id, 'in');
check('a name another box has is refused', (S().saveBoxEditor('XOR') ?? '').includes('already exists'));
check(`save (${S().saveBoxEditor('Both')})`, S().boxEditor === null);
const both = S().confirmedBoxLibrary.find((b) => b.name === 'Both');
check('the library has it, 2 in 1 out', S().confirmedBoxLibrary.length === lib0 + 1 &&
  both?.inputPortIds.length === 2 && both?.outputPortIds.length === 1);
check('the question canvas is untouched', S().components.map((c) => c.id).join() === live0);

console.log('[refusals and swaps]');
S().openBoxEditor(both!.id);
S().placeBoxInstance(both!.id, 500, 500);
check('a box cannot contain itself', (S().saveBoxEditor() ?? '').includes('itself'));
S().cancelBoxEditor();
check('cancel restores the canvas', S().boxEditor === null && S().components.map((c) => c.id).join() === live0);
check('box selection with only inputs selected is refused', (() => {
  S().setSelectedIds([byLabel('IN1').id]);
  return S().boxSelection() !== null;
})());
S().openBoxEditor(both!.id);
S().switchQuestion(2);
await flush();
check('a question switch closes the editor', S().boxEditor === null);
S().switchQuestion(0);
await flush();
check('…and Q1 kept its own canvas', S().components.map((c) => c.id).join() === live0);

console.log(`\nboxEditorCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
