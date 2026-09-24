// Headless check pinning graded-case replay ("Run this input", task 002):
// loading a failed case from the grade sheet into the question's live run
// runs EXACTLY the grader's run.
//
//   cd app && npx tsx tools/caseRunCheck.ts
//
// Pins:
//   [engine ≡ grader]  engine/caseRun.ts is the grader minus the comparison:
//     for every reference fixture with a value bank or turbot arenas
//     (perception excluded), its correct AND broken machines (and an empty
//     canvas, for Stage 1), every case k: runValueCase gives the grader's
//     reason, or — with no reason — the grader's decoded `got`;
//     runTurbotCase deep-equals turbotCases[k]. Results are PARALLEL to their
//     banks (cases[k].input is test_cases[k].inputs; a case's separations
//     ride on its result).
//   [MEM scratch]  the grader grades from rest: an SC machine and an SC-
//     brained turbot saved with every MEM holding 1 grade exactly as with 0
//     (gradingCircuit) — and the raw engine WOULD differ, so the pin bites.
//   [store load]  per mode (CC, SC tally + binary, FSM tally + k=2 binary,
//     TM tally-with-gaps + binary, turbot CC/SC/FSM/TM brains incl. k > 0):
//     loadCaseInput(q, k) feeds exactly caseStimulus (CC INPUT toggles by
//     label, SC/FSM history inputs = the codec's time steps, the TM initial
//     tape with its separations, the turbot on turbot_cases[k]'s arena), and
//     the run's end state decodes to the RECORDED result (CC/SC/FSM decode →
//     got, TM acceptTM/decodeTM → got or the recorded reason, turbot final
//     pose + steps). loadedCase never carries expected/got. TM: Reset then
//     Step to the end reproduces the fast-forwarded tape + history.
//   [remote shape]  the same load against a student's copy — stripAnswers
//     (no bank) + studentRecord (expected/got blank): hw5-p4's gap cases
//     still get the grader's tape, and the live verdict equals the recorded
//     reason / got.
//   [same question]  a load on the question already open, mid-run, restarts
//     every run slice (intervals stopped, no leftover history) and keeps the
//     undo history.
//   [older results]  a result graded before cases recorded their TM block
//     separations: studentRecord(record, released, assignment) fills them
//     from the server's bank (case k, same input only), so a remote student's
//     hw5-p4 gap replay is still the grader's tape; locally the store takes
//     them from the bank (engine recordedCaseSeparations, one rule).
//   [resubmit]  the banner (gradeDisplay gradedCaseView) compares the canvas
//     with the machine graded in the case's OWN attempt: after a fixed
//     machine is resubmitted, attempt 1's ✗ is never "Same as when graded";
//     the settled divergence wording; Run again moves to the latest attempt.
//   [viewed attempt]  while a submitted attempt is on show (store
//     viewSubmission, task 003) and a later one is the latest, a case replays
//     the attempt ON SHOW — its recorded verdict, its machine (so the banner
//     reads "Same as when graded"); without the view, the latest (task 002).
//   [dismiss]  ✕ (clearLoadedCase) puts the Map back on the primary arena,
//     the turbot at its start, runs at its budget.
//   [step budgets]  question TM/turbot runs stop at the grader's budgets
//     (DEFAULT_TM_MAX_STEPS; the shown arena's maxSteps, 'limit'), sandbox
//     runs keep the UI cap; an in-question turbot brain starts with MEMs at 0.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  AssignmentData,
  AssignmentQuestion,
  CircuitData,
  QuestionResult,
  SubmissionRecord,
  TMTape,
} from '../src/types';
import { gradeQuestion } from '../src/engine/grader';
import {
  runValueCase,
  runTurbotCase,
  caseStimulus,
  questionLayout,
  gradingCircuit,
  gradedMachineKey,
} from '../src/engine/caseRun';
import {
  sortByLabel,
  decodeOutput,
  outputAccepted,
  encodeTM,
  acceptTM,
  decodeTM,
  notationForRepresentation,
  evaluateSCSequence,
  DEFAULT_TM_MAX_STEPS,
} from '../src/engine';
import { tapeCellsUsed } from '../src/engine/tm';
import { stripAnswers, studentRecord } from '../../server/src/sanitize';
import { gradedCaseView } from '../src/gradeDisplay';
import { comp, wire, transition, circuit } from './builder';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = join(HERE, 'fixtures/reference');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

interface Fixture {
  question: AssignmentQuestion;
  correct: CircuitData;
  broken?: CircuitData;
}

