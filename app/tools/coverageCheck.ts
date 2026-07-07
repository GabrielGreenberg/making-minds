// Coverage harness — the adversarial backbone of the build-out loop.
//
//   npm run coverage        (from app/)   →   npx tsx tools/coverageCheck.ts
//
// Turns "the UI can construct a machine that solves every course problem" into a
// runnable assertion. Two independent parts:
//
//  1. SELF-TEST — reuses the existing devData sample machines (correct +
//     incorrect, one per mode) to prove that the harness's assert-pass /
//     assert-fail machinery genuinely *discriminates* across all five modes,
//     today, before any course fixtures exist. This is the proof-of-life.
//     Additionally, synthetic in-memory tripwires prove that each hardening bar
//     (breadth WARN, statement lint, layout oracle) actually fires.
//
//  2. LEDGER — reads fixtures/coverage-manifest.json (one row per
//     machine-buildable problem in HW1–HW6). Rows come in two TIERS:
//
//     - tier "exact" (default) — the correct machine passes every case while
//       the deliberately-broken variant does not (the grader must discriminate,
//       not rubber-stamp). The bar for arithmetic, where correct solutions are
//       cheap; verified rows stay exact as regression pins.
//     - tier "interface" — the CURRENT bar for perception/navigation (user
//       directive 2026-07-06): the point is that the INTERFACE exists, not that
//       the answer is right. The fixture's machine is a *plausible attempt*; the
//       row is green ("interface") when the machine passes Stage-1 validation
//       (the editor/engine can express a well-formed machine of this shape) and
//       the real grader runs it end-to-end to a per-case result. Its SCORE is
//       reported but NOT asserted; no broken variant is required. Getting
//       exactly-correct answers is a separate, future project — do not spend
//       tokens chasing them.
//
//     Rows without a fixture are `pending` — the expected state until the loop
//     fills them in, and NOT a failure.
//
//     On top of the pass/fail spine, each fixtured row runs through four bars:
//       - broken-breadth (WARN)     — how much of the bank the broken variant
//                                     actually trips (see BREADTH POLICY below)
//       - drain coverage (WARN)     — SC/FSM banks must exercise drain steps
//                                     when the widths make that possible
//       - statement lint (FAIL)     — question.statement must be clean prose
//       - layout oracle  (FAIL)     — CC/SC machines must render without
//                                     overlapping/colliding wires (layoutCheck.ts)
//     WARN bars never change row state or the exit code; FAIL bars mark the row
//     REGRESSED.
//
// Exit code = self-test failures + regressions (a fixtured row whose assertions
// broke). `pending` rows never fail the run, so `npm run coverage` is green today
// and stays a meaningful gate as fixtures accrue. A machine-readable JSON summary
// is printed between markers so a loop iteration can reconcile COVERAGE.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import type { AssignmentQuestion, CircuitData, RepSystem } from '../src/types';
import { gradeQuestion, type QuestionResult } from '../src/engine/grader';
import { axisForMode, encodeInput, type CodecLayout } from '../src/engine/codec';
import { validateMachine } from '../src/engine/machineValidation';
import { validateTurbotTM, validateTurbotFSM } from '../src/engine/turbot';
import { validatePerceptionMachine } from '../src/engine/perception';
import { notationForRepresentation } from '../src/engine/tmCodec';
import { checkCircuitLayout } from './layoutCheck';
import { comp, wire, circuit } from './builder';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
} from '../src/devData/sampleData';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const MANIFEST_PATH = join(FIXTURES, 'coverage-manifest.json');

// ─── Manifest + fixture shapes ───────────────────────────────────────────────

interface ManifestRow {
  id: string;
  hw: string;
  problem: string;
  mode: string;
  category: string;
  title: string;
  /** Path to a reference fixture, relative to tools/fixtures/, or null. */
  fixture: string | null;
  /** Bookkeeping mirror of the real state; the harness is authoritative. */
  status: string;
  /** Verification tier — see header. Absent = 'exact'. */
  tier?: 'exact' | 'interface';
  notes?: string;
}

