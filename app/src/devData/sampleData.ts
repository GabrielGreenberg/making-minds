// Sample assignment + artificial submissions for exercising the full pipeline
// (submit → store → autograde → instructor gradebook) across CC, SC, and FSM.
//
// Pure and framework-agnostic: builds `AssignmentData` and `SubmissionData`
// values only — no storage, no React. The browser dev seed (devData/seed.ts) and
// the headless pipeline check (tools/pipelineCheck.ts) both build on these.
//
// Test vectors are derived from the known-correct circuits (CC via the instructor
// formula path; SC/FSM by running the engines), so a correct submission is
// guaranteed to score 100% and the pipeline test is self-consistent.

import type {
  AssignmentData,
  AssignmentQuestion,
  CircuitComponent,
  CircuitData,
  SubmissionData,
  Wire,
} from '../types';
import { getPortsForType } from '../types';
import { generateCCTestVectors } from '../engine/testVectorGen';
import { evaluateSCSequence } from '../engine/sc';
import { evaluateFSMSequence } from '../engine/fsm';

export const SAMPLE_ASSIGNMENT_ID = 'sample-mixed';

// ── small builders ─────────────────────────────────────────────

function comp(
  id: string,
  type: CircuitComponent['type'],
  label: string,
  extra: Partial<CircuitComponent> = {},
): CircuitComponent {
  return { id, type, x: 0, y: 0, label, ports: getPortsForType(type), ...extra };
}

function wire(
  id: string,
  src: string,
  srcPort: string,
  tgt: string,
  tgtPort: string,
  extra: Partial<Wire> = {},
): Wire {
  return {
    id,
    sourceComponentId: src,
    sourcePortId: srcPort,
    targetComponentId: tgt,
    targetPortId: tgtPort,
    value: 0,
    ...extra,
  };
}

// ── CC: OUT1 = IN1 AND IN2 ─────────────────────────────────────

export function ccCorrect(): CircuitData {
  return {
    components: [
      comp('cc-in1', 'INPUT', 'IN1'),
      comp('cc-in2', 'INPUT', 'IN2'),
      comp('cc-and', 'AND', ''),
      comp('cc-out1', 'OUTPUT', 'OUT1'),
    ],
    wires: [
      wire('cc-w1', 'cc-in1', 'out', 'cc-and', 'in1'),
      wire('cc-w2', 'cc-in2', 'out', 'cc-and', 'in2'),
      wire('cc-w3', 'cc-and', 'out', 'cc-out1', 'in'),
    ],
  };
}

// Wrong: OR instead of AND (fails on 01, 10).
export function ccIncorrect(): CircuitData {
  const c = ccCorrect();
  return {
    components: c.components.map((x) => (x.id === 'cc-and' ? { ...x, type: 'OR' } : x)),
    wires: c.wires,
  };
}

// ── SC: 1-bit delay register. OUT1[t] = IN1[t-1], initial 0 ─────

export function scCorrect(): CircuitData {
  return {
    components: [
      comp('sc-in1', 'INPUT', 'IN1'),
      // right-to-left: output port = mout (left), input port = min (right).
      comp('sc-mem', 'MEM', 'M1', { memDirection: 'right-to-left', storedValue: 0 }),
      comp('sc-out1', 'OUTPUT', 'OUT1'),
    ],
    wires: [
      wire('sc-w1', 'sc-in1', 'out', 'sc-mem', 'min'), // feed input into the register
      wire('sc-w2', 'sc-mem', 'mout', 'sc-out1', 'in'), // read stored value out
    ],
  };
}

// Wrong: pass-through (no delay). OUT1[t] = IN1[t].
export function scIncorrect(): CircuitData {
  return {
    components: [
      comp('sc-in1', 'INPUT', 'IN1'),
      comp('sc-out1', 'OUTPUT', 'OUT1'),
    ],
    wires: [wire('sc-w1', 'sc-in1', 'out', 'sc-out1', 'in')],
  };
}

// ── FSM: a 2-state Mealy machine ───────────────────────────────
// S0: 0→0 stay S0, 1→1 go S1.   S1: 0→1 go S0, 1→0 stay S1.

export function fsmCorrect(): CircuitData {
  return {
    components: [comp('fsm-s0', 'STATE', 'S₀'), comp('fsm-s1', 'STATE', 'S₁')],
    wires: [
      wire('fsm-t1', 'fsm-s0', 'right', 'fsm-s0', 'left', { transitionLabel: '0:0' }),
      wire('fsm-t2', 'fsm-s0', 'right', 'fsm-s1', 'left', { transitionLabel: '1:1' }),
      wire('fsm-t3', 'fsm-s1', 'right', 'fsm-s0', 'left', { transitionLabel: '0:1' }),
      wire('fsm-t4', 'fsm-s1', 'right', 'fsm-s1', 'left', { transitionLabel: '1:0' }),
    ],
  };
}