function loadFixture(id: string): Fixture {
  return JSON.parse(readFileSync(join(REF, `${id}.json`), 'utf8')) as Fixture;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** JSON round-trip: the wire's own semantics (undefined keys vanish). */
const canon = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// A never-stopping turbot-TM brain (the parityCheck wanderer): it circles
// forever, so every arena truncates at maxSteps.
const wandererBrain: CircuitData = circuit(
  [comp('w-s0', 'STATE', 'S₀', 100, 100, { stateKind: 'external' })],
  [
    transition('w-t1', 'w-s0', 'w-s0', 'E:↑'),
    transition('w-t2', 'w-s0', 'w-s0', 'F:↑'),
    transition('w-t3', 'w-s0', 'w-s0', 'B:↱'),
  ],
);

// ── [engine ≡ grader] ───────────────────────────────────────────────────────
console.log('[engine ≡ grader]');
const fixtureIds = readdirSync(REF)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();
let valueCasesCompared = 0;
let turbotCasesCompared = 0;
let separationsSeen = 0;
for (const id of fixtureIds) {
  const fx = loadFixture(id);
  const q = fx.question;
  if (q.perception) continue;
  const empty: CircuitData = { components: [], wires: [] };
  const machines: [string, CircuitData][] = [['correct', fx.correct], ['empty', empty]];
  if (fx.broken) machines.push(['broken', fx.broken]);
  for (const [name, m] of machines) {
    const graded = gradeQuestion(q, m);
    const problems: string[] = [];
    if (q.buildMode === 'turbot') {
      const bank = q.turbot_cases ?? [];
      if ((graded.turbotCases ?? []).length !== bank.length) problems.push('turbotCases not parallel to turbot_cases');
      bank.forEach((_, k) => {
        const live = runTurbotCase(q, m, k);
        turbotCasesCompared++;
        if (!same(canon(live), canon(graded.turbotCases?.[k]))) {
          problems.push(`arena ${k}: ${JSON.stringify(canon(live))} vs ${JSON.stringify(canon(graded.turbotCases?.[k]))}`);
        }
      });
    } else {
      const bank = q.test_cases ?? [];
      if (graded.cases.length !== bank.length) problems.push('cases not parallel to test_cases');
      bank.forEach((tc, k) => {
        const rec = graded.cases[k];
        if (!rec || !same(rec.input, tc.inputs)) problems.push(`case ${k}: input not parallel`);
        if (!same(rec?.separations, tc.separations)) problems.push(`case ${k}: separations not carried`);
        if (tc.separations) separationsSeen++;
        const live = runValueCase(q, m, tc.inputs, tc.separations);
        valueCasesCompared++;
        if (live.reason !== rec?.reason) problems.push(`case ${k}: reason ${live.reason} vs ${rec?.reason}`);
        else if (live.reason === undefined && !same(live.got, rec?.got)) {
          problems.push(`case ${k}: got ${JSON.stringify(live.got)} vs ${JSON.stringify(rec?.got)}`);
        }
      });
    }
    if (problems.length > 0 || name !== 'empty') {
      check(`${id} ${name}: caseRun ≡ grader on every case`, problems.length === 0, problems.slice(0, 3).join(' | '));
    }
  }
}
check(`compared ${valueCasesCompared} value cases and ${turbotCasesCompared} arenas (non-trivial)`,
  valueCasesCompared > 500 && turbotCasesCompared > 10);
check(`hw5-p4's gap cases carry their separations onto the result (${separationsSeen} seen)`, separationsSeen >= 48);

// ── [MEM scratch] ───────────────────────────────────────────────────────────
console.log('\n[MEM scratch: every machine is graded from rest]');
function withMems(c: CircuitData, v: number): CircuitData {
  return { ...c, components: c.components.map((x) => (x.type === 'MEM' ? { ...x, storedValue: v } : x)) };
}
for (const id of ['hw3-p7', 'hw3-p6', 'hw3-p14']) {
  const fx = loadFixture(id);
  const dirty = withMems(fx.correct, 1);
  check(`${id}: saved with every MEM = 1, grades exactly as from rest`,
    same(canon(gradeQuestion(fx.question, dirty)), canon(gradeQuestion(fx.question, withMems(fx.correct, 0)))));
  check(`${id}: gradingCircuit zeroes the MEMs`,
    gradingCircuit(dirty).components.every((x) => x.type !== 'MEM' || x.storedValue === 0));
}
{
  // The pin has teeth: the raw SC engine seeds MEMs from storedValue, so the
  // same run from the dirty circuit differs.
  const fx = loadFixture('hw3-p7');
  const differs = (fx.question.test_cases ?? []).some((tc) => {
    const stim = caseStimulus(fx.question, tc.inputs);
    if (stim?.axis !== 'time') return false;
    const dirty = withMems(fx.correct, 1);
    return !same(
      evaluateSCSequence(dirty.components, dirty.wires, stim.steps),
      evaluateSCSequence(fx.correct.components, fx.correct.wires, stim.steps),
    );
  });
  check("hw3-p7: the raw engine WOULD run a dirty circuit's MEMs from 1 (so the pin bites)", differs);
}

// ── The REAL store, headless ────────────────────────────────────────────────
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
const { useStore, selectTurbotArena, selectQuestionStepBudget, UI_RUN_STEP_CAP } = await import('../src/store');

async function waitUntil(pred: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Open `q` (alone in an assignment) with `machine` on the canvas, graded and
 *  recorded as the latest submission. `remote` swaps in a student's copy of
 *  both (server/src/sanitize.ts). Returns the FULL grade (the reference). */
/** `machine` submitted for `q` as attempt `attempt` of `full`, graded. */
function gradedRecord(full: AssignmentData, q: AssignmentQuestion, machine: CircuitData, attempt = 1): SubmissionRecord {
  const graded = gradeQuestion(q, machine);
  return {
    assignmentId: full.id,
    attempt,
    submittedAt: '2026-09-23T00:00:00.000Z',
    submission: {
      assignmentTitle: full.title,
      submittedAt: '2026-09-23T00:00:00.000Z',
      answers: [{ questionId: q.id, circuit: clone(machine) }],
    },
    result: { student: 's', questions: [graded], passed: graded.passed, total: graded.total },
  };
}

function openGraded(q: AssignmentQuestion, machine: CircuitData, remote = false): QuestionResult {
  const full: AssignmentData = { id: `case-run-${q.label}-${remote ? 'r' : 'l'}`, title: 'case run check', questions: [q] };
  const record = gradedRecord(full, q, machine);
  const graded = record.result!.questions[0];
  const store = useStore.getState();
  store.loadAssignment(remote ? stripAnswers(full) : full);
  useStore.setState({
    components: clone(machine.components),
    wires: clone(machine.wires),
    submissions: { [full.id]: remote ? studentRecord(record, true) : record },
  });
  return graded;
}

function noAnswerKey(label: string) {
  const lc = useStore.getState().loadedCase;
  check(`${label}: loadedCase carries no expected/got`,
    lc !== null && !/"(expected|got)"/.test(JSON.stringify(lc)));
}

/** The failing case indices of a graded value/turbot question (all, capped). */
function failingIndices(r: QuestionResult, cap: number): number[] {
  const list = r.turbotCases ?? r.cases;
  return list.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass).map(({ k }) => k).slice(0, cap);
}

/** The value-mode store load pin for case k (both shapes). */
async function pinValueLoad(tag: string, q: AssignmentQuestion, full: QuestionResult, k: number) {
  const tc = full.cases[k];
  const label = `${tag} case ${k} (${tc.input.join(',')}${tc.separations ? ` gap ${tc.separations.join(',')}` : ''})`;
  await useStore.getState().loadCaseInput(q.id, k);
  const s = useStore.getState();
  const layout = questionLayout(q)!;
  const stim = caseStimulus(q, tc.input, tc.separations)!;
  noAnswerKey(label);
  // The live verdict (what the banner shows) equals the recorded case.
  const lc = s.loadedCase;
  const live = lc && lc.kind === 'value' ? runValueCase(q, { components: s.components, wires: s.wires }, lc.input, lc.separations) : null;
  check(`${label}: live verdict = recorded (${tc.reason ?? `got ${tc.got.join(',')}`})`,
    live !== null && live.reason === tc.reason && (tc.reason !== undefined || same(live.got, tc.got)));

  if (q.buildMode === 'CC') {
    const ins = sortByLabel(s.components, 'IN').map((c) => c.value);
    check(`${label}: CC INPUT toggles by label = the codec's bits`, stim.axis === 'space' && same(ins, stim.bits));
    const outBits = sortByLabel(s.components, 'OUT').map((c) => c.value ?? 0);
    const raw = { axis: 'space' as const, bits: outBits };
    check(`${label}: CC outputs decode to the recorded result`,
      tc.reason === 'malformed output' ? !outputAccepted(raw, layout) : same(decodeOutput(raw, layout), tc.got));
  } else if (q.buildMode === 'SC') {
    const hist = s.scHistory.slice().sort((a, b) => a.t - b.t);
    check(`${label}: SC fed the codec's stream`, stim.axis === 'time' && same(hist.map((h) => h.inputBits), stim.steps));
    const raw = { axis: 'time' as const, steps: hist.map((h) => h.outputBits) };
    check(`${label}: SC window outputs decode to the recorded result`,
      tc.reason === 'malformed output' ? !outputAccepted(raw, layout) : same(decodeOutput(raw, layout), tc.got));
  } else if (q.buildMode === 'FSM') {
    const hist = s.fsmHistory.slice().sort((a, b) => a.t - b.t);
    check(`${label}: FSM fed the codec's symbols`,
      stim.axis === 'time' && same(hist.map((h) => String(h.input)), stim.steps.map((r) => r.join(''))));
    const raw = { axis: 'time' as const, steps: hist.map((h) => String(h.output).split('').map(Number)) };
    check(`${label}: FSM outputs decode to the recorded result`,
      tc.reason === 'malformed output'
        ? !outputAccepted(raw, layout)
        : tc.reason !== undefined
          ? s.fsmHalted
          : same(decodeOutput(raw, layout), tc.got));
  } else {
    const notation = notationForRepresentation(q.representation);
    const wantTape: TMTape = encodeTM(notation, tc.input, tc.separations);
    check(`${label}: TM initial tape = encodeTM with the case's separations`,
      stim.axis === 'tape' && same(s.tmInitialTape, wantTape) && same(stim.tape, wantTape));
    const run = {
      tape: s.tmTape,
      halted: s.tmHalted,
      steps: s.tmHistory.length,
      hitStepLimit: !s.tmHalted,
      history: s.tmHistory,
      finalStateId: s.tmCurrentStateId,
    };
    const rej = acceptTM(notation, run, { requireStandardHaltPosition: q.requireStandardHaltPosition });
    const budgetReason = tc.reason?.includes('tape cells');
    check(`${label}: TM end state is the recorded result`,
      tc.reason === undefined
        ? rej === null && decodeTM(notation, s.tmTape) === tc.got[0]
        : budgetReason
          ? rej === null && tapeCellsUsed(run, s.tmInitialTape) > (q.maxTapeCells ?? Infinity)
          : rej?.reason === tc.reason);
    if (s.tmHistory.length <= 1500) {
      const fastTape = clone(s.tmTape);
      const fastHistory = clone(s.tmHistory);
      s.tmReset();
      for (let i = 0; i < 1600 && !useStore.getState().tmHalted; i++) useStore.getState().tmStep();
      const t = useStore.getState();
      check(`${label}: TM Reset + Step replays to the same tape and history`,
        same(t.tmTape, fastTape) && same(t.tmHistory, fastHistory));
    }
  }
}

/** The turbot store load pin for arena k. */
async function pinTurbotLoad(tag: string, q: AssignmentQuestion, full: QuestionResult, k: number) {
  const rec = full.turbotCases![k];
  const label = `${tag} arena ${k}`;
  await useStore.getState().loadCaseInput(q.id, k);
  const s = useStore.getState();
  noAnswerKey(label);
  check(`${label}: the Map shows turbot_cases[${k}]'s arena`,
    same(selectTurbotArena(s), q.turbot_cases![k].arena) && s.turbotCaseIndex === k);
  check(`${label}: run ends where the grader's did (${rec.stepsTaken} steps, (${rec.finalPosition.x}, ${rec.finalPosition.y}) ${rec.finalPosition.facing})`,
    s.turbotHalted && s.turbotHistory.length === rec.stepsTaken && same(s.turbotState, rec.finalPosition),
    `store: ${s.turbotHistory.length} steps, ${JSON.stringify(s.turbotState)} (${s.turbotStopReason})`);
  const live = runTurbotCase(q, { components: s.components, wires: s.wires }, k);
  check(`${label}: live verdict = recorded`, same(canon(live), canon(rec)));
}

console.log('\n[store load: local mode]');
const VALUE_ROWS: [string, number][] = [
  ['hw2-p1', 4], // CC binary
  ['hw1-p16', 2], // CC tally
  ['hw3-p7', 4], // SC tally
  ['hw3-p6', 4], // SC binary
  ['hw4-p3', 4], // FSM tally
  ['hw4-p11', 4], // FSM binary, k=2 input groups
  ['hw5-p4', 6], // TM tally, gap cases
  ['hw5-p9', 4], // TM binary
];
for (const [id, cap] of VALUE_ROWS) {
  const fx = loadFixture(id);
  const full = openGraded(fx.question, fx.broken!);
  const ks = failingIndices(full, cap);
  // hw5-p4: make sure gap cases are among those loaded.
  if (id === 'hw5-p4') {
    const gapFails = full.cases.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass && c.separations).map(({ k }) => k);
    ks.push(...gapFails.slice(0, 3));
  }
  check(`${id}: the broken machine fails some cases to load`, ks.length > 0);
  for (const k of ks) {
    openGraded(fx.question, fx.broken!);
    await pinValueLoad(id, fx.question, full, k);
  }
}
const TURBOT_ROWS: [string, CircuitData | null][] = [
  ['hw2-p13', null], // CC brain
  ['hw3-p14', null], // SC brain, 3 arenas
  ['hw4-p14', null], // FSM brain
  ['hw6-p2', wandererBrain], // TM brain that never stops: 'exceeded max steps'
];
for (const [id, alt] of TURBOT_ROWS) {
  const fx = loadFixture(id);
  const machine = alt ?? fx.correct;
  const full = openGraded(fx.question, machine);
  // Every arena, passing or not (k > 0 included): any case is loadable.
  for (let k = 0; k < (fx.question.turbot_cases ?? []).length; k++) {
    openGraded(fx.question, machine);
    await pinTurbotLoad(`${id}${alt ? ' (wanderer)' : ''}`, fx.question, full, k);
  }
}

