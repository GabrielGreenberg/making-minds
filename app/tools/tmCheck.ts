// Headless smoke test for the Turing-machine engine, codec, validation, and the
// grader's TM branch.
//
//   cd app && npx tsx tools/tmCheck.ts
//
// Covers the value-based codec pipeline (CLAUDE_KB/engines/tm.md): unary
// increment (standard position), zero output (blank tape → 0), a binary
// example, an ambiguous-transition table (validation fails every case), a
// two-block tape (well-formedness failure), the standard-halt-position
// toggle, and the per-case `separations` layout hint (encodeTM honors a
// widened block gap; a gap=1-only machine fails a separations-bearing case
// end-to-end through the grader).

import type {
  CircuitComponent,
  Wire,
  AssignmentData,
  AssignmentQuestion,
  SubmissionData,
  TMNotation,
  TMTape,
} from '../src/types';
import { getPortsForType } from '../src/types';
import {
  evaluateTMSequence,
  type TMEvalResult,
} from '../src/engine/tm';
import { tmNotation } from '../src/engine/notation';
import { encodeTM, acceptTM, decodeTM } from '../src/engine/tmCodec';
import { validateTMTable } from '../src/engine/tmValidate';
import { gradeSubmission, gradeQuestion } from '../src/engine/grader';

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
    wires: [wire('t1', 's0', 's0', '1:1,R'), wire('t2', 's0', 's1', '0:1,R')],
  };
}

// The SAME machine spelled with the legacy dual-action alias ('1:1R') — the
// engine must execute it identically (the alias is accepted forever).
function tmIncrementLegacy() {
  return {
    components: [comp('s0', 'S₀'), comp('s1', 'S₁')],
    wires: [wire('t1', 's0', 's0', '1:1R'), wire('t2', 's0', 's1', '0:1R')],
  };
}

// Unary increment that HALTS IN STANDARD POSITION: after writing the new
// stroke it steps back left onto it (blockEnd) before halting.
//   S₀ on 1 → 1,R (stay); S₀ on 0 → 1,R (go S₁); S₁ on 0 → 0,L (go S₂, halts).
function tmIncrementStandard() {
  return {
    components: [comp('s0', 'S₀'), comp('s1', 'S₁'), comp('s2', 'S₂')],
    wires: [
      wire('t1', 's0', 's0', '1:1,R'),
      wire('t2', 's0', 's1', '0:1,R'),
      wire('t3', 's1', 's2', '0:0,L'),
    ],
  };
}

// Unary constant-zero: erase every stroke walking left, then halt.
//   S₀ on 1 → write 0, move L (stay S₀); S₀ on 0 → halt (no matching transition).
function tmZero() {
  return {
    components: [comp('s0', 'S₀')],
    wires: [wire('t1', 's0', 's0', '1:0,L')],
  };
}

// Binary identity f(x)=x: a single state with no transitions halts at step 0,
// leaving the input block untouched.
function tmIdentity() {
  return { components: [comp('s0', 'S₀')], wires: [] as Wire[] };
}

