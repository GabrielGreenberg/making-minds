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
//
//  2. LEDGER — reads fixtures/coverage-manifest.json (one row per
//     machine-buildable problem in HW1–HW6). For every row that has a reference
//     fixture, it runs the REAL grader and asserts the correct machine passes
//     every case while the deliberately-broken variant does not (the grader must
//     discriminate, not rubber-stamp). Rows without a fixture are `pending` — the
//     expected state until the loop fills them in, and NOT a failure.
//
// Exit code = self-test failures + regressions (a fixtured row whose assertions
// broke). `pending` rows never fail the run, so `npm run coverage` is green today
// and stays a meaningful gate as fixtures accrue. A machine-readable JSON summary
// is printed between markers so a loop iteration can reconcile COVERAGE.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import type { AssignmentQuestion, CircuitData } from '../src/types';
import { gradeQuestion } from '../src/engine/grader';
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
  notes?: string;
}

interface Manifest {
  meta?: Record<string, unknown>;
  rows: ManifestRow[];
}

// A reference fixture is self-contained: the authored question plus a correct
// machine and (strongly encouraged) a deliberately-broken one. For navigation
// (turbot) questions, arena *generality* is expressed by putting several arenas
// in question.turbot_cases — the grader already requires every case to pass.
interface ReferenceFixture {
  question: AssignmentQuestion;
  correct: CircuitData;
  broken?: CircuitData;
}

type RowState = 'verified' | 'regressed' | 'pending';

// ─── Grading helper ──────────────────────────────────────────────────────────

/** True iff the machine is graded and passes every one of its cases. */
function allPass(question: AssignmentQuestion, circuit: CircuitData): boolean {
  const r = gradeQuestion(question, circuit);
  return r.status === 'graded' && r.total > 0 && r.passed === r.total;
}

// ─── Reporting ───────────────────────────────────────────────────────────────

let selfTestFailures = 0;
function selfCheck(label: string, cond: boolean): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) selfTestFailures++;
}

// ─── 1. SELF-TEST ────────────────────────────────────────────────────────────
// The sample assignment carries one question per mode (CC/SC/FSM/TM/turbot); the
// correct submission must pass every case and the incorrect one must fail at
// least one. If this breaks, nothing else the harness reports can be trusted.

function runSelfTest(): void {
  console.log('SELF-TEST — harness discriminates correct vs. broken (devData)');
  const assignment = buildSampleAssignment();
  const correct = new Map(buildCorrectSubmission().answers.map((a) => [a.questionId, a.circuit]));
  const wrong = new Map(buildIncorrectSubmission().answers.map((a) => [a.questionId, a.circuit]));

  for (const q of assignment.questions) {
    const c = correct.get(q.id);
    const w = wrong.get(q.id);
    selfCheck(`${q.label} (${q.buildMode}) correct passes`, !!c && allPass(q, c));
    selfCheck(`${q.label} (${q.buildMode}) broken fails`, !!w && !allPass(q, w));
  }
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
}

function evaluateRow(row: ManifestRow): RowResult {
  if (!row.fixture) return { row, state: 'pending', detail: 'no reference fixture yet' };

  let fx: ReferenceFixture;
  try {
    fx = JSON.parse(readFileSync(resolveFixture(row.fixture), 'utf8')) as ReferenceFixture;
  } catch (err) {
    return { row, state: 'regressed', detail: `fixture unreadable: ${(err as Error).message}` };
  }

  if (!fx.question || !fx.correct) {
    return { row, state: 'regressed', detail: 'fixture missing question or correct machine' };
  }

  if (!allPass(fx.question, fx.correct)) {
    return { row, state: 'regressed', detail: 'reference (correct) machine does NOT pass all cases' };
  }
  // The broken variant is what makes the check adversarial: a grader that passes
  // everything is worthless. Warn loudly (as a regression) if a fixture omits it.
  if (!fx.broken) {
    return { row, state: 'regressed', detail: 'fixture has no broken variant (adversarial check missing)' };
  }
  if (allPass(fx.question, fx.broken)) {
    return { row, state: 'regressed', detail: 'broken variant wrongly PASSES (grader not discriminating)' };
  }
  return { row, state: 'verified', detail: 'correct passes, broken fails' };
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

  console.log('COVERAGE LEDGER — reference-verified vs. pending (HW1–HW6)');
  for (const [hw, rows] of byHw) {
    const verified = rows.filter((r) => r.state === 'verified').length;
    console.log(`\n  ${hw}  (${verified}/${rows.length} verified)`);
    for (const r of rows) {
      const mark = r.state === 'verified' ? '✓' : r.state === 'regressed' ? '✗' : '·';
      console.log(`    ${mark} ${r.row.id.padEnd(10)} ${r.row.category.padEnd(11)} ${r.row.title}`);
      if (r.state === 'regressed') console.log(`        → ${r.detail}`);
    }
  }

  const verified = results.filter((r) => r.state === 'verified').length;
  const pending = results.filter((r) => r.state === 'pending').length;
  const regressions = results.filter((r) => r.state === 'regressed').length;

  console.log(`\n  totals: ${verified} verified · ${pending} pending · ${regressions} regressed · ${results.length} in scope`);

  // Machine-readable summary for a loop iteration to reconcile COVERAGE.md.
  const summary = {
    verified,
    pending,
    regressed: regressions,
    total: results.length,
    rows: results.map((r) => ({ id: r.row.id, state: r.state, detail: r.detail })),
  };
  console.log('\n=== COVERAGE SUMMARY (json) ===');
  console.log(JSON.stringify(summary));
  console.log('=== END COVERAGE SUMMARY ===');

  return { results, regressions };
}

// ─── main ────────────────────────────────────────────────────────────────────

runSelfTest();
const { regressions } = runLedger();

const failures = selfTestFailures + regressions;
console.log(`\n${failures === 0 ? 'COVERAGE OK' : `COVERAGE FAILED (${failures}: ${selfTestFailures} self-test, ${regressions} regressions)`}`);
process.exit(failures === 0 ? 0 : 1);