console.log('\n[store load: remote shape — student copy, no bank, no key]');
for (const [id, cap] of [['hw5-p4', 0], ['hw3-p7', 3], ['hw4-p11', 3], ['hw2-p1', 3]] as [string, number][]) {
  const fx = loadFixture(id);
  const full = gradeQuestion(fx.question, fx.broken!);
  const ks = id === 'hw5-p4'
    ? full.cases.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass && c.separations).map(({ k }) => k).slice(0, 4)
    : failingIndices(full, cap);
  check(`${id} (remote): cases to load`, ks.length > 0);
  for (const k of ks) {
    openGraded(fx.question, fx.broken!, true);
    const s = useStore.getState();
    check(`${id} (remote) case ${k}: the student copy has no bank and no key`,
      (s.assignment?.questions[0].test_cases ?? []).length === 0 &&
        s.submissions[s.assignment!.id].result!.questions[0].cases.every((c) => c.expected.length === 0 && c.got.length === 0));
    // Reference: the FULL bank's case (the grader's tape), checked against
    // what a student gets from their own record alone.
    await pinValueLoad(`${id} (remote)`, s.assignment!.questions[0], full, k);
  }
}

// ── [same question] ─────────────────────────────────────────────────────────
console.log('\n[same question: a load mid-run restarts the run, keeps undo]');
{
  const fx = loadFixture('hw3-p7');
  const full = openGraded(fx.question, fx.broken!);
  const k = failingIndices(full, 1)[0];
  const store = useStore.getState();
  store.setScGlobalSequenceInput(0, '111');
  store.loadScGlobalSequence(0);
  store.scStep();
  store.scStep();
  store.scRun();
  const undoMark = { components: [], wires: [], boxes: [], confirmedBoxes: [] };
  useStore.setState({ undoStack: [undoMark], redoStack: [undoMark] });
  check('mid-run: an SC run is in flight', useStore.getState().scRunning && useStore.getState().scHistory.length === 2);
  await useStore.getState().loadCaseInput(fx.question.id, k);
  const s = useStore.getState();
  const win = Math.max(...questionLayout(fx.question)!.inputWidths, ...questionLayout(fx.question)!.outputWidths);
  check('the in-flight run stopped (interval cleared)', !s.scRunning && s.scRunIntervalId === null);
  check(`the history is the case's run alone (${s.scHistory.length} steps = the window ${win})`,
    s.scHistory.length === win && s.scHistory[0].t === 1);
  check('the typed input is the case (one row)', s.scGlobalSequences.length === 1);
  check('undo/redo history kept (a load is not a canvas swap)', s.undoStack.length === 1 && s.redoStack.length === 1);
  await new Promise((r) => setTimeout(r, 400));
  check('…and no stale interval steps it further', useStore.getState().scHistory.length === win);

  // TM mid-run: tmRun in flight, then a load.
  const tm = loadFixture('hw5-p9');
  const tmFull = openGraded(tm.question, tm.broken!);
  const tk = failingIndices(tmFull, 1)[0];
  useStore.getState().setTmCell(0);
  useStore.getState().tmRun();
  await useStore.getState().loadCaseInput(tm.question.id, tk);
  const t = useStore.getState();
  check('TM: the in-flight run stopped, the case tape is loaded',
    !t.tmRunning && t.tmRunIntervalId === null &&
      same(t.tmInitialTape, encodeTM('binary', tmFull.cases[tk].input, tmFull.cases[tk].separations)));

  // A stale load (superseded before its deferred run) applies nothing.
  const fsm = loadFixture('hw4-p11');
  const fsmFull = openGraded(fsm.question, fsm.broken!);
  const [k1, k2] = failingIndices(fsmFull, 2);
  const first = useStore.getState().loadCaseInput(fsm.question.id, k1);
  const second = useStore.getState().loadCaseInput(fsm.question.id, k2);
  await Promise.all([first, second]);
  const f = useStore.getState();
  const stim2 = caseStimulus(fsm.question, fsmFull.cases[k2].input)!;
  check('a superseded load runs nothing: only the newer case ran',
    f.loadedCase?.caseIndex === k2 && stim2.axis === 'time' &&
      same(f.fsmHistory.map((h) => String(h.input)), stim2.steps.map((r) => r.join(''))));

  // A different question id, or a case the record doesn't have, is a no-op.
  await useStore.getState().loadCaseInput(9999, 0);
  check('a load for a question that is not open changes nothing', useStore.getState().loadedCase?.caseIndex === k2);
  await useStore.getState().loadCaseInput(fsm.question.id, 99999);
  check('a load for a case the record lacks changes nothing', useStore.getState().loadedCase?.caseIndex === k2);
}

