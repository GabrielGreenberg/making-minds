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
// computes `x + 1`. Turbot questions (one per inner mode: CC, SC, FSM, TM)
// grade positionally instead — each sample brain solves its arena's success
// criterion. So a correct submission scores 100% and the pipeline check is
// self-consistent.

import type {
  ArenaCell,
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
const SAMPLE_ASSIGNMENT_TITLE = 'Sample — CC / SC / FSM / TM / Turbot';

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

// ── Turbot (CC brain): "walk forward until blocked, then stop" ──────
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

// ── Turbot (SC brain): "turn left at the first wall, stop at the second" ──
// MEM M1 latches "have I ever been blocked" (m' = s OR m), so what the brain
// does at a wall depends on state carried across cycles: left wheel i = NOT s,
// right wheel j = (NOT s) OR (NOT m) — clear → 11 forward, first wall (m=0) →
// 01 turn left, any later wall (m=1) → 00 stop. On the sample L course it
// walks east, turns the corner, walks north, and stops on the goal.

export function turbotScCorrect(): CircuitData {
  return {
    components: [
      comp('tsc-in1', 'INPUT', 'IN1'),
      comp('tsc-m1', 'MEM', 'M1', { memDirection: 'right-to-left', storedValue: 0 }),
      comp('tsc-nots', 'NOT', ''), // NOT s
      comp('tsc-notm', 'NOT', ''), // NOT m
      comp('tsc-orj', 'OR', ''),   // j = NOT s OR NOT m
      comp('tsc-orm', 'OR', ''),   // m' = s OR m
      comp('tsc-out1', 'OUTPUT', 'OUT1'),
      comp('tsc-out2', 'OUTPUT', 'OUT2'),
    ],
    wires: [
      wire('tsc-w1', 'tsc-in1', 'out', 'tsc-nots', 'in'),
      wire('tsc-w2', 'tsc-nots', 'out', 'tsc-out1', 'in'),
      wire('tsc-w3', 'tsc-nots', 'out', 'tsc-orj', 'in1'),
      wire('tsc-w4', 'tsc-m1', 'mout', 'tsc-notm', 'in'),
      wire('tsc-w5', 'tsc-notm', 'out', 'tsc-orj', 'in2'),
      wire('tsc-w6', 'tsc-orj', 'out', 'tsc-out2', 'in'),
      wire('tsc-w7', 'tsc-in1', 'out', 'tsc-orm', 'in1'),
      wire('tsc-w8', 'tsc-m1', 'mout', 'tsc-orm', 'in2'),
      wire('tsc-w9', 'tsc-orm', 'out', 'tsc-m1', 'min'),
    ],
  };
}

// Wrong: the memoryless forward-until-blocked brain — treats every wall the
// same, so it stops at the first wall, short of the corner goal.
export function turbotScIncorrect(): CircuitData {
  return turbotCorrect();
}

// ── Turbot (FSM brain): "walk forward until blocked, then stop" ──────
// One state; turbot-FSM Mealy transitions carry the full 2-bit motor code
// ("in:ij"): clear ahead → 11 (forward), blocked → 00 (stop).

export function turbotFsmCorrect(): CircuitData {
  return {
    components: [comp('tfsm-s0', 'STATE', 'S₀')],
    wires: [
      wire('tfsm-t1', 'tfsm-s0', 'right', 'tfsm-s0', 'left', { transitionLabel: '0:11' }),
      wire('tfsm-t2', 'tfsm-s0', 'right', 'tfsm-s0', 'left', { transitionLabel: '1:00' }),
    ],
  };
}

// Wrong: turns left (01) instead of stopping when blocked — pivots at the
// wall forever and runs into the step limit.
export function turbotFsmIncorrect(): CircuitData {
  return {
    components: [comp('tfsm-s0', 'STATE', 'S₀')],
    wires: [
      wire('tfsm-t1', 'tfsm-s0', 'right', 'tfsm-s0', 'left', { transitionLabel: '0:11' }),
      wire('tfsm-t2', 'tfsm-s0', 'right', 'tfsm-s0', 'left', { transitionLabel: '1:01' }),
    ],
  };
}

// ── Turbot (TM brain): the textbook walker ("Turbots: Operation") ─────
// S₀ (external) senses E/F ahead and moves forward into S₁; S₁ (internal)
// writes a 1 on the private tape; S₂ (internal) moves the head left and
// returns to S₀ — recording one stroke per forward move. At a wall S₀ senses
// B, has no transition, and halts; halting IS stopping for a turbot TM, so
// halting on the food satisfies reach-and-stop.

export function turbotTmCorrect(): CircuitData {
  return {
    components: [
      comp('ttm-s0', 'STATE', 'S₀', { stateKind: 'external' }),
      comp('ttm-s1', 'STATE', 'S₁', { stateKind: 'internal' }),
      comp('ttm-s2', 'STATE', 'S₂', { stateKind: 'internal' }),
    ],
    wires: [
      wire('ttm-t1', 'ttm-s0', 'right', 'ttm-s1', 'left', { transitionLabel: 'E:↑' }),
      wire('ttm-t2', 'ttm-s0', 'right', 'ttm-s1', 'left', { transitionLabel: 'F:↑' }),
      wire('ttm-t3', 'ttm-s1', 'right', 'ttm-s2', 'left', { transitionLabel: '0:1' }),
      wire('ttm-t4', 'ttm-s2', 'right', 'ttm-s0', 'left', { transitionLabel: '1:L' }),
    ],
  };
}

// Wrong: a single internal state spinning right over the blank tape (0:R) —
// it never reaches an external state, never moves in the arena, and runs
// into the step limit.
export function turbotTmIncorrect(): CircuitData {
  return {
    components: [comp('ttm-s0', 'STATE', 'S₀', { stateKind: 'internal' })],
    wires: [
      wire('ttm-t1', 'ttm-s0', 'right', 'ttm-s0', 'left', { transitionLabel: '0:R' }),
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

  // A 1×5 corridor, goal against the east wall: walk east and stop at the
  // goal (arena-based grading — no test_cases/cc_spec).
  const corridorCase = {
    arena: {
      width: 5,
      height: 1,
      cells: [['empty', 'empty', 'empty', 'empty', 'goal']] as ArenaCell[][],
      start: { x: 0, y: 0, facing: 'E' as const },
    },
    maxSteps: 20,
    criterion: 'reach-and-stop' as const,
  };

  // Turbot (CC brain): the corridor walk.
  const turbotCcQuestion: AssignmentQuestion = {
    id: 5,
    label: 'Q5 (Turbot - CC)',
    statement:
      'Program the turbot to walk forward until it is blocked, then stop. The goal sits against the far wall.',
    buildMode: 'turbot',
    // The authored encoding (only meaningful for TM brains, where it picks
    // the internal tape alphabet; a circuit brain ignores it).
    representation: 'binary',
    innerMode: 'CC',
    turbot_cases: [corridorCase],
  };

  // Turbot (SC brain): a 3×3 "L" course — start SW facing east, goal NE.
  // Reaching it takes a turn at the east wall, and treating the two walls
  // differently (turn, then stop) takes memory.
  const turbotScQuestion: AssignmentQuestion = {
    id: 6,
    label: 'Q6 (Turbot - SC)',
    statement:
      'Walk the L-shaped course: go forward, turn left at the first wall, and stop on the goal at the second. Use memory to treat the two walls differently.',
    buildMode: 'turbot',
    representation: 'binary',
    innerMode: 'SC',
    turbot_cases: [
      {
        arena: {
          width: 3,
          height: 3,
          cells: [
            ['empty', 'empty', 'goal'],
            ['empty', 'empty', 'empty'],
            ['empty', 'empty', 'empty'],
          ],
          start: { x: 0, y: 2, facing: 'E' },
        },
        maxSteps: 20,
        criterion: 'reach-and-stop',
      },
    ],
  };

  // Turbot (FSM brain): the corridor walk again, but the brain is a state
  // machine — turbot-FSM transitions carry the full 2-bit motor code.
  const turbotFsmQuestion: AssignmentQuestion = {
    id: 7,
    label: 'Q7 (Turbot - FSM)',
    statement:
      'Program the turbot to walk forward until it is blocked, then stop — this time with a finite-state machine brain.',
    buildMode: 'turbot',
    representation: 'binary',
    innerMode: 'FSM',
    turbot_cases: [corridorCase],
  };

  // Turbot (TM brain): the textbook walker — reach the food and halt there
  // (halting IS stopping). Unary encoding: the internal tape alphabet is
  // {0,1}, no * allowed.
  const turbotTmQuestion: AssignmentQuestion = {
    id: 8,
    label: 'Q8 (Turbot - TM)',
    statement:
      'Program the turbot to walk forward to the food and halt there, recording a stroke on its internal tape for each move.',
    buildMode: 'turbot',
    representation: 'tally',
    innerMode: 'TM',
    turbot_cases: [
      {
        arena: {
          width: 4,
          height: 1,
          cells: [['empty', 'empty', 'empty', 'goal']],
          start: { x: 0, y: 0, facing: 'E' },
        },
        maxSteps: 50,
        criterion: 'reach-and-stop',
      },
    ],
  };

  return {
    id: SAMPLE_ASSIGNMENT_ID,
    title: SAMPLE_ASSIGNMENT_TITLE,
    questions: [
      ccQuestion,
      scQuestion,
      fsmQuestion,
      tmQuestion,
      turbotCcQuestion,
      turbotScQuestion,
      turbotFsmQuestion,
      turbotTmQuestion,
    ],
  };
}

// ── Sample submissions ─────────────────────────────────────────
// One answer per question, in question-id order (1..8):
// CC, SC, FSM, TM, Turbot-CC, Turbot-SC, Turbot-FSM, Turbot-TM.

function submission(student: string, circuits: CircuitData[]): SubmissionData {
  return {
    assignmentTitle: SAMPLE_ASSIGNMENT_TITLE,
    student,
    submittedAt: '2026-06-27T12:00:00.000Z', // stamped by caller in real flow
    answers: circuits.map((circuit, i) => ({ questionId: i + 1, circuit })),
  };
}

function allCorrect(): CircuitData[] {
  return [
    ccCorrect(), scCorrect(), fsmCorrect(), tmCorrect(),
    turbotCorrect(), turbotScCorrect(), turbotFsmCorrect(), turbotTmCorrect(),
  ];
}

function allIncorrect(): CircuitData[] {
  return [
    ccIncorrect(), scIncorrect(), fsmIncorrect(), tmIncorrect(),
    turbotIncorrect(), turbotScIncorrect(), turbotFsmIncorrect(), turbotTmIncorrect(),
  ];
}

/** All-correct submission (should score 8/8). */
export function buildCorrectSubmission(student = 'correct@example.com'): SubmissionData {
  return submission(student, allCorrect());
}

/** All-incorrect submission (should score 0/8). */
export function buildIncorrectSubmission(student = 'wrong@example.com'): SubmissionData {
  return submission(student, allIncorrect());
}

/**
 * A spread of artificial students with varying correctness, for seeding the
 * instructor gradebook with something interesting to look at.
 */
export function buildSampleSubmissions(): SubmissionData[] {
  // Mix the two banks per student: pick the correct circuit for the listed
  // question ids, the incorrect one elsewhere.
  const mixed = (student: string, correctIds: number[]): SubmissionData => {
    const good = allCorrect();
    const bad = allIncorrect();
    return submission(student, good.map((c, i) => (correctIds.includes(i + 1) ? c : bad[i])));
  };
  return [
    mixed('ada@example.com', [1, 2, 3, 4, 5, 6, 7, 8]), // 8/8
    mixed('alan@example.com', [1, 3, 4, 5, 6, 7, 8]), // 7/8 (SC wrong)
    mixed('grace@example.com', [1, 2, 5, 6]), // 4/8
    mixed('claude@example.com', []), // 0/8
    mixed('', [1, 2, 3, 4, 5, 6, 7, 8]), // Anonymous, 8/8
  ];
}
