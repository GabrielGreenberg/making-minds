// boxEditorCheck — making a box and editing one (task 085; memo
// docs/buildout/designs/editor-workbench.md §Boxes). The palette's BOX tile
// is the ONE way to make a box: store.ts boxTool drafts a box around the
// selection (or arms the NEW_BOX draw tool), confirmBox makes it — the parts
// stay on the canvas inside a named outline. The box editor only EDITS a
// library box, and a save reaches every copy. [hw1 p4→p5] drives the real
// HW1 the way its Problem 5 hint asks: box the XOR on P4, reuse it on P5.

import type { AssignmentData, CircuitComponent } from '../src/types';

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

const { useStore, BOX_DRAFT_PAD } = await import('../src/store');
const { buildSampleAssignment, SAMPLE_ASSIGNMENT_ID } = await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');
const { localWorkbookStore } = await import('../src/storage/workbookStore');
const { getComponentBounds } = await import('../src/componentGeometry');
const { gradeQuestion } = await import('../src/engine/grader');
const { truthTableCC } = await import('../src/engine/cc');
const { readFileSync } = await import('node:fs');

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

/** The XOR as HW1 P4 asks for it: (x OR y) AND NOT (x AND y). */
function buildXor(): CircuitComponent[] {
  const before = S().components.length;
  S().addComponent('INPUT', 100, 100);
  S().addComponent('INPUT', 100, 220);
  S().addComponent('OR', 260, 60);
  S().addComponent('AND', 260, 200);
  S().addComponent('NOT', 380, 200);
  S().addComponent('AND', 500, 120);
  S().addComponent('OUTPUT', 640, 130);
  const parts = added(before);
  const [in1, in2, or, and1, not, and2, out] = parts;
  S().addWire(in1.id, 'out', or.id, 'in1');
  S().addWire(in2.id, 'out', or.id, 'in2');
  S().addWire(in1.id, 'out', and1.id, 'in1');
  S().addWire(in2.id, 'out', and1.id, 'in2');
  S().addWire(and1.id, 'out', not.id, 'in');
  S().addWire(or.id, 'out', and2.id, 'in1');
  S().addWire(not.id, 'out', and2.id, 'in2');
  S().addWire(and2.id, 'out', out.id, 'in');
  return parts;
}

/** Box everything on the canvas through the BOX tool (select all → BOX →
 *  Ready to Box). Returns the new box's id, or the refusal. */
function boxAllWithTheTool(): { id: string } | { error: string } {
  S().setSelectedIds([...S().components.map((c) => c.id), ...S().wires.map((w) => w.id)]);
  const err = S().boxTool();
  if (err) return { error: err };
  const draft = S().boxDrawing.draftBox;
  if (!draft) return { error: 'no draft' };
  const confirmErr = S().confirmBox(draft.id);
  return confirmErr ? { error: confirmErr } : { id: draft.id };
}

const assignment = buildSampleAssignment();
await localAssignmentStore.save(assignment);
await localAssignmentStore.setVisible(SAMPLE_ASSIGNMENT_ID, true);
check('sample assignment opened', await S().openAssignment(SAMPLE_ASSIGNMENT_ID));
S().switchQuestion(0);
await flush();
useStore.setState({ components: [], wires: [], boxes: [] });

console.log('[the BOX tool]');
const xor = buildXor();
check('the unboxed gates compute XOR', truthTable() === '0110');
const libBefore = S().confirmedBoxLibrary.length;
// The selection holds wires too (a rubber band catches them): the draft is
// drawn around the PARTS.
S().setSelectedIds([...xor.map((c) => c.id), S().wires[0].id]);
check('BOX with parts selected drafts a box (no refusal)', S().boxTool() === null);
const draft = S().boxDrawing.draftBox!;
check('…in the adjusting phase, the draw tool disarmed',
  S().boxDrawing.phase === 'adjusting' && draft !== null && S().selectedTool === null);
check(`…around every selected part's footprint, ${BOX_DRAFT_PAD}px clear`, xor.every((c) => {
  const b = getComponentBounds(c);
  return b.left - BOX_DRAFT_PAD >= draft.x - 0.5 && b.top - BOX_DRAFT_PAD >= draft.y - 0.5 &&
    b.right + BOX_DRAFT_PAD <= draft.x + draft.width + 0.5 && b.bottom + BOX_DRAFT_PAD <= draft.y + draft.height + 0.5;
}));
check('…on this canvas, unnamed, with no library entry and no editor yet',
  S().boxes.some((b) => b.id === draft.id && !b.name) && S().confirmedBoxLibrary.length === libBefore && S().boxEditor === null);