// ── [older results] ─────────────────────────────────────────────────────────
console.log('\n[older results: graded before cases recorded their separations]');
{
  const fx = loadFixture('hw5-p4');
  const q = fx.question;
  const full: AssignmentData = { id: 'case-run-older', title: 'case run check', questions: [q] };
  const record = gradedRecord(full, q, fx.broken!);
  const graded = record.result!.questions[0];
  // What the grader stored before this change: no case carries separations.
  const older: SubmissionRecord = clone(record);
  for (const c of older.result!.questions[0].cases) delete c.separations;
  const gapKs = graded.cases.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass && c.separations).map(({ k }) => k);
  check('hw5-p4: the broken machine fails gap cases', gapKs.length > 0);
  check('served WITHOUT the assignment, an older student copy lacks them (the pin bites)',
    studentRecord(older, true).result!.questions[0].cases.every((c) => c.separations === undefined));
  const served = studentRecord(older, true, full);
  const servedCases = served.result!.questions[0].cases;
  check('served with the assignment: every case gets its bank separations back',
    same(servedCases.map((c) => c.separations ?? null), q.test_cases!.map((tc) => tc.separations ?? null)));
  check('…and still no answer key', servedCases.every((c) => c.expected.length === 0 && c.got.length === 0));
  const edited: AssignmentData = clone(full);
  const e0 = gapKs[0];
  edited.questions[0].test_cases![e0].inputs = edited.questions[0].test_cases![e0].inputs.map((v) => v + 1);
  check('a bank case whose input changed since grading vouches for nothing',
    studentRecord(older, true, edited).result!.questions[0].cases[e0].separations === undefined);
  // Remote: the student's copy (no bank) and the served record alone give
  // the grader's tape and the recorded verdict.
  for (const k of gapKs.slice(0, 3)) {
    useStore.getState().loadAssignment(stripAnswers(full));
    useStore.setState({ components: clone(fx.broken!.components), wires: clone(fx.broken!.wires), submissions: { [full.id]: served } });
    await pinValueLoad('hw5-p4 (remote, older result)', useStore.getState().assignment!.questions[0], graded, k);
  }
  // Local: the record as stored, the bank at hand.
  for (const k of gapKs.slice(0, 2)) {
    useStore.getState().loadAssignment(full);
    useStore.setState({ components: clone(fx.broken!.components), wires: clone(fx.broken!.wires), submissions: { [full.id]: older } });
    await pinValueLoad('hw5-p4 (local, older result)', q, graded, k);
  }
}