interface Manifest {
  meta?: Record<string, unknown>;
  rows: ManifestRow[];
}

// A reference fixture is self-contained: the authored question plus a machine.
// For tier "exact", `correct` is a correct solution and `broken` (strongly
// encouraged) a deliberately-wrong one. For tier "interface", `correct` is a
// *plausible attempt* — its score is reported, not asserted — and `broken` is
// optional/ignored. For navigation (turbot) questions, arena *generality* is
// expressed by putting several arenas in question.turbot_cases.
interface ReferenceFixture {
  question: AssignmentQuestion;
  correct: CircuitData;
  broken?: CircuitData;
}

type RowState = 'verified' | 'interface' | 'regressed' | 'pending';

// ─── Grading helper ──────────────────────────────────────────────────────────

/** True iff the result says the machine passed every one of its cases. */
function isFullPass(r: QuestionResult): boolean {
  return r.status === 'graded' && r.total > 0 && r.passed === r.total;
}

/** True iff the machine is graded and passes every one of its cases. */
function allPass(question: AssignmentQuestion, machine: CircuitData): boolean {
  return isFullPass(gradeQuestion(question, machine));
}

// ─── Stage-1 validation mirror (interface tier) ──────────────────────────────
// The grader reports a Stage-1-invalid machine as `graded` with 0/total (never
// `skipped`), so the interface tier needs the validation verdict directly. This
// mirrors the dispatch in grader.ts (gradeQuestion / gradeTape / gradeTurbot /
// gradePerception Stage-1 blocks) — if that dispatch changes, change this too.

function validateStage1(
  question: AssignmentQuestion,
  machine: CircuitData,
): { ok: boolean; reason?: string } {
  const rep: RepSystem = question.representation ?? 'binary';

  // Open questions have no machine and no Stage 1 (gradeQuestion short-circuits
  // to 'pending' before any validation); fixtures are never open questions.
  if (question.buildMode === 'open') return { ok: true };

  if (question.buildMode === 'turbot') {
    const innerMode = question.innerMode;
    if (!innerMode) return { ok: false, reason: 'question has no inner mode set' };
    // The question's encoding picks a turbot TM's internal tape alphabet
    // (binary {0,1,*}, unary {0,1}) — same mapping as gradeTurbot.
    const notation = notationForRepresentation(question.representation ?? 'binary');
    if (innerMode === 'TM' || innerMode === 'FSM') {
      const errors = innerMode === 'TM'
        ? validateTurbotTM(machine.components, machine.wires, notation)
        : validateTurbotFSM(machine.components, machine.wires);
      return errors.length === 0
        ? { ok: true }
        : { ok: false, reason: errors.map((e) => e.message).join(' ') };
    }
    // CC/SC brains: the fixed 1-bit sensor / 2-bit motor layout (grader's turbotLayout).
    const layout: CodecLayout =
      innerMode === 'SC'
        ? { axis: 'time', rep: 'binary', inputWidths: [1], outputWidths: [1, 1] }
        : { axis: 'space', rep: 'binary', inputWidths: [1], outputWidths: [2] };
    return validateMachine(machine, innerMode, layout, rep);
  }

  // Perception questions: Stage 1 is the retina interface — `width` input
  // wires, one output wire (gradePerception's validatePerceptionMachine).
  if (question.perception) {
    return validatePerceptionMachine(machine, question.perception.width);
  }

  const mode = question.buildMode;
  const axis = axisForMode(mode);
  if (axis === 'tape') {
    return validateMachine(machine, 'TM', { axis: 'tape', rep, inputWidths: [], outputWidths: [] }, rep);
  }
  const spec = question.cc_spec;
  if (!spec) return { ok: false, reason: 'question has no cc_spec (group widths unknown)' };
  const layout: CodecLayout = {
    axis,
    rep,
    inputWidths: spec.inputs.map((g) => g.width),
    outputWidths: spec.outputs.map((g) => g.width),
  };
  return validateMachine(machine, mode, layout, rep);
}