check(`Ready to Box confirms it (${S().confirmBox(draft.id)})`, S().boxDrawing.phase === 'idle' && S().boxDrawing.draftBox === null);
const entry = S().confirmedBoxLibrary[S().confirmedBoxLibrary.length - 1];
check('one library entry added, 2 in · 1 out (the canvas\'s own IN1, IN2, OUT1)',
  S().confirmedBoxLibrary.length === libBefore + 1 && entry.id === draft.id &&
  entry.inputPortIds.length === 2 && entry.outputPortIds.length === 1);
check('no editor opens: the box shows where it was made', S().boxEditor === null);
const outline = S().boxes.find((b) => b.id === entry.id);
check('the canvas keeps its loose parts inside a named outline',
  S().components.length === 7 && !S().components.some((c) => c.type === 'BOXED') &&
  !!outline?.name && outline.componentIds.length === 7);
check('…and still computes XOR', truthTable() === '0110');
check(`rename it XOR (${S().renameBox(entry.id, 'XOR')})`,
  S().confirmedBoxLibrary.some((b) => b.id === entry.id && b.name === 'XOR') &&
  S().boxes.some((b) => b.id === entry.id && b.name === 'XOR'));

S().undo();
check('undo steps back over the rename', S().confirmedBoxLibrary.some((b) => b.id === entry.id && b.name !== 'XOR'));
S().undo();
check('a second undo steps back over draft + confirm: loose parts, no entry, no outline, no draft',
  S().components.length === 7 && !S().confirmedBoxLibrary.some((b) => b.id === entry.id) &&
  !S().boxes.some((b) => b.id === entry.id) && S().boxDrawing.phase === 'idle');
S().redo();
check('redo brings back the box as confirmed (not as a draft)',
  S().confirmedBoxLibrary.some((b) => b.id === entry.id) && S().boxDrawing.phase === 'idle');
S().redo();
check('…and its name', S().confirmedBoxLibrary.some((b) => b.id === entry.id && b.name === 'XOR'));

S().setSelectedIds([]);
check('with nothing selected, BOX arms the draw tool', S().boxTool() === null && S().selectedTool === 'NEW_BOX');
check('…and a second click disarms it', S().boxTool() === null && S().selectedTool === null);

// The canvas's drawn rectangle takes the same path (startBoxDraft); Esc and
// the draft's Cancel drop the unnamed draft with it.
const drawnId = S().startBoxDraft({ x: 40, y: 400, width: 200, height: 120 });
check('a drawn rectangle becomes a draft', drawnId !== null && S().boxDrawing.draftBox?.id === drawnId);
S().cancelBoxDraft();
check('cancelling drops the draft and its unnamed box',
  S().boxDrawing.phase === 'idle' && !S().boxes.some((b) => b.id === drawnId));
const drawn2 = S().startBoxDraft({ x: 40, y: 400, width: 200, height: 120 });
S().undo();
check('undo while adjusting takes the draft away, and its Ready to Box with it',
  !S().boxes.some((b) => b.id === drawn2) && S().boxDrawing.phase === 'idle' && S().boxDrawing.draftBox === null);
S().redo();
check('…redo brings the draft back to adjust', S().boxDrawing.phase === 'adjusting' && S().boxDrawing.draftBox?.id === drawn2);
S().cancelBoxDraft();

// Cancel takes the undo step its draft took while nothing is pushed over it,
// so the first undo after Cancel (or Esc, or a swap) is a real one.
const nCancel = S().components.length;
S().addComponent('AND', 700, 420);
S().startBoxDraft({ x: 680, y: 400, width: 120, height: 100 });
S().cancelBoxDraft();
S().undo();
check('after Cancel the first undo is a real one: the AND added before the draft goes',
  S().components.length === nCancel && S().boxDrawing.phase === 'idle');
// An unnamed box that is not a draft (an orphan: a pre-085 save, a locked
// question's Esc) is never taken for one: an undo drops it, never adjusts it.
useStore.setState({ boxes: [...S().boxes, { id: 'orphan', name: '', x: 40, y: 400, width: 80, height: 60, componentIds: [], inputPortIds: [], outputPortIds: [] }] });
const nOrphan = S().components.length;
S().addComponent('OR', 700, 420);
S().undo();
check('an orphan unnamed box: an undo drops it and brings back no draft',
  S().components.length === nOrphan && S().boxDrawing.phase === 'idle' && S().boxDrawing.draftBox === null &&
  !S().boxes.some((b) => b.id === 'orphan'));

