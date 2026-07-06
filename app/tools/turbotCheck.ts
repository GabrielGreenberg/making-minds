// Headless smoke test for the turbot engine and the grader's turbot branch.
//
//   cd app && npx tsx tools/turbotCheck.ts
//
// A turbot's brain is an ordinary CC/SC/FSM/TM circuit wired to a fixed
// 1-bit sensor / 2-bit motor interface (spec §9) — this exercises the
// arena driver loop (engine/turbot.ts) against a "move forward until
// blocked, then stop" brain built in each inner mode, plus the three
// success criteria (spec §12.5) and the grader's turbot branch.

import type {
  CircuitComponent,
  Wire,
  ArenaConfig,
  AssignmentData,
  SubmissionData,
} from '../src/types';
import { getPortsForType } from '../src/types';
import {
  runTurbot,
  evaluateTurbotCriterion,
  validateTurbotTM,
  validateTurbotFSM,
  TURBOT_FORWARD,
} from '../src/engine/turbot';
import { gradeSubmission } from '../src/engine/grader';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

function corridor(width: number, goalX: number): ArenaConfig {
  return {
    width,
    height: 1,
    cells: [Array.from({ length: width }, (_, x) => (x === goalX ? 'goal' : 'empty'))],
    start: { x: 0, y: 0, facing: 'E' },
  };
}

// ── CC brain: "move forward until blocked ahead, then stop" ─────────
// IN1 -> NOT -> OUT1, OUT2 (splitting one NOT to both motor bits: sensor=0 ->
// both bits 1 (forward); sensor=1 -> both bits 0 (stop)).
function ccForwardBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const inp: CircuitComponent = { id: 'in1', type: 'INPUT', x: 0, y: 0, label: 'IN1', ports: getPortsForType('INPUT') };
  const not1: CircuitComponent = { id: 'not1', type: 'NOT', x: 0, y: 0, label: 'NOT1', ports: getPortsForType('NOT') };
  const out1: CircuitComponent = { id: 'out1', type: 'OUTPUT', x: 0, y: 0, label: 'OUT1', ports: getPortsForType('OUTPUT') };
  const out2: CircuitComponent = { id: 'out2', type: 'OUTPUT', x: 0, y: 0, label: 'OUT2', ports: getPortsForType('OUTPUT') };
  return {
    components: [inp, not1, out1, out2],
    wires: [
      { id: 'w1', sourceComponentId: 'in1', sourcePortId: 'out', targetComponentId: 'not1', targetPortId: 'in', value: 0 },
      { id: 'w2', sourceComponentId: 'not1', sourcePortId: 'out', targetComponentId: 'out1', targetPortId: 'in', value: 0 },
      { id: 'w3', sourceComponentId: 'not1', sourcePortId: 'out', targetComponentId: 'out2', targetPortId: 'in', value: 0 },
    ],
  };
}

// ── FSM brain: same behavior, one state (S0 loops on itself). Turbot-FSM
// transitions output the FULL 2-bit motor code ("in:ij"): clear ahead → 11
// (forward), blocked → 00 (stop).
function fsmForwardBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const s0: CircuitComponent = { id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') };
  return {
    components: [s0],
    wires: [
      { id: 't1', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '0:11' },
      { id: 't2', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '1:00' },
    ],
  };
}

// ── FSM brain that TURNS: wall-follower — clear ahead → forward (11),
// blocked → turn left (01, right motor only). Never stops.
function fsmTurnerBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const s0: CircuitComponent = { id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') };
  return {
    components: [s0],
    wires: [
      { id: 't1', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '0:11' },
      { id: 't2', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '1:01' },
    ],
  };
}