// ─── Bar 1: broken-breadth ───────────────────────────────────────────────────
// BREADTH POLICY. The broken variant's fail fraction (failed cases / bank size)
// measures how much of the bank the adversarial check really exercises.
//   - SAMPLED banks (SC, FSM, TM — the time/tape axes test a *sample* of the
//     input space): a broken machine that trips < 25% of the bank is a narrow
//     near-miss; on a sampled bank that means most of the sample never
//     discriminates, so the row gets a WARN. Warnings never change row state or
//     the exit code; a summary count is printed instead.
//   - EXHAUSTIVE banks (CC — every input value 0..max is enumerated): a narrow
//     near-miss is legitimate because the whole input space is tested (e.g.
//     hw2-p6's broken variant fails exactly 1/16 by design), so the fraction is
//     printed as info only, never warned about.
// Turbot rows (hand-authored arenas, positional grading) also print info only.

const SAMPLED_MODES = new Set(['SC', 'FSM', 'TM']);
const BREADTH_WARN_FRACTION = 0.25;

function fractionLabel(failed: number, total: number): string {
  return `${failed}/${total} (${Math.round((failed / total) * 100)}%)`;
}

function breadthWarning(mode: string, failed: number, total: number): string | null {
  if (!SAMPLED_MODES.has(mode)) return null;
  if (total === 0 || failed / total >= BREADTH_WARN_FRACTION) return null;
  return `breadth: broken variant fails only ${fractionLabel(failed, total)} of a SAMPLED bank (< 25%)`;
}

// ─── Bar 2: drain coverage (SC/FSM) ──────────────────────────────────────────
// Time-axis runs feed input for max(inputWidth) steps, then keep stepping on
// zero input ("drain steps") so delayed bits reach the output. A bank whose
// every expected output fits inside the input window never checks that a
// machine emits during drain — a serial adder that drops its final carry would
// still pass. If the widths make a drain-emitting case possible (outputWidth >
// inputWidth) but the bank contains none, WARN. If outputWidth == inputWidth
// (e.g. identity), drain is unreachable by construction — no warning.

function drainWarning(mode: string, question: AssignmentQuestion): string | null {
  if (mode !== 'SC' && mode !== 'FSM') return null;
  const spec = question.cc_spec;
  const cases = question.test_cases;
  if (!spec || !cases || cases.length === 0) return null;

  const inputWidths = spec.inputs.map((g) => g.width);
  const outputWidths = spec.outputs.map((g) => g.width);
  const maxIn = Math.max(...inputWidths);
  const maxOut = Math.max(...outputWidths);
  if (maxOut <= maxIn) return null; // drain unreachable by construction

  // Encode each case's EXPECTED OUTPUT on the time axis (same codec the grader
  // uses) and look for a nonzero bit at a step >= the input width — i.e. a case
  // that only passes if the machine emits during drain steps.
  const outLayout: CodecLayout = {
    axis: 'time',
    rep: question.representation ?? 'binary',
    inputWidths: outputWidths, // encode outputs → widths in the input slot
    outputWidths,
  };
  const covered = cases.some((tc) => {
    const enc = encodeInput(tc.outputs, outLayout);
    if (enc.axis !== 'time') return false;
    for (let t = maxIn; t < enc.steps.length; t++) {
      if (enc.steps[t].some((b) => b !== 0)) return true;
    }
    return false;
  });
  return covered
    ? null
    : `drain: output width ${maxOut} > input width ${maxIn}, but no case's expected output has a bit at step >= ${maxIn} (drain steps untested)`;
}

// ─── Bar 3: statement lint (hard FAIL) ───────────────────────────────────────
// Every wired fixture's question.statement must be clean prose:
//   (a) no ledger-shorthand prefix ("+2 [0-15] B. …", "2x B. …", "x+y T. …" —
//       a short formula-ish leading token ending in " B." or " T.");
//   (b) no answer-giveaway parenthetical ("(It is possible…", "(Yes,…") — the
//       feasibility questions must not carry their own answer;
//   (c) non-empty.
// A violation is a hard failure: the row is marked REGRESSED.