// Wrong: flip the output on the S0 →1 transition (1:1 becomes 1:0).
export function fsmIncorrect(): CircuitData {
  const c = fsmCorrect();
  return {
    components: c.components,
    wires: c.wires.map((w) => (w.id === 'fsm-t2' ? { ...w, transitionLabel: '1:0' } : w)),
  };
}

// ── Sample assignment (test vectors derived from the correct circuits) ──

// SC input sequences (flat, one bit per step since the circuit has 1 INPUT).
const SC_INPUT_SEQS = [
  [1, 0, 1, 1, 0, 0, 1],
  [0, 0, 1, 0, 1, 1, 1, 0],
];
// FSM input sequences (one bit per step).
const FSM_INPUT_SEQS = [
  [1, 1, 0, 1, 0, 0],
  [0, 1, 0, 1, 1, 1, 0],
];

function scExpected(inputSeq: number[]): number[] {
  // 1 input/step, 1 output/step → outputs flatten back to one bit per step.
  const steps = inputSeq.map((b) => [b]);
  return evaluateSCSequence(scCorrect().components, scCorrect().wires, steps).flat();
}

function fsmExpected(inputSeq: number[]): number[] {
  return evaluateFSMSequence(fsmCorrect().components, fsmCorrect().wires, inputSeq).outputBits;
}

export function buildSampleAssignment(): AssignmentData {
  const ccQuestion: AssignmentQuestion = {
    id: 1,
    label: 'Q1 (CC)',
    statement: 'Build a combinatorial circuit computing OUT1 = IN1 AND IN2.',
    buildMode: 'CC',
    representation: 'binary',
    grading_mode: 'exhaustive',
    cc_spec: {
      inputs: [
        { name: 'a', width: 1, encoding: 'binary' },
        { name: 'b', width: 1, encoding: 'binary' },
      ],
      outputs: [{ name: 'y', width: 1, encoding: 'binary', formula: 'a & b' }],
    },
    test_vectors: generateCCTestVectors({
      inputs: [
        { name: 'a', width: 1, encoding: 'binary' },
        { name: 'b', width: 1, encoding: 'binary' },
      ],
      outputs: [{ name: 'y', width: 1, encoding: 'binary', formula: 'a & b' }],
    }),
  };

  const scQuestion: AssignmentQuestion = {
    id: 2,
    label: 'Q2 (SC)',
    statement: 'Build a sequential circuit that delays the input by one clock tick (OUT1[t] = IN1[t−1], starting at 0).',
    buildMode: 'SC',
    representation: 'binary',
    test_vectors: SC_INPUT_SEQS.map((seq) => ({
      input_sequence: seq,
      expected_output: scExpected(seq),
    })),
  };

  const fsmQuestion: AssignmentQuestion = {
    id: 3,
    label: 'Q3 (FSM)',
    statement: 'Build a finite-state machine matching the given input/output behaviour.',
    buildMode: 'FSM',
    representation: 'binary',
    test_vectors: FSM_INPUT_SEQS.map((seq) => ({
      input_sequence: seq,
      expected_output: fsmExpected(seq),
    })),
  };

  return {
    id: SAMPLE_ASSIGNMENT_ID,
    title: 'Sample — CC / SC / FSM',
    questions: [ccQuestion, scQuestion, fsmQuestion],
  };
}

// ── Sample submissions ─────────────────────────────────────────

function submission(
  student: string,
  cc: CircuitData,
  sc: CircuitData,
  fsm: CircuitData,
): SubmissionData {
  return {
    assignmentTitle: 'Sample — CC / SC / FSM',
    student,
    submittedAt: '2026-06-27T12:00:00.000Z', // stamped by caller in real flow
    answers: [
      { questionId: 1, circuit: cc },
      { questionId: 2, circuit: sc },
      { questionId: 3, circuit: fsm },
    ],
  };
}

/** All-correct submission (should score 3/3). */
export function buildCorrectSubmission(student = 'correct@example.com'): SubmissionData {
  return submission(student, ccCorrect(), scCorrect(), fsmCorrect());
}

/** All-incorrect submission (should score 0/3). */
export function buildIncorrectSubmission(student = 'wrong@example.com'): SubmissionData {
  return submission(student, ccIncorrect(), scIncorrect(), fsmIncorrect());
}

/**
 * A spread of artificial students with varying correctness, for seeding the
 * instructor gradebook with something interesting to look at.
 */
export function buildSampleSubmissions(): SubmissionData[] {
  return [
    submission('ada@example.com', ccCorrect(), scCorrect(), fsmCorrect()), // 3/3
    submission('alan@example.com', ccCorrect(), scIncorrect(), fsmCorrect()), // 2/3
    submission('grace@example.com', ccCorrect(), scCorrect(), fsmIncorrect()), // 2/3
    submission('claude@example.com', ccIncorrect(), scIncorrect(), fsmIncorrect()), // 0/3
    submission('', ccCorrect(), scCorrect(), fsmCorrect()), // Anonymous, 3/3
  ];
}
