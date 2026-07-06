// Headless check pinning the SC/FSM question-run contract (P1.9 + P1.9b).
//
//   cd app && npx tsx tools/scWindowCheck.ts
//
// Two halves of the same contract — inside a question, the UI must run EXACTLY
// what the grader runs:
//
//   WINDOW LENGTH (P1.9)   the codec window — stepCountFor = max(1, input
//     widths, output widths) — is CANONICAL: the grader runs exactly that many
//     time steps and decodes output wire j from steps 1..Wo_j only
//     (engine/codec.ts). Question runs execute the same window.
//
//   WINDOW CONTENT (P1.9b) the fed input stream must be the codec's, not the
//     typed chars: the typed string is parsed as a VALUE per input group
//     (exactly how the A/V ARG column reads it — tally "11" = 2) and laid on
//     the time axis by encodeInput. For tally that means zeros LEAD and the
//     ones arrive LAST — the reverse of feeding typed chars at t1..tL. Feeding
//     raw chars made a grader-passing tally machine (hw3-p7's correct machine)
//     show '/' in the A/V table, and a direct-wire tally identity decode '/'
//     instead of its typed value. Binary is unaffected (typed numeral LSB-first
//     coincides with the raw right-to-left feed).
//
//   Invalid input policy: a typed string that is not a valid numeral for the
//     representation (tally with a 1 after a 0, e.g. "101") denotes no value,
//     so there is no grader stream to match — the run falls back to feeding
//     the raw typed bits (window-bounded), and the A/V ARG column flags the
//     input '/' exactly as it always has.
//
//   DISPLAY DIRECTION (P1.9c) the FSM Input/Output row's OUT string is built
//     t-DESCENDING (t1 rightmost — time flows right-to-left in SC and FSM
//     tables) via the pure builder components/outputDisplay.ts, shared with
//     the SC Global I/O rows. A question run's OUT therefore reads as a
//     numeral exactly like the typed IN: the binary identity on "110" shows
//     an OUT reading 110 (= 6), the tally identity on "11" a valid tally
//     numeral (ones leftmost). The FSM-binary stream pins below use the
//     NON-palindrome "110" so a reversed feed/display cannot sneak through.
//
// Sandbox behavior (no open question / no cc_spec) is also pinned: SC runs
// L + one 0-drain step per MEM; FSM runs L; both feed raw typed bits.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AssignmentData, AssignmentQuestion, CircuitData, RepSystem } from '../src/types';
import { buildQuestionBank } from '../src/engine/testVectorGen';
import { gradeQuestion } from '../src/engine/grader';
import {
  stepCountFor,
  timeOutputBits,
  encodeInput,
  bitsToTally,
  bitsToValue,
  type CodecLayout,
} from '../src/engine';
import { outputDisplayString } from '../src/components/outputDisplay';
import { comp, wire, transition, circuit } from './builder';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

// ── Machines ────────────────────────────────────────────────────────────────

// Intended SC solution for f(x) = x: a direct wire.
const direct: CircuitData = circuit(
  [comp('in1', 'INPUT', 'IN1'), comp('out1', 'OUTPUT', 'OUT1')],
  [wire('w1', 'in1', 'out', 'out1', 'in')],
);

// Exhibit B: identity with ONE redundant MEM delay stage.
const delayed: CircuitData = circuit(
  [
    comp('in1', 'INPUT', 'IN1'),
    comp('m1', 'MEM', 'M1', 0, 0, { memDirection: 'right-to-left', storedValue: 0 }),
    comp('out1', 'OUTPUT', 'OUT1'),
  ],
  [wire('w1', 'in1', 'out', 'm1', 'min'), wire('w2', 'm1', 'mout', 'out1', 'in')],
);

// Exhibit C: binary identity that emits garbage 1s AFTER the codec window.
// OUT = OR(IN, constant-1 delayed through 6 MEMs) — the garbage first reaches
// OUT at t7; the binary window is 6, so the grader never sees it.
function garbageAfterWindow(): CircuitData {
  const comps = [
    comp('in1', 'INPUT', 'IN1'),
    comp('not1', 'NOT', 'NOT'), // input unconnected → reads 0 → outputs 1 every step
    ...Array.from({ length: 6 }, (_, i) =>
      comp(`m${i + 1}`, 'MEM', `M${i + 1}`, 0, 0, { memDirection: 'right-to-left' as const, storedValue: 0 })),
    comp('or1', 'OR', 'OR'),
    comp('out1', 'OUTPUT', 'OUT1'),
  ];
  const wires = [
    wire('w-not', 'not1', 'out', 'm1', 'min'),
    ...Array.from({ length: 5 }, (_, i) => wire(`w-m${i + 1}`, `m${i + 1}`, 'mout', `m${i + 2}`, 'min')),
    wire('w-chain-or', 'm6', 'mout', 'or1', 'in2'),
    wire('w-in-or', 'in1', 'out', 'or1', 'in1'),
    wire('w-or-out', 'or1', 'out', 'out1', 'in'),
  ];
  return circuit(comps, wires);
}

