// Sample assignment + artificial submissions for exercising the full pipeline
// (submit → store → autograde → instructor gradebook) across CC, SC, FSM, TM,
// and turbot.
//
// Pure and framework-agnostic: builds `AssignmentData` and `SubmissionData`
// values only — no storage, no React. The browser dev seed (devData/seed.ts) and
// the headless pipeline check (tools/pipelineCheck.ts) both build on these.
//
// Every question's test_cases are generated from a DSL formula + representation
// (engine/testVectorGen.ts) — the codec model (CLAUDE_KB/pipeline/codec.md). The
// sample circuits implement those functions exactly on their axis: CC `a & b`
// (space); SC a 1-step delay register, which on the time axis computes `2 * x`;
// FSM a pass-through identity, `x`; TM unary successor, which on the tape axis
// computes `x + 1`. So a correct submission scores 100% and the pipeline check
// is self-consistent.

import type {
  AssignmentData,
  AssignmentQuestion,
  CCSpec,
  CircuitComponent,
  CircuitData,
  RepSystem,
  SubmissionData,
  Wire,
} from '../types';
import { getPortsForType } from '../types';
import { generateTestCases } from '../engine/testVectorGen';

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
    components: c.components.map((x) =>
      x.id === 'cc-and' ? { ...x, type: 'OR' } : x,
    ),
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
    components: [comp('sc-in1', 'INPUT', 'IN1'), comp('sc-out1', 'OUTPUT', 'OUT1')],
    wires: [wire('sc-w1', 'sc-in1', 'out', 'sc-out1', 'in')],
  };
}

// ── FSM: pass-through identity. OUT[t] = IN[t] each step ────────
// On the time axis (one bit per step, LSB-first) this computes f(x) = x.
// A single state echoes each input bit: S0 on 0→0 (stay), on 1→1 (stay).

export function fsmCorrect(): CircuitData {
  return {
    components: [comp('fsm-s0', 'STATE', 'S₀')],
    wires: [
      wire('fsm-t1', 'fsm-s0', 'right', 'fsm-s0', 'left', { transitionLabel: '0:0' }),
      wire('fsm-t2', 'fsm-s0', 'right', 'fsm-s0', 'left', { transitionLabel: '1:1' }),
    ],
  };
}

// Wrong: complement each bit (0:1, 1:0) → computes 7−x on a 3-bit value, never x.
export function fsmIncorrect(): CircuitData {
  return {
    components: [comp('fsm-s0', 'STATE', 'S₀')],
    wires: [
      wire('fsm-t1', 'fsm-s0', 'right', 'fsm-s0', 'left', { transitionLabel: '0:1' }),
      wire('fsm-t2', 'fsm-s0', 'right', 'fsm-s0', 'left', { transitionLabel: '1:0' }),
    ],
  };
}

// ── TM: unary successor. y = x + 1 (tape axis, unary/tally notation) ───
// S₀ scans right over strokes (rewriting 1, moving right each step); on the
// first background cell it writes a stroke, moves right, and halts in S₁ —
// appending one 1 to the block.

export function tmCorrect(): CircuitData {
  return {
    components: [comp('tm-s0', 'STATE', 'S₀'), comp('tm-s1', 'STATE', 'S₁')],
    wires: [
      wire('tm-t1', 'tm-s0', 'right', 'tm-s0', 'left', { transitionLabel: '1:1R' }),
      wire('tm-t2', 'tm-s0', 'right', 'tm-s1', 'left', { transitionLabel: '0:1R' }),
    ],
  };
}

// Wrong: erase every stroke walking left, then halt → always outputs 0.
export function tmIncorrect(): CircuitData {
  return {
    components: [comp('tm-s0', 'STATE', 'S₀')],
    wires: [
      wire('tm-t1', 'tm-s0', 'right', 'tm-s0', 'left', { transitionLabel: '1:0L' }),
    ],
  };
}

// ── Turbot: "walk forward until blocked, then stop" (CC brain) ──────
// A single NOT gate split to both motor wires: sensor 0 (clear ahead) →
// bits 11 (forward); sensor 1 (blocked) → bits 00 (stop). In the sample
// corridor the goal sits against the far wall, so stopping at the wall
// satisfies reach-and-stop.

export function turbotCorrect(): CircuitData {
  return {
    components: [
      comp('tb-in1', 'INPUT', 'IN1'),
      comp('tb-not', 'NOT', ''),
      comp('tb-out1', 'OUTPUT', 'OUT1'),
      comp('tb-out2', 'OUTPUT', 'OUT2'),
    ],
    wires: [
      wire('tb-w1', 'tb-in1', 'out', 'tb-not', 'in'),
      wire('tb-w2', 'tb-not', 'out', 'tb-out1', 'in'),
      wire('tb-w3', 'tb-not', 'out', 'tb-out2', 'in'),
    ],
  };
}

// Wrong: motor wired straight from the sensor — outputs 00 (stop) on the
// very first clear-ahead cycle, so the turbot never leaves the start.
export function turbotIncorrect(): CircuitData {
  return {
    components: [
      comp('tb-in1', 'INPUT', 'IN1'),
      comp('tb-out1', 'OUTPUT', 'OUT1'),
      comp('tb-out2', 'OUTPUT', 'OUT2'),
    ],
    wires: [
      wire('tb-w1', 'tb-in1', 'out', 'tb-out1', 'in'),
      wire('tb-w2', 'tb-in1', 'out', 'tb-out2', 'in'),
    ],
  };
}

// ── Sample assignment (test cases generated from DSL formulas + rep) ──
// Each question is value-based: the codec encodes inputs to the mode's axis,
// runs the circuit, decodes the output, and compares to f(x).

