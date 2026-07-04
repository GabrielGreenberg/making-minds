// Headless smoke test for the Turing-machine engine, codec, validation, and the
// grader's TM branch.
//
//   cd app && npx tsx tools/tmCheck.ts
//
// Covers the value-based codec pipeline (CLAUDE_KB/engines/tm.md): unary
// increment (standard position), zero output (blank tape → 0), a binary
// example, an ambiguous-transition table (validation fails every case), a
// two-block tape (well-formedness failure), and the standard-halt-position
// toggle.

import type {
  CircuitComponent,
  Wire,
  AssignmentData,
  SubmissionData,
  TMNotation,
  TMTape,
} from '../src/types';
import { getPortsForType } from '../src/types';
import {
  evaluateTMSequence,
  parseTMAction,
  type TMEvalResult,
} from '../src/engine/tm';
import { encodeTM, acceptTM, decodeTM } from '../src/engine/tmCodec';
import { validateTMTable } from '../src/engine/tmValidate';
import { gradeSubmission } from '../src/engine/grader';

function comp(id: string, label: string): CircuitComponent {
  return { id, type: 'STATE', x: 0, y: 0, label, ports: getPortsForType('STATE') };
}
function wire(id: string, src: string, tgt: string, transitionLabel: string): Wire {
  return {
    id, sourceComponentId: src, sourcePortId: 'right',
    targetComponentId: tgt, targetPortId: 'left', value: 0, transitionLabel,
  };
}

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// Unary increment: scan right over 1s (rewriting 1, moving right each step),
// then write a 1 into the first background cell and halt.
//   S₀ on 1 → write 1, move R (stay S₀); S₀ on 0 → write 1, move R (go S₁, halts).
function tmIncrement() {
  return {
    components: [comp('s0', 'S₀'), comp('s1', 'S₁')],
    wires: [wire('t1', 's0', 's0', '1:1R'), wire('t2', 's0', 's1', '0:1R')],
  };
}

// Unary constant-zero: erase every stroke walking left, then halt.
//   S₀ on 1 → write 0, move L (stay S₀); S₀ on 0 → halt (no matching transition).
function tmZero() {
  return {
    components: [comp('s0', 'S₀')],
    wires: [wire('t1', 's0', 's0', '1:0L')],
  };
}

// Binary identity f(x)=x: a single state with no transitions halts at step 0,
// leaving the input block untouched.
function tmIdentity() {
  return { components: [comp('s0', 'S₀')], wires: [] as Wire[] };
}

// Ambiguous: two transitions out of S₀ on reading 1 (nondeterministic).
function tmAmbiguous() {
  return {
    components: [comp('s0', 'S₀')],
    wires: [wire('t1', 's0', 's0', '1:0R'), wire('t2', 's0', 's0', '1:1L')],
  };
}

function run(machine: { components: CircuitComponent[]; wires: Wire[] }, notation: TMNotation, values: number[]) {
  return evaluateTMSequence(machine.components, machine.wires, encodeTM(notation, values), notation);
}

// ── engine + codec ─────────────────────────────────────────────
console.log('[engine + codec]');

const inc2 = run(tmIncrement(), 'unary', [2]);
check('unary increment halts', inc2.halted && !inc2.hitStepLimit);
check('unary 2 → 3', acceptTM('unary', inc2) === null && decodeTM('unary', inc2.tape) === 3);

const inc0 = run(tmIncrement(), 'unary', [0]);
check('unary 0 → 1 (zero-valued input at standard position)',
  acceptTM('unary', inc0) === null && decodeTM('unary', inc0.tape) === 1);

const zero2 = run(tmZero(), 'unary', [2]);
check('constant-zero 2 → 0 (blank tape decodes to 0)',
  acceptTM('unary', zero2) === null && decodeTM('unary', zero2.tape) === 0);

const id5 = run(tmIdentity(), 'binary', [5]);
check('binary identity 5 → 5', acceptTM('binary', id5) === null && decodeTM('binary', id5.tape) === 5);

const id0 = run(tmIdentity(), 'binary', [0]);
check('binary identity 0 → 0 (*0*)', acceptTM('binary', id0) === null && decodeTM('binary', id0.tape) === 0);

