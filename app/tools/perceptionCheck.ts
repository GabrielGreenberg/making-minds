// Smoke test for the perception engine + grader (engine/perception.ts,
// gradePerception in engine/grader.ts).
//
//   npx tsx tools/perceptionCheck.ts
//
// Covers: the rule evaluators on known stimuli, case-bank generation shape and
// determinism, and bit-level grading of the sample correct/incorrect circuits
// for all five perception problems (edge, object, landmark, change, motion).

import type { AssignmentQuestion, CircuitData, PerceptionRule } from '../src/types';
import {
  hasRunAtLeast,
  hasRunExactly,
  singleObjectAt,
  expectedPerceptionOutputs,
  buildPerceptionCases,
  perceptionModeFor,
  objectFrame,
} from '../src/engine/perception';
import { gradeQuestion } from '../src/engine/grader';
import {
  perceptionEdgeCorrect, perceptionEdgeIncorrect,
  perceptionObjectCorrect, perceptionObjectIncorrect,
  perceptionLandmarkCorrect, perceptionLandmarkIncorrect,
  perceptionChangeCorrect, perceptionChangeIncorrect,
  perceptionMotionCorrect, perceptionMotionIncorrect,
} from '../src/devData/sampleData';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const bits = (s: string) => s.split('').map((c) => (c === '1' ? 1 : 0));

// ── rule evaluators ────────────────────────────────────────────────
console.log('[rule evaluators]');
check('min-run: 00111000 has ≥3', hasRunAtLeast(bits('00111000'), 3));
check('min-run: 11110000 has ≥3', hasRunAtLeast(bits('11110000'), 3));
check('min-run: 00110100 lacks ≥3', !hasRunAtLeast(bits('00110100'), 3));
check('min-run: run at the very end counts', hasRunAtLeast(bits('00000111'), 3));
check('exact-run: 00111000 has =3', hasRunExactly(bits('00111000'), 3));
check('exact-run: 11110000 lacks =3', !hasRunExactly(bits('11110000'), 3));
check('exact-run: 11101110 has =3', hasRunExactly(bits('11101110'), 3));
check('exact-run: 01111011 lacks =3 (runs of 4 and 2)', !hasRunExactly(bits('01111011'), 3));
check('object: 00111000 is one object at 2', singleObjectAt(bits('00111000'), 3) === 2);
check('object: 00111001 is not a single object', singleObjectAt(bits('00111001'), 3) === null);
check('object: 01111000 is not a 3-object', singleObjectAt(bits('01111000'), 3) === null);

const pattern: PerceptionRule = { kind: 'pattern', pattern: '110010111' };
check('pattern: exact match → 1',
  expectedPerceptionOutputs(pattern, [bits('110010111')])[0] === 1);
check('pattern: one bit off → 0',
  expectedPerceptionOutputs(pattern, [bits('110010110')])[0] === 0);

const change: PerceptionRule = { kind: 'change' };
const A = bits('10100000');
const B = bits('10100001');
check('change: [A,A,B,B] → 1,0,1,0 (onset from blank counts)',
  expectedPerceptionOutputs(change, [A, A, B, B]).join('') === '1010');
check('change: blank first frame → 0',
  expectedPerceptionOutputs(change, [bits('00000000'), A]).join('') === '01');

const motion: PerceptionRule = { kind: 'motion', objectLength: 3 };
const up = [objectFrame(8, 3, 5), objectFrame(8, 3, 4), objectFrame(8, 3, 3)];
check('motion: upward climb → 0 then 1s',
  expectedPerceptionOutputs(motion, up).join('') === '011');
check('motion: downward drift → all 0',
  expectedPerceptionOutputs(motion, [...up].reverse()).join('') === '000');
check('motion: static object → all 0',
  expectedPerceptionOutputs(motion, [objectFrame(8, 3, 4), objectFrame(8, 3, 4)]).join('') === '00');

