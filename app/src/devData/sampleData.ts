// Sample assignment + artificial submissions for exercising the full pipeline
// (submit → store → autograde → instructor gradebook) across CC, SC, FSM, TM,
// turbot, perception, and open questions.
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
  PerceptionRule,
  RepSystem,
  SubmissionData,
  Wire,
} from '../types';
import { getPortsForType } from '../types';
import { generateTestCases } from '../engine/testVectorGen';
import { buildPerceptionCases, perceptionModeFor } from '../engine/perception';

export const SAMPLE_ASSIGNMENT_ID = 'sample-mixed';
const SAMPLE_ASSIGNMENT_TITLE = 'Sample — CC / SC / FSM / TM / Turbot / Perception / Open';

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
      wire('tm-t1', 'tm-s0', 'right', 'tm-s0', 'left', { transitionLabel: '1:1,R' }),
      wire('tm-t2', 'tm-s0', 'right', 'tm-s1', 'left', { transitionLabel: '0:1,R' }),
    ],
  };
}

// Wrong: erase every stroke walking left, then halt → always outputs 0.
export function tmIncorrect(): CircuitData {
  return {
    components: [comp('tm-s0', 'STATE', 'S₀')],
    wires: [
      wire('tm-t1', 'tm-s0', 'right', 'tm-s0', 'left', { transitionLabel: '1:0,L' }),
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

// ── Perception circuits: a tiny netlist builder ────────────────
// The perception samples are too big to wire by hand (the motion detector is
// ~80 gates), so they're generated: refs are (component, port) pairs, gates
// take refs and return their output ref, and and/or fold over 2-input gates.
// Splitting (one output → many inputs) is legal wiring, so refs can be reused.

interface NetRef {
  comp: string;
  port: string;
}

class Netlist {
  components: CircuitComponent[] = [];
  wires: Wire[] = [];
  private n = 0;
  private prefix: string;
  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private id(): string {
    return `${this.prefix}-${++this.n}`;
  }

  connect(src: NetRef, tgt: NetRef): void {
    this.wires.push(wire(this.id(), src.comp, src.port, tgt.comp, tgt.port));
  }

  input(label: string): NetRef {
    const id = this.id();
    this.components.push(comp(id, 'INPUT', label));
    return { comp: id, port: 'out' };
  }

  output(label: string, from: NetRef): void {
    const id = this.id();
    this.components.push(comp(id, 'OUTPUT', label));
    this.connect(from, { comp: id, port: 'in' });
  }

  /** A MEM register fed by `store`; the returned ref reads last cycle's value. */
  mem(label: string, store: NetRef): NetRef {
    const id = this.id();
    this.components.push(comp(id, 'MEM', label, { memDirection: 'right-to-left', storedValue: 0 }));
    this.connect(store, { comp: id, port: 'min' });
    return { comp: id, port: 'mout' };
  }

  gate(type: 'AND' | 'OR' | 'XOR', a: NetRef, b: NetRef): NetRef {
    const id = this.id();
    this.components.push(comp(id, type, ''));
    this.connect(a, { comp: id, port: 'in1' });
    this.connect(b, { comp: id, port: 'in2' });
    return { comp: id, port: 'out' };
  }

  not(a: NetRef): NetRef {
    const id = this.id();
    this.components.push(comp(id, 'NOT', ''));
    this.connect(a, { comp: id, port: 'in' });
    return { comp: id, port: 'out' };
  }

  and(refs: NetRef[]): NetRef {
    return refs.reduce((a, b) => this.gate('AND', a, b));
  }

  or(refs: NetRef[]): NetRef {
    return refs.reduce((a, b) => this.gate('OR', a, b));
  }

  circuit(): CircuitData {
    return { components: this.components, wires: this.wires };
  }
}

function retina(net: Netlist, width: number): NetRef[] {
  return Array.from({ length: width }, (_, i) => net.input(`IN${i + 1}`));
}

// ── CC perception: edge detector (≥3 consecutive 1s over 8 inputs) ──
// OUT1 = OR over every 3-window of AND(window bits).

export function perceptionEdgeCorrect(): CircuitData {
  const net = new Netlist('ped');
  const ins = retina(net, 8);
  const windows = Array.from({ length: 6 }, (_, p) => net.and([ins[p], ins[p + 1], ins[p + 2]]));
  net.output('OUT1', net.or(windows));
  return net.circuit();
}

// Wrong: fires on ANY stimulation (OR of all inputs) — e.g. fails on 10000000.
export function perceptionEdgeIncorrect(): CircuitData {
  const net = new Netlist('ped');
  const ins = retina(net, 8);
  net.output('OUT1', net.or(ins));
  return net.circuit();
}

// ── CC perception: object detector (EXACTLY 3 consecutive 1s) ──
// A maximal run of exactly 3: the window is all 1s and both neighbours
// (where they exist) are 0.

export function perceptionObjectCorrect(): CircuitData {
  const net = new Netlist('pob');
  const ins = retina(net, 8);
  const terms = Array.from({ length: 6 }, (_, p) => {
    const lits = [ins[p], ins[p + 1], ins[p + 2]];
    if (p > 0) lits.push(net.not(ins[p - 1]));
    if (p + 3 < 8) lits.push(net.not(ins[p + 3]));
    return net.and(lits);
  });
  net.output('OUT1', net.or(terms));
  return net.circuit();
}

// Wrong: the ≥3 edge detector — fails on a run of four (11110000).
export function perceptionObjectIncorrect(): CircuitData {
  return perceptionEdgeCorrect();
}

// ── CC perception: landmark recognition (input = 110010111, 9 inputs) ──
// AND over all nine literals, negating the wires the pattern holds at 0.

const LANDMARK = '110010111';

export function perceptionLandmarkCorrect(): CircuitData {
  const net = new Netlist('plm');
  const ins = retina(net, LANDMARK.length);
  net.output('OUT1', net.and(ins.map((r, i) => (LANDMARK[i] === '1' ? r : net.not(r)))));
  return net.circuit();
}

// Wrong: AND over all inputs — fires on 111111111, misses the landmark.
export function perceptionLandmarkIncorrect(): CircuitData {
  const net = new Netlist('plm');
  const ins = retina(net, LANDMARK.length);
  net.output('OUT1', net.and(ins));
  return net.circuit();
}

// ── SC perception: change detector (frame differs from previous frame) ──
// One MEM per wire remembers last cycle's frame; XOR each wire against its
// memory and OR the differences. MEMs start at 0, so the "previous input"
// before the first frame is the blank frame — exactly the grading convention.

export function perceptionChangeCorrect(): CircuitData {
  const net = new Netlist('pch');
  const ins = retina(net, 8);
  const diffs = ins.map((r, i) => net.gate('XOR', r, net.mem(`M${i + 1}`, r)));
  net.output('OUT1', net.or(diffs));
  return net.circuit();
}

// Wrong: memoryless OR of the current frame — fails on a held nonzero frame
// (says "change" forever) and on a change to the blank frame.
export function perceptionChangeIncorrect(): CircuitData {
  const net = new Netlist('pch');
  const ins = retina(net, 8);
  net.output('OUT1', net.or(ins));
  return net.circuit();
}

// ── SC perception: motion detector (3-long object moving up 1/step) ──
// matchNow(p) recognises "the frame is exactly one object at position p"
// (AND over all 8 literals); matchPrev(q) recognises the same on the MEM
// copy of the previous frame. Upward motion = object now at p, before at p+1.

export function perceptionMotionCorrect(): CircuitData {
  const net = new Netlist('pmo');
  const ins = retina(net, 8);
  const mems = ins.map((r, i) => net.mem(`M${i + 1}`, r));
  const exactObjectAt = (wires: NetRef[], p: number): NetRef =>
    net.and(wires.map((r, i) => (i >= p && i < p + 3 ? r : net.not(r))));
  const terms = Array.from({ length: 5 }, (_, p) =>
    net.gate('AND', exactObjectAt(ins, p), exactObjectAt(mems, p + 1)),
  );
  net.output('OUT1', net.or(terms));
  return net.circuit();
}

// Wrong: detects an object in the CURRENT frame only (no memory of where it
// was) — a static object reads as "moving".
export function perceptionMotionIncorrect(): CircuitData {
  const net = new Netlist('pmo');
  const ins = retina(net, 8);
  const exactObjectAt = (p: number): NetRef =>
    net.and(ins.map((r, i) => (i >= p && i < p + 3 ? r : net.not(r))));
  net.output('OUT1', net.or(Array.from({ length: 6 }, (_, p) => exactObjectAt(p))));
  return net.circuit();
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

  // Perception questions (bit-level grading, outside the codec): the five
  // problems from the perception homework specs — three CC (one frame) and
  // two SC (a frame per clock tick).
  const perceptionQuestion = (
    id: number,
    label: string,
    statement: string,
    rule: PerceptionRule,
    width: number,
  ): AssignmentQuestion => ({
    id,
    label,
    statement,
    buildMode: perceptionModeFor(rule),
    representation: 'binary',
    perception: { rule, width },
    perception_cases: buildPerceptionCases({ rule, width }),
  });

  const edgeQuestion = perceptionQuestion(
    9,
    'Q9 (CC perception)',
    'Edge detector. Design a machine (8 inputs, 1 output) that outputs 1 iff there is a string of at least three consecutive 1s anywhere in the input.',
    { kind: 'min-run', runLength: 3 },
    8,
  );
  const objectQuestion = perceptionQuestion(
    10,
    'Q10 (CC perception)',
    'Object detector. Design a machine (8 inputs, 1 output) that outputs 1 iff there is a string of exactly three consecutive 1s anywhere in the input.',
    { kind: 'exact-run', runLength: 3 },
    8,
  );
  const landmarkQuestion = perceptionQuestion(
    11,
    'Q11 (CC perception)',
    'Landmark recognition. Design a machine (9 inputs, 1 output) that outputs 1 iff the input = 110010111.',
    { kind: 'pattern', pattern: LANDMARK },
    LANDMARK.length,
  );
  const changeQuestion = perceptionQuestion(
    12,
    'Q12 (SC perception)',
    'Change detector. Design a sequential machine (8 inputs, 1 output) that outputs 1 iff the current input differs in any way from the previous input.',
    { kind: 'change' },
    8,
  );
  const motionQuestion = perceptionQuestion(
    13,
    'Q13 (SC perception)',
    'Motion detector. Let an object image be a string of exactly three consecutive 1s. Design a sequential machine (8 inputs, 1 output) that outputs 1 iff there is an object image anywhere in the input moving upwards 1 unit per unit of time.',
    { kind: 'motion', objectLength: 3 },
    8,
  );
  // Open (free-text) question: answered in prose, not autograded — the grader
  // marks it `pending` and the gradebook shows the response for manual review.
  const openQuestion: AssignmentQuestion = {
    id: 14,
    label: 'Q14 (Open)',
    statement:
      'Representational systems. Suppose you were designing a calculator for solving a ' +
      'high-stakes problem. (Perhaps "you" are Nature, the "calculator" is the Brain, and ' +
      'the "problem" is Survival.) Would you design it to calculate in binary or in tally? ' +
      'Why? Use specific examples to justify your answer. ~1 paragraph.',
    buildMode: 'open',
    representation: 'binary', // meaningless for open questions; type uniformity
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
      edgeQuestion,
      objectQuestion,
      landmarkQuestion,
      changeQuestion,
      motionQuestion,
      openQuestion,
    ],
  };
}

// ── Sample submissions ─────────────────────────────────────────
// One answer per machine question, in question-id order (1..13):
// CC, SC, FSM, TM, Turbot-CC, Turbot-SC, Turbot-FSM, Turbot-TM,
// then perception: edge, object, landmark, change, motion.
// Q14 (open) gets a free-text response instead of a circuit.

const SAMPLE_OPEN_RESPONSE =
  'I would design it to calculate in binary. A tally representation grows linearly with the ' +
  'value — representing 1,000,000 takes a million strokes — while binary grows with the ' +
  'logarithm, so twenty bits suffice. For a brain solving survival under tight energy and ' +
  'time budgets, compact codes mean fewer components, faster operations, and less to go ' +
  'wrong: an adder over 20 wires beats one over a million.';

function submission(
  student: string,
  circuits: CircuitData[],
  openResponse: string = SAMPLE_OPEN_RESPONSE,
): SubmissionData {
  return {
    assignmentTitle: SAMPLE_ASSIGNMENT_TITLE,
    student,
    submittedAt: '2026-06-27T12:00:00.000Z', // stamped by caller in real flow
    answers: [
      ...circuits.map((circuit, i) => ({ questionId: i + 1, circuit })),
      { questionId: 14, circuit: { components: [], wires: [] }, responseText: openResponse },
    ],
  };
}

function allCorrect(): CircuitData[] {
  return [
    ccCorrect(), scCorrect(), fsmCorrect(), tmCorrect(),
    turbotCorrect(), turbotScCorrect(), turbotFsmCorrect(), turbotTmCorrect(),
    perceptionEdgeCorrect(), perceptionObjectCorrect(), perceptionLandmarkCorrect(),
    perceptionChangeCorrect(), perceptionMotionCorrect(),
  ];
}

function allIncorrect(): CircuitData[] {
  return [
    ccIncorrect(), scIncorrect(), fsmIncorrect(), tmIncorrect(),
    turbotIncorrect(), turbotScIncorrect(), turbotFsmIncorrect(), turbotTmIncorrect(),
    perceptionEdgeIncorrect(), perceptionObjectIncorrect(), perceptionLandmarkIncorrect(),
    perceptionChangeIncorrect(), perceptionMotionIncorrect(),
  ];
}

/** All-correct submission (should score 13/13). */
export function buildCorrectSubmission(student = 'correct@example.com'): SubmissionData {
  return submission(student, allCorrect());
}

/** All-incorrect submission (should score 0/13; the open answer is left blank). */
export function buildIncorrectSubmission(student = 'wrong@example.com'): SubmissionData {
  return submission(student, allIncorrect(), '');
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
  const all = Array.from({ length: 13 }, (_, i) => i + 1);
  return [
    mixed('ada@example.com', all), // 13/13
    mixed('alan@example.com', all.filter((id) => id !== 2)), // 12/13 (SC wrong)
    mixed('grace@example.com', [1, 2, 5, 6, 9, 12]), // 6/13
    mixed('claude@example.com', []), // 0/13
    mixed('', all), // Anonymous, 13/13
  ];
}