const SHORTHAND_PREFIX = /^[\s0-9xXyY+\-*/()[\]<>=,]{1,24}[BT]\.(\s|$)/;
const GIVEAWAY_PARENTHETICALS = ['(it is possible', '(yes,', '(yes:'];

function lintStatement(statement: string | undefined): string[] {
  const problems: string[] = [];
  const text = (statement ?? '').trim();
  if (text.length === 0) {
    problems.push('statement lint: statement is empty');
    return problems;
  }
  if (SHORTHAND_PREFIX.test(text)) {
    problems.push('statement lint: begins with ledger shorthand (e.g. "2x B.") instead of prose');
  }
  const lower = text.toLowerCase();
  for (const g of GIVEAWAY_PARENTHETICALS) {
    if (lower.includes(g)) {
      problems.push(`statement lint: answer-giveaway parenthetical ("${g}…")`);
      break;
    }
  }
  return problems;
}

// ─── Bar 4: layout oracle gate (hard FAIL, CC/SC rows only) ──────────────────
// CC/SC machines route through src/wireRouter exactly as CircuitCanvas renders
// them; layoutCheck.ts asserts no different-source collinear/near-parallel
// overlaps, no wires through foreign bodies, no overlapping component boxes.
// FSM/TM/turbot STATE-node curves bypass the router — skipped by mode.

const LAYOUT_MODES = new Set(['CC', 'SC']);

function layoutProblems(mode: string, fx: ReferenceFixture): string[] {
  if (!LAYOUT_MODES.has(mode)) return [];
  const violations = [
    ...checkCircuitLayout(fx.correct, 'correct'),
    ...(fx.broken ? checkCircuitLayout(fx.broken, 'broken') : []),
  ];
  return violations.map((v) => `layout: [${v.kind}] ${v.machine}: ${v.detail}`);
}

// ─── Reporting ───────────────────────────────────────────────────────────────

let selfTestFailures = 0;
function selfCheck(label: string, cond: boolean): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) selfTestFailures++;
}

// ─── 1. SELF-TEST ────────────────────────────────────────────────────────────
// The sample assignment carries questions across all modes (CC/SC/FSM/TM, one
// turbot per inner mode, and an open question); the correct submission must
// pass every case and the incorrect one must fail at least one (open questions
// instead grade to 'pending' — manual review). If this breaks, nothing else
// the harness reports can be trusted.

function runSelfTest(): void {
  console.log('SELF-TEST — harness discriminates correct vs. broken (devData)');
  const assignment = buildSampleAssignment();
  const correct = new Map(buildCorrectSubmission().answers.map((a) => [a.questionId, a.circuit]));
  const wrong = new Map(buildIncorrectSubmission().answers.map((a) => [a.questionId, a.circuit]));

  for (const q of assignment.questions) {
    const c = correct.get(q.id);
    const w = wrong.get(q.id);
    if (q.buildMode === 'open') {
      // Open questions are manually reviewed, not autograded: the pipeline's
      // contract is a 'pending' 0/0 result (pipelineCheck pins the response
      // payload), so there is no correct/broken discrimination to test here.
      const r = gradeQuestion(q, c);
      selfCheck(`${q.label} (${q.buildMode}) grades to pending (manual review, 0/0)`,
        r.status === 'pending' && r.total === 0 && r.passed === 0);
      continue;
    }
    selfCheck(`${q.label} (${q.buildMode}) correct passes`, !!c && allPass(q, c));
    selfCheck(`${q.label} (${q.buildMode}) broken fails`, !!w && !allPass(q, w));
  }
  console.log('');
}

// ─── 1b. SELF-TEST — synthetic tripwires ─────────────────────────────────────
// In-memory fixtures (NEVER added to the manifest) that prove the hardening
// bars actually fire: a checker that cannot fail is not checking anything.

