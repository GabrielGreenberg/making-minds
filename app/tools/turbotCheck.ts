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
  TurbotHistoryEntry,
  TurbotOrientation,
} from '../src/types';
import { getPortsForType } from '../src/types';
import {
  runTurbot,
  evaluateTurbotCriterion,
  validateTurbotTM,
  validateTurbotFSM,
  TURBOT_FORWARD,
  type TurbotRunResult,
} from '../src/engine/turbot';
import { gradeSubmission, summarizeResult } from '../src/engine/grader';
import { gradeSubmissions } from '../src/instructor/Gradebook';

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

// ── ONE validity function for turbot-FSM labels (P1.12) ─────────────
// turbotFsmNotation (engine/notation.ts) is the single answer to "is this
// turbot-FSM brain label legal" — grader Stage-1 (via validateTurbotFSM),
// runBrainStep, and the store's label editor all read it. Legacy 1-bit
// outputs ('0:1' forward, '1:0' stop) alias to the canonical 2-bit motor
// spelling ('0:11'/'1:00'); a brain written in either spelling must validate
// and run bit-identically, and canonical turn labels ('01' left / '10'
// right) execute via the same wheel-bit table as circuit brains (spec §9.2).
console.log('\n[engine: turbot-FSM one-notation validity]');
function fsmForwardBrainLegacy(): { components: CircuitComponent[]; wires: Wire[] } {
  const s0: CircuitComponent = { id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') };
  return {
    components: [s0],
    wires: [
      { id: 't1', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '0:1' },
      { id: 't2', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '1:0' },
    ],
  };
}
{
  const legacy = fsmForwardBrainLegacy();
  const runLegacy = runTurbot(legacy.components, legacy.wires, 'FSM', corridor(3, 2), 10);
  check('legacy 1-bit alias labels behave bit-identically to the canonical 2-bit brain',
    runLegacy.haltedByMotor && runLegacy.finalState.x === runFSM.finalState.x &&
    runLegacy.history.length === runFSM.history.length);

  const notationAssignment: AssignmentData = {
    id: 'turbot-fsm-notation-smoke',
    title: 'Turbot FSM notation smoke',
    questions: [{
      id: 1,
      label: 'Q1 (turbot FSM)',
      statement: 'Move forward until blocked, then stop on the goal.',
      buildMode: 'turbot',
      innerMode: 'FSM',
      representation: 'binary',
      turbot_cases: [{ arena: corridor(3, 2), maxSteps: 10, criterion: 'reach-and-stop' }],
    }],
  };
  const gradeBrain = (circuit: { components: CircuitComponent[]; wires: Wire[] }) =>
    gradeSubmission(notationAssignment, {
      assignmentTitle: notationAssignment.title,
      student: 'fsm-notation@example.com',
      submittedAt: '2026-07-06T00:00:00Z',
      answers: [{ questionId: 1, circuit }],
    }).questions[0];
  check('grader accepts the legacy-alias brain', gradeBrain(legacy).passed === 1);
  check('grader accepts the canonical-label brain', gradeBrain(fsmForwardBrain()).passed === 1);

  const canonWires = fsmForwardBrain().wires;
  const badLabel = {
    components: fsmForwardBrain().components,
    wires: [{ ...canonWires[0] }, { ...canonWires[1], transitionLabel: '1:2' }],
  };
  const badResult = gradeBrain(badLabel);
  check('an illegal turbot-FSM label fails Stage-1 with a reason',
    badResult.passed === 0 && !!badResult.turbotCases?.[0]?.reason);

  // Canonical turn labels now execute: '0:01' = right wheel only = pivot left.
  const spinner: { components: CircuitComponent[]; wires: Wire[] } = {
    components: [{ id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') }],
    wires: [
      { id: 't1', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '0:01' },
      { id: 't2', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '1:01' },
    ],
  };
  const runSpin = runTurbot(spinner.components, spinner.wires, 'FSM', corridor(3, 2), 4);
  check('canonical turn label pivots in place (left turns, no movement)',
    runSpin.hitStepLimit && runSpin.finalState.x === 0 &&
    runSpin.history.every((h) => h.action === 'left'));
}

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
    tWire('t1', 's0', 's0', '0:1'), // base-FSM single output bit — a legacy alias of '0:11'
    tWire('t2', 's0', 's0', '1:00'),
  ],
};
// Legacy 1-bit outputs are ALIASES of the canonical 2-bit motor spelling
// (turbotFsmNotation, P1.12) — old localStorage machines keep validating.
check('a legacy one-bit label is accepted as an alias (input 0 is handled)',
  validateTurbotFSM(oneBitFsm.components, oneBitFsm.wires).length === 0);
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

// ── pass-through vs the step limit (P4.3) ───────────────────────────
// The step limit bounds SIMULATION; whether a truncated run fails is the
// criterion's call (criterionRequiresStop, engine/turbot.ts). pass-through
// is trace-satisfiable — HW2 §III's Pac-Man rule: the turbot completes
// navigation by CROSSING the goal and "need not stop" — and a memoryless CC
// brain can never emit motor 00, so every CC pass-through run ends at the
// step limit. Truncation must not trump a criterion the trace satisfied.
// Stop-requiring criteria (reach-and-stop; return-to-start) keep failing
// outright on truncation: the turbot never came to rest.
console.log('\n[pass-through step-limit]');
{
  const gradeOneCase = (
    innerMode: 'CC' | 'FSM',
    circuit: { components: CircuitComponent[]; wires: Wire[] },
    arena: ArenaConfig,
    criterion: 'reach-and-stop' | 'pass-through' | 'return-to-start',
    maxSteps: number
  ) => {
    const a: AssignmentData = {
      id: 'step-limit-smoke',
      title: 'Step-limit smoke',
      questions: [{
        id: 1,
        label: 'Q1 (step limit)',
        statement: 'Criterion vs step limit.',
        buildMode: 'turbot',
        innerMode,
        representation: 'binary',
        turbot_cases: [{ arena, maxSteps, criterion }],
      }],
    };
    const r = gradeSubmission(a, {
      assignmentTitle: a.title,
      student: 'steplimit@example.com',
      submittedAt: '2026-07-07T00:00:00Z',
      answers: [{ questionId: 1, circuit }],
    }).questions[0];
    return { passed: r.passed, case: r.turbotCases?.[0] };
  };

  // (i) A never-stopping brain whose trace crosses the goal PASSES a
  // pass-through arena despite hitStepLimit. The FSM turner (never emits 00)
  // walks over the mid-corridor goal, then pivots at the east wall forever.
  const turnerPass = gradeOneCase('FSM', fsmTurnerBrain(), corridor(4, 2), 'pass-through', 12);
  check('never-stopping FSM turner passes pass-through despite the step limit',
    turnerPass.passed === 1 && turnerPass.case?.pass === true && turnerPass.case?.hitStepLimit === true);
  check('a criterion-satisfied step-limited case carries no misleading reason',
    turnerPass.case?.reason === undefined);
  // The hw2-p13 exhibit shape: a memoryless CC reflex brain truncated long
  // before any wall (it CANNOT stop within budget) still passes on the trace.
  const ccPass = gradeOneCase('CC', ccForwardBrain(), corridor(1000, 2), 'pass-through', 5);
  check('memoryless CC brain truncated mid-corridor passes pass-through on the trace',
    ccPass.passed === 1 && ccPass.case?.pass === true && ccPass.case?.hitStepLimit === true);

  // (ii) A never-stopping brain that never crosses the goal still FAILS —
  // and the reason names the criterion, not the step limit (the limit is
  // not why it failed; the trace is). A block seals the goal off: the
  // turner pivots at the start forever.
  const sealedArena: ArenaConfig = {
    width: 3,
    height: 1,
    cells: [['empty', 'block', 'goal']],
    start: { x: 0, y: 0, facing: 'E' },
  };
  const turnerFail = gradeOneCase('FSM', fsmTurnerBrain(), sealedArena, 'pass-through', 12);
  check('never-stopping turner that never crosses the goal still fails',
    turnerFail.passed === 0 && turnerFail.case?.pass === false && turnerFail.case?.hitStepLimit === true);
  check('the failure reason names the criterion, not the step limit',
    turnerFail.case?.reason === "'pass-through' criterion not satisfied within max steps");

  // (iii) reach-and-stop + hitStepLimit still fails even though the trace
  // visited the goal: the criterion judges the END of the run.
  const reachFail = gradeOneCase('FSM', fsmTurnerBrain(), corridor(4, 2), 'reach-and-stop', 12);
  check('reach-and-stop still fails a step-limited run even with the goal in-trace',
    reachFail.passed === 0 && reachFail.case?.hitStepLimit === true && reachFail.case?.reason === 'exceeded max steps');

  // (iv) return-to-start + hitStepLimit still fails — even pivoting in place
  // ON the start cell: truncation means the turbot never came to rest there.
  const returnFail = gradeOneCase('FSM', fsmTurnerBrain(), boxed1x1, 'return-to-start', 8);
  check('return-to-start still fails a step-limited run even sitting on the start',
    returnFail.passed === 0 && returnFail.case?.hitStepLimit === true && returnFail.case?.reason === 'exceeded max steps');
}

// ── multi-arena: navigation grading requires EVERY arena (P4.2) ──────
// Navigation problems promise generality — Mad Max (hw3-p15) puts the block
// at an UNKNOWN distance, so a question's `turbot_cases` is a FAMILY of
// arenas and a brain hardcoded to one layout must fail the family. The
// family here: 1×8 corridor, block at x = 3 / 5 / 7, the "sensing spot"
// (goal cell) just before it at x = 2 / 4 / 6; criterion return-to-start
// (whose goal-visit clause — the trace must reach the goal before coming
// home — is what makes an out-and-back family discriminating at all: final
// position alone is satisfied by a brain that never leaves).
console.log('\n[multi-arena: hardcoded brains fail the family]');

function madMaxArena(blockX: number): ArenaConfig {
  return {
    width: 8,
    height: 1,
    cells: [Array.from({ length: 8 }, (_, x) =>
      (x === blockX ? 'block' : x === blockX - 1 ? 'goal' : 'empty'))],
    start: { x: 0, y: 0, facing: 'E' },
  };
}

// Hardcoded layout-solver: walk exactly n forward (blind — both sensor
// inputs drive forward), two left turns, walk n back, stop. Solves every
// layout whose sensing spot is within n cells; knows nothing about blocks.
function hardcodedOutAndBack(n: number): { components: CircuitComponent[]; wires: Wire[] } {
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  const motors = [
    ...Array.from({ length: n }, () => '11'), // out n
    '01', '01',                               // U-turn (two left pivots)
    ...Array.from({ length: n }, () => '11'), // back n
    '00',                                     // stop
  ];
  motors.forEach((motor, i) => {
    const id = `s${i}`;
    const next = i + 1 < motors.length ? `s${i + 1}` : id; // last state self-loops
    components.push({ id, type: 'STATE', x: 0, y: 0, label: `S${i}`, ports: getPortsForType('STATE') });
    wires.push(tWire(`${id}a`, id, next, `0:${motor}`), tWire(`${id}b`, id, next, `1:${motor}`));
  });
  return { components, wires };
}

// Sensor-reactive Mad Max: forward until block ahead, U-turn, forward until
// boundary ahead, stop — 3 states, distance-agnostic.
function madMaxBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const s = (id: string, label: string): CircuitComponent =>
    ({ id, type: 'STATE', x: 0, y: 0, label, ports: getPortsForType('STATE') });
  return {
    components: [s('s0', 'S₀'), s('s1', 'S₁'), s('s2', 'S₂')],
    wires: [
      tWire('m1', 's0', 's0', '0:11'), tWire('m2', 's0', 's1', '1:01'),
      tWire('m3', 's1', 's2', '0:01'), tWire('m4', 's1', 's2', '1:01'),
      tWire('m5', 's2', 's2', '0:11'), tWire('m6', 's2', 's2', '1:00'),
    ],
  };
}

