// Headless check for the provenance seam (task 033; law 8 in
// tasks/PROFILE.md §8): assignment content enters only through
// app/src/provenance.ts (canPaste + usePasteGuard).
//
//   cd app && npx tsx tools/pasteCheck.ts
//
// [policy table]     canPaste: every (origin scope, user) → (target) row.
// [canvas verdict]   canvasPasteVerdict: in an assignment, policy, then canvas
//                    kind, then the question's allowed_components (recursing
//                    into BOXED); the sandbox takes anything.
// [text verdict]     textPasteVerdict: the SLOT's text or nothing; another
//                    window's copy id, or anything foreign on the system
//                    clipboard, means "copied elsewhere since".
// [input types]      guardedInputType: paste-like beforeinput types refused,
//                    typing and deletes pass.
// [store paste]      the real Zustand store: sandbox → assignment refused (no
//                    undo entry), across questions and assignments accepted,
//                    kind / allowed-component refusals (none in the sandbox),
//                    lock-first, the seam survives canvas swaps and empties on
//                    a principal change.
// [grep gate]        no clipboard API outside usePasteGuard.ts; every text
//                    field in components/, one by one, wears the guard's ref,
//                    is structurally read-only, or is a counted exemption
//                    with a reason.
// [console hole]     window.__store only in dev builds; importProject and the
//                    legacy boxed library are gone.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import type { AssignmentData, CircuitComponent } from '../src/types';

// The store registers window/document listeners at import time, so install
// minimal shims BEFORE dynamically importing it (as navResetCheck does).
const noop = () => {};
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
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

const {
  canPaste,
  canvasPasteVerdict,
  textPasteVerdict,
  guardedInputType,
  refusalMessage,
  canvasKind,
  stampCanvas,
  stampText,
  peekClipboard,
  resetClipboard,
  currentProvenance,
} = await import('../src/provenance');
type Provenance = import('../src/provenance').Provenance;
type CanvasClip = import('../src/provenance').CanvasClip;
type ClipItem<T> = import('../src/provenance').ClipItem<T>;
type SystemClipboard = import('../src/provenance').SystemClipboard;
const { useStore, selectPasteScope } = await import('../src/store');
const { buildSampleAssignment } = await import('../src/devData/sampleData');
const { comp: build } = await import('./builder');
/** A bare component of `type` with id `id` (label = type). */
const comp = (type: CircuitComponent['type'], id: string): CircuitComponent => build(id, type, type);

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const A = 'a@x.test';
const B = 'b@x.test';
const SANDBOX = { kind: 'sandbox' } as const;
const hw = (assignmentId: string) => ({ kind: 'assignment', assignmentId }) as const;
const prov = (scope: Provenance['scope'], user: string | null): Provenance => ({ scope, user });

// ─── [policy table] ─────────────────────────────────────────────────────────
console.log('\n[policy table]');
{
  const rows: [string, Provenance, Provenance, true | string][] = [
    ['sandbox → sandbox', prov(SANDBOX, A), prov(SANDBOX, A), true],
    ['assignment → sandbox', prov(hw('hw1'), A), prov(SANDBOX, A), true],
    ["another user's assignment item → sandbox", prov(hw('hw1'), B), prov(SANDBOX, A), true],
    ['sandbox → assignment', prov(SANDBOX, A), prov(hw('hw1'), A), 'from-sandbox'],
    ['visitor sandbox → assignment', prov(SANDBOX, null), prov(hw('hw1'), A), 'from-sandbox'],
    ['hw1 → hw1 (same user)', prov(hw('hw1'), A), prov(hw('hw1'), A), true],
    ['hw1 → hw2 (same user)', prov(hw('hw1'), A), prov(hw('hw2'), A), true],
    ["another user's assignment item → assignment", prov(hw('hw1'), B), prov(hw('hw1'), A), 'other-user'],
    ["the visitor's assignment item → a signed-in assignment", prov(hw('hw1'), null), prov(hw('hw1'), A), 'other-user'],
  ];
  for (const [label, origin, target, want] of rows) {
    const v = canPaste(origin, target);
    check(`${label}: ${want === true ? 'ok' : `refused '${want}'`}`,
      want === true ? v.ok : !v.ok && v.reason === want);
  }
  const refused = canPaste(prov(SANDBOX, A), prov(hw('hw1'), A));
  check('a refusal carries refusalMessage wording',
    !refused.ok && refused.message === refusalMessage('from-sandbox'));
}