// ── [resubmit] ──────────────────────────────────────────────────────────────
console.log("\n[resubmit: the banner compares against the case's own attempt]");
{
  const fx = loadFixture('hw2-p1');
  const q = fx.question;
  const full: AssignmentData = { id: 'case-run-resubmit', title: 'case run check', questions: [q] };
  const first = gradedRecord(full, q, fx.broken!, 1);
  const k = failingIndices(first.result!.questions[0], 1)[0];
  useStore.getState().loadAssignment(full);
  useStore.setState({ components: clone(fx.broken!.components), wires: clone(fx.broken!.wires), submissions: { [full.id]: first } });
  await useStore.getState().loadCaseInput(q.id, k);
  const view = () => {
    const s = useStore.getState();
    return gradedCaseView(q, s.loadedCase!, { components: s.components, wires: s.wires }, s.submissions[full.id]?.attempt);
  };
  const v1 = view();
  check('attempt 1 on its own machine: ✗ recorded, "Same as when graded."',
    v1.note === 'same' && !v1.recorded.pass && v1.noteText === 'Same as when graded.');
  // The fix, on the canvas, not yet submitted: the settled divergence note.
  useStore.setState({ components: clone(fx.correct.components), wires: clone(fx.correct.wires) });
  const v2 = view();
  check('fixed on the canvas: "You\'ve changed this question since you submitted — this runs your current machine."',
    v2.note === 'changed' &&
      v2.noteText === "You've changed this question since you submitted — this runs your current machine.");
  // The fix submitted: attempt 2 is the latest record, the loaded case is
  // still attempt 1's (its ✗). Never "Same as when graded" beside it.
  useStore.setState({ submissions: { [full.id]: gradedRecord(full, q, fx.correct, 2) } });
  const v3 = view();
  check(`resubmitted: attempt 1's ✗ is not called the same run (${v3.note}: ${v3.noteText})`,
    v3.note === 'resubmitted' && !v3.recorded.pass && v3.noteText.includes('attempt 1') && v3.noteText.includes('current machine'));
  check('…and the live run is the fixed machine\'s (it decodes, no rejection)', v3.now.pass === undefined && v3.now.text.startsWith('output '));
  // Run again: the latest attempt's case, on its own machine.
  await useStore.getState().loadCaseInput(q.id, k);
  const v4 = view();
  check("Run again loads attempt 2's case: its ✓, the same run",
    useStore.getState().loadedCase?.attempt === 2 && v4.recorded.pass && v4.note === 'same');
  // A resubmit of the SAME machine still holds the graded one: the same run.
  useStore.setState({ components: clone(fx.broken!.components), wires: clone(fx.broken!.wires), submissions: { [full.id]: first } });
  await useStore.getState().loadCaseInput(q.id, k);
  useStore.setState({ submissions: { [full.id]: gradedRecord(full, q, fx.broken!, 2) } });
  check('a resubmit of the very machine graded in attempt 1 stays "same"', view().note === 'same');
}