console.log('[refusals]');
S().toggleCurrentQuestionDone();
S().setSelectedIds(xor.map((c) => c.id));
const boxesDone = S().boxes.length;
check('a question marked done refuses BOX, in the lock\'s words',
  (S().boxTool() ?? '').includes('marked done') && S().boxDrawing.phase === 'idle' && S().boxes.length === boxesDone);
check('…and a drawn draft', S().startBoxDraft({ x: 0, y: 0, width: 100, height: 100 }) === null && S().boxes.length === boxesDone);
S().toggleCurrentQuestionDone();
check('an open box editor refuses BOX', S().openBoxEditor(entry.id) === null && (S().boxTool() ?? '').includes('Save or cancel'));
S().cancelBoxEditor();
S().switchQuestion(2); // Q3 (FSM)
await flush();
check('an FSM canvas refuses BOX', (S().boxTool() ?? '') !== '' && S().boxDrawing.phase === 'idle' && S().selectedTool === null);
S().switchQuestion(0);
await flush();

console.log('[edit reaches every copy]');
S().switchQuestion(1);
await flush();
const q2Before = S().components.length;
S().placeBoxInstance(entry.id, 300, 300);
const q2Copy = S().components[q2Before];
check('a copy placed on Q2', q2Copy?.boxedCircuitId === entry.id);
S().switchQuestion(0);
await flush();

check(`the editor opens a library box by id (${S().openBoxEditor(entry.id)})`, S().boxEditor?.boxId === entry.id);
check('…as an existing box (it saves to every copy)', S().boxEditor?.isNew === false);
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
const orEntry = S().confirmedBoxLibrary.find((b) => b.id === entry.id)!;
const orTable = truthTableCC(orEntry.internalComponents, orEntry.internalWires);
check('the library box now computes OR',
  orTable !== null && orTable !== 'too-many' && orTable.rows.map((r) => r.outputBits.join('')).join(',') === '0,1,1,1');
const q2Saved = S().questionCircuits.get(assignment.questions[1].id)!;
const q2Now = q2Saved.components.find((c: CircuitComponent) => c.id === q2Copy.id)!;
check('Q2\'s copy took the edit too', q2Now.internalCircuit!.components.some((c) => c.type === 'OR') &&
  !q2Now.internalCircuit!.components.some((c) => c.type === 'NOT'));
check('a drawn outline is not a copy: Q1\'s own loose parts still compute XOR', truthTable() === '0110');

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
const norEntry = S().confirmedBoxLibrary.find((b) => b.id === entry.id)!;
const norTable = truthTableCC(norEntry.internalComponents, norEntry.internalWires);
check('the library box computes NOR',
  norTable !== null && norTable !== 'too-many' && norTable.rows.map((r) => r.outputBits.join('')).join(',') === '1,0,0,0');
const q2Done = S().questionCircuits.get(assignment.questions[1].id)!.components.find((c: CircuitComponent) => c.id === q2Copy.id)!;
check('the done question\'s copy is unchanged', !q2Done.internalCircuit!.components.some((c) => c.type === 'NOT'));

console.log('[refusals and swaps]');
// A second library box, for the taken-name refusal: two more parts boxed
// with the tool, well clear of the XOR.
const n4 = S().components.length;
S().addComponent('INPUT', 100, 520);
S().addComponent('NOT', 240, 520);
S().addComponent('OUTPUT', 380, 520);
const [nIn, nNot, nOut] = added(n4);
S().addWire(nIn.id, 'out', nNot.id, 'in');
S().addWire(nNot.id, 'out', nOut.id, 'in');
S().setSelectedIds([nIn.id, nNot.id, nOut.id]);
S().boxTool();
const otherId = S().boxDrawing.draftBox?.id ?? '';
check(`a second box (${S().confirmBox(otherId)})`, S().confirmedBoxLibrary.some((b) => b.id === otherId));
check('…around its own three parts only', S().boxes.find((b) => b.id === otherId)?.componentIds.length === 3);
const other = S().confirmedBoxLibrary.find((b) => b.id === otherId)!;
const live0 = S().components.map((c) => c.id).join();