/** SC question: bitwise OR of two 3-bit streams, hand-picked 9-case bank. */
function tripwireQuestion(statement: string): AssignmentQuestion {
  // 8 pairs with x & y == 0 (where OR == XOR) plus ONE pair with a shared bit
  // (3,1): the broken XOR machine fails exactly 1 of 9 sampled cases.
  const pairs: [number, number][] = [
    [1, 2], [1, 4], [1, 6], [2, 4], [2, 5], [3, 4], [0, 7], [5, 2], [3, 1],
  ];
  return {
    id: 901,
    label: 'Tripwire',
    statement,
    buildMode: 'SC',
    representation: 'binary',
    cc_spec: {
      inputs: [
        { name: 'x', width: 3 },
        { name: 'y', width: 3 },
      ],
      outputs: [{ name: 'out', width: 3, formula: 'x | y' }],
    },
    test_cases: pairs.map(([x, y]) => ({ inputs: [x, y], outputs: [x | y] })),
  };
}

/** Two input streams through one gate to one output; gate type is the knob. */
function tripwireMachine(gate: 'OR' | 'XOR'): CircuitData {
  return circuit(
    [
      comp('inx', 'INPUT', 'IN1', 100, 80),
      comp('iny', 'INPUT', 'IN2', 100, 220),
      comp('g1', gate, gate, 320, 130),
      comp('out1', 'OUTPUT', 'OUT1', 540, 150),
    ],
    [
      wire('w1', 'inx', 'out', 'g1', 'in1'),
      wire('w2', 'iny', 'out', 'g1', 'in2'),
      wire('w3', 'g1', 'out', 'out1', 'in'),
    ],
  );
}

/** Two wires from different sources forced onto the same target port: their
 *  final stub segments are identical → a different-source collinear overlap. */
function tripwireBadLayoutMachine(): CircuitData {
  return circuit(
    [
      comp('ina', 'INPUT', 'IN1', 100, 100),
      comp('inb', 'INPUT', 'IN2', 100, 200),
      comp('outc', 'OUTPUT', 'OUT1', 400, 150),
    ],
    [
      wire('w1', 'ina', 'out', 'outc', 'in'),
      wire('w2', 'inb', 'out', 'outc', 'in'),
    ],
  );
}

function tripwireRow(id: string, mode: string): ManifestRow {
  return {
    id,
    hw: 'SELF',
    problem: '-',
    mode,
    category: 'self-test',
    title: 'synthetic tripwire',
    fixture: '(in-memory)',
    status: '-',
  };
}