check('encode/decode binary round-trip 11', decodeTM('binary', encodeTM('binary', [11])) === 11);
check('parse: `*` write is binary-only',
  parseTMAction('*R', 'binary') !== null && parseTMAction('*R', 'unary') === null);

// ── acceptor edge cases (constructed tapes) ────────────────────
console.log('\n[acceptor]');
function halted(tape: TMTape): TMEvalResult {
  return { tape, halted: true, steps: 0, hitStepLimit: false, history: [] };
}

const twoBlocks = halted({ cells: { 0: '1', 2: '1' }, head: 2 });
check('two stroke blocks → reject', acceptTM('unary', twoBlocks) !== null);

const stepLimited: TMEvalResult = { tape: { cells: {}, head: 0 }, halted: false, steps: 10000, hitStepLimit: true, history: [] };
check('no halt (step limit) → reject', acceptTM('unary', stepLimited) !== null);

const offPosition = halted({ cells: { 0: '1', 1: '1' }, head: 0 }); // head left of rightmost '1'
check('standard-halt-position toggle OFF → accept', acceptTM('unary', offPosition) === null);
check('standard-halt-position toggle ON → reject',
  acceptTM('unary', offPosition, { requireStandardHaltPosition: true }) !== null);
const onPosition = halted({ cells: { 0: '1', 1: '1' }, head: 1 }); // head on rightmost '1'
check('standard-halt-position toggle ON, head on block end → accept',
  acceptTM('unary', onPosition, { requireStandardHaltPosition: true }) === null);

// ── validation ─────────────────────────────────────────────────
console.log('\n[validation]');
check('valid increment table → no errors',
  validateTMTable(tmIncrement().components, tmIncrement().wires, 'unary').length === 0);
const ambErrors = validateTMTable(tmAmbiguous().components, tmAmbiguous().wires, 'unary');
check('ambiguous table → error', ambErrors.length > 0 && ambErrors[0].kind === 'ambiguous');
const unparseable = validateTMTable([comp('s0', 'S₀')], [wire('t1', 's0', 's0', 'x:y')], 'unary');
check('unparseable label → error', unparseable.length > 0 && unparseable[0].kind === 'unparseable');
const starInUnary = validateTMTable([comp('s0', 'S₀')], [wire('t1', 's0', 's0', '*:0R')], 'unary');
check('`*` read in a unary machine → unparseable', starInUnary.length > 0 && starInUnary[0].kind === 'unparseable');

// ── grader ─────────────────────────────────────────────────────
console.log('\n[grader]');
const assignment: AssignmentData = {
  id: 'tm-smoke',
  title: 'TM smoke',
  questions: [{
    id: 1,
    label: 'Q1 (TM)',
    statement: 'Unary increment',
    buildMode: 'TM',
    representation: 'tally',
    test_cases: [
      { inputs: [2], outputs: [3] },
      { inputs: [0], outputs: [1] },
      { inputs: [5], outputs: [6] },
    ],
  }],
};

function sub(student: string, circuit: { components: CircuitComponent[]; wires: Wire[] }): SubmissionData {
  return {
    assignmentTitle: 'TM smoke',
    student,
    submittedAt: '2026-06-29T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  };
}

const correct = gradeSubmission(assignment, sub('correct@example.com', tmIncrement()));
check('correct: all cases pass', correct.questions[0].status === 'graded' &&
  correct.questions[0].passed === 3 && correct.questions[0].total === 3);

const wrong = gradeSubmission(assignment, sub('wrong@example.com', tmZero()));
check('wrong machine: fails cases', wrong.questions[0].status === 'graded' &&
  wrong.questions[0].passed < wrong.questions[0].total);

const ambiguous = gradeSubmission(assignment, sub('amb@example.com', tmAmbiguous()));
check('ambiguous table: graded, 0 passed, every case has a reason',
  ambiguous.questions[0].status === 'graded' &&
  ambiguous.questions[0].passed === 0 &&
  ambiguous.questions[0].cases.every((c) => !!c.reason));

console.log(`\n${failures === 0 ? 'TM CHECK OK' : `TM CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