// ── [viewed attempt] ────────────────────────────────────────────────────────
console.log('\n[viewed attempt: a case replays the attempt on show]');
{
  const fx = loadFixture('hw2-p1');
  const q = fx.question;
  const full: AssignmentData = { id: 'case-run-viewed', title: 'case run check', questions: [q] };
  const first = gradedRecord(full, q, fx.broken!, 1);
  const k = failingIndices(first.result!.questions[0], 1)[0];
  // The live canvas holds the fix; attempt 1 (the broken machine) is viewed…
  useStore.getState().loadAssignment(full);
  useStore.setState({ components: clone(fx.correct.components), wires: clone(fx.correct.wires), submissions: { [full.id]: first } });
  check('viewSubmission(1) resolves true', (await useStore.getState().viewSubmission(1)) === true);
  check("…and the canvas holds attempt 1's machine",
    gradedMachineKey({ components: useStore.getState().components, wires: useStore.getState().wires }) === gradedMachineKey(fx.broken!));
  // …and then the fix is submitted: attempt 2 is the latest.
  useStore.setState({ submissions: { [full.id]: gradedRecord(full, q, fx.correct, 2) } });
  await useStore.getState().loadCaseInput(q.id, k);
  {
    const s = useStore.getState();
    const lc = s.loadedCase;
    check("the case is attempt 1's (the attempt on show), its ✗ recorded",
      lc?.attempt === 1 && lc.kind === 'value' && !lc.recorded.pass && lc.gradedKey === gradedMachineKey(fx.broken!));
    const v = gradedCaseView(q, lc!, { components: s.components, wires: s.wires }, s.submissions[full.id]?.attempt);
    check('…so the banner reads "Same as when graded."', v.note === 'same' && v.noteText === 'Same as when graded.');
  }
  // Back to the live work: the same load replays the latest attempt (002).
  await useStore.getState().viewSubmission(null);
  await useStore.getState().loadCaseInput(q.id, k);
  check("on the live work the case is the latest attempt's (2)", useStore.getState().loadedCase?.attempt === 2);
  useStore.getState().closeAssignment();
}