// ─── [canvas verdict] ──────────────────────────────────────────────────────
console.log('\n[canvas verdict]');
{
  const clipOf = (...components: CircuitComponent[]): CanvasClip => ({ components, wires: [] });
  const item = (clip: CanvasClip, kind: ClipItem<CanvasClip>['kind'], origin = prov(hw('hw1'), A)): ClipItem<CanvasClip> =>
    ({ payload: clip, origin, kind });
  const target = (kind: ReturnType<typeof canvasKind>, allowed: CircuitComponent['type'][] | null = null) =>
    ({ prov: prov(hw('hw1'), A), kind, allowed });

  const and = comp('AND', 'g1');
  const mem = comp('MEM', 'm1');
  const or = comp('OR', 'g2');
  const state = comp('STATE', 's0');

  check('kinds: CC/SC → circuit, FSM (turbot too) → FSM, TM → TM, turbot TM → turbot-TM, open → none',
    canvasKind('CC', 'CC') === 'circuit' && canvasKind('SC', 'SC') === 'circuit' &&
    canvasKind('turbot', 'CC') === 'circuit' && canvasKind('turbot', 'FSM') === 'FSM' &&
    canvasKind('FSM', 'FSM') === 'FSM' && canvasKind('TM', 'TM') === 'TM' &&
    canvasKind('turbot', 'TM') === 'turbot-TM' && canvasKind('open', 'open') === null);

  const ok = canvasPasteVerdict(item(clipOf(and), 'circuit'), target('circuit'));
  check('circuit → circuit: ok, carrying the clip', ok.ok && ok.clip.components[0].id === 'g1');
  check('MEM into an unrestricted CC question: ok',
    canvasPasteVerdict(item(clipOf(mem), 'circuit'), target('circuit')).ok);
  for (const [from, to] of [['FSM', 'circuit'], ['circuit', 'FSM'], ['TM', 'FSM'], ['TM', 'turbot-TM']] as const) {
    const v = canvasPasteVerdict(item(clipOf(state), from), target(to));
    check(`${from} → ${to}: refused as mode`, !v.ok && v.reason === 'mode');
  }
  check('anything → an open question: refused as mode',
    (() => { const v = canvasPasteVerdict(item(clipOf(and), 'circuit'), target(null)); return !v.ok && v.reason === 'mode'; })());

  const restricted: CircuitComponent['type'][] = ['INPUT', 'OUTPUT', 'NOT', 'AND'];
  const orV = canvasPasteVerdict(item(clipOf(and, or), 'circuit'), target('circuit', restricted));
  check('an OR into an [INPUT,OUTPUT,NOT,AND] question: refused, naming OR',
    !orV.ok && orV.reason === 'component' && orV.message.includes('OR'));
  const boxed: CircuitComponent = { ...comp('BOXED', 'b1'), internalCircuit: { components: [comp('OR', 'inner')], wires: [] } };
  const boxV = canvasPasteVerdict(item(clipOf(boxed), 'circuit'), target('circuit', restricted));
  check('a BOXED whose internals hold an OR: refused (recursion)', !boxV.ok && boxV.reason === 'component');
  check('an AND into the restricted question: ok',
    canvasPasteVerdict(item(clipOf(and), 'circuit'), target('circuit', restricted)).ok);

  const fromSandbox = canvasPasteVerdict(item(clipOf(and), 'circuit', prov(SANDBOX, A)), target('circuit'));
  check('policy first: a sandbox item → assignment refused before any kind check',
    !fromSandbox.ok && fromSandbox.reason === 'from-sandbox');
  const sandboxTarget = { prov: prov(SANDBOX, A), kind: 'FSM' as const, allowed: null };
  const kindInSandbox = canvasPasteVerdict(item(clipOf(and), 'circuit'), sandboxTarget);
  check('the sandbox is free: circuit parts onto a sandbox FSM canvas paste (no kind check)',
    kindInSandbox.ok && kindInSandbox.clip.components[0].id === 'g1');
  const sandboxItemInSandbox = canvasPasteVerdict(item(clipOf(state), 'TM', prov(SANDBOX, B)), sandboxTarget);
  check('…whatever its origin or kind', sandboxItemInSandbox.ok);
  const none = canvasPasteVerdict(null, target('circuit'));
  check('nothing copied: refused as empty', !none.ok && none.reason === 'empty');
}