// Ambiguous: two transitions out of S₀ on reading 1 (nondeterministic). One
// is spelled canonically, one via the legacy alias — validation must see the
// clash across spellings.
function tmAmbiguous() {
  return {
    components: [comp('s0', 'S₀')],
    wires: [wire('t1', 's0', 's0', '1:0,R'), wire('t2', 's0', 's0', '1:1L')],
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
check('parse: `*` write is binary-only (canonical and legacy spellings)',
  tmNotation('binary').parse('0:*,R') !== null && tmNotation('unary').parse('0:*,R') === null &&
  tmNotation('binary').parse('0:*R') !== null && tmNotation('unary').parse('0:*R') === null);

// Legacy dual-action alias: the SAME machine spelled '1:1R' runs identically.
const incLegacy = run(tmIncrementLegacy(), 'unary', [2]);
check('legacy-alias machine runs identically (2 → 3, halts)',
  incLegacy.halted && acceptTM('unary', incLegacy) === null && decodeTM('unary', incLegacy.tape) === 3);
check('legacy-alias history records the canonical action ("1,R")',
  incLegacy.history.length > 0 && incLegacy.history.every((h) => h.action === '1,R'));

// ── separations: per-case block-gap layout hint ────────────────
// TestCase.separations widens the background gap between input blocks (gap
// AFTER each block except the last). encodeTM honors it; absent = the classic
// single-cell separator. This is what makes "do not assume the blocks are
// separated by exactly one empty cell" (HW5 P4) testable through the bank.
console.log('\n[separations]');

// Gap-robust unary adder (hw5-p4's construction): shift the x block left one
// cell per round until it touches y, then park in standard position.
function tmAdderGapRobust() {
  return {
    components: [comp('a0', 'S₀'), comp('a1', 'S₁'), comp('a2', 'S₂'), comp('a3', 'S₃'), comp('a4', 'S₄'), comp('a5', 'S₅')],
    wires: [
      wire('g1', 'a0', 'a1', '1:0,L'), // erase rightmost stroke of x
      wire('g2', 'a1', 'a1', '1:1,L'), // walk left through the rest of x
      wire('g3', 'a1', 'a2', '0:1,L'), // re-add the stroke one cell left of the block
      wire('g4', 'a2', 'a3', '0:0,R'), // still a gap → another round
      wire('g5', 'a2', 'a4', '1:1,R'), // y reached → single merged block
      wire('g6', 'a3', 'a3', '1:1,R'), // walk right to the block's end
      wire('g7', 'a3', 'a0', '0:0,L'), // step back onto rightmost stroke; repeat
      wire('g8', 'a4', 'a4', '1:1,R'), // walk right to the merged block's end
      wire('g9', 'a4', 'a5', '0:0,L'), // step back onto rightmost stroke (SP); halt
    ],
  };
}
// Gap=1-ONLY unary adder (the refuted machine): fill the single separator
// cell, then erase one stroke to compensate. Correct iff the gap is exactly 1.
function tmAdderGap1Only() {
  return {
    components: [comp('b0', 'S₀'), comp('b1', 'S₁'), comp('b2', 'S₂'), comp('b3', 'S₃'), comp('b4', 'S₄')],
    wires: [
      wire('h1', 'b0', 'b0', '1:1,L'), // walk left across x
      wire('h2', 'b0', 'b1', '0:1,L'), // fill the separator (assumes gap=1!)
      wire('h3', 'b1', 'b1', '1:1,L'), // walk left across y
      wire('h4', 'b1', 'b2', '0:0,R'), // background past y; step back on
      wire('h5', 'b2', 'b3', '1:0,R'), // erase one stroke (compensate)
      wire('h6', 'b3', 'b3', '1:1,R'), // walk right to run's end
      wire('h7', 'b3', 'b4', '0:0,L'), // step back onto rightmost stroke (SP)
    ],
  };
}

// encodeTM layout: gap 3 between the blocks, head still in standard position.
const gap3 = encodeTM('unary', [2, 3], [3]);
check('encodeTM separations [3]: blocks at 0-1 and 5-7, head on 7',
  JSON.stringify(gap3) === JSON.stringify({ cells: { 0: '1', 1: '1', 5: '1', 6: '1', 7: '1' }, head: 7 }));
check('encodeTM separations absent === [1] (default layout unchanged)',
  JSON.stringify(encodeTM('unary', [2, 3])) === JSON.stringify(encodeTM('unary', [2, 3], [1])));

// Full encode→run→accept→decode round-trip at gap 3.
const robustG3 = evaluateTMSequence(tmAdderGapRobust().components, tmAdderGapRobust().wires, gap3, 'unary');
check('gap-robust adder at gap 3: encode→run→accept→decode gives 2+3=5',
  robustG3.halted && acceptTM('unary', robustG3) === null && decodeTM('unary', robustG3.tape) === 5);

// The gap=1-only machine fails the same separations-bearing case…
const gap1OnlyG3 = evaluateTMSequence(tmAdderGap1Only().components, tmAdderGap1Only().wires, gap3, 'unary');
check('gap=1-only adder at gap 3: rejected or wrong value',
  acceptTM('unary', gap1OnlyG3) !== null || decodeTM('unary', gap1OnlyG3.tape) !== 5);

// …and end-to-end through the grader: separations rides inside the TestCase.
const sepQuestion: AssignmentQuestion = {
  id: 9, label: 'Q (sep)', statement: 'Unary x+y, arbitrary block separation', buildMode: 'TM',
  representation: 'tally',
  test_cases: [
    { inputs: [2, 3], outputs: [5] },                     // default gap 1
    { inputs: [2, 3], outputs: [5], separations: [3] },   // widened gap
  ],
};
const sepRobust = gradeQuestion(sepQuestion, tmAdderGapRobust());
check('grader: gap-robust adder passes both gap-1 and separations cases',
  sepRobust.status === 'graded' && sepRobust.passed === 2 && sepRobust.total === 2);
const sepGap1Only = gradeQuestion(sepQuestion, tmAdderGap1Only());
check('grader: gap=1-only adder passes the default case but FAILS the separations case',
  sepGap1Only.status === 'graded' && sepGap1Only.total === 2 && sepGap1Only.passed === 1 &&
  sepGap1Only.cases[0].pass && !sepGap1Only.cases[1].pass && !!sepGap1Only.cases[1].reason);

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
const starInUnary = validateTMTable([comp('s0', 'S₀')], [wire('t1', 's0', 's0', '*:0,R')], 'unary');
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

// ── requireStandardHaltPosition, end-to-end through the grader ─────
// The question-level flag must have teeth: tmIncrement leaves the RIGHT tape
// but halts one cell right of the block (it writes the final stroke and moves
// R before halting) — exactly the machine the flag exists to catch.
console.log('\n[grader: requireStandardHaltPosition]');
const laxQuestion: AssignmentQuestion = assignment.questions[0];
const strictQuestion: AssignmentQuestion = { ...laxQuestion, requireStandardHaltPosition: true };

const laxOffPosition = gradeQuestion(laxQuestion, tmIncrement());
check('flag ABSENT: right-tape/off-position machine passes all cases (default unchanged)',
  laxOffPosition.status === 'graded' &&
  laxOffPosition.passed === laxOffPosition.total && laxOffPosition.total === 3);

const strictOffPosition = gradeQuestion(strictQuestion, tmIncrement());
check('flag SET: same machine FAILS every case with a position reason',
  strictOffPosition.status === 'graded' &&
  strictOffPosition.passed === 0 && strictOffPosition.total === 3 &&
  strictOffPosition.cases.every((c) => !!c.reason && c.reason.includes('rightmost cell')));

const strictStandard = gradeQuestion(strictQuestion, tmIncrementStandard());
check('flag SET: standard-position increment passes all cases',
  strictStandard.status === 'graded' &&
  strictStandard.passed === strictStandard.total && strictStandard.total === 3);

console.log(`\n${failures === 0 ? 'TM CHECK OK' : `TM CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