// ── SC brain: "forward until blocked; first block → turn left; later block →
// stop". MEM M1 latches "have I ever been blocked" (m' = s OR m), so what the
// brain does at a wall depends on state carried across cycles: left wheel
// i = NOT s, right wheel j = (NOT s) OR (NOT m) — clear → 11 forward, first
// wall (m=0) → 01 turn left, any later wall (m=1) → 00 stop.
function scTurnerBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const c = (id: string, type: CircuitComponent['type'], label: string, extra: Partial<CircuitComponent> = {}): CircuitComponent =>
    ({ id, type, x: 0, y: 0, label, ports: getPortsForType(type), ...extra });
  const w = (id: string, src: string, srcPort: string, tgt: string, tgtPort: string): Wire =>
    ({ id, sourceComponentId: src, sourcePortId: srcPort, targetComponentId: tgt, targetPortId: tgtPort, value: 0 });
  return {
    components: [
      c('in1', 'INPUT', 'IN1'),
      c('m1', 'MEM', 'M1', { memDirection: 'right-to-left', storedValue: 0 }),
      c('nots', 'NOT', ''), // NOT s
      c('notm', 'NOT', ''), // NOT m
      c('orj', 'OR', ''),   // j = NOT s OR NOT m
      c('orm', 'OR', ''),   // m' = s OR m
      c('out1', 'OUTPUT', 'OUT1'),
      c('out2', 'OUTPUT', 'OUT2'),
    ],
    wires: [
      w('w1', 'in1', 'out', 'nots', 'in'),
      w('w2', 'nots', 'out', 'out1', 'in'),
      w('w3', 'nots', 'out', 'orj', 'in1'),
      w('w4', 'm1', 'mout', 'notm', 'in'),
      w('w5', 'notm', 'out', 'orj', 'in2'),
      w('w6', 'orj', 'out', 'out2', 'in'),
      w('w7', 'in1', 'out', 'orm', 'in1'),
      w('w8', 'm1', 'mout', 'orm', 'in2'),
      w('w9', 'orm', 'out', 'm1', 'min'),
    ],
  };
}

// A 3×3 "L" course: start SW corner facing E, goal NE corner. Reaching it
// takes a turn at the east wall — a memoryless forward-until-blocked brain
// stops short at (2,2).
function lArena(): ArenaConfig {
  return {
    width: 3,
    height: 3,
    cells: [
      ['empty', 'empty', 'goal'],
      ['empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty'],
    ],
    start: { x: 0, y: 2, facing: 'E' },
  };
}

// ── engine ────────────────────────────────────────────────────────
console.log('[engine: CC brain]');

const ccBrain = ccForwardBrain();
const runCC = runTurbot(ccBrain.components, ccBrain.wires, 'CC', corridor(3, 2), 10);
check('CC brain: moves forward to the wall then stops', runCC.haltedByMotor && runCC.finalState.x === 2 && runCC.finalState.y === 0);
check('CC brain: history has 3 cycles (2 forward, 1 stop)', runCC.history.length === 3);
check('reach-and-stop passes when goal == wall', evaluateTurbotCriterion(corridor(3, 2), runCC, 'reach-and-stop'));

const passThroughArena = corridor(3, 1); // goal mid-corridor, wall is at x=2
const runPassThrough = runTurbot(ccBrain.components, ccBrain.wires, 'CC', passThroughArena, 10);
check('pass-through passes when goal is mid-trace (not final)',
  runPassThrough.finalState.x === 2 && evaluateTurbotCriterion(passThroughArena, runPassThrough, 'pass-through'));
check('reach-and-stop fails when goal is not the final cell',
  !evaluateTurbotCriterion(passThroughArena, runPassThrough, 'reach-and-stop'));

const boxedArena: ArenaConfig = { width: 1, height: 1, cells: [['empty']], start: { x: 0, y: 0, facing: 'E' } };
const runBoxed = runTurbot(ccBrain.components, ccBrain.wires, 'CC', boxedArena, 10);
check('return-to-start passes for a turbot boxed in on all sides',
  runBoxed.haltedByMotor && evaluateTurbotCriterion(boxedArena, runBoxed, 'return-to-start'));

console.log('\n[engine: FSM brain]');
const fsmBrain = fsmForwardBrain();
const runFSM = runTurbot(fsmBrain.components, fsmBrain.wires, 'FSM', corridor(3, 2), 10);
check('FSM brain: same forward-until-wall behavior', runFSM.haltedByMotor && runFSM.finalState.x === 2);