// ─── [text verdict] + [input types] ────────────────────────────────────────
console.log('\n[text verdict]');
{
  const target = prov(hw('hw1'), A);
  const sys = (text = '', marker = '', other = false): SystemClipboard => ({ text, marker, other });
  const item: ClipItem<string> = { payload: 'my own sentence', origin: prov(hw('hw2'), A), id: 'w1:3' };
  const refused = (v: ReturnType<typeof textPasteVerdict>, reason: string) => !v.ok && v.reason === reason;
  const inserts = (v: ReturnType<typeof textPasteVerdict>) => v.ok && !v.native && v.text === item.payload;

  check('no item, text from a chat → refused as outside', refused(textPasteVerdict(null, target, sys('text from a chat')), 'outside'));
  check('no item, empty system clipboard → refused as empty', refused(textPasteVerdict(null, target, sys()), 'empty'));
  check("no item, another window's copy id → refused as other-window",
    refused(textPasteVerdict(null, target, sys('', 'w2:1')), 'other-window'));
  check("item + its own copy id beside '' → inserts item.text", inserts(textPasteVerdict(item, target, sys('', 'w1:3'))));
  // The stale-slot repro: copy "alpha" here, copy "beta" in another window
  // (its guard leaves '' plus ITS id), paste here → refused, not a silent "alpha".
  check("item + another window's copy id since → refused as other-window, not inserted",
    refused(textPasteVerdict(item, target, sys('', 'w2:1')), 'other-window'));
  check("item + '' and no id (a browser that drops the id type) → inserts item.text",
    inserts(textPasteVerdict(item, target, sys())));
  check('item + systemText === item.text, no id → inserts', inserts(textPasteVerdict(item, target, sys(item.payload))));
  check("item + foreign systemText → refused as outside", refused(textPasteVerdict(item, target, sys('an answer from a friend')), 'outside'));
  check("item + '' beside an image or a file copied since → refused as outside",
    refused(textPasteVerdict(item, target, sys('', '', true)), 'outside'));
  check("another user's text item (its own id) → refused as other-user",
    refused(textPasteVerdict({ ...item, origin: prov(hw('hw1'), B) }, target, sys('', 'w1:3')), 'other-user'));
  const sandbox = textPasteVerdict(null, prov(SANDBOX, A), sys('anything'));
  check('sandbox target → native (no interception)', sandbox.ok && sandbox.native);

  const id1 = stampText('first', target);
  const id2 = stampText('second', target);
  check('stampText: a fresh copy id per copy, one window prefix, the slot carries the latest',
    id1 !== id2 && id1.split(':')[0] === id2.split(':')[0] && peekClipboard().text?.id === id2);
  check('…and that id is what makes the slot pasteable',
    refused(textPasteVerdict(peekClipboard().text, target, sys('', id1)), 'other-window') &&
    (() => { const v = textPasteVerdict(peekClipboard().text, target, sys('', id2)); return v.ok && !v.native && v.text === 'second'; })());
  resetClipboard(null);
}
console.log('\n[input types]');
{
  const guarded = ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank', 'insertLink', 'deleteByDrag'];
  const free = ['insertText', 'insertReplacementText', 'insertLineBreak', 'deleteContentBackward'];
  check(`guarded: ${guarded.join(', ')}`, guarded.every(guardedInputType));
  check(`free: ${free.join(', ')}`, free.every((t) => !guardedInputType(t)));
}

