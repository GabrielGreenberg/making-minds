// Smoke test for the perception engine + grader (engine/perception.ts,
// gradePerception in engine/grader.ts).
//
//   npx tsx tools/perceptionCheck.ts
//
// Covers: the rule evaluators on known stimuli, case-bank generation shape and
// determinism, and bit-level grading of the sample correct/incorrect circuits
// for all five perception problems (edge, object, landmark, change, motion).
//
// And the SC perception frame player (task 012): a film of frames is the
// store's scInputSequence as lanes (framesToLanes), and the REAL store's
// clocked run of it — scStep/scRun, headless — IS the grader's run of the
// same frames: the same bits fed, the same output bit per step, from MEMs at
// 0, stopping after the last frame (no sandbox drain step), never reading the
// answer key, never locked.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AssignmentData, AssignmentQuestion, CircuitData, PerceptionRule } from '../src/types';
import {
  hasRunAtLeast,
  hasRunExactly,
  singleObjectAt,
  expectedPerceptionOutputs,
  buildPerceptionCases,
  perceptionModeFor,
  objectFrame,
  framesToLanes,
  lanesToFrames,
  shiftFrame,
  runPerceptionCase,
} from '../src/engine/perception';
import { gradeQuestion } from '../src/engine/grader';
import { gradingCircuit } from '../src/engine/caseRun';
import { memorySlots } from '../src/engine/netlist';
import { boxWhole, comp } from './builder';
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

// ── frames ↔ lanes (the frame player's film as the run's input) ────
console.log('\n[frames ↔ lanes]');
{
  const films = [up, ...changeCases.map((c) => c.frames), ...motionCases.map((c) => c.frames)];
  check('lanesToFrames(framesToLanes(f, 8), 8) is f, for every SC bank film',
    films.every((f) => JSON.stringify(lanesToFrames(framesToLanes(f, 8), 8)) === JSON.stringify(f)));
  const lanes = framesToLanes(up, 8);
  check('lane i is wire IN(i+1) over time, t1 first',
    lanes.length === 8 && lanes.every((lane, i) => lane.length === up.length && lane.every((b, t) => b === up[t][i])));
  check('ragged / short / missing lanes read 0',
    JSON.stringify(lanesToFrames([[1, 1, 1], [1]], 3)) === JSON.stringify([[1, 1, 0], [1, 0, 0], [1, 0, 0]]));
  check('a short frame reads 0 in its missing bits',
    JSON.stringify(framesToLanes([[1]], 3)) === JSON.stringify([[1], [0], [0]]));
  check('framesToLanes([], w) loads no lane, and holds no frame',
    framesToLanes([], 8).every((l) => l.length === 0) && lanesToFrames(framesToLanes([], 8), 8).length === 0);
  const f = objectFrame(8, 3, 4);
  check("the player's shift up is toward IN1: objectFrame(8,3,4) → objectFrame(8,3,3)",
    JSON.stringify(shiftFrame(f, 'up')) === JSON.stringify(objectFrame(8, 3, 3)));
  check("…so the motion rule reads [f, up(f)] as upward motion (the player's 'up' IS the rule's)",
    expectedPerceptionOutputs(motion, [f, shiftFrame(f, 'up')])[1] === 1);
  check('shift down moves away from IN1, and is not upward motion',
    JSON.stringify(shiftFrame(f, 'down')) === JSON.stringify(objectFrame(8, 3, 5)) &&
    expectedPerceptionOutputs(motion, [f, shiftFrame(f, 'down')])[1] === 0);
}

// ── The REAL store, headless ────────────────────────────────────────────────

// Minimal DOM shims so the store module (browser code) loads under Node
// (as scWindowCheck).
(globalThis as unknown as { window: unknown }).window = {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { document: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
};
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
}

// Import AFTER the shims (static imports would hoist above them).
const {
  useStore,
  selectCodecLayout,
  selectCodecWindow,
  selectScRunWindow,
  selectPerceptionRetina,
  selectQuestionLocked,
} = await import('../src/store');