// ── case generation ────────────────────────────────────────────────
console.log('\n[case generation]');
const edgeCases = buildPerceptionCases({ rule: { kind: 'min-run', runLength: 3 }, width: 8 });
check('CC bank enumerates all 2^8 frames', edgeCases.length === 256);
check('CC cases are single-frame', edgeCases.every((c) => c.frames.length === 1 && c.expected.length === 1));
check('CC bank has both classes',
  edgeCases.some((c) => c.expected[0] === 1) && edgeCases.some((c) => c.expected[0] === 0));

const changeCases = buildPerceptionCases({ rule: change, width: 8 });
check('SC bank is multi-frame', changeCases.length > 0 && changeCases.every((c) => c.frames.length >= 2));
check('SC expected parallels frames', changeCases.every((c) => c.expected.length === c.frames.length));
const changeCases2 = buildPerceptionCases({ rule: change, width: 8 });
check('SC bank is deterministic', JSON.stringify(changeCases) === JSON.stringify(changeCases2));

const motionCases = buildPerceptionCases({ rule: motion, width: 8 });
check('motion bank has a passing sequence', motionCases.some((c) => c.expected.includes(1)));
check('motion bank has all-negative sequences', motionCases.some((c) => !c.expected.includes(1)));

check('perceptionModeFor: runs/pattern → CC, change/motion → SC',
  perceptionModeFor({ kind: 'min-run', runLength: 3 }) === 'CC' &&
  perceptionModeFor(pattern) === 'CC' &&
  perceptionModeFor(change) === 'SC' &&
  perceptionModeFor(motion) === 'SC');

let threw = false;
try {
  buildPerceptionCases({ rule: { kind: 'pattern', pattern: '11' }, width: 8 });
} catch {
  threw = true;
}
check('pattern length must equal width', threw);

// ── grading ────────────────────────────────────────────────────────
console.log('\n[grading]');

function perceptionQuestion(rule: PerceptionRule, width: number): AssignmentQuestion {
  return {
    id: 1,
    label: 'P',
    statement: 's',
    buildMode: perceptionModeFor(rule),
    representation: 'binary',
    perception: { rule, width },
    perception_cases: buildPerceptionCases({ rule, width }),
  };
}

function gradePair(
  label: string,
  rule: PerceptionRule,
  width: number,
  good: CircuitData,
  bad: CircuitData,
) {
  const q = perceptionQuestion(rule, width);
  const g = gradeQuestion(q, good);
  const b = gradeQuestion(q, bad);
  check(`${label}: correct circuit passes every case`,
    g.status === 'graded' && g.total > 0 && g.passed === g.total);
  check(`${label}: incorrect circuit fails some case`,
    b.status === 'graded' && b.passed < b.total);
  const failing = b.perceptionCases?.find((c) => !c.pass);
  check(`${label}: failure reports the first wrong step`,
    failing != null && (failing.failStep ?? 0) >= 1);
}

gradePair('edge', { kind: 'min-run', runLength: 3 }, 8,
  perceptionEdgeCorrect(), perceptionEdgeIncorrect());
gradePair('object', { kind: 'exact-run', runLength: 3 }, 8,
  perceptionObjectCorrect(), perceptionObjectIncorrect());
gradePair('landmark', pattern, 9,
  perceptionLandmarkCorrect(), perceptionLandmarkIncorrect());
gradePair('change', change, 8,
  perceptionChangeCorrect(), perceptionChangeIncorrect());
gradePair('motion', motion, 8,
  perceptionMotionCorrect(), perceptionMotionIncorrect());

// Structural rejection: wrong retina size fails every case with a reason.
const q8 = perceptionQuestion({ kind: 'min-run', runLength: 3 }, 8);
const wrongShape = gradeQuestion(q8, perceptionLandmarkCorrect()); // 9 inputs, expects 8
check('wrong input count fails every case with a reason',
  wrongShape.status === 'graded' &&
  wrongShape.passed === 0 &&
  (wrongShape.perceptionCases?.every((c) => !c.pass && !!c.reason) ?? false));

console.log(`\n${failures === 0 ? 'PERCEPTION OK' : `PERCEPTION FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