// ─── [store paste] ─────────────────────────────────────────────────────────
console.log('\n[store paste]');
{
  const s = () => useStore.getState();
  const ids = () => new Set(s().components.map((c) => c.id));
  /** Add a component and return it (the one id not there before). */
  const add = (type: CircuitComponent['type'], x = 100, y = 100): CircuitComponent => {
    const before = ids();
    s().addComponent(type, x, y);
    return s().components.find((c) => !before.has(c.id))!;
  };
  const copy = (...comps: CircuitComponent[]) => {
    s().setSelectedIds(comps.map((c) => c.id));
    s().copySelected();
  };

  s().resetForPrincipal(A);
  check('the seam holds the principal the store reported', currentProvenance(SANDBOX).user === A);
  check('a principal change leaves both slots empty',
    peekClipboard().canvas === null && peekClipboard().text === null);

  // Sandbox → assignment: refused, and leaves no trace.
  s().enterSandbox();
  check('scope in the sandbox', selectPasteScope(s()).kind === 'sandbox');
  copy(add('AND'));
  check('a sandbox copy is stamped sandbox, by A, as a circuit',
    peekClipboard().canvas?.origin.scope.kind === 'sandbox' && peekClipboard().canvas?.origin.user === A &&
    peekClipboard().canvas?.kind === 'circuit');

  const base = buildSampleAssignment();
  const hwA: AssignmentData = { ...base, id: 'paste-hw-a' };
  const hwB: AssignmentData = { ...buildSampleAssignment(), id: 'paste-hw-b' };
  s().loadAssignment(hwA);
  const scope = selectPasteScope(s());
  check('scope in an assignment', scope.kind === 'assignment' && scope.assignmentId === 'paste-hw-a');
  const beforeComps = s().components;
  const msg = s().paste();
  check('sandbox → assignment: paste returns the refusal message',
    msg === refusalMessage('from-sandbox'));
  check('…components unchanged and no undo entry',
    s().components === beforeComps && s().undoStack.length === 0);

  // Q1 (CC) → Q2 (SC): accepted, with new ids and renumbered labels.
  const in1 = add('INPUT', 40, 40);
  const gate = add('AND', 140, 40);
  const out1 = add('OUTPUT', 240, 40);
  s().addWire(in1.id, in1.ports.find((p) => p.side === 'right')!.id, gate.id, gate.ports.find((p) => p.side === 'left')!.id);
  copy(in1, gate, out1);
  check('an assignment copy is stamped with that assignment',
    (() => { const o = peekClipboard().canvas?.origin.scope; return o?.kind === 'assignment' && o.assignmentId === 'paste-hw-a'; })());
  s().switchQuestion(1);
  check('switchQuestion does NOT clear the seam', peekClipboard().canvas !== null);
  s().resetAllSimState();
  check('resetAllSimState does NOT clear the seam', peekClipboard().canvas !== null);
  add('INPUT', 40, 200);
  add('OUTPUT', 240, 200);
  const q2Before = ids();
  check('Q1 → Q2: accepted', s().paste() === null);
  const pasted = s().components.filter((c) => !q2Before.has(c.id));
  check('…three components pasted, all with new ids',
    pasted.length === 3 && pasted.every((c) => c.id !== in1.id && c.id !== gate.id && c.id !== out1.id));
  check('…IN/OUT relabelled after the canvas\'s own (IN2, OUT2)',
    pasted.some((c) => c.type === 'INPUT' && c.label === 'IN2') &&
    pasted.some((c) => c.type === 'OUTPUT' && c.label === 'OUT2'));
  const pastedIds = new Set(pasted.map((c) => c.id));
  const pastedWire = s().wires.find((w) => pastedIds.has(w.sourceComponentId));
  check('…the internal wire re-pointed at the new ids',
    pastedWire != null && pastedIds.has(pastedWire.targetComponentId));
  check('…and the paste is one undo step', s().undoStack.length > 0);

  // HW-A → HW-B (same user): accepted.
  s().loadAssignment(hwB);
  check('HW-A → HW-B (same user): accepted', s().paste() === null && s().components.length === 3);

  // Assignment → sandbox: accepted.
  s().enterSandbox();
  const sbBefore = s().components.length;
  check('assignment → sandbox: accepted', s().paste() === null && s().components.length === sbBefore + 3);

  // FSM question → CC question: refused as mode.
  s().loadAssignment(hwA);
  s().switchQuestion(2); // Q3, FSM
  copy(add('STATE', 100, 100));
  check('an FSM copy is stamped FSM', peekClipboard().canvas?.kind === 'FSM');
  s().switchQuestion(0); // Q1, CC
  const q1Count = s().components.length;
  const modeMsg = s().paste();
  check('FSM question → CC question: refused with a message',
    typeof modeMsg === 'string' && modeMsg.includes("can't go on") && s().components.length === q1Count);
  s().enterSandbox();
  const sbCircuit = s().components.length;
  check('FSM question → a sandbox circuit tab: accepted (the sandbox is free)',
    canvasKind(s().buildMode, s().buildMode) === 'circuit' && s().paste() === null && s().components.length === sbCircuit + 1);

  // An OR into a restricted question: refused, naming OR.
  const restrictedHw: AssignmentData = {
    ...buildSampleAssignment(),
    id: 'paste-hw-restricted',
  };
  restrictedHw.questions[0] = { ...restrictedHw.questions[0], allowed_components: ['INPUT', 'OUTPUT', 'NOT', 'AND'] };
  s().loadAssignment(restrictedHw);
  s().switchQuestion(1); // Q2, SC, unrestricted
  copy(add('OR', 100, 100));
  s().switchQuestion(0); // Q1, restricted
  const orMsg = s().paste();
  check('OR into a restricted question: refused, naming OR',
    typeof orMsg === 'string' && orMsg.includes('OR') && s().components.length === 0);

  // Locked (done) question: a no-op, lock first.
  s().switchQuestion(1);
  copy(add('AND', 100, 100));
  s().switchQuestion(0);
  s().toggleCurrentQuestionDone();
  const lockedCount = s().components.length;
  check('locked (done) question: paste is a silent no-op',
    s().paste() === null && s().components.length === lockedCount && s().undoStack.length === 0);
  s().toggleCurrentQuestionDone();
  check('…and pastes once unlocked', s().paste() === null && s().components.length === lockedCount + 1);

  // An empty selection keeps the previous item.
  const held = peekClipboard().canvas;
  s().setSelectedIds([]);
  s().copySelected();
  check('copySelected with an empty selection keeps the previous item', peekClipboard().canvas === held);

  // A principal change empties both slots.
  stampText('a sentence of A\'s', currentProvenance(scope));
  check('the text slot holds A\'s stamp', peekClipboard().text?.origin.user === A);
  s().goHome();
  s().resetForPrincipal(B);
  check('resetForPrincipal(B) empties both slots',
    peekClipboard().canvas === null && peekClipboard().text === null);
  check('…and hands the seam the new principal', currentProvenance(SANDBOX).user === B);
  s().loadAssignment(hwA);
  const bCount = s().components.length;
  s().paste();
  check("…so B's paste brings nothing of A's", s().components.length === bCount);

  // Even an item stamped by A that somehow survived is refused for B.
  stampCanvas({ components: [comp('AND', 'stale')], wires: [] }, prov(hw('paste-hw-a'), A), 'circuit');
  const staleMsg = s().paste();
  check("an item stamped by A → B's assignment: refused as another account",
    staleMsg === refusalMessage('other-user'));
  resetClipboard(B);

  // importWorkbook only ever writes the sandbox (the future-import invariant).
  s().importWorkbook(JSON.stringify({
    formatVersion: 2,
    metadata: { title: 'Imported' },
    activeWorksheetId: 'ws-1',
    worksheets: [{ id: 'ws-1', title: 'Sheet 1', buildMode: 'CC', activeTask: 'arithmetic', circuit: { components: [], wires: [] }, boxes: [] }],
  }));
  check('importWorkbook leaves assignment === null (imports land in the sandbox)', s().assignment === null);
}