// FSM identity: one state, echo the input bit.
const fsmIdentity: CircuitData = circuit(
  [comp('fsm-s0', 'STATE', 'S₀')],
  [
    transition('fsm-t1', 'fsm-s0', 'fsm-s0', '0:0'),
    transition('fsm-t2', 'fsm-s0', 'fsm-s0', '1:1'),
  ],
);

// ── Questions (authored exactly as the question creator would) ──────────────

function identityQuestion(rep: RepSystem, mode: 'SC' | 'FSM'): AssignmentQuestion {
  const bank = buildQuestionBank([{ name: 'x', maxVal: 0 }], [{ name: 'f', formula: 'x' }], rep, mode);
  return {
    id: 1,
    label: `identity (${mode}, ${rep})`,
    statement: 'Build a machine computing f(x) = x.',
    buildMode: mode,
    representation: rep,
    cc_spec: bank.spec,
    test_cases: bank.test_cases,
  };
}

function layoutOf(q: AssignmentQuestion): CodecLayout {
  return {
    axis: 'time',
    rep: q.representation,
    inputWidths: q.cc_spec!.inputs.map((g) => g.width),
    outputWidths: q.cc_spec!.outputs.map((g) => g.width),
  };
}

function windowOf(q: AssignmentQuestion): number {
  return stepCountFor(layoutOf(q));
}

const qTally = identityQuestion('tally', 'SC');
const qBinSc = identityQuestion('binary', 'SC');
const qBinFsm = identityQuestion('binary', 'FSM');
const qTallyFsm = identityQuestion('tally', 'FSM');

// The real HW3-P7 question (SC tally, f(x) = x+3) and its verified-correct
// reference machine — the fixture the coverage ledger already grades.
const hw3p7 = JSON.parse(
  readFileSync(join(HERE, 'fixtures/reference/hw3-p7.json'), 'utf8'),
) as { question: AssignmentQuestion; correct: CircuitData };

// ── (a)/(b) grader semantics pins (the grader itself is untouched) ──────────

console.log('[grader: canonical window semantics]');
const control = gradeQuestion(qTally, direct);
check('control: direct-wire identity passes every tally case',
  control.status === 'graded' && control.total > 0 && control.passed === control.total);

const exhibitB = gradeQuestion(qTally, delayed);
check('exhibit B: identity + redundant MEM FAILS the grader',
  exhibitB.status === 'graded' && exhibitB.passed < exhibitB.total);
// The delayed machine shifts the stream one step, so the window sees one one
// too few: the grader decodes a valid-but-WRONG tally value (x − 1).
const bX3 = exhibitB.cases.find((c) => c.input[0] === 3);
check(`exhibit B: the x=3 case fails with a wrong decoded value (got ${JSON.stringify(bX3?.got)})`,
  bX3 !== undefined && !bX3.pass && bX3.got[0] === 2);

const exhibitC = gradeQuestion(qBinSc, garbageAfterWindow());
check('exhibit C: post-window garbage PASSES the grader (window never sees it)',
  exhibitC.status === 'graded' && exhibitC.total > 0 && exhibitC.passed === exhibitC.total);

const hw3p7Grade = gradeQuestion(hw3p7.question, hw3p7.correct);
check(`hw3-p7: the fixture's correct machine passes the grader (${hw3p7Grade.passed}/${hw3p7Grade.total})`,
  hw3p7Grade.status === 'graded' && hw3p7Grade.total > 0 && hw3p7Grade.passed === hw3p7Grade.total);

const fsmTallyGrade = gradeQuestion(qTallyFsm, fsmIdentity);
check('FSM tally identity: echo machine passes the grader',
  fsmTallyGrade.status === 'graded' && fsmTallyGrade.total > 0 && fsmTallyGrade.passed === fsmTallyGrade.total);