function runTripwires(): void {
  console.log('SELF-TEST — synthetic tripwires (the bars must actually fire)');

  const cleanStatement =
    'Design a sequential circuit that emits, on each clock tick, the OR of the two input bits arriving on IN1 and IN2.';
  const correct = tripwireMachine('OR');
  const broken = tripwireMachine('XOR');

  // (a) breadth: a sampled-mode (SC) row whose broken fails exactly 1 of 9
  // cases must stay verified but produce a breadth WARN.
  const breadth = evaluateFixture(tripwireRow('tripwire-breadth', 'SC'), {
    question: tripwireQuestion(cleanStatement),
    correct,
    broken,
  });
  selfCheck(
    'breadth tripwire: broken fails 1/9 of sampled bank → row verified + WARN',
    breadth.state === 'verified' && breadth.warnings.some((w) => w.startsWith('breadth:')),
  );
  selfCheck('breadth tripwire: clean statement passes lint', !breadth.detail.includes('statement lint'));

  // (b) statement lint: shorthand prefix and giveaway parenthetical must FAIL.
  const shorthand = evaluateFixture(tripwireRow('tripwire-lint-shorthand', 'SC'), {
    question: tripwireQuestion('2x B. Design a sequential circuit that doubles the input.'),
    correct,
    broken,
  });
  selfCheck(
    'lint tripwire: shorthand prefix ("2x B.") → REGRESSED',
    shorthand.state === 'regressed' && shorthand.detail.includes('ledger shorthand'),
  );
  const giveaway = evaluateFixture(tripwireRow('tripwire-lint-giveaway', 'SC'), {
    question: tripwireQuestion(
      'Is it possible to compute 2x with a sequential circuit? (It is possible — use a MEM block.)',
    ),
    correct,
    broken,
  });
  selfCheck(
    'lint tripwire: "(It is possible" giveaway → REGRESSED',
    giveaway.state === 'regressed' && giveaway.detail.includes('answer-giveaway'),
  );

  // (c) layout oracle: a two-wire CC machine deliberately laid out with a
  // different-source collinear overlap must FAIL the oracle and regress the row.
  const bad = tripwireBadLayoutMachine();
  const badLayout = evaluateFixture(tripwireRow('tripwire-layout', 'CC'), {
    question: {
      id: 902,
      label: 'Tripwire',
      statement: 'Wire two inputs into one output pin (deliberately illegal layout).',
      buildMode: 'CC',
      representation: 'binary',
      cc_spec: {
        inputs: [
          { name: 'a', width: 1, max_value: 1 },
          { name: 'b', width: 1, max_value: 1 },
        ],
        outputs: [{ name: 'y', width: 1, formula: 'a' }],
      },
      test_cases: [{ inputs: [0, 0], outputs: [0] }],
    },
    correct: bad,
    broken: bad,
  });
  selfCheck(
    'layout tripwire: different-source collinear overlap → REGRESSED',
    badLayout.state === 'regressed' && badLayout.detail.includes('collinear-overlap'),
  );

  // (d) interface tier: a valid-but-WRONG machine (XOR on the OR bank, fails
  // 1/9) must land in the green 'interface' state — correctness is explicitly
  // not required at this tier.
  const ifaceRow: ManifestRow = { ...tripwireRow('tripwire-iface-ok', 'SC'), tier: 'interface' };
  const ifaceOk = evaluateInterfaceFixture(ifaceRow, {
    question: tripwireQuestion(cleanStatement),
    correct: broken, // deliberately: the wrong machine, no broken variant
  });
  selfCheck(
    "interface tripwire: valid-but-wrong machine, no broken variant → 'interface' (green)",
    ifaceOk.state === 'interface' && ifaceOk.detail.includes('8/9'),
  );

  // (e) …but the tier is not a rubber stamp: a Stage-1-INVALID machine (one
  // INPUT for a two-group SC question) must regress.
  const invalidMachine = circuit(
    [comp('inx', 'INPUT', 'IN1', 100, 80), comp('out1', 'OUTPUT', 'OUT1', 400, 150)],
    [wire('w1', 'inx', 'out', 'out1', 'in')],
  );
  const ifaceBad = evaluateInterfaceFixture(
    { ...tripwireRow('tripwire-iface-invalid', 'SC'), tier: 'interface' },
    { question: tripwireQuestion(cleanStatement), correct: invalidMachine },
  );
  selfCheck(
    'interface tripwire: Stage-1-invalid machine → REGRESSED',
    ifaceBad.state === 'regressed' && ifaceBad.detail.includes('Stage-1'),
  );

  console.log('');
}

// ─── 2. LEDGER ───────────────────────────────────────────────────────────────

function resolveFixture(rel: string): string {
  return isAbsolute(rel) ? rel : join(FIXTURES, rel);
}

interface RowResult {
  row: ManifestRow;
  state: RowState;
  detail: string;
  /** WARN-level findings (breadth/drain); never change state or exit code. */
  warnings: string[];
  /** Broken variant's fail stats, when the broken machine was graded. */
  brokenFailed?: number;
  bankSize?: number;
  brokenFailFraction?: number;
}

/**
 * All bars for one wired fixture. Hard failures (grading spine, statement
 * lint, layout oracle) accumulate into `detail` and regress the row; WARN bars
 * (breadth, drain) accumulate into `warnings` and never change state.
 */