check('open the XOR box', S().openBoxEditor(entry.id) === null);
const n3 = S().components.length;
S().addComponent('AND', 300, 400);
const [loose] = added(n3);
S().addWire(byLabel('IN1').id, 'out', loose.id, 'in1');
S().addWire(byLabel('IN2').id, 'out', loose.id, 'in2');
check('an output that leads nowhere is refused', (S().saveBoxEditor() ?? '').includes('Free end'));
S().setSelectedIds([loose.id]);
S().deleteSelected();
check('a name another box has is refused', (S().saveBoxEditor(other.name) ?? '').includes('already exists'));
S().placeBoxInstance(entry.id, 500, 500);
check('a box cannot contain itself', (S().saveBoxEditor() ?? '').includes('itself'));
S().cancelBoxEditor();
check('cancel restores the canvas', S().boxEditor === null && S().components.map((c) => c.id).join() === live0);
S().openBoxEditor(entry.id);
S().switchQuestion(2);
await flush();
check('a question switch closes the editor', S().boxEditor === null);
S().switchQuestion(0);
await flush();
check('…and Q1 kept its own canvas', S().components.map((c) => c.id).join() === live0);

S().setSelectedIds([byLabel('IN1').id]);
check('BOX drafts around one part', S().boxTool() === null && S().boxDrawing.phase === 'adjusting');
const midDraft = S().boxDrawing.draftBox!.id;
S().switchQuestion(2);
await flush();
check('a question switch mid-draft leaves no draft behind', S().boxDrawing.phase === 'idle' && S().boxDrawing.draftBox === null);
const q1Saved = S().questionCircuits.get(assignment.questions[0].id)!;
check('…and saved no unnamed draft into Q1', !q1Saved.boxes.some((b) => b.id === midDraft || !b.name));
S().switchQuestion(0);
await flush();
check('…nor is one on Q1\'s canvas when you come back', !S().boxes.some((b) => !b.name) && S().boxDrawing.phase === 'idle');

console.log('[ports: one per cut end]');
// Textbook Rule 3 (every free end is an input or an output), as confirmBox
// applies it: an IN or OUT node inside is one port (the XOR boxed with its
// nodes: 2 in · 1 out, [the BOX tool]), and so is every wire end the edge
// cuts — never merged by source (the retired ▣ Box merged them).
useStore.setState({ components: [], wires: [], boxes: [], undoStack: [], redoStack: [] });
const cutXor = buildXor();
const [, , cOr, cAnd1, cNot, cAnd2] = cutXor;
S().setSelectedIds([cOr.id, cAnd1.id, cNot.id, cAnd2.id]);
S().boxTool();
const gatesOnly = S().boxDrawing.draftBox?.id ?? '';
check(`the XOR's four gates boxed without its IN and OUT nodes (${S().confirmBox(gatesOnly)})`,
  S().confirmedBoxLibrary.some((b) => b.id === gatesOnly));
const gatesEntry = S().confirmedBoxLibrary.find((b) => b.id === gatesOnly);
check('…have four inputs (x and y each reach two gates: four cut ends) and one output',
  gatesEntry?.inputPortIds.length === 4 && gatesEntry?.outputPortIds.length === 1);
S().undo();
check('…(undone: no entry, no outline)', !S().confirmedBoxLibrary.some((b) => b.id === gatesOnly) && !S().boxes.some((b) => b.id === gatesOnly));

console.log('[a draft is never saved]');
// No save, fold or load carries an unnamed box (store.ts namedBoxes): not
// the autosave mid-draft, and not a workbook saved before 085 with one in it.
const sampleQ1 = assignment.questions[0].id;
const t0 = Date.now();
S().setSelectedIds([byLabel('IN1').id]);
S().boxTool();
const liveDraft = S().boxDrawing.draftBox?.id ?? '';
await new Promise((r) => setTimeout(r, 1800)); // the autosave's 1.5 s debounce
const saved1 = await localWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID);
check('the autosave ran mid-draft', S().boxDrawing.draftBox?.id === liveDraft && (S().lastSavedAt ?? 0) >= t0);
check('…and saved no unnamed box', !!saved1 && !(saved1.questionCircuits[sampleQ1]?.boxes ?? []).some((b) => !b.name));
S().cancelBoxDraft();
const legacy = (await localWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID))!;
legacy.questionCircuits[sampleQ1] = {
  ...legacy.questionCircuits[sampleQ1],
  boxes: [...(legacy.questionCircuits[sampleQ1]?.boxes ?? []), { id: 'legacy-draft', name: '', x: 40, y: 40, width: 80, height: 60, componentIds: [], inputPortIds: [], outputPortIds: [] }],
};
await localWorkbookStore.saveAssignmentState(SAMPLE_ASSIGNMENT_ID, legacy);
// A fresh page: nothing of the assignment in memory.
useStore.setState({ assignment: null, components: [], wires: [], boxes: [], questionCircuits: new Map(), undoStack: [], redoStack: [] });
check('a fresh page opens the workbook', await S().openAssignment(SAMPLE_ASSIGNMENT_ID));
S().switchQuestion(0);
await flush();
check('…a workbook saved with an unnamed box loads without it',
  S().components.length > 0 && !S().boxes.some((b) => !b.name) && S().boxDrawing.phase === 'idle');