function question(
  id: number,
  label: string,
  statement: string,
  buildMode: AssignmentQuestion['buildMode'],
  spec: CCSpec,
  representation: RepSystem = 'binary',
): AssignmentQuestion {
  return {
    id,
    label,
    statement,
    buildMode,
    representation,
    cc_spec: spec,
    test_cases: generateTestCases(spec, representation, buildMode),
  };
}

export function buildSampleAssignment(): AssignmentData {
  // CC: y = a AND b (space axis — bits across wires).
  const ccQuestion = question(
    1,
    'Q1 (CC)',
    'Build a combinatorial circuit computing OUT1 = IN1 AND IN2.',
    'CC',
    {
      inputs: [
        { name: 'a', width: 1 },
        { name: 'b', width: 1 },
      ],
      outputs: [{ name: 'y', width: 1, formula: 'a & b' }],
    },
  );

  // SC: a 1-step delay register, which on the time axis (LSB-first) computes
  // y = 2x. Output width 4 holds 2x for the 3-bit input range and gives the
  // drain step the shifted bit needs.
  const scQuestion = question(
    2,
    'Q2 (SC)',
    'Build a sequential circuit that delays the input by one clock tick (OUT1[t] = IN1[t−1], starting at 0).',
    'SC',
    {
      inputs: [{ name: 'x', width: 3 }],
      outputs: [{ name: 'y', width: 4, formula: '2 * x' }],
    },
  );

  // FSM: pass-through identity, y = x (time axis, one bit per step).
  const fsmQuestion = question(
    3,
    'Q3 (FSM)',
    'Build a finite-state machine that outputs each input bit unchanged (identity).',
    'FSM',
    {
      inputs: [{ name: 'x', width: 3 }],
      outputs: [{ name: 'y', width: 3, formula: 'x' }],
    },
  );

  // TM: unary successor, y = x + 1 (tape axis; "tally" representation is the
  // unary notation on this axis). Output width 4 holds x+1 for the 0..3 input
  // range.
  const tmQuestion = question(
    4,
    'Q4 (TM)',
    'Build a Turing machine that computes the unary successor (OUT = IN + 1).',
    'TM',
    {
      inputs: [{ name: 'x', width: 3 }],
      outputs: [{ name: 'y', width: 4, formula: 'x + 1' }],
    },
    'tally',
  );

  // Turbot: a 1×5 corridor, goal against the east wall; a CC brain must walk
  // east and stop at the goal (arena-based grading — no test_cases/cc_spec).
  const turbotQuestion: AssignmentQuestion = {
    id: 5,
    label: 'Q5 (Turbot)',
    statement:
      'Program the turbot to walk forward until it is blocked, then stop. The goal sits against the far wall.',
    buildMode: 'turbot',
    representation: 'tally',
    innerMode: 'CC',
    turbot_cases: [
      {
        arena: {
          width: 5,
          height: 1,
          cells: [['empty', 'empty', 'empty', 'empty', 'goal']],
          start: { x: 0, y: 0, facing: 'E' },
        },
        maxSteps: 20,
        criterion: 'reach-and-stop',
      },
    ],
  };

  return {
    id: SAMPLE_ASSIGNMENT_ID,
    title: 'Sample — CC / SC / FSM / TM',
    questions: [ccQuestion, scQuestion, fsmQuestion, tmQuestion, turbotQuestion],
  };
}

// ── Sample submissions ─────────────────────────────────────────

function submission(
  student: string,
  cc: CircuitData,
  sc: CircuitData,
  fsm: CircuitData,
  tm: CircuitData,
  turbot: CircuitData,
): SubmissionData {
  return {
    assignmentTitle: 'Sample — CC / SC / FSM / TM',
    student,
    submittedAt: '2026-06-27T12:00:00.000Z', // stamped by caller in real flow
    answers: [
      { questionId: 1, circuit: cc },
      { questionId: 2, circuit: sc },
      { questionId: 3, circuit: fsm },
      { questionId: 4, circuit: tm },
      { questionId: 5, circuit: turbot },
    ],
  };
}

/** All-correct submission (should score 5/5). */
export function buildCorrectSubmission(student = 'correct@example.com'): SubmissionData {
  return submission(student, ccCorrect(), scCorrect(), fsmCorrect(), tmCorrect(), turbotCorrect());
}

/** All-incorrect submission (should score 0/5). */
export function buildIncorrectSubmission(student = 'wrong@example.com'): SubmissionData {
  return submission(student, ccIncorrect(), scIncorrect(), fsmIncorrect(), tmIncorrect(), turbotIncorrect());
}

/**
 * A spread of artificial students with varying correctness, for seeding the
 * instructor gradebook with something interesting to look at.
 */
export function buildSampleSubmissions(): SubmissionData[] {
  return [
    submission('ada@example.com', ccCorrect(), scCorrect(), fsmCorrect(), tmCorrect(), turbotCorrect()), // 5/5
    submission('alan@example.com', ccCorrect(), scIncorrect(), fsmCorrect(), tmCorrect(), turbotCorrect()), // 4/5
    submission('grace@example.com', ccCorrect(), scCorrect(), fsmIncorrect(), tmIncorrect(), turbotIncorrect()), // 2/5
    submission('claude@example.com', ccIncorrect(), scIncorrect(), fsmIncorrect(), tmIncorrect(), turbotIncorrect()), // 0/5
    submission('', ccCorrect(), scCorrect(), fsmCorrect(), tmCorrect(), turbotCorrect()), // Anonymous, 5/5
  ];
}