// ─── [grep gate] + [console hole] ──────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
};
walk(SRC);
const relOf = (file: string) => relative(SRC, file).split('\\').join('/');
const isCommentLine = (line: string) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

console.log('\n[grep gate]');
{
  const SEAM_DOM_ADAPTER = 'usePasteGuard.ts';
  const API = /onPaste|onCopy|onCut|clipboardData|navigator\.clipboard|execCommand/;
  const LISTENER = /addEventListener\(\s*['"](paste|copy|cut|beforeinput)['"]/;
  const violations: string[] = [];
  for (const file of files) {
    const rel = relOf(file);
    if (rel === SEAM_DOM_ADAPTER) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (API.test(line) || LISTENER.test(line)) violations.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
    });
  }
  for (const v of violations) console.log(`        → ${v}`);
  check(`no clipboard API outside ${SEAM_DOM_ADAPTER} (${files.length} files scanned)`, violations.length === 0);
  check(`${SEAM_DOM_ADAPTER} exists and listens for paste + beforeinput`,
    (() => {
      const text = readFileSync(join(SRC, SEAM_DOM_ADAPTER), 'utf8');
      return /addEventListener\('paste'/.test(text) && /addEventListener\('beforeinput'/.test(text);
    })());

  // Every text field in components/ — each <textarea> and each <input> that
  // takes text — is checked ONE BY ONE: it wears the guard's ref
  // (ref={pasteGuardRef}), or is structurally read-only (a bare `readOnly`,
  // never `readOnly={…}` — nothing can be pasted into it), or is one of a
  // file's counted exemptions below. So a new answer field fails here until it
  // is guarded, even in a file that already guards another.
  const EXEMPT: Record<string, { fields: number; reason: string }> = {
    'DataTable.tsx': { fields: 2, reason: 'exploratory run inputs (SC/FSM sequences); never graded' },
    'SequentialTimeline.tsx': { fields: 1, reason: 'exploratory SC cell inputs; never graded' },
    'TurbotArenaPanel.tsx': { fields: 2, reason: 'arena size fields of the sandbox map editor; never graded' },
    'TabBar.tsx': { fields: 1, reason: 'sandbox tab titles; not work' },
    'FeedbackPanel.tsx': { fields: 1, reason: 'platform/homework reports to the instructor; not work' },
  };
  // The files whose answer fields wear the guard today (each keeps at least one).
  const GUARDED = ['OpenResponsePanel.tsx', 'FillInPanel.tsx', 'Palette.tsx', 'CircuitCanvas.tsx'];
  const NON_TEXT = /\btype=["'](range|checkbox|radio|file|color|button|submit|hidden)["']/;
  const GUARD_REF = /\bref=\{pasteGuardRef\}/;
  const BARE_READONLY = /\breadOnly\b(?!\s*=)/;

  /** The opening tag starting at `start` ('<input …' up to its closing '>'),
   *  skipping '>' inside {…} expressions (arrow functions) and quoted strings. */
  const openingTag = (code: string, start: number): string => {
    let depth = 0;
    for (let i = start + 1; i < code.length; i++) {
      const c = code[i];
      if (c === '"' || c === "'" || c === '`') {
        const close = code.indexOf(c, i + 1);
        if (close < 0) break;
        i = close;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) return code.slice(start, i + 1);
    }
    return code.slice(start);
  };
  /** Every text-taking field's opening tag, with its line number. */
  const textFields = (source: string): { tag: string; line: number }[] => {
    // Blank out comments (keeping newlines, so line numbers hold); a '//'
    // right after a non-space (a URL's 'https://') is not a comment.
    const code = source.replace(/\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/[^\n]*/gm, (m) => m.replace(/[^\n]/g, ' '));
    const out: { tag: string; line: number }[] = [];
    for (const m of code.matchAll(/<(input|textarea)\b/g)) {
      const tag = openingTag(code, m.index);
      if (m[1] === 'input' && NON_TEXT.test(tag)) continue;
      out.push({ tag, line: code.slice(0, m.index).split('\n').length });
    }
    return out;
  };

  const COMPONENTS = join(SRC, 'components');
  const offenders: string[] = [];
  for (const name of readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(join(COMPONENTS, name), 'utf8');
    const fields = textFields(source);
    const guarded = fields.filter((f) => GUARD_REF.test(f.tag));
    const loose = fields.filter((f) => !GUARD_REF.test(f.tag) && !BARE_READONLY.test(f.tag));
    if (guarded.length > 0 && !/usePasteGuard\(/.test(source)) {
      offenders.push(`${name}: wears ref={pasteGuardRef} without calling usePasteGuard(`);
    }
    const exempt = EXEMPT[name];
    if (exempt) {
      check(`exempt ${name} (${exempt.fields} field${exempt.fields === 1 ? '' : 's'}): ${exempt.reason}`,
        loose.length === exempt.fields);
      if (loose.length !== exempt.fields) {
        console.log(`        → ${name} has ${loose.length} unguarded text field(s) (lines ${loose.map((f) => f.line).join(', ')}); ${exempt.fields} exempt`);
      }
      continue;
    }
    if (GUARDED.includes(name)) {
      check(`${name}: ${guarded.length} guarded field(s), every other one read-only`, guarded.length > 0 && loose.length === 0);
    }
    for (const f of loose) offenders.push(`${name}:${f.line} a text field neither wearing ref={pasteGuardRef}, bare readOnly, nor EXEMPT`);
  }
  for (const o of offenders) console.log(`        → ${o}`);
  check('every components/*.tsx text field, one by one, is guarded, read-only or a counted exemption', offenders.length === 0);
}

console.log('\n[console hole]');
{
  const store = readFileSync(join(SRC, 'store.ts'), 'utf8');
  const lines = store.split('\n');
  const assigns = lines.map((l, i) => [l, i] as const).filter(([l]) => /__store\s*=/.test(l) && !isCommentLine(l));
  const guardedByDev = assigns.every(([, i]) => {
    for (let j = i - 1; j >= 0; j--) {
      if (/^\s*if\s*\(/.test(lines[j])) return lines[j].includes('import.meta.env?.DEV === true');
    }
    return false;
  });
  check('store.ts sets window.__store only inside an import.meta.env?.DEV guard',
    assigns.length === 1 && guardedByDev);
  check('…so a non-dev import leaves it unset',
    (globalThis as unknown as { window: Record<string, unknown> }).window.__store === undefined);
  const GONE = /\b(importProject|boxedLibrary|importBoxedCircuit|boxCurrentCircuit)\b/;
  const stragglers: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!isCommentLine(line) && GONE.test(line)) stragglers.push(`${relOf(file)}:${i + 1}`);
    });
  }
  for (const v of stragglers) console.log(`        → ${v}`);
  check('importProject, boxedLibrary, importBoxedCircuit and boxCurrentCircuit are gone', stragglers.length === 0);
}

// ─── verdict ─────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? 'PASTE CHECK OK' : `PASTE CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