S().addComponent('AND', 700, 500);
S().undo();
check('…and the first undo after an edit brings back no draft', S().boxDrawing.phase === 'idle' && !S().boxes.some((b) => !b.name));

console.log('[hw1 p4→p5]');
// The real HW1, as a student works it: build the XOR on P4, box it with the
// BOX tool, name it, then build P5's half adder around a copy. A copy with
// no due date, so the pin never depends on the calendar (past due AND
// submitted is frozen: dueDates.ts isFrozen).
const hw1 = JSON.parse(readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8')) as AssignmentData;
const hw1Copy: AssignmentData = { ...hw1, id: 'hw1-box-check' };
delete hw1Copy.dueDate;
await localAssignmentStore.save(hw1Copy);
await localAssignmentStore.setVisible(hw1Copy.id, true);
check('HW1 opened', await S().openAssignment(hw1Copy.id));
const p4 = hw1Copy.questions[3];
const p5 = hw1Copy.questions[4];
check('P4 is the XOR, P5 combines circuits', p4.id === 4 && /XOR/.test(p4.title ?? '') && p5.id === 5);
S().switchQuestion(3);
await flush();
buildXor();
const boxed = boxAllWithTheTool();
check(`P4: the XOR boxed with the BOX tool (${'error' in boxed ? boxed.error : 'ok'})`, 'id' in boxed);
const xorId = 'id' in boxed ? boxed.id : '';
check(`…and named XOR (${S().renameBox(xorId, 'XOR')})`, S().confirmedBoxLibrary.some((b) => b.id === xorId && b.name === 'XOR'));
const p4Grade = gradeQuestion(p4, { components: S().components, wires: S().wires });
check(`P4 grades correct (${p4Grade.passed}/${p4Grade.total})`, p4Grade.total > 0 && p4Grade.passed === p4Grade.total);

S().switchQuestion(4);
await flush();
check('on P5 the library holds XOR', S().confirmedBoxLibrary.some((b) => b.id === xorId && b.name === 'XOR'));
S().placeTool({ box: xorId }, 320, 140);
const copy = S().components.find((c) => c.type === 'BOXED' && c.boxedCircuitId === xorId);
check('P5: a copy placed from the palette\'s tool', copy !== undefined && copy.label === 'XOR' &&
  copy.ports.filter((p) => p.side === 'left').length === 2 && copy.ports.filter((p) => p.side === 'right').length === 1);
const before5 = S().components.length;
S().addComponent('INPUT', 100, 100);
S().addComponent('INPUT', 100, 240);
S().addComponent('AND', 320, 260);
S().addComponent('OUTPUT', 560, 140);
S().addComponent('OUTPUT', 560, 270);
const [x, y, carryAnd, sum, carry] = added(before5);
S().addWire(x.id, 'out', copy!.id, 'in1');
S().addWire(y.id, 'out', copy!.id, 'in2');
S().addWire(x.id, 'out', carryAnd.id, 'in1');
S().addWire(y.id, 'out', carryAnd.id, 'in2');
S().addWire(copy!.id, 'out1', sum.id, 'in');
S().addWire(carryAnd.id, 'out', carry.id, 'in');
const half = truthTableCC(S().components, S().wires);
check('the half adder runs: OUT1 OUT2 = 00, 10, 10, 01',
  half !== null && half !== 'too-many' && half.rows.map((r) => r.outputBits.join('')).join(',') === '00,10,10,01');
const p5Grade = gradeQuestion(p5, { components: S().components, wires: S().wires });
check(`P5 grades correct (${p5Grade.passed}/${p5Grade.total})`, p5Grade.total > 0 && p5Grade.passed === p5Grade.total);
const record = await S().submitAssignment(hw1Copy.id);
const p5Result = record?.result?.questions.find((q) => q.questionId === p5.id);
const p4Result = record?.result?.questions.find((q) => q.questionId === p4.id);
check('Submit grades P5 correct', !!p5Result && p5Result.total > 0 && p5Result.passed === p5Result.total);
check('…and P4 (its loose parts inside the outline)', !!p4Result && p4Result.total > 0 && p4Result.passed === p4Result.total);

console.log(`\nboxEditorCheck: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

export {};