// The trivial exploit: stop on the first cycle, never move.
function lazyBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  return {
    components: [{ id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') }],
    wires: [tWire('l1', 's0', 's0', '0:00'), tWire('l2', 's0', 's0', '1:00')],
  };
}

function madMaxAssignment(blockXs: number[]): AssignmentData {
  return {
    id: 'madmax-family',
    title: 'Mad Max family',
    questions: [{
      id: 1,
      label: 'Q1 (Mad Max)',
      statement: 'Drive to the block (unknown distance), then return to start and stop.',
      buildMode: 'turbot',
      innerMode: 'FSM',
      representation: 'binary',
      turbot_cases: blockXs.map((b) => ({ arena: madMaxArena(b), maxSteps: 30, criterion: 'return-to-start' as const })),
    }],
  };
}
function gradeFamily(blockXs: number[], circuit: { components: CircuitComponent[]; wires: Wire[] }) {
  return gradeSubmission(madMaxAssignment(blockXs), {
    assignmentTitle: 'Mad Max family',
    student: 'family@example.com',
    submittedAt: '2026-07-07T00:00:00Z',
    answers: [{ questionId: 1, circuit }],
  });
}

// (i) The hardcoded brain PASSES the 1-arena family — a single layout
// cannot tell a layout-solver from a navigator.
const hard2Solo = gradeFamily([3], hardcodedOutAndBack(2));
check('hardcoded out-2-back-2 brain passes the 1-arena family (1/1)',
  hard2Solo.questions[0].passed === 1 && hard2Solo.questions[0].total === 1 &&
  summarizeResult(hard2Solo).questionsPassed === 1);

// (ii) The SAME brain FAILS the 3-arena family: it never reaches the
// sensing spot at distance 4 or 6.
const hard2Family = gradeFamily([3, 5, 7], hardcodedOutAndBack(2));
check('the same hardcoded brain fails the 3-arena family (1/3)',
  hard2Family.questions[0].passed === 1 && hard2Family.questions[0].total === 3);
check('a partially-passing family does not pass the question',
  summarizeResult(hard2Family).questionsPassed === 0);

// (iii) Per-arena results identify the failing arenas with full detail.
const hard2Cases = hard2Family.questions[0].turbotCases ?? [];
check('per-arena results: one TurbotCaseResult per arena (3)',
  hard2Cases.length === 3);
check('per-arena results: arena #1 passes, arenas #2 and #3 fail',
  hard2Cases[0]?.pass === true && hard2Cases[1]?.pass === false && hard2Cases[2]?.pass === false);
check('failing arenas carry steps + final pose (returned home without visiting the goal)',
  hard2Cases.slice(1).every((c) =>
    c.stepsTaken === 7 && c.finalPosition.x === 0 && c.finalPosition.y === 0 && c.hitStepLimit === false));
// P5.3: a clean halt-at-start that skipped the goal is a criterion failure
// and must SAY so — no reason-less failed arenas in the drill-down.
check('failing family arenas carry the criterion-named goal-visit reason',
  hard2Cases.slice(1).every((c) =>
    c.reason === "'return-to-start' criterion not satisfied: goal cell never visited"));
check('the passing family arena carries no reason', hard2Cases[0]?.reason === undefined);

// (iv) All-must-pass aggregation: a brain tuned to distance 4 clears two
// layouts (its blind walk overshoots distance 2 but still crosses the goal)
// yet 2/3 arenas is NOT a pass.
const hard4Family = gradeFamily([3, 5, 7], hardcodedOutAndBack(4));
check('distance-4 hardcoded brain passes exactly 2 of 3 arenas',
  hard4Family.questions[0].passed === 2 && hard4Family.questions[0].total === 3 &&
  hard4Family.questions[0].turbotCases?.[2]?.pass === false);
check('2/3 arenas is not a pass (all arenas required)',
  summarizeResult(hard4Family).questionsPassed === 0);

// The sensor-reactive navigator the family is asking for passes everywhere.
const madMaxFamily = gradeFamily([3, 5, 7], madMaxBrain());
check('sensor-reactive Mad Max brain passes all 3 arenas',
  madMaxFamily.questions[0].passed === 3 && madMaxFamily.questions[0].total === 3 &&
  summarizeResult(madMaxFamily).questionsPassed === 1);

// Criterion teeth: with a goal in the arena, return-to-start requires the
// trace to VISIT it — the never-moving brain no longer passes vacuously.
// (Goal-less arenas keep plain end-at-start: the boxed-arena check above.)
const lazyFamily = gradeFamily([3, 5, 7], lazyBrain());
check('stop-immediately brain fails every goal-ful return-to-start arena (0/3)',
  lazyFamily.questions[0].passed === 0 && lazyFamily.questions[0].total === 3);

// Gradebook logic consumes the SAME per-arena counts: the question grade is
// all-or-nothing and every failing arena is counted (not just index 0).
const gradebookGrades = gradeSubmissions(madMaxAssignment([3, 5, 7]), [{
  assignmentId: 'madmax-family',
  attempt: 1,
  submittedAt: '2026-07-07T00:00:00Z',
  submission: {
    assignmentTitle: 'Mad Max family',
    student: 'family@example.com',
    submittedAt: '2026-07-07T00:00:00Z',
    answers: [{ questionId: 1, circuit: hardcodedOutAndBack(2) }],
  },
}]);
check('gradebook: hardcoded brain scores 0 on the family (question not passed)',
  gradebookGrades[0].grades[0].passed === false && gradebookGrades[0].score === 0);
check('gradebook: both failing arenas are counted (failedCount 2 of 3)',
  gradebookGrades[0].grades[0].failedCount === 2);

// ── failure reasons: every failing arena explains itself (P5.3) ──────
// A clean halt that just doesn't satisfy its criterion (no step limit, no
// dead brain) used to yield reason: undefined — the Desert Ant shape
// (hw6-p2 members 2/3: halt at the start, goal never visited). Now every
// failing TurbotCaseResult names its criterion via
// explainTurbotCriterionFailure; passing cases still carry none.
console.log('\n[failure reasons name the criterion]');
{
  const gradeOne = (
    circuit: { components: CircuitComponent[]; wires: Wire[] },
    arena: ArenaConfig,
    criterion: 'reach-and-stop' | 'pass-through' | 'return-to-start'
  ) => {
    const a: AssignmentData = {
      id: 'reason-smoke',
      title: 'Reason smoke',
      questions: [{
        id: 1,
        label: 'Q1 (reasons)',
        statement: 'Every failing arena explains itself.',
        buildMode: 'turbot',
        innerMode: 'FSM',
        representation: 'binary',
        turbot_cases: [{ arena, maxSteps: 50, criterion }],
      }],
    };
    return gradeSubmission(a, {
      assignmentTitle: a.title,
      student: 'reasons@example.com',
      submittedAt: '2026-07-07T00:00:00Z',
      answers: [{ questionId: 1, circuit }],
    }).questions[0].turbotCases![0];
  };

  // reach-and-stop, clean stop off the goal: the forward brain drives past
  // the mid-corridor goal and parks at the far wall.
  const offGoal = gradeOne(fsmForwardBrain(), corridor(4, 1), 'reach-and-stop');
  check('clean stop off the goal fails reach-and-stop with a named reason',
    offGoal.pass === false && offGoal.hitStepLimit === false &&
    offGoal.reason === "'reach-and-stop' criterion not satisfied: stopped off the goal cell");

  // pass-through, clean stop short of the goal: the lazy brain stops on
  // cycle 1 without ever crossing it.
  const neverCrossed = gradeOne(lazyBrain(), corridor(3, 2), 'pass-through');
  check('clean stop short of the goal fails pass-through with a named reason',
    neverCrossed.pass === false && neverCrossed.hitStepLimit === false &&
    neverCrossed.reason === "'pass-through' criterion not satisfied: goal cell never crossed");

  // return-to-start, clean stop away from home: the forward brain parks at
  // the far wall instead of returning.
  const notHome = gradeOne(fsmForwardBrain(), corridor(4, 2), 'return-to-start');
  check('clean stop away from the start fails return-to-start with a named reason',
    notHome.pass === false && notHome.hitStepLimit === false &&
    notHome.reason === "'return-to-start' criterion not satisfied: did not end on the start cell");

  // return-to-start, home but the goal-visit clause unmet (the Desert Ant
  // shape): the lazy brain halts at the start without visiting the goal.
  const noVisit = gradeOne(lazyBrain(), madMaxArena(3), 'return-to-start');
  check('halt-at-start without a goal visit carries the goal-visit reason',
    noVisit.pass === false && noVisit.hitStepLimit === false &&
    noVisit.reason === "'return-to-start' criterion not satisfied: goal cell never visited");

  // Passing cases carry no reason: the forward brain reaches and stops on
  // the pre-wall goal.
  const cleanPass = gradeOne(fsmForwardBrain(), corridor(4, 3), 'reach-and-stop');
  check('a cleanly passing case carries no reason',
    cleanPass.pass === true && cleanPass.reason === undefined);
}

// ── trajectory & orientation independence ────────────────────────────
// Grading judges WHERE the turbot went (goal visited; where it came to
// rest), never HOW: the path taken and the facing — final or at any point
// of the trace — must not affect any criterion. Pinned two ways: the
// criterion function judged on hand-built runs that differ ONLY in facing
// or route, and an end-to-end grader run whose brain spins in place on the
// goal before stopping (final facing ≠ arrival facing ≠ start facing).
console.log('\n[trajectory & orientation independence]');
{
  const mkRun = (
    final: { x: number; y: number; facing: TurbotOrientation },
    trace: Array<[number, number]>,
    opts: { stopped?: boolean; hitStepLimit?: boolean; facings?: TurbotOrientation[] } = {}
  ): TurbotRunResult => ({
    finalState: final,
    history: trace.map(([x, y], i): TurbotHistoryEntry => ({
      t: i + 1, kind: 'external', input: '0', action: 'forward',
      x, y, facing: opts.facings?.[i] ?? 'E',
    })),
    haltedByMotor: opts.stopped ?? true,
    haltedByBrain: false,
    stopped: opts.stopped ?? true,
    hitStepLimit: opts.hitStepLimit ?? false,
  });

  // reach-and-stop: identical rest position, every possible final facing.
  const rasArena = corridor(3, 2);
  const facings: TurbotOrientation[] = ['N', 'E', 'S', 'W'];
  check('reach-and-stop passes with ANY final facing (N/E/S/W all equal)',
    facings.every((f) =>
      evaluateTurbotCriterion(rasArena, mkRun({ x: 2, y: 0, facing: f }, [[1, 0], [2, 0]]), 'reach-and-stop')));

  // reach-and-stop: a roundabout route (overshoot-free here — corridor is
  // 1-D, so wander = extra back-and-forth cells) grades the same as the
  // direct one; only the rest position matters.
  const direct = mkRun({ x: 2, y: 0, facing: 'E' }, [[1, 0], [2, 0]]);
  const wander = mkRun({ x: 2, y: 0, facing: 'W' }, [[1, 0], [0, 0], [1, 0], [2, 0]],
    { facings: ['E', 'W', 'E', 'E'] });
  check('reach-and-stop: direct and roundabout routes to the same rest cell both pass',
    evaluateTurbotCriterion(rasArena, direct, 'reach-and-stop') &&
    evaluateTurbotCriterion(rasArena, wander, 'reach-and-stop'));

  // pass-through: the goal appearing ANYWHERE in the trace suffices — the
  // run may end far away, facing anywhere, truncated by the step limit.
  const ptCross = mkRun({ x: 0, y: 0, facing: 'S' }, [[1, 0], [2, 0], [1, 0], [0, 0]],
    { stopped: false, hitStepLimit: true });
  const ptMiss = mkRun({ x: 1, y: 0, facing: 'E' }, [[1, 0], [0, 0], [1, 0]],
    { stopped: false, hitStepLimit: true });
  check('pass-through passes on a mid-trace goal crossing (ends elsewhere, any facing)',
    evaluateTurbotCriterion(rasArena, ptCross, 'pass-through'));
  check('pass-through fails the same-shaped run whose trace skipped the goal',
    !evaluateTurbotCriterion(rasArena, ptMiss, 'pass-through'));

  // return-to-start: home is a POSITION, not a pose — ending with a facing
  // different from the start facing (corridor starts facing E) still passes,
  // and the goal-visit clause reads the trace positions only.
  const homeTurned = mkRun({ x: 0, y: 0, facing: 'W' }, [[1, 0], [2, 0], [1, 0], [0, 0]]);
  check('return-to-start passes when home with a final facing ≠ start facing',
    evaluateTurbotCriterion(rasArena, homeTurned, 'return-to-start'));

  // End-to-end: an FSM brain that drives to the goal, then TURNS IN PLACE
  // twice before stopping — trajectory gains two in-place turns and the
  // final facing (W) differs from both the start and arrival facing (E).
  const spinStopBrain = (): { components: CircuitComponent[]; wires: Wire[] } => {
    const st = (id: string, label: string): CircuitComponent =>
      ({ id, type: 'STATE', x: 0, y: 0, label, ports: getPortsForType('STATE') });
    const tr = (id: string, from: string, to: string, label: string): Wire =>
      ({ id, sourceComponentId: from, sourcePortId: 'right', targetComponentId: to, targetPortId: 'left', value: 0, transitionLabel: label });
    return {
      components: [st('s0', 'S₀'), st('s1', 'S₁'), st('s2', 'S₂')],
      wires: [
        tr('t1', 's0', 's0', '0:11'), // clear → forward
        tr('t2', 's0', 's1', '1:01'), // blocked (past the goal) → turn left
        tr('t3', 's1', 's2', '0:01'), // turn left again…
        tr('t4', 's1', 's2', '1:01'),
        tr('t5', 's2', 's2', '0:00'), // …then stop
        tr('t6', 's2', 's2', '1:00'),
      ],
    };
  };
  const spinAssignment: AssignmentData = {
    id: 'spin-smoke',
    title: 'Spin smoke',
    questions: [{
      id: 1,
      label: 'Q1 (spin-then-stop)',
      statement: 'Final orientation must not matter.',
      buildMode: 'turbot',
      innerMode: 'FSM',
      representation: 'binary',
      turbot_cases: [{ arena: corridor(3, 2), maxSteps: 20, criterion: 'reach-and-stop' }],
    }],
  };
  const spinResult = gradeSubmission(spinAssignment, {
    assignmentTitle: spinAssignment.title,
    student: 'spin@example.com',
    submittedAt: '2026-07-19T00:00:00Z',
    answers: [{ questionId: 1, circuit: spinStopBrain() }],
  }).questions[0].turbotCases![0];
  check('grader: spin-in-place-then-stop on the goal passes reach-and-stop end-to-end',
    spinResult.pass === true && spinResult.reason === undefined);
  check('grader: the spun run really ended facing away from its start facing',
    spinResult.finalPosition.facing !== corridor(3, 2).start.facing);
}

console.log(`\n${failures === 0 ? 'TURBOT CHECK OK' : `TURBOT CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