// ── Display direction: the IN/OUT rows read t1-RIGHTMOST ───────────────────
// The pure builder behind the FSM Input/Output OUT cell (and the SC Global
// I/O rows): later steps extend left, so the string reads as a numeral.
console.log('\n[display: outputDisplayString is t-descending (t1 rightmost)]');
check("unordered entries sort t-DESCENDING: t1=0, t2=1, t3=1 → '110' (not '011')",
  outputDisplayString([{ t: 2, bits: [1] }, { t: 1, bits: [0] }, { t: 3, bits: [1] }]) === '110');
check("multi-wire steps concatenate per step (SC rows): t1=[0,1], t2=[1,0] → '1001'",
  outputDisplayString([{ t: 1, bits: [0, 1] }, { t: 2, bits: [1, 0] }]) === '1001');

// ── The REAL store, headless ────────────────────────────────────────────────

// Minimal DOM shims so the store module (browser code) loads under Node.
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
const { useStore, selectCodecWindow } = await import('../src/store');

async function waitUntil(pred: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

function assignmentFor(q: AssignmentQuestion): AssignmentData {
  return { id: `sc-window-check-${q.buildMode}-${q.id}-${q.representation}`, title: 'SC window check', questions: [q] };
}

function openQuestion(q: AssignmentQuestion, machine: CircuitData) {
  useStore.getState().loadAssignment(assignmentFor(q));
  useStore.setState({ components: machine.components, wires: machine.wires });
}

/** Type + load + Run an SC global sequence, wait for the run to stop. */
async function scTypeAndRun(typed: string): Promise<boolean> {
  useStore.getState().setScGlobalSequenceInput(0, typed);
  useStore.getState().loadScGlobalSequence(0);
  useStore.getState().scRun();
  return waitUntil(() => {
    const s = useStore.getState();
    return !s.scRunning && s.scHistory.length > 0;
  });
}

/** The input stream the store actually fed, [step][wire] t-ascending. */
function scFedSteps(): number[][] {
  return useStore.getState().scHistory.slice().sort((a, b) => a.t - b.t).map((h) => h.inputBits);
}

/** The A/V VAL bits DataTable shows for a question run: the grader's exact
 *  window slice per output group (codec timeOutputBits over the history). */
function avQuestionBits(outputWidths: number[]): number[] {
  const hist = useStore.getState().scHistory;
  const steps = hist.slice().sort((a, b) => a.t - b.t).map((h) => h.outputBits);
  return outputWidths.flatMap((w, j) => timeOutputBits(steps, w, j));
}

function sameSteps(a: number[][], b: number[][]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function eqArr(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── SC question runs feed the codec stream (TALLY content parity) ──────────
console.log('\n[store: SC tally question runs feed the codec stream]');
{
  // hw3-p7's CORRECT machine, typed "11" (= 2): the run must execute the
  // grader's window, feed the grader's exact stream, and the A/V numeral must
  // be the grader's expected output for x=2.
  const q = hw3p7.question;
  const win = windowOf(q);
  const layout = layoutOf(q);
  openQuestion(q, hw3p7.correct);
  check(`hw3-p7: selectCodecWindow sees the question window (${win})`,
    selectCodecWindow(useStore.getState()) === win);

  check('hw3-p7: run terminates on its own', await scTypeAndRun('11'));
  const s = useStore.getState();
  check(`hw3-p7: run stopped at the codec window: ${s.scHistory.length} steps run (want ${win})`,
    s.scHistory.length === win && s.scTimeStep === win + 1);

  const wantStream = encodeInput([2], layout);
  check('hw3-p7: fed input stream EQUALS codec encodeInput([2]) — zeros leading, ones last',
    wantStream.axis === 'time' && sameSteps(scFedSteps(), wantStream.steps));

  const expected = q.test_cases!.find((tc) => tc.inputs[0] === 2)!.outputs[0];
  const avBits = avQuestionBits(q.cc_spec!.outputs.map((g) => g.width));
  const avVal = bitsToTally(avBits);
  check(`hw3-p7: A/V windowed decode is the CORRECT numeral (got ${avVal}, grader expects ${expected})`,
    avVal !== null && avVal === expected);
}

{
  // Regression pin: a zero-MEM direct-wire tally identity, typed "111",
  // decodes to 3 again (via the correct zeros-leading stream — pre-round-1 it
  // read 3 off the ones-first stream; round 1 alone showed '/').
  const win = windowOf(qTally);
  openQuestion(qTally, direct);
  check('tally identity (direct wire): run terminates', await scTypeAndRun('111'));
  const wantStream = encodeInput([3], layoutOf(qTally));
  check('tally identity: fed stream EQUALS codec encodeInput([3])',
    wantStream.axis === 'time' && sameSteps(scFedSteps(), wantStream.steps));
  check(`tally identity: ran the window (${useStore.getState().scHistory.length} steps, want ${win})`,
    useStore.getState().scHistory.length === win);
  const avVal = bitsToTally(avQuestionBits(qTally.cc_spec!.outputs.map((g) => g.width)));
  check(`tally identity: typed "111" decodes to 3 again (got ${avVal})`, avVal === 3);
}

{
  // Exhibit B's machine in the store: the UI now shows the SAME wrong value
  // the grader decodes (x − 1), instead of a stream the grader never feeds.
  const win = windowOf(qTally);
  openQuestion(qTally, delayed);
  check('exhibit B (store): run terminates', await scTypeAndRun('111'));
  const s = useStore.getState();
  check(`exhibit B (store): run stopped at the codec window (${s.scHistory.length} steps, want ${win})`,
    s.scHistory.length === win && s.scTimeStep === win + 1);

  useStore.getState().scStep();
  check('exhibit B (store): a further manual Step past the window is a no-op',
    useStore.getState().scHistory.length === win);

  const avVal = bitsToTally(avQuestionBits(qTally.cc_spec!.outputs.map((g) => g.width)));
  check(`exhibit B (store): A/V decode equals the grader's decoded got (${JSON.stringify(bX3?.got)}) — not the typed 3`,
    bX3 !== undefined && avVal === bX3.got[0] && avVal !== 3);
}

// ── SC binary question runs: typed numeral = tested value (unchanged feed) ──
console.log('\n[store: SC binary question run]');
{
  const win = windowOf(qBinSc);
  openQuestion(qBinSc, direct);
  check('binary identity: run terminates', await scTypeAndRun('110'));
  // Typed "110" is the numeral 6; binary LSB-first encode coincides with the
  // old raw right-to-left feed, so binary behavior is pinned unchanged.
  const wantStream = encodeInput([6], layoutOf(qBinSc));
  check('binary identity: fed stream EQUALS codec encodeInput([6])',
    wantStream.axis === 'time' && sameSteps(scFedSteps(), wantStream.steps));
  check(`binary identity: ran the window (${useStore.getState().scHistory.length} steps, want ${win})`,
    useStore.getState().scHistory.length === win);
  const avBits = avQuestionBits(qBinSc.cc_spec!.outputs.map((g) => g.width));
  check(`binary identity: A/V windowed decode = 6 (got ${bitsToValue(avBits, 'binary')})`,
    bitsToValue(avBits, 'binary') === 6);
}

// ── Invalid input policy: not a numeral → raw bits, flagged '/' by ARG ─────
console.log('\n[store: invalid tally input falls back to raw typed bits]');
{
  const win = windowOf(qTally);
  openQuestion(qTally, direct);
  check("ARG reads tally '101' as invalid ('/')", bitsToTally([1, 0, 1]) === null);
  check('invalid input: run still terminates', await scTypeAndRun('101'));
  // No value → no grader stream; the raw typed bits are fed (t1 = rightmost
  // char), 0-padded to the window, window bound still enforced.
  const raw = Array.from({ length: win }, (_, t) => [t === 0 || t === 2 ? 1 : 0]);
  check('invalid input: fed stream is the raw typed bits, window-bounded',
    sameSteps(scFedSteps(), raw) && useStore.getState().scHistory.length === win);
}

// ── FSM question runs ───────────────────────────────────────────────────────
console.log('\n[store: FSM question runs]');
{
  const win = windowOf(qBinFsm);
  openQuestion(qBinFsm, fsmIdentity);
  check(`selectCodecWindow sees the question window (${win})`,
    selectCodecWindow(useStore.getState()) === win);

  useStore.getState().fsmGlobalReset();
  // NON-palindrome "110" (= 6): a t1-first raw feed would be the reversed
  // stream (reading 3), so this pins the DIRECTION — typed FSM question
  // input is an MSB-left numeral, exactly like SC and the A/V ARG column.
  useStore.getState().setFsmInputSequence([1, 1, 0]); // typed "110" = 6
  useStore.getState().fsmRun();
  const done = await waitUntil(() => {
    const s = useStore.getState();
    return !s.fsmRunning && s.fsmHistory.length > 0;
  });
  check('run terminates on its own', done);

  const s = useStore.getState();
  check(`fsmRun executed the full window: ${s.fsmHistory.length} steps (want ${win})`,
    s.fsmHistory.length === win);
  const fed = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [h.input]);
  const wantStream = encodeInput([6], layoutOf(qBinFsm));
  check('fed input stream EQUALS codec encodeInput([6]) — MSB-left numeral, LSB at t1',
    wantStream.axis === 'time' && sameSteps(fed, wantStream.steps));

  useStore.getState().fsmStep();
  check('a further manual Step past the window is a no-op',
    useStore.getState().fsmHistory.length === win);

  // Identity machine: the window decodes back to x = 6, as the grader would.
  const series = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [h.output]);
  const decoded = bitsToValue(timeOutputBits(series, qBinFsm.cc_spec!.outputs[0].width, 0), 'binary');
  check(`window decodes to the typed value (got ${decoded}, want 6)`, decoded === 6);

  // The Input/Output row's OUT display: t1 rightmost, so the passing identity
  // shows an OUT that READS "110" as a numeral (leading zeros aside).
  const display = outputDisplayString(s.fsmHistory.map((h) => ({ t: h.t, bits: [h.output] })));
  check(`OUT display reads 110 as a numeral, t1 rightmost (got "${display}")`,
    display.length === win && display.endsWith('110') &&
    bitsToValue(display.split('').map(Number), 'binary') === 6);
}

{
  // TALLY direction for FSM: typed "11" (= 2) must be fed as the codec lays
  // it (ones LAST), and the echo machine's window must decode back to 2.
  const win = windowOf(qTallyFsm);
  openQuestion(qTallyFsm, fsmIdentity);
  useStore.getState().fsmGlobalReset();
  useStore.getState().setFsmInputSequence([1, 1]); // typed "11" = tally 2
  useStore.getState().fsmRun();
  const done = await waitUntil(() => {
    const s = useStore.getState();
    return !s.fsmRunning && s.fsmHistory.length > 0;
  });
  check('FSM tally: run terminates', done);
  const s = useStore.getState();
  check(`FSM tally: executed the window (${s.fsmHistory.length} steps, want ${win})`,
    s.fsmHistory.length === win);
  const fed = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [h.input]);
  const wantStream = encodeInput([2], layoutOf(qTallyFsm));
  check('FSM tally: fed stream EQUALS codec encodeInput([2]) — ones arrive last',
    wantStream.axis === 'time' && sameSteps(fed, wantStream.steps));
  const series = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [h.output]);
  const decoded = bitsToValue(timeOutputBits(series, qTallyFsm.cc_spec!.outputs[0].width, 0), 'tally');
  check(`FSM tally: window decodes to the typed value (got ${decoded}, want 2)`, decoded === 2);

  // OUT display: with t1 rightmost the echoed ones sit LEFTMOST — a VALID
  // tally numeral for 2 ("11" then zeros). Built t-ascending it would read
  // "0…011", which tally rejects ('/').
  const display = outputDisplayString(s.fsmHistory.map((h) => ({ t: h.t, bits: [h.output] })));
  check(`FSM tally: OUT display is a VALID tally numeral for 2 (got "${display}")`,
    display.length === win && bitsToTally(display.split('').map(Number)) === 2);
}