// ── [dismiss] ───────────────────────────────────────────────────────────────
console.log('\n[dismiss: ✕ puts the Map back on the primary arena]');
{
  const fx = loadFixture('hw3-p14');
  const q: AssignmentQuestion = clone(fx.question);
  q.turbot_cases = q.turbot_cases!.map((tc, i) => ({ ...tc, maxSteps: tc.maxSteps + i }));
  openGraded(q, fx.correct);
  const last = q.turbot_cases.length - 1;
  await useStore.getState().loadCaseInput(q.id, last);
  check(`loaded: the Map on arena ${last}`, useStore.getState().turbotCaseIndex === last && last > 0);
  useStore.getState().clearLoadedCase();
  const s = useStore.getState();
  check('dismissed: no loaded case, arena index 0', s.loadedCase === null && s.turbotCaseIndex === 0);
  check('…the Map shows the primary arena with the turbot fresh at its start',
    same(selectTurbotArena(s), q.turbot_cases[0].arena) && same(s.turbotState, q.turbot_cases[0].arena.start) &&
      s.turbotHistory.length === 0 && !s.turbotHalted && !s.turbotRunning);
  check(`…and runs stop at the primary arena's budget (${q.turbot_cases[0].maxSteps})`,
    selectQuestionStepBudget(s) === q.turbot_cases[0].maxSteps);
  // A value case's dismissal leaves the run it made alone.
  const cc = loadFixture('hw2-p1');
  const ccFull = openGraded(cc.question, cc.broken!);
  await useStore.getState().loadCaseInput(cc.question.id, failingIndices(ccFull, 1)[0]);
  const before = JSON.stringify(useStore.getState().components);
  useStore.getState().clearLoadedCase();
  check('a value case dismissed: the loaded inputs stay on the canvas',
    useStore.getState().loadedCase === null && JSON.stringify(useStore.getState().components) === before);
}