// FSM brains can issue every motor command, turns included: in a 1×1 box the
// turner senses B every cycle and pivots left (E → N → W → S → …) forever.
const fsmTurner = fsmTurnerBrain();
const boxed1x1: ArenaConfig = { width: 1, height: 1, cells: [['empty']], start: { x: 0, y: 0, facing: 'E' } };
const runTurner = runTurbot(fsmTurner.components, fsmTurner.wires, 'FSM', boxed1x1, 4);
check('FSM brain can turn: 01 pivots the turbot left each cycle',
  runTurner.history.map((h) => h.facing).join('') === 'NWSE' &&
  runTurner.history.every((h) => h.action === 'left'));
check('a never-stopping FSM turner runs to the step limit', runTurner.hitStepLimit);

console.log('\n[engine: SC brain]');
// The stateful turner threads the L course: east to the wall, one left turn
// (MEM latches the block), north to the goal, stop at the second wall.
const scBrain = scTurnerBrain();
const runSC = runTurbot(scBrain.components, scBrain.wires, 'SC', lArena(), 20);
check('SC brain: turns the corner and stops on the goal',
  runSC.haltedByMotor && runSC.finalState.x === 2 && runSC.finalState.y === 0);
check('SC brain: MEM state picks the action at each wall (turn, then stop)',
  runSC.history.map((h) => h.action).join(',') === 'forward,forward,left,forward,forward,stop');
check('SC turner satisfies reach-and-stop on the L course',
  evaluateTurbotCriterion(lArena(), runSC, 'reach-and-stop'));

// The same NOT-split circuit run as an SC brain (no MEM) is memoryless: it
// stops at the first wall, short of the corner goal.
const runSCMemoryless = runTurbot(ccForwardBrain().components, ccForwardBrain().wires, 'SC', lArena(), 20);
check('memoryless SC brain stops short at the east wall',
  runSCMemoryless.haltedByMotor && runSCMemoryless.finalState.x === 2 && runSCMemoryless.finalState.y === 2);
check('memoryless SC brain fails reach-and-stop on the L course',
  !evaluateTurbotCriterion(lArena(), runSCMemoryless, 'reach-and-stop'));

console.log('\n[turbot FSM validation]');
check('2-bit-output FSM table validates',
  validateTurbotFSM(fsmBrain.components, fsmBrain.wires).length === 0);