// ── Sandbox runs keep their old lengths and raw feed ────────────────────────
console.log('\n[store: sandbox unchanged]');
{
  useStore.getState().closeAssignment();
  useStore.setState({ components: delayed.components, wires: delayed.wires, buildMode: 'SC' });
  check('sandbox has no codec window', selectCodecWindow(useStore.getState()) === null);

  useStore.getState().scGlobalReset();
  useStore.getState().setScGlobalSequenceInput(0, '111');
  useStore.getState().loadScGlobalSequence(0);
  useStore.getState().scRun();
  const done = await waitUntil(() => {
    const s = useStore.getState();
    return !s.scRunning && s.scHistory.length > 0;
  });
  const ran = useStore.getState().scHistory.length;
  check(`SC sandbox run is L + one drain step per MEM: ${ran} steps (want 4)`, done && ran === 4);
  check('SC sandbox feeds the raw typed bits (ones first)',
    sameSteps(scFedSteps(), [[1], [1], [1], [0]]));

  useStore.getState().fsmGlobalReset();
  useStore.setState({ components: fsmIdentity.components, wires: fsmIdentity.wires, buildMode: 'FSM' });
  // NON-palindrome "110": the old pin used the palindrome [1,0,1], which
  // could not tell feed directions apart — it silently pinned the P1.10 bug
  // (sandbox FSM consumed typed input LEFTMOST-first, the reverse of the SC
  // sandbox above). P1.12 folded the P1.10 fix into the fsmStep rewrite:
  // the sandbox now feeds t1 = RIGHTMOST typed char, matching SC.
  useStore.getState().setFsmInputSequence([1, 1, 0]);
  useStore.getState().fsmRun();
  const fsmDone = await waitUntil(() => {
    const s = useStore.getState();
    return !s.fsmRunning && s.fsmHistory.length > 0;
  });
  const fsmRan = useStore.getState().fsmHistory.length;
  check(`FSM sandbox run stops at the typed length: ${fsmRan} steps (want 3)`, fsmDone && fsmRan === 3);
  check('FSM sandbox feeds the raw typed bits, t1 = rightmost char (matches SC; P1.10)',
    sameSteps(useStore.getState().fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [h.input]),
      [[0], [1], [1]]));
}