// ── [step budgets] ──────────────────────────────────────────────────────────
console.log('\n[step budgets: question runs stop where the grader does]');
{
  check(`sandbox: no question budget (Run keeps the UI cap ${UI_RUN_STEP_CAP})`,
    selectQuestionStepBudget({ buildMode: 'TM', assignment: null, currentQuestionIndex: 0 }) === null &&
      UI_RUN_STEP_CAP === 1000);
  const tm = loadFixture('hw5-p9');
  openGraded(tm.question, tm.correct);
  check(`TM question: the budget is the grader's (${DEFAULT_TM_MAX_STEPS})`,
    selectQuestionStepBudget(useStore.getState()) === DEFAULT_TM_MAX_STEPS);
  // A TM Step past the budget is refused, as the grader never runs it.
  const looping: CircuitData = circuit(
    [comp('l-s0', 'STATE', 'S₀')],
    [transition('l-t1', 'l-s0', 'l-s0', '0:0,R'), transition('l-t2', 'l-s0', 'l-s0', '1:1,R'), transition('l-t3', 'l-s0', 'l-s0', '*:*,R')],
  );
  useStore.setState({ components: looping.components, wires: looping.wires });
  const fakeHistory = Array.from({ length: DEFAULT_TM_MAX_STEPS }, (_, i) => ({
    t: i + 1, stateLabel: 'S₀', read: '0' as const, action: '0,R', headBefore: i, nextStateLabel: 'S₀',
  }));
  useStore.setState({ tmHistory: fakeHistory, tmTimeStep: DEFAULT_TM_MAX_STEPS + 1 });
  useStore.getState().tmStep();
  check('TM question: a Step past the budget is refused',
    useStore.getState().tmHistory.length === DEFAULT_TM_MAX_STEPS && !useStore.getState().tmHalted);

  // Turbot: an arena with a tiny budget and a brain that never stops.
  const tb = loadFixture('hw3-p14');
  const q: AssignmentQuestion = clone(tb.question);
  q.turbot_cases = q.turbot_cases!.map((tc, i) => ({ ...tc, maxSteps: 3 + i }));
  // OUT1 = OUT2 = IN1 OR NOT IN1 = 1: motor 11, forward forever (into a
  // wall it just stays put) — it never stops.
  const spinner: CircuitData = circuit(
    [
      comp('in1', 'INPUT', 'IN1'),
      comp('n1', 'NOT', 'NOT'),
      comp('or1', 'OR', 'OR'),
      comp('o1', 'OUTPUT', 'OUT1'),
      comp('o2', 'OUTPUT', 'OUT2'),
    ],
    [
      wire('w1', 'in1', 'out', 'n1', 'in'),
      wire('w2', 'in1', 'out', 'or1', 'in1'),
      wire('w3', 'n1', 'out', 'or1', 'in2'),
      wire('w4', 'or1', 'out', 'o1', 'in'),
      wire('w5', 'or1', 'out', 'o2', 'in'),
    ],
  );
  q.innerMode = 'CC';
  openGraded(q, spinner);
  check('turbot question: the budget is the shown arena\'s maxSteps (3)',
    selectQuestionStepBudget(useStore.getState()) === 3);
  useStore.setState({ turbotCaseIndex: 2 });
  check('…and follows the arena a graded case put on the Map (5)',
    selectQuestionStepBudget(useStore.getState()) === 5);
  useStore.setState({ turbotCaseIndex: 0 });
  useStore.getState().turbotReset();
  useStore.getState().turbotRun();
  const stopped = await waitUntil(() => !useStore.getState().turbotRunning, 10000);
  const r = useStore.getState();
  check(`turbot question: Run stops at maxSteps with 'limit' (${r.turbotHistory.length} steps, ${r.turbotStopReason})`,
    stopped && r.turbotHistory.length === 3 && r.turbotHalted && r.turbotStopReason === 'limit');
  useStore.getState().turbotReset();
  for (let i = 0; i < 10; i++) useStore.getState().turbotStep();
  const st = useStore.getState();
  check('turbot question: Step stops at maxSteps too',
    st.turbotHistory.length === 3 && st.turbotHalted && st.turbotStopReason === 'limit');

  // An in-question SC brain starts from rest, whatever a MEM override left.
  const sc = loadFixture('hw3-p14');
  openGraded(sc.question, withMems(sc.correct, 1));
  useStore.getState().turbotReset();
  const mems = useStore.getState().turbotBrainState.memValues ?? [];
  check('turbot question: an SC brain starts with every MEM at 0 (the grader\'s start)',
    mems.length > 0 && mems.every((v) => v === 0));
}

console.log(failures === 0 ? '\nAll case-run checks passed.' : `\n${failures} case-run check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