function evaluateFixture(row: ManifestRow, fx: ReferenceFixture): RowResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  let brokenFailed: number | undefined;
  let bankSize: number | undefined;

  // Bar 3 — statement lint (hard).
  problems.push(...lintStatement(fx.question.statement));

  // Grading spine: correct passes everything, broken fails something.
  const correctResult = gradeQuestion(fx.question, fx.correct);
  if (!isFullPass(correctResult)) {
    problems.push('reference (correct) machine does NOT pass all cases');
  }
  if (!fx.broken) {
    // The broken variant is what makes the check adversarial: a grader that
    // passes everything is worthless. Warn loudly (as a regression) if missing.
    problems.push('fixture has no broken variant (adversarial check missing)');
  } else {
    const brokenResult = gradeQuestion(fx.question, fx.broken);
    if (isFullPass(brokenResult)) {
      problems.push('broken variant wrongly PASSES (grader not discriminating)');
    } else if (brokenResult.status === 'graded' && brokenResult.total > 0) {
      // Bar 1 — broken-breadth (WARN; see BREADTH POLICY above).
      brokenFailed = brokenResult.total - brokenResult.passed;
      bankSize = brokenResult.total;
      const bw = breadthWarning(row.mode, brokenFailed, bankSize);
      if (bw) warnings.push(bw);
    }
  }

  // Bar 2 — drain coverage (WARN; SC/FSM only).
  const dw = drainWarning(row.mode, fx.question);
  if (dw) warnings.push(dw);

  // Bar 4 — layout oracle (hard; CC/SC only).
  problems.push(...layoutProblems(row.mode, fx));

  const state: RowState = problems.length > 0 ? 'regressed' : 'verified';
  return {
    row,
    state,
    detail: state === 'verified' ? 'correct passes, broken fails' : problems.join('; '),
    warnings,
    brokenFailed,
    bankSize,
    brokenFailFraction:
      brokenFailed !== undefined && bankSize ? brokenFailed / bankSize : undefined,
  };
}

/**
 * Interface-tier bars (see header): the machine must be a WELL-FORMED machine
 * of the question's mode (Stage-1 validation — the proof that the editor/engine
 * can express this shape) and the real grader must run it end-to-end to a
 * per-case result. Its score is reported, never asserted. Statement lint and
 * the layout oracle still apply (they are interface quality); breadth/drain
 * bars and the broken variant do not.
 */
function evaluateInterfaceFixture(row: ManifestRow, fx: ReferenceFixture): RowResult {
  const problems: string[] = [];

  problems.push(...lintStatement(fx.question.statement));

  const valid = validateStage1(fx.question, fx.correct);
  if (!valid.ok) {
    problems.push(`interface: machine fails Stage-1 validation (${valid.reason ?? 'invalid machine'})`);
  }

  const result = gradeQuestion(fx.question, fx.correct);
  if (result.status !== 'graded' || result.total === 0) {
    const why = result.status === 'skipped' ? (result.reason ?? 'skipped') : 'empty bank';
    problems.push(`interface: pipeline did not grade end-to-end (${why})`);
  }

  problems.push(...layoutProblems(row.mode, fx));

  const state: RowState = problems.length > 0 ? 'regressed' : 'interface';
  const score =
    result.status === 'graded' && result.total > 0
      ? `attempt scores ${result.passed}/${result.total}`
      : 'no score';
  return {
    row,
    state,
    detail:
      state === 'interface'
        ? `interface OK — valid machine, grades end-to-end (${score}; correctness not required)`
        : problems.join('; '),
    warnings: [],
  };
}

function evaluateRow(row: ManifestRow): RowResult {
  if (!row.fixture) {
    return { row, state: 'pending', detail: 'no reference fixture yet', warnings: [] };
  }

  let fx: ReferenceFixture;
  try {
    fx = JSON.parse(readFileSync(resolveFixture(row.fixture), 'utf8')) as ReferenceFixture;
  } catch (err) {
    return {
      row,
      state: 'regressed',
      detail: `fixture unreadable: ${(err as Error).message}`,
      warnings: [],
    };
  }

  if (!fx.question || !fx.correct) {
    return {
      row,
      state: 'regressed',
      detail: 'fixture missing question or correct machine',
      warnings: [],
    };
  }

  return row.tier === 'interface' ? evaluateInterfaceFixture(row, fx) : evaluateFixture(row, fx);
}

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as Manifest;
}