// ── 2-input FSM question: the store run ≡ the grader run ───────────────────
// The store twin of grader.ts's old wire-0 flatten (codecSteps[tIdx]?.[0])
// died in P1.12: question runs join the FULL encoded row into one k-char
// symbol per step. Pin: a k=2 serial adder's store run feeds exactly the
// grader's stream and its window decodes to the grader's expected output.
console.log('\n[store: 2-input FSM question run matches the grader]');
{
  const bank = buildQuestionBank(
    [{ name: 'x', maxVal: 0 }, { name: 'y', maxVal: 0 }],
    [{ name: 'out', formula: 'x + y' }],
    'binary',
    'FSM',
  );
  const qXY: AssignmentQuestion = {
    id: 2,
    label: 'x + y (FSM, k=2)',
    statement: 'Add two binary numerals, one bit of each per step.',
    buildMode: 'FSM',
    representation: 'binary',
    cc_spec: bank.spec,
    test_cases: bank.test_cases,
  };
  // Classic 2-state serial adder over 'xy:o' labels (S0 = no carry, S1 = carry).
  const adder: CircuitData = circuit(
    [comp('add-s0', 'STATE', 'S₀'), comp('add-s1', 'STATE', 'S₁')],
    [
      transition('add-t1', 'add-s0', 'add-s0', '00:0'),
      transition('add-t2', 'add-s0', 'add-s0', '01:1'),
      transition('add-t3', 'add-s0', 'add-s0', '10:1'),
      transition('add-t4', 'add-s0', 'add-s1', '11:0'),
      transition('add-t5', 'add-s1', 'add-s0', '00:1'),
      transition('add-t6', 'add-s1', 'add-s1', '01:0'),
      transition('add-t7', 'add-s1', 'add-s1', '10:0'),
      transition('add-t8', 'add-s1', 'add-s1', '11:1'),
    ],
  );

  const graded = gradeQuestion(qXY, adder);
  check(`grader control: the adder passes the k=2 bank (${graded.passed}/${graded.total})`,
    graded.status === 'graded' && graded.total > 0 && graded.passed === graded.total);

  const win = windowOf(qXY);
  openQuestion(qXY, adder);
  useStore.getState().fsmGlobalReset();
  // Typed IN chunks right-to-left, `numGroups` chars per step, char i =
  // group i (the SC global-sequence convention): "101101" = x 110 (6), y 011 (3).
  useStore.getState().setFsmInputSequence([1, 0, 1, 1, 0, 1]);
  useStore.getState().fsmRun();
  const done = await waitUntil(() => {
    const s = useStore.getState();
    return !s.fsmRunning && s.fsmHistory.length > 0;
  });
  check('k=2 run terminates on its own', done);

  const s = useStore.getState();
  check(`k=2 run executes the codec window (${s.fsmHistory.length} steps, want ${win})`,
    s.fsmHistory.length === win);

  const wantStream = encodeInput([6, 3], layoutOf(qXY));
  const fedSymbols = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => String(h.input));
  check('k=2 fed symbols EQUAL the codec rows joined (x char first per step)',
    wantStream.axis === 'time' &&
    eqArr(fedSymbols, wantStream.steps.map((row) => row.join(''))));

  const series = s.fsmHistory.slice().sort((a, b) => a.t - b.t).map((h) => [Number(h.output)]);
  const decoded = bitsToValue(timeOutputBits(series, qXY.cc_spec!.outputs[0].width, 0), 'binary');
  check(`k=2 window decodes to the grader's expected 6 + 3 = 9 (got ${decoded})`, decoded === 9);
}

console.log(`\n${failures === 0 ? 'SC WINDOW CHECK OK' : `SC WINDOW CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
