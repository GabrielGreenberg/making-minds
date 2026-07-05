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
import { runTurbot, evaluateTurbotCriterion } from '../src/engine/turbot';
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

// ── FSM brain: same behavior, one state, one output bit (S0 loops on itself). ─
function fsmForwardBrain(): { components: CircuitComponent[]; wires: Wire[] } {
  const s0: CircuitComponent = { id: 's0', type: 'STATE', x: 0, y: 0, label: 'S₀', ports: getPortsForType('STATE') };
  return {
    components: [s0],
    wires: [
      { id: 't1', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '0:1' },
      { id: 't2', sourceComponentId: 's0', sourcePortId: 'right', targetComponentId: 's0', targetPortId: 'left', value: 0, transitionLabel: '1:0' },
    ],
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

console.log('\n[engine: step limit]');
const infiniteArena = corridor(1000, 999);
const runLimited = runTurbot(ccBrain.components, ccBrain.wires, 'CC', infiniteArena, 5);
check('hits the step limit before reaching a far wall', runLimited.hitStepLimit && !runLimited.haltedByMotor);

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

console.log(`\n${failures === 0 ? 'TURBOT CHECK OK' : `TURBOT CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