const oneBitFsm = {
  components: [{ id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') } as CircuitComponent],
  wires: [
    tWire('t1', 's0', 's0', '0:1'), // base-FSM single output bit — not turbot-FSM grammar
    tWire('t2', 's0', 's0', '1:00'),
  ],
};
check('base-FSM one-bit label is rejected (and input 0 left unhandled)',
  validateTurbotFSM(oneBitFsm.components, oneBitFsm.wires).length > 0);
const partialFsm = {
  components: [{ id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') } as CircuitComponent],
  wires: [tWire('t1', 's0', 's0', '0:11')],
};
check('FSM table missing an input transition is rejected (must be total)',
  validateTurbotFSM(partialFsm.components, partialFsm.wires).length > 0);

console.log('\n[engine: step limit]');
const infiniteArena = corridor(1000, 999);
const runLimited = runTurbot(ccBrain.components, ccBrain.wires, 'CC', infiniteArena, 5);
check('hits the step limit before reaching a far wall', runLimited.hitStepLimit && !runLimited.haltedByMotor);

// ── Turbot TM (textbook "Turbots: Operation") ───────────────────
// The textbook's example machine, plus an F transition so it can walk onto
// food: S₀ (external) E:↑ / F:↑ → S₁; S₁ (internal) 0:1 → S₂ (write, head
// stays); S₂ (internal) 1:L → S₀ (move, cells stay). It moves forward and
// records a "1" each time; at a wall S₀ senses B, has no transition, halts.
function stateComp(id: string, label: string, kind: 'internal' | 'external'): CircuitComponent {
  return { id, type: 'STATE', x: 0, y: 0, label, ports: getPortsForType('STATE'), stateKind: kind };
}
function tWire(id: string, src: string, tgt: string, transitionLabel: string): Wire {
  return {
    id, sourceComponentId: src, sourcePortId: 'right',
    targetComponentId: tgt, targetPortId: 'left', value: 0, transitionLabel,
  };
}
function turbotTmWalker(): { components: CircuitComponent[]; wires: Wire[] } {
  return {
    components: [
      stateComp('s0', 'S₀', 'external'),
      stateComp('s1', 'S₁', 'internal'),
      stateComp('s2', 'S₂', 'internal'),
    ],
    wires: [
      tWire('t1', 's0', 's1', `E:${TURBOT_FORWARD}`),
      tWire('t2', 's0', 's1', `F:${TURBOT_FORWARD}`),
      tWire('t3', 's1', 's2', '0:1'),
      tWire('t4', 's2', 's0', '1:L'),
    ],
  };
}

console.log('\n[engine: turbot TM]');
const tmArena = corridor(4, 3); // 1×4 corridor, food against the east wall
const runTM = runTurbot(turbotTmWalker().components, turbotTmWalker().wires, 'TM', tmArena, 50);
check('turbot TM walks to the food and halts there',
  runTM.haltedByBrain && runTM.stopped && runTM.finalState.x === 3 && runTM.finalState.y === 0);
check('halting IS stopping for a turbot TM: reach-and-stop passes',
  evaluateTurbotCriterion(tmArena, runTM, 'reach-and-stop'));
check('each transition is one step: 3 moves × 3 transitions = 9',
  runTM.history.length === 9);
check('internal steps leave the pose unchanged',
  runTM.history[1].kind === 'internal' && runTM.history[1].x === runTM.history[0].x);
check('the walker records a 1 per forward move (3 ones on the tape)',
  runTM.history.filter((h) => h.action === 'write 1').length === 3);
check('external steps carry B/E/F senses', runTM.history[0].input === 'E' && runTM.history[0].kind === 'external');

// Food is passable: the turbot walked THROUGH nothing here, but ends ON the
// food cell — moving onto food must be allowed.
check('turbot can move onto food', runTM.finalState.x === 3);

console.log('\n[turbot TM validation]');
check('walker validates', validateTurbotTM(turbotTmWalker().components, turbotTmWalker().wires).length === 0);
const dualActionOnInternal = {
  components: [stateComp('s0', 'S₀', 'internal')],
  wires: [tWire('t1', 's0', 's0', '0:0R')], // base-TM dual action — not turbot-TM grammar
};
check('dual-action label on an internal state is rejected',
  validateTurbotTM(dualActionOnInternal.components, dualActionOnInternal.wires).length > 0);
const externalLabelOnInternal = {
  components: [stateComp('s0', 'S₀', 'internal')],
  wires: [tWire('t1', 's0', 's0', `E:${TURBOT_FORWARD}`)],
};
check('external label on an internal state is rejected',
  validateTurbotTM(externalLabelOnInternal.components, externalLabelOnInternal.wires).length > 0);
const ambiguousExternal = {
  components: [stateComp('s0', 'S₀', 'external'), stateComp('s1', 'S₁', 'internal')],
  wires: [tWire('t1', 's0', 's1', `E:${TURBOT_FORWARD}`), tWire('t2', 's0', 's1', 'E:↱')],
};
check('two transitions on the same sense are rejected',
  validateTurbotTM(ambiguousExternal.components, ambiguousExternal.wires).length > 0);

// The question's encoding picks the internal alphabet: binary {0,1,*},
// unary {0,1} — a label mentioning * is only legal under binary.
const starUser = {
  components: [stateComp('s0', 'S₀', 'internal')],
  wires: [tWire('t1', 's0', 's0', '0:*')],
};
check('a * label validates under the binary encoding',
  validateTurbotTM(starUser.components, starUser.wires, 'binary').length === 0);
check('a * label is rejected under the unary encoding',
  validateTurbotTM(starUser.components, starUser.wires, 'unary').length > 0);
check('a *-free table validates under the unary encoding',
  validateTurbotTM(turbotTmWalker().components, turbotTmWalker().wires, 'unary').length === 0);

console.log('\n[grader: turbot TM]');
const tmAssignment: AssignmentData = {
  id: 'turbot-tm-smoke',
  title: 'Turbot TM smoke',
  questions: [{
    id: 1,
    label: 'Q1 (Turbot TM)',
    statement: 'Walk forward to the food, recording a 1 per move.',
    buildMode: 'turbot',
    innerMode: 'TM',
    representation: 'tally',
    turbot_cases: [{ arena: corridor(4, 3), maxSteps: 50, criterion: 'reach-and-stop' }],
  }],
};
const tmCorrectSub: SubmissionData = {
  assignmentTitle: 'Turbot TM smoke',
  student: 'tm@example.com',
  submittedAt: '2026-07-05T00:00:00Z',
  answers: [{ questionId: 1, circuit: turbotTmWalker() }],
};
const tmGraded = gradeSubmission(tmAssignment, tmCorrectSub);
check('turbot TM walker passes reach-and-stop',
  tmGraded.questions[0].status === 'graded' && tmGraded.questions[0].passed === 1);

// An internal spinner (0:R forever) never halts → step limit → fail.
const spinner = {
  components: [stateComp('s0', 'S₀', 'internal')],
  wires: [tWire('t1', 's0', 's0', '0:R')],
};
const tmSpinnerSub: SubmissionData = { ...tmCorrectSub, student: 'spin@example.com', answers: [{ questionId: 1, circuit: spinner }] };
const tmSpinnerGraded = gradeSubmission(tmAssignment, tmSpinnerSub);
check('non-halting turbot TM fails on the step limit',
  tmSpinnerGraded.questions[0].passed === 0 &&
  tmSpinnerGraded.questions[0].turbotCases?.[0]?.hitStepLimit === true);

// A dual-action table fails Stage-1 validation (every case rejected).
const tmInvalidSub: SubmissionData = { ...tmCorrectSub, student: 'invalid@example.com', answers: [{ questionId: 1, circuit: dualActionOnInternal }] };
const tmInvalidGraded = gradeSubmission(tmAssignment, tmInvalidSub);
check('dual-action table fails validation with a reason',
  tmInvalidGraded.questions[0].passed === 0 &&
  !!tmInvalidGraded.questions[0].turbotCases?.[0]?.reason);

// The tally question grades under the unary encoding, so a * table is
// rejected at Stage 1 even though it would be a legal binary machine.
const tmStarSub: SubmissionData = { ...tmCorrectSub, student: 'star@example.com', answers: [{ questionId: 1, circuit: starUser }] };
const tmStarGraded = gradeSubmission(tmAssignment, tmStarSub);
check('grading respects the encoding: * table fails a unary (tally) question',
  tmStarGraded.questions[0].passed === 0 &&
  !!tmStarGraded.questions[0].turbotCases?.[0]?.reason);

// ── grader ─────────────────────────────────────────────────────
console.log('\n[grader]');
const assignment: AssignmentData = {
  id: 'turbot-smoke',
  title: 'Turbot smoke',
  questions: [{
    id: 1,
    label: 'Q1 (turbot)',
    statement: 'Move forward until you hit the goal, then stop.',
    buildMode: 'turbot',
    innerMode: 'CC',
    representation: 'binary',
    turbot_cases: [
      { arena: corridor(3, 2), maxSteps: 10, criterion: 'reach-and-stop' },
      { arena: corridor(4, 3), maxSteps: 10, criterion: 'reach-and-stop' },
    ],
  }],
};

function sub(student: string, circuit: { components: CircuitComponent[]; wires: Wire[] }): SubmissionData {
  return {
    assignmentTitle: 'Turbot smoke',
    student,
    submittedAt: '2026-07-05T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  };
}

const correct = gradeSubmission(assignment, sub('correct@example.com', ccForwardBrain()));
check('correct turbot: all cases pass', correct.questions[0].status === 'graded' &&
  correct.questions[0].passed === 2 && correct.questions[0].total === 2);

// Wrong brain: always outputs "left" (turn in place forever) — never reaches the goal.
function neverMovesBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const inp: CircuitComponent = { id: 'in1', type: 'INPUT', x: 0, y: 0, label: 'IN1', ports: getPortsForType('INPUT') };
  const out1: CircuitComponent = { id: 'out1', type: 'OUTPUT', x: 0, y: 0, label: 'OUT1', ports: getPortsForType('OUTPUT') };
  const out2: CircuitComponent = { id: 'out2', type: 'OUTPUT', x: 0, y: 0, label: 'OUT2', ports: getPortsForType('OUTPUT') };
  // OUT1 unwired (reads 0), IN1 -> OUT2 directly: sensor=0 ahead -> bits (0,0)=stop; not useful either way,
  // but never satisfies reach-and-stop away from the start since the turbot never moves.
  return {
    components: [inp, out1, out2],
    wires: [
      { id: 'w1', sourceComponentId: 'in1', sourcePortId: 'out', targetComponentId: 'out2', targetPortId: 'in', value: 0 },
    ],
  };
}
const wrong = gradeSubmission(assignment, sub('wrong@example.com', neverMovesBrain()));
check('wrong turbot: fails cases', wrong.questions[0].status === 'graded' && wrong.questions[0].passed === 0);
check('wrong turbot: turbotCases carries per-case detail', (wrong.questions[0].turbotCases ?? []).length === 2);

// ── grader: FSM-brained turbot question ────────────────────────
console.log('\n[grader: turbot FSM]');
const fsmAssignment: AssignmentData = {
  id: 'turbot-fsm-smoke',
  title: 'Turbot FSM smoke',
  questions: [{
    id: 1,
    label: 'Q1 (Turbot FSM)',
    statement: 'Move forward until you hit the goal, then stop.',
    buildMode: 'turbot',
    innerMode: 'FSM',
    representation: 'binary',
    turbot_cases: [
      { arena: corridor(3, 2), maxSteps: 10, criterion: 'reach-and-stop' },
      { arena: corridor(4, 3), maxSteps: 10, criterion: 'reach-and-stop' },
    ],
  }],
};
function fsmSub(student: string, circuit: { components: CircuitComponent[]; wires: Wire[] }): SubmissionData {
  return {
    assignmentTitle: 'Turbot FSM smoke',
    student,
    submittedAt: '2026-07-06T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  };
}
const fsmGraded = gradeSubmission(fsmAssignment, fsmSub('fsm@example.com', fsmForwardBrain()));
check('correct FSM turbot: all cases pass',
  fsmGraded.questions[0].status === 'graded' && fsmGraded.questions[0].passed === 2 && fsmGraded.questions[0].total === 2);

// The turner never issues 00, so it pivots at the wall forever → step limit.
const fsmTurnerGraded = gradeSubmission(fsmAssignment, fsmSub('turner@example.com', fsmTurnerBrain()));
check('never-stopping FSM turbot fails on the step limit',
  fsmTurnerGraded.questions[0].passed === 0 &&
  fsmTurnerGraded.questions[0].turbotCases?.every((c) => c.hitStepLimit) === true);

// A non-total table (input 1 unhandled) fails Stage-1 validation with a reason.
const fsmPartialGraded = gradeSubmission(fsmAssignment, fsmSub('partial@example.com', partialFsm));
check('partial FSM table fails validation with a reason',
  fsmPartialGraded.questions[0].passed === 0 &&
  !!fsmPartialGraded.questions[0].turbotCases?.[0]?.reason);

// ── grader: SC-brained turbot question ─────────────────────────
console.log('\n[grader: turbot SC]');
const scAssignment: AssignmentData = {
  id: 'turbot-sc-smoke',
  title: 'Turbot SC smoke',
  questions: [{
    id: 1,
    label: 'Q1 (Turbot SC)',
    statement: 'Walk the L course: turn left at the first wall, stop at the goal.',
    buildMode: 'turbot',
    innerMode: 'SC',
    representation: 'binary',
    turbot_cases: [{ arena: lArena(), maxSteps: 20, criterion: 'reach-and-stop' }],
  }],
};
function scSub(student: string, circuit: { components: CircuitComponent[]; wires: Wire[] }): SubmissionData {
  return {
    assignmentTitle: 'Turbot SC smoke',
    student,
    submittedAt: '2026-07-06T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  };
}
const scGraded = gradeSubmission(scAssignment, scSub('sc@example.com', scTurnerBrain()));
check('correct SC turbot (MEM turner) passes the L course',
  scGraded.questions[0].status === 'graded' && scGraded.questions[0].passed === 1 && scGraded.questions[0].total === 1);

const scMemorylessGraded = gradeSubmission(scAssignment, scSub('nomem@example.com', ccForwardBrain()));
check('memoryless SC turbot fails the L course',
  scMemorylessGraded.questions[0].passed === 0 &&
  (scMemorylessGraded.questions[0].turbotCases ?? []).length === 1);

console.log(`\n${failures === 0 ? 'TURBOT CHECK OK' : `TURBOT CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