function runLedger(): { results: RowResult[]; regressions: number } {
  const manifest = loadManifest();
  const results = manifest.rows.map(evaluateRow);

  // Group progress by homework.
  const byHw = new Map<string, RowResult[]>();
  for (const r of results) {
    const list = byHw.get(r.row.hw) ?? [];
    list.push(r);
    byHw.set(r.row.hw, list);
  }

  console.log('COVERAGE LEDGER — exact ✓ / interface ◐ / pending · (HW1–HW6)');
  for (const [hw, rows] of byHw) {
    const verified = rows.filter((r) => r.state === 'verified').length;
    const iface = rows.filter((r) => r.state === 'interface').length;
    const green = iface > 0 ? `${verified} exact + ${iface} interface` : `${verified}`;
    console.log(`\n  ${hw}  (${green} / ${rows.length})`);
    for (const r of rows) {
      const mark =
        r.state === 'verified' ? '✓' : r.state === 'interface' ? '◐' : r.state === 'regressed' ? '✗' : '·';
      const fraction =
        r.brokenFailed !== undefined && r.bankSize
          ? `  [broken fails ${fractionLabel(r.brokenFailed, r.bankSize)}]`
          : '';
      console.log(
        `    ${mark} ${r.row.id.padEnd(10)} ${r.row.category.padEnd(11)} ${r.row.title}${fraction}`,
      );
      if (r.state === 'regressed') console.log(`        → ${r.detail}`);
      for (const w of r.warnings) console.log(`        WARN ${w}`);
    }
  }

  const verified = results.filter((r) => r.state === 'verified').length;
  const interfaceOnly = results.filter((r) => r.state === 'interface').length;
  const pending = results.filter((r) => r.state === 'pending').length;
  const regressions = results.filter((r) => r.state === 'regressed').length;
  const breadthWarnings = results.reduce(
    (n, r) => n + r.warnings.filter((w) => w.startsWith('breadth:')).length,
    0,
  );
  const drainWarnings = results.reduce(
    (n, r) => n + r.warnings.filter((w) => w.startsWith('drain:')).length,
    0,
  );

  console.log(
    `\n  totals: ${verified} exact-verified · ${interfaceOnly} interface-verified · ${pending} pending · ${regressions} regressed · ${results.length} in scope`,
  );
  console.log(`  warnings: ${breadthWarnings} breadth warnings · ${drainWarnings} drain warnings`);

  // Machine-readable summary for a loop iteration to reconcile COVERAGE.md.
  const summary = {
    verified,
    interface: interfaceOnly,
    pending,
    regressed: regressions,
    total: results.length,
    warnings: { breadth: breadthWarnings, drain: drainWarnings },
    rows: results.map((r) => ({
      id: r.row.id,
      state: r.state,
      detail: r.detail,
      ...(r.brokenFailed !== undefined ? { brokenFailed: r.brokenFailed } : {}),
      ...(r.bankSize !== undefined ? { bankSize: r.bankSize } : {}),
      ...(r.brokenFailFraction !== undefined
        ? { brokenFailFraction: Number(r.brokenFailFraction.toFixed(4)) }
        : {}),
      ...(r.warnings.length > 0 ? { warnings: r.warnings } : {}),
    })),
  };
  console.log('\n=== COVERAGE SUMMARY (json) ===');
  console.log(JSON.stringify(summary));
  console.log('=== END COVERAGE SUMMARY ===');

  return { results, regressions };
}

// ─── main ────────────────────────────────────────────────────────────────────

runSelfTest();
runTripwires();
const { regressions } = runLedger();

const failures = selfTestFailures + regressions;
console.log(`\n${failures === 0 ? 'COVERAGE OK' : `COVERAGE FAILED (${failures}: ${selfTestFailures} self-test, ${regressions} regressions)`}`);
process.exit(failures === 0 ? 0 : 1);