async function waitUntil(pred: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const hw3 = JSON.parse(readFileSync(join(HERE, '../src/devData/homeworks/hw3.json'), 'utf8')) as AssignmentData;
const hw3Question = (id: number) => hw3.questions.find((q) => q.id === id)!;

/** Open `q` alone with `machine` on its canvas (a fresh canvas: reset law 1). */
function openPerception(q: AssignmentQuestion, machine: CircuitData) {
  useStore.getState().loadAssignment({ id: `perception-check-${q.id}`, title: 'Perception check', questions: [q] });
  useStore.setState({ components: machine.components, wires: machine.wires });
}

/** scStep until the store refuses one; the number of steps taken. */
function stepToEnd(): number {
  let steps = 0;
  for (let guard = 0; guard < 500; guard++) {
    const before = useStore.getState().scTimeStep;
    useStore.getState().scStep();
    if (useStore.getState().scTimeStep === before) break;
    steps++;
  }
  return steps;
}

/** What the store's run fed and output, per step, t ascending. */
function storeRun(): { fed: number[][]; out: number[] } {
  const hist = useStore.getState().scHistory.slice().sort((a, b) => a.t - b.t);
  return { fed: hist.map((h) => h.inputBits), out: hist.map((h) => h.outputBits[0] ?? 0) };
}

/** The machine with run scratch left in every top-level MEM (autosaved and
 *  submitted as-is): both the grader and the player must start from 0. */
function withDirtyMems(m: CircuitData): CircuitData {
  return { ...m, components: m.components.map((c) => (c.type === 'MEM' ? { ...c, storedValue: 1 } : c)) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n[store: SC perception frame run ≡ grader]');
const perceptionPairs: [number, string, () => CircuitData, () => CircuitData][] = [
  [11, 'change', perceptionChangeCorrect, perceptionChangeIncorrect],
  [12, 'motion', perceptionMotionCorrect, perceptionMotionIncorrect],
];
for (const [id, name, correct, incorrect] of perceptionPairs) {
  const q = hw3Question(id);
  const cases = q.perception_cases ?? [];
  check(`hw3 #${id} (${name}) is an SC perception question with a bank`,
    q.buildMode === 'SC' && !!q.perception && cases.length > 0);

  const machines: [string, CircuitData][] = [
    ['correct', correct()],
    ['incorrect', incorrect()],
    ['correct, boxed whole', boxWhole(correct())],
    ['correct, dirty MEM scratch', withDirtyMems(correct())],
  ];
  for (const [mName, machine] of machines) {
    const graded = gradeQuestion(q, machine);
    let exactLength = true;
    let fedFrames = true;
    let gradersGot = true;
    let enginesRun = true;
    let refusesPast = true;
    let missesExpected = false;
    cases.forEach((tc, k) => {
      openPerception(q, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      const s = useStore.getState();
      exactLength &&= s.scHistory.length === tc.frames.length && s.scTimeStep === tc.frames.length + 1;
      const run = storeRun();
      fedFrames &&= same(run.fed, tc.frames);
      gradersGot &&= same(run.out, graded.perceptionCases?.[k]?.got);
      enginesRun &&= same(run.out, runPerceptionCase(gradingCircuit(machine), 'SC', tc));
      s.scStep();
      const after = useStore.getState();
      refusesPast &&= after.scHistory.length === tc.frames.length && after.scTimeStep === tc.frames.length + 1;
      missesExpected ||= !same(run.out, tc.expected);
    });
    check(`${name} / ${mName}: every case runs exactly its frames — no drain step`, exactLength);
    check(`${name} / ${mName}: the fed input bits ARE the case's frames`, fedFrames);
    check(`${name} / ${mName}: the output bit per step ≡ the grader's got (${graded.passed}/${graded.total} graded)`, gradersGot);
    check(`${name} / ${mName}: … ≡ runPerceptionCase(gradingCircuit(machine))`, enginesRun);
    check(`${name} / ${mName}: a further scStep past the film is refused`, refusesPast);
    if (mName === 'incorrect') {
      check(`${name} / incorrect: the store run shows the miss the grader fails (not vacuous)`,
        missesExpected && graded.passed < graded.total);
    } else {
      check(`${name} / ${mName}: the grader passes it (${graded.passed}/${graded.total})`,
        graded.status === 'graded' && graded.passed === graded.total);
    }
  }

  // Run (the interval loop) stops at the film's end too — not at L + one
  // drain step per MEM, the sandbox's end.
  {
    const machine = correct();
    const drain = memorySlots(machine.components).length;
    const tc = cases[0];
    openPerception(q, machine);
    useStore.getState().setScFrames(tc.frames);
    useStore.getState().scRun(1);
    const stopped = await waitUntil(() => !useStore.getState().scRunning);
    await new Promise((r) => setTimeout(r, 30)); // a stray tick would land here
    const s = useStore.getState();
    check(`${name}: Run stops by itself after the ${tc.frames.length} frames, not ${tc.frames.length} + ${drain} MEM drain steps`,
      drain > 0 && stopped && s.scHistory.length === tc.frames.length && s.scTimeStep === tc.frames.length + 1);
    check(`${name}: Run's outputs ≡ the grader's got`,
      same(storeRun().out, gradeQuestion(q, machine).perceptionCases?.[0]?.got));
  }

  // The run window and the codec: a perception question has no codec layout,
  // even given a stray cc_spec — its end is the film's length.
  for (const [label, qv] of [
    ['as authored', q],
    ['with a stray cc_spec', { ...q, cc_spec: { inputs: [{ name: 'x', width: 3 }], outputs: [{ name: 'y', width: 3, formula: 'x' }] } }],
  ] as [string, AssignmentQuestion][]) {
    const tc = cases[0];
    openPerception(qv, correct());
    useStore.getState().setScFrames(tc.frames);
    const s = useStore.getState();
    check(`${name} ${label}: no codec layout/window; run window = ${tc.frames.length} frames; retina = ${q.perception!.width}`,
      selectCodecLayout(s) === null && selectCodecWindow(s) === null &&
      selectScRunWindow(s) === tc.frames.length && selectPerceptionRetina(s) === q.perception!.width);
    stepToEnd();
    check(`${name} ${label}: the run ≡ the grader's got`,
      same(storeRun().out, gradeQuestion(q, correct()).perceptionCases?.[0]?.got));
  }

  // The run never reads the answer key: a student's stripped copy (remote:
  // perception_cases removed, server/src/sanitize.ts) plays identically.
  {
    const stripped: AssignmentQuestion = { ...q, perception_cases: [] };
    const machine = incorrect();
    let identical = true;
    for (const tc of cases) {
      openPerception(q, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      const keyed = storeRun();
      openPerception(stripped, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      identical &&= same(storeRun(), keyed) && selectScRunWindow(useStore.getState()) === tc.frames.length;
    }
    check(`${name}: a stripped copy (perception_cases: []) plays every film identically`, identical);
  }

  // Frames are stimulus: never locked. A done question still loads and plays a film.
  {
    const tc = cases[0];
    openPerception(q, correct());
    useStore.getState().toggleCurrentQuestionDone();
    const locked = selectQuestionLocked(useStore.getState());
    useStore.getState().setScFrames(tc.frames);
    const loaded = same(useStore.getState().scInputSequence, framesToLanes(tc.frames, q.perception!.width));
    stepToEnd();
    check(`${name}: marked done (locked=${locked}), setScFrames still loads the film and it plays`,
      locked && loaded && same(storeRun().out, gradeQuestion(q, correct()).perceptionCases?.[0]?.got));
  }

  // An edit mid-run (a raw setState — the store's machine-key subscriber, law 6)
  // restarts the run at t=1 keeping the film; a canvas swap drops the film (law 1).
  {
    const tc = cases[0];
    openPerception(q, correct());
    useStore.getState().setScFrames(tc.frames);
    useStore.getState().scStep();
    useStore.getState().scStep();
    const film = useStore.getState().scInputSequence;
    const midRun = useStore.getState().scTimeStep === 3;
    useStore.setState({ components: [...useStore.getState().components, comp('pc-extra-not', 'NOT', 'NOT', 600, 600)] });
    const s = useStore.getState();
    check(`${name}: an edit mid-run restarts at t=1 with the film kept`,
      midRun && s.scTimeStep === 1 && s.scHistory.length === 0 && same(s.scInputSequence, film));
    useStore.getState().resetAllSimState();
    check(`${name}: a canvas swap (resetAllSimState) drops the film`,
      useStore.getState().scInputSequence.every((lane) => lane.length === 0));
  }
}

console.log(`\n${failures === 0 ? 'PERCEPTION OK' : `PERCEPTION FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
