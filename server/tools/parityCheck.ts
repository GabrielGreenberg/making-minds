// Server ↔ engine grading-parity pin (`npm run check`, after serverCheck).
//
// The Evaluation seam promises "the same code grades on the server". The server
// imports app/src/engine/grader.ts directly, so that is true *by construction*
// today — but nothing pinned that a submission graded through the real HTTP
// path (auth → POST → grade-on-receipt → stored record → instructor GET) equals
// a direct in-process `gradeSubmission` call. Server preprocessing, a sanitize
// bug, or version skew after the Remote-store cutover would misgrade silently.
// This tool makes the contract testable:
//
//   1. Assemble an assignment from REPRESENTATIVE reference fixtures — one
//      codec question per axis (CC hw2-p7 space, SC hw3-p6 time, FSM hw4-p11
//      time/k=2 inputs, TM hw5-p9 tape), a turbot (hw6-p2 — return-to-start,
//      so criterionRequiresStop + failure reasons are exercised; its
//      interface-tier "correct" brain scores 1/3, so failing turbot cases with
//      reasons cross the wire even on attempt 1), a perception question
//      (hw2-p12), and the devData open question (pending, 0/0).
//   2. Submit twice as a student: attempt 1 = the fixtures' correct machines,
//      attempt 2 = the fixtures' broken variants plus a hand-built
//      never-stopping turbot brain (hitStepLimit=true / 'exceeded max steps'
//      crosses the wire) and a blank open response.
//   3. Grade each submission BOTH ways — direct `gradeSubmission` in-process,
//      and through the booted server (assignment created via the API,
//      submitted as the student, record fetched as the INSTRUCTOR — the full,
//      unsanitized view) — and compare the grade payloads deeply.
//   4. Pin the student-facing sanitization boundary on the same records
//      (perception-aware — extends, not duplicates, serverCheck: see below).
//   5. Pin manual-review parity: the review endpoint's stored record must
//      deeply equal the pure `applyManualReview` applied in-process to the
//      same records (reviewedAt is server-stamped, so the server's stamp is
//      injected into the in-process side — the submittedAt pattern) — and the
//      released student view carries the verdict but still no per-case detail.
//   6. Provenance never grades (task 034): the integrity summary sits beside
//      `result` (so the answers echo and the grade stay byte-equal), a review
//      leaves it untouched, and answers carrying signed editing records grade
//      exactly as the same answers without them.
//   7. A TM case's block separations (task 002, "Run this input") reach the
//      student: their copy of an hw5-p4 result keeps each gap case's
//      `separations` (input layout — the tape the grader laid out) while
//      `expected`/`got` stay blank, and a case without gaps gains no key; a
//      result stored before cases recorded them gets them from the server's
//      bank on the student's submissions route.
//   8. Boxes drawn across wires (task 038): attempt 4 answers the CC (hw2-p7)
//      and SC (hw3-p6) questions with everything but their INs/OUTs in one
//      box whose ports are bound to the wires it cuts. The server grades it
//      exactly as in process, and exactly as the unboxed machines; the same
//      box saved before 038 and re-bound by the load rule grades the same.
//
// ── What is (and is not) normalized in the comparison ──────────────────────
// The compared payload is `record.result` (the SubmissionResult) plus the
// echoed `record.submission.answers`. NOTHING inside them is stripped. The
// only normalization is a JSON round-trip (`canon`) applied to BOTH sides:
// the wire format is JSON, so in-process optional keys explicitly set to
// `undefined` (e.g. TurbotCaseResult.reason on a passing case) serialize to
// absent keys — that is the wire's own semantics, not a fudge. Any other
// difference is a parity failure, reported path-by-path.
//
// Fields the server legitimately owns, each asserted explicitly instead of
// deep-compared (the documented strip list):
//   - record.assignmentId        — storage bookkeeping; echoes the URL id.
//   - record.attempt             — server-assigned per-(assignment,student)
//                                  counter (asserted 1 and 2).
//   - record.submittedAt and record.submission.submittedAt — the server stamps
//     receipt time ("identity and timestamp are the server's word", app.ts);
//     the client's clock is ignored by design, so timestamps cannot match a
//     value chosen here. Asserted to be a valid ISO date, not compared.
//   - record.submission.student  — server-stamped from the session token
//     (lowercased email). Not stripped: the direct grade uses the same
//     identity, so result.student must be byte-equal.
//   - record.submission.assignmentTitle — server copies it from the stored
//     assignment; asserted equal to assignment.title.
//
// ── Sanitization pins (student view) ────────────────────────────────────────
// serverCheck already pins: student assignment copy has empty test_cases (but
// keeps turbot arenas), no results at all pre-release, and post-release scores
// with empty `cases`/`turbotCases`. This tool EXTENDS that boundary to the
// perception fields that landed after sanitize.ts was written: the student
// assignment copy must not carry `perception_cases` (the expected
// classification bits are the answer key), and post-release student records
// must not carry `perceptionCases` (frames/expected/got detail). Both were
// LEAKING before the 2026-07-08 sanitize.ts fix this tool pins.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import { gradeSubmission, gradeQuestion } from '../../app/src/engine/grader';
import { studentRecord } from '../src/sanitize';
import { applyManualReview } from '../../app/src/storage/manualReview';
import { buildSampleAssignment } from '../../app/src/devData/sampleData';
import { nextTrace } from '../../app/src/provenance/trace';
import { prepareKey } from '../../app/src/provenance/ids';
import { comp, transition, circuit, boxAcross, unbind } from '../../app/tools/builder';
import { rebindLegacyBoxes } from '../../app/src/boxPorts';
import type {
  AssignmentData,
  AssignmentQuestion,
  CircuitData,
  SubmissionData,
  SubmissionRecord,
  SubmissionResult,
} from '../../app/src/types';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── Assemble the assignment from reference fixtures ─────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = join(HERE, '..', '..', 'app', 'tools', 'fixtures', 'reference');

interface ReferenceFixture {
  question: AssignmentQuestion;
  correct: CircuitData;
  broken?: CircuitData;
}

function loadFixture(id: string): ReferenceFixture {
  return JSON.parse(readFileSync(join(REF, `${id}.json`), 'utf8')) as ReferenceFixture;
}

// One codec question per axis + turbot + perception; ids renumbered 1..7 so
// the assembled assignment has unique question ids (fixtures keep their
// original per-homework ids, which collide across files).
const FIXTURE_IDS = ['hw2-p7', 'hw3-p6', 'hw4-p11', 'hw5-p9', 'hw6-p2', 'hw2-p12'] as const;
const fixtures = FIXTURE_IDS.map((id) => loadFixture(id));

// The open question comes from devData (buildSampleAssignment), as the
// fixtures never author open questions.
const openQuestion = buildSampleAssignment().questions.find((q) => q.buildMode === 'open')!;
// HW1 P11: the fill-in-the-blank shape. Its `fill_in_answers` are the answer
// key and must be stripped from the student's copy like any other bank.
const fillInQuestion = JSON.parse(
  readFileSync(new URL('../../app/src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
).questions.find((q: { id: number }) => q.id === 11);
const FILL_ANSWERS = Array.from({ length: 11 }, (_, n) => n.toString(2));

const ASSIGNMENT_ID = 'parity-hw';
const assignment: AssignmentData = {
  id: ASSIGNMENT_ID,
  title: 'Grading-parity pin assignment',
  questions: [
    ...fixtures.map((fx, i) => ({ ...fx.question, id: i + 1, label: FIXTURE_IDS[i] })),
    { ...openQuestion, id: 7, label: 'open' },
    { ...fillInQuestion, id: 8, label: 'fill-in' },
  ],
};

// A never-stopping turbot-TM brain for hw6-p2's walled arenas: one external
// state that always moves forward and turns right at walls. It circles
// forever, so every arena truncates at maxSteps and the stop-requiring
// return-to-start criterion fails with hitStepLimit=true / 'exceeded max
// steps' — the exact fields the parity compare must carry across the wire.
const wandererBrain: CircuitData = circuit(
  [comp('w-s0', 'STATE', 'S₀', 100, 100, { stateKind: 'external' })],
  [
    transition('w-t1', 'w-s0', 'w-s0', 'E:↑'),
    transition('w-t2', 'w-s0', 'w-s0', 'F:↑'),
    transition('w-t3', 'w-s0', 'w-s0', 'B:↱'),
  ],
);

const emptyCircuit: CircuitData = { components: [], wires: [] };
const OPEN_RESPONSE = 'Binary: logarithmic codes need exponentially fewer components than tally.';

type Answers = SubmissionData['answers'];

const correctAnswers: Answers = [
  ...fixtures.map((fx, i) => ({ questionId: i + 1, circuit: fx.correct })),
  { questionId: 7, circuit: emptyCircuit, responseText: OPEN_RESPONSE },
  { questionId: 8, circuit: emptyCircuit, fillAnswers: FILL_ANSWERS },
];

const brokenAnswers: Answers = [
  ...fixtures.map((fx, i) => ({
    // hw6-p2 (index 4) ships no broken variant (interface tier) — substitute
    // the wanderer so the turbot question fails with rich per-case detail.
    questionId: i + 1,
    circuit: fx.broken ?? wandererBrain,
  })),
  { questionId: 7, circuit: emptyCircuit, responseText: '' },
  // One padded (still correct — leading zeros normalise) and one wrong.
  { questionId: 8, circuit: emptyCircuit, fillAnswers: FILL_ANSWERS.map((a, i) => (i === 4 ? '1' : '00' + a)) },
];

// ── Direct in-process grades (side A) ────────────────────────────────────────

const student = TOY_ACCOUNTS.find((a) => a.role === 'student')!;
const instructor = TOY_ACCOUNTS.find((a) => a.role === 'instructor')!;
const studentEmail = student.email.toLowerCase(); // the server's identity spelling

function directGrade(answers: Answers): SubmissionResult {
  return gradeSubmission(assignment, {
    assignmentTitle: assignment.title,
    student: studentEmail,
    submittedAt: 'client-clock-ignored-by-server',
    answers,
  });
}

const directCorrect = directGrade(correctAnswers);
const directBroken = directGrade(brokenAnswers);

// ── Deep JSON comparison ─────────────────────────────────────────────────────

/** JSON-value canonicalization — the wire's own semantics (see header). */
function canon<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Collect up to 12 paths where two canonicalized JSON values differ. */
function diffPaths(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 12) return out;
  if (Object.is(a, b)) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push(`${path}: direct=${JSON.stringify(a)} server=${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: array/object mismatch`);
    return out;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (out.length >= 12) break;
    if (!(k in ao)) out.push(`${path}.${k}: absent on direct side`);
    else if (!(k in bo)) out.push(`${path}.${k}: absent on server side`);
    else diffPaths(ao[k], bo[k], `${path}.${k}`, out);
  }
  return out;
}

/** Recursively find keys from `forbidden` holding non-empty arrays. */
function findLeaks(value: unknown, forbidden: Set<string>, path = '$', out: string[] = []): string[] {
  if (value === null || typeof value !== 'object' || out.length >= 12) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findLeaks(v, forbidden, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    // Array-valued secrets (test_cases, CaseResult.expected/got) leak by being
    // non-empty; string-valued ones (FillInCaseResult.expected/got) leak by
    // being non-empty text — both must be caught, or a blanked '' reads clean
    // even when a regression puts the answer back.
    if (forbidden.has(k) && ((Array.isArray(v) && v.length > 0) || (typeof v === 'string' && v.length > 0))) {
      out.push(`${path}.${k}`);
    }
    findLeaks(v, forbidden, `${path}.${k}`, out);
  }
  return out;
}

// Comparator self-tests: a pin is only as good as its detector — a planted
// divergence/leak must be caught, or a green run proves nothing.
check(
  'self-test: diffPaths detects a planted divergence',
  diffPaths({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }).length === 1 &&
    diffPaths({ x: 1 }, { x: 1, y: 2 }).length === 1,
);
check(
  'self-test: findLeaks detects a planted leak (array-valued)',
  findLeaks({ q: [{ test_cases: [1] }] }, new Set(['test_cases'])).length === 1 &&
    findLeaks({ q: [{ test_cases: [] }] }, new Set(['test_cases'])).length === 0,
);
check(
  'self-test: findLeaks detects a planted leak (string-valued, e.g. fill-in expected)',
  findLeaks({ q: [{ expected: 'answer' }] }, new Set(['expected'])).length === 1 &&
    findLeaks({ q: [{ expected: '' }] }, new Set(['expected'])).length === 0,
);

// ── Boot the real server (same harness pattern as serverCheck) ──────────────

const config: ServerConfig = {
  port: 0,
  dbPath: ':memory:',
  corsOrigins: [],
  authMode: 'dev',
  sessionTtlSeconds: 3600,
};

const db = new Db(config.dbPath);
for (const a of TOY_ACCOUNTS) {
  db.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
}
// NOTE: the assignment is NOT seeded into the DB — it is created through the
// real API below, so the whole authoring → storage → grading path is on trial.

const app = createApp(config, db);
const server = app.listen(0);
await new Promise<void>((resolve) => server.on('listening', resolve));
const address = server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;

async function api<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

const sTok = (
  await api<{ token: string }>('POST', '/auth/login', { body: { email: student.email } })
).json.token;
const iTok = (
  await api<{ token: string }>('POST', '/auth/login', { body: { email: instructor.email } })
).json.token;
check('logins issued tokens', !!sTok && !!iTok);

// Create the assignment via the API (instructor), as real authoring would, and
// publish it — assignments are hidden from students until released, and the
// student-side pins below need to be able to fetch it.
const put = await api('PUT', `/assignments/${ASSIGNMENT_ID}`, { token: iTok, body: assignment });
check('assignment created via API', put.status === 200);
const published = await api<{ visible: boolean }>(
  'PUT', `/assignments/${ASSIGNMENT_ID}/visibility`,
  { token: iTok, body: { visible: true } },
);
check('assignment published to students', published.status === 200 && published.json.visible);

// ── Sanitization pin #1: the student's assignment copy ──────────────────────
// serverCheck pins empty test_cases + retained turbot arenas on the sample
// assignment; here the deep scan additionally rejects perception_cases (the
// perception answer bank) anywhere in the student copy. turbot_cases stay by
// design (the arena is the question statement, not the answer).
const sAsg = await api<{ assignment: AssignmentData }>('GET', `/assignments/${ASSIGNMENT_ID}`, {
  token: sTok,
});
const asgLeaks = findLeaks(
  sAsg.json.assignment,
  new Set(['test_cases', 'perception_cases', 'fill_in_answers', 'expected']),
);
check('student assignment copy leaks no answer banks (incl. perception + fill-in)', asgLeaks.length === 0, asgLeaks.join(', '));
check(
  'student assignment copy keeps the fill-in labels (they are the prompts)',
  (sAsg.json.assignment.questions.find((q) => q.id === 8)?.fill_in?.labels ?? []).length === 11,
);
check(
  'student assignment copy keeps the turbot arenas',
  (sAsg.json.assignment.questions.find((q) => q.buildMode === 'turbot')?.turbot_cases ?? []).length > 0,
);

// ── Submit both attempts as the student ──────────────────────────────────────
const post1 = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok, body: { answers: correctAnswers } },
);
const post2 = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok, body: { answers: brokenAnswers } },
);
check('both submissions accepted', post1.status === 201 && post2.status === 201);
check(
  'submit responses withhold grades pre-release (serverCheck pins this broadly)',
  post1.json.record?.result === undefined && post2.json.record?.result === undefined,
);

// ── Fetch the stored records as the INSTRUCTOR (full, unsanitized) ───────────
// The gradebook's route: the plain /submissions is the caller's own (task 037).
const all = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions/all`,
  { token: iTok },
);
const rec1 = all.json.records.find((r) => r.attempt === 1);
const rec2 = all.json.records.find((r) => r.attempt === 2);
check('instructor sees both stored records', !!rec1 && !!rec2);

if (rec1 && rec2) {
  // Server-owned wrapper fields — asserted, not deep-compared (see header).
  for (const [name, rec] of [['attempt 1', rec1], ['attempt 2', rec2]] as const) {
    check(`${name}: assignmentId is server bookkeeping`, rec.assignmentId === ASSIGNMENT_ID);
    check(
      `${name}: server-stamped receipt timestamp is a real date, client clock ignored`,
      !Number.isNaN(Date.parse(rec.submission.submittedAt)) &&
        rec.submission.submittedAt !== 'client-clock-ignored-by-server' &&
        rec.submittedAt === rec.submission.submittedAt,
    );
    check(`${name}: server-stamped identity`, rec.submission.student === studentEmail);
    check(`${name}: assignmentTitle from stored assignment`, rec.submission.assignmentTitle === assignment.title);
  }

  // THE PARITY PIN: stored grade payload ≡ direct gradeSubmission, deeply.
  const d1 = diffPaths(canon(directCorrect), canon(rec1.result));
  check('PARITY: attempt 1 grade payload ≡ direct gradeSubmission', d1.length === 0, d1.join(' | '));
  const d2 = diffPaths(canon(directBroken), canon(rec2.result));
  check('PARITY: attempt 2 grade payload ≡ direct gradeSubmission', d2.length === 0, d2.join(' | '));

  // The server must store the answers verbatim (no circuit preprocessing).
  const a1 = diffPaths(canon(correctAnswers), canon(rec1.submission.answers));
  check('attempt 1 answers stored verbatim', a1.length === 0, a1.join(' | '));
  const a2 = diffPaths(canon(brokenAnswers), canon(rec2.submission.answers));
  check('attempt 2 answers stored verbatim', a2.length === 0, a2.join(' | '));
}

// ── Anchors: the compared payloads really contain what the pin is for ───────
// (Parity between two empty results would prove nothing. These assert against
// the DIRECT results; parity above extends every claim to the server copy.)
const q = (r: SubmissionResult, id: number) => r.questions.find((x) => x.questionId === id)!;

check(
  'anchor: attempt 1 codec questions (CC/SC/FSM/TM) all full-pass',
  [1, 2, 3, 4].every((id) => {
    const r = q(directCorrect, id);
    return r.status === 'graded' && r.total > 0 && r.passed === r.total;
  }),
);
const t1 = q(directCorrect, 5);
check(
  'anchor: attempt 1 turbot is a non-perfect grade with criterion-named reasons',
  t1.passed === 1 &&
    t1.total === 3 &&
    (t1.turbotCases ?? []).filter((c) => !c.pass).every((c) => (c.reason ?? '').includes('return-to-start')),
);
const p1 = q(directCorrect, 6);
check(
  'anchor: attempt 1 perception full-pass with per-case results',
  p1.passed === p1.total && p1.total > 0 && (p1.perceptionCases ?? []).length === p1.total,
);
const o1 = q(directCorrect, 7);
check(
  'anchor: open question is pending 0/0 with the response text',
  o1.status === 'pending' && o1.passed === 0 && o1.total === 0 && o1.response === OPEN_RESPONSE,
);
check(
  'anchor: attempt 2 codec + perception questions all fail somewhere',
  [1, 2, 3, 4, 6].every((id) => {
    const r = q(directBroken, id);
    return r.status === 'graded' && r.passed < r.total;
  }),
);
const t2 = q(directBroken, 5);
check(
  'anchor: attempt 2 turbot hits the step limit on every arena',
  t2.passed === 0 &&
    (t2.turbotCases ?? []).length === 3 &&
    (t2.turbotCases ?? []).every((c) => c.hitStepLimit && c.reason === 'exceeded max steps'),
);
check('anchor: attempt 2 open response is blank but still pending', q(directBroken, 7).response === '');

// ── Sanitization pin #2: student record view, pre- and post-release ─────────
const preRelease = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
check(
  'student sees no results pre-release',
  preRelease.json.records.length === 2 && preRelease.json.records.every((r) => r.result === undefined),
);

await api('PUT', `/assignments/${ASSIGNMENT_ID}/grades-release`, { token: iTok, body: { released: true } });
const postRelease = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
check(
  'post-release student sees the same scores the instructor does',
  postRelease.json.records.every((r) => {
    const full = all.json.records.find((f) => f.attempt === r.attempt)?.result;
    return !!r.result && !!full && r.result.passed === full.passed && r.result.total === full.total;
  }),
);
// notes/todos.md item 4 ("indicate failed test cases"): students now DO see
// safe per-case detail (which input, pass/fail, why) once released — the
// widening in server/src/sanitize.ts. What must never reach them, released
// or not, is the answer key itself: CaseResult/PerceptionCaseResult's
// `expected`/`got` and FillInCaseResult's `expected`/`got` (a string, not an
// array — the extended findLeaks catches that shape too).
const recordLeaks = postRelease.json.records.flatMap((r) => findLeaks(r.result, new Set(['expected', 'got'])));
check('post-release student records leak no answer keys (incl. perception + fill-in)', recordLeaks.length === 0, recordLeaks.join(', '));

// The flip side of the same widening: the SAFE fields must actually be
// there, not just absent-of-leak — a pin that only checks silence would pass
// on an empty response too.
const brokenRecord = postRelease.json.records.find((r) => r.attempt === 2)!;
const sCodec = brokenRecord.result!.questions.find((x) => x.questionId === 1)!;
check(
  'student sees which inputs a value question failed on (input + pass, no expected/got)',
  sCodec.cases.length > 0 &&
    sCodec.cases.some((c) => !c.pass) &&
    sCodec.cases.every((c) => Array.isArray(c.input) && c.input.length > 0),
);
const sPerception = brokenRecord.result!.questions.find((x) => x.questionId === 6)!;
check(
  'student sees which frames a perception question failed on',
  (sPerception.perceptionCases ?? []).length > 0 &&
    (sPerception.perceptionCases ?? []).some((c) => !c.pass && c.frames.length > 0),
);
const sTurbot = brokenRecord.result!.questions.find((x) => x.questionId === 5)!;
check(
  "student sees turbot arenas' full detail (no answer key exists for this shape)",
  (sTurbot.turbotCases ?? []).length > 0 &&
    (sTurbot.turbotCases ?? []).every((c) => typeof c.stepsTaken === 'number' && c.finalPosition != null),
);
const sFillIn = brokenRecord.result!.questions.find((x) => x.questionId === 8)!;
check(
  'student sees which blanks a fill-in question got wrong (label + pass, no expected/got)',
  (sFillIn.fillCases ?? []).length > 0 &&
    (sFillIn.fillCases ?? []).some((c) => !c.pass) &&
    (sFillIn.fillCases ?? []).every((c) => c.label.length > 0 && c.expected === '' && c.got === ''),
);

// ── Manual-review parity: review endpoint ≡ pure applyManualReview ──────────
// The endpoint (POST .../submissions/:attempt/review) claims to be the same
// pure function the local SubmissionStore runs — one contract, two homes.
// Prove it: review attempt 1's open question (id 7) over HTTP, apply
// applyManualReview in-process to the SAME pre-review instructor records with
// the server's reviewedAt stamp injected (the one server-owned field), and
// deep-compare the full stored record.
const REVIEW_NOTE = 'Strong answer; cites the component-count asymmetry.';
const reviewRes = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${ASSIGNMENT_ID}/submissions/1/review`,
  { token: iTok, body: { student: studentEmail, questionId: 7, pass: true, note: REVIEW_NOTE } },
);
check('review endpoint records the verdict (201)', reviewRes.status === 201);

const serverStamp =
  reviewRes.json.record?.result?.questions.find((q) => q.questionId === 7)?.manual?.reviewedAt ?? '';
check("reviewedAt is the server's word (valid ISO date)", !Number.isNaN(Date.parse(serverStamp)));

const inProcess = applyManualReview(canon(all.json.records), 1, 7, {
  pass: true,
  note: REVIEW_NOTE,
  reviewedAt: serverStamp,
});
const afterReview = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions/all`,
  { token: iTok },
);
const dReview = diffPaths(
  canon(inProcess?.find((r) => r.attempt === 1)),
  canon(afterReview.json.records.find((r) => r.attempt === 1)),
);
check('PARITY: server-applied review ≡ in-process applyManualReview', dReview.length === 0, dReview.join(' | '));

// The verdict is the open question's grade: post-release the student sees it
// (pass + note survive studentRecord's roll-up) — but the reviewed record
// still leaks no answer key (the safe-field widening applies here too).
const sAfterReview = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
const sOpen = sAfterReview.json.records
  .find((r) => r.attempt === 1)
  ?.result?.questions.find((q) => q.questionId === 7);
check(
  'post-release student sees the open-question verdict',
  sOpen?.manual?.pass === true && sOpen.manual.note === REVIEW_NOTE,
);
const reviewLeaks = sAfterReview.json.records.flatMap((r) => findLeaks(r.result, new Set(['expected', 'got'])));
check('reviewed student records still leak no answer keys', reviewLeaks.length === 0, reviewLeaks.join(', '));

// ── Provenance never grades (task 034) ──────────────────────────────────────
const preIntegrity = all.json.records.find((r) => r.attempt === 1)?.integrity;
const postIntegrity = afterReview.json.records.find((r) => r.attempt === 1)?.integrity;
check('the stored record carries an integrity summary beside its result',
  preIntegrity != null && preIntegrity.questions.length === correctAnswers.length);
const dIntegrity = diffPaths(canon(preIntegrity), canon(postIntegrity));
check('manual review preserves record.integrity', postIntegrity != null && dIntegrity.length === 0, dIntegrity.join(' | '));
check('students never receive it', sAfterReview.json.records.every((r) => !('integrity' in r)));

// The same correct answers, each carrying a signed editing record, graded
// through the server: the grade must equal the plain direct grade, deeply.
const wbKey = (
  await api<{ mintKey?: string }>('GET', `/workbooks/${ASSIGNMENT_ID}`, { token: sTok })
).json.mintKey;
const signer = wbKey ? prepareKey(wbKey) : null;
check('the workbook fetch hands the student a mint key', signer != null);
const provenanced: Answers = correctAnswers.map((a) => ({
  ...a,
  provenance: nextTrace(
    null,
    { compIns: a.circuit.components.length },
    { questionId: a.questionId, textBefore: {}, textAfter: a, countBefore: 0, gapMs: 0 },
    signer,
  ),
}));
const post3 = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
  { token: sTok, body: { answers: provenanced } },
);
const rec3 = (
  await api<{ records: SubmissionRecord[] }>('GET', `/assignments/${ASSIGNMENT_ID}/submissions/all`, { token: iTok })
).json.records.find((r) => r.attempt === 3);
const d3 = diffPaths(canon(directCorrect), canon(rec3?.result));
check('PARITY: answers with provenance grade exactly as without it',
  post3.status === 201 && rec3 != null && d3.length === 0, d3.join(' | '));
const a3 = diffPaths(canon(provenanced), canon(rec3?.submission.answers));
check('…and are stored verbatim, provenance included', a3.length === 0, a3.join(' | '));
check("…whose records the server reads as this student's own",
  (rec3?.integrity?.questions ?? []).every((q) => q.record === 'self'));

// ── 7. TM block separations reach the student, the key does not ─────────────
{
  const gap = loadFixture('hw5-p4');
  const graded = gradeQuestion(gap.question, gap.broken);
  const at = '2026-09-23T00:00:00.000Z';
  const full: SubmissionRecord = {
    assignmentId: 'gap',
    attempt: 1,
    submittedAt: at,
    submission: { assignmentTitle: 'gap', submittedAt: at, answers: [{ questionId: gap.question.id, circuit: gap.broken! }] },
    result: { student: studentEmail, questions: [graded], passed: graded.passed, total: graded.total },
  };
  const bank = gap.question.test_cases ?? [];
  const mine = canon(studentRecord(full, true)).result!.questions[0].cases;
  check('hw5-p4: the grader carries each gap case\'s separations onto its result',
    bank.filter((tc) => tc.separations).length >= 48 &&
      graded.cases.every((c, k) => JSON.stringify(c.separations) === JSON.stringify(bank[k].separations)));
  check("a student's copy keeps every case's separations (input layout, not the key)",
    mine.length === bank.length &&
      mine.every((c, k) => JSON.stringify(c.separations) === JSON.stringify(bank[k].separations)));
  check('…a case without gaps gains no separations key',
    mine.every((c, k) => bank[k].separations != null || !('separations' in c)));
  const gapLeaks = findLeaks(mine, new Set(['expected', 'got']));
  check('…and expected/got stay blank', gapLeaks.length === 0, gapLeaks.join(', '));

  // A result graded BEFORE cases recorded their separations (stored as-is in
  // the pilot DB): the student's submissions route fills them from the
  // server's own bank, so their replay is still the grader's tape.
  const GAP_ID = 'parity-gap';
  const gapAssignment: AssignmentData = { id: GAP_ID, title: 'gap', questions: [gap.question] };
  await api('PUT', `/assignments/${GAP_ID}`, { token: iTok, body: gapAssignment });
  await api('PUT', `/assignments/${GAP_ID}/visibility`, { token: iTok, body: { visible: true } });
  await api('PUT', `/assignments/${GAP_ID}/grades-release`, { token: iTok, body: { released: true } });
  const older = canon(full);
  for (const c of older.result!.questions[0].cases) delete c.separations;
  db.addSubmission(GAP_ID, studentEmail, older.submission, older.result);
  const served = await api<{ records: SubmissionRecord[] }>('GET', `/assignments/${GAP_ID}/submissions`, { token: sTok });
  const olderMine = served.json.records[0]?.result?.questions[0].cases ?? [];
  check("an older stored result: the student's route fills every case's separations from the bank",
    olderMine.length === bank.length &&
      olderMine.every((c, k) => JSON.stringify(c.separations) === JSON.stringify(bank[k].separations)));
  const olderLeaks = findLeaks(olderMine, new Set(['expected', 'got']));
  check('…still with expected/got blank', olderLeaks.length === 0, olderLeaks.join(', '));
}

// ── 8. Boxes drawn across wires grade as the machines they enclose ─────────
{
  const across = (i: number) => boxAcross(fixtures[i].correct);
  const acrossAnswers: Answers = correctAnswers.map((a) =>
    a.questionId === 1 || a.questionId === 2 ? { ...a, circuit: across(a.questionId - 1) } : a);
  const boxes = acrossAnswers.slice(0, 2).map((a) => a.circuit.components.find((c) => c.type === 'BOXED'));
  check('attempt 4: hw2-p7 (CC) and hw3-p6 (SC) boxed across, no IN/OUT inside, every port bound',
    boxes.every((b) => b != null && b.ports.length > 0 && b.ports.every((p) => p.bind !== undefined) &&
      !b.internalCircuit!.components.some((c) => c.type === 'INPUT' || c.type === 'OUTPUT')));
  const post4 = await api<{ record: SubmissionRecord }>(
    'POST',
    `/assignments/${ASSIGNMENT_ID}/submissions`,
    { token: sTok, body: { answers: acrossAnswers } },
  );
  const rec4 = (
    await api<{ records: SubmissionRecord[] }>('GET', `/assignments/${ASSIGNMENT_ID}/submissions/all`, { token: iTok })
  ).json.records.find((r) => r.attempt === post4.json.record?.attempt);
  const direct4 = directGrade(acrossAnswers);
  const d4 = diffPaths(canon(direct4), canon(rec4?.result));
  check('PARITY: boxed-across answers — server grade ≡ direct gradeSubmission',
    post4.status === 201 && rec4 != null && d4.length === 0, d4.join(' | '));
  const a4 = diffPaths(canon(acrossAnswers), canon(rec4?.submission.answers));
  check('…stored verbatim, port bindings included', a4.length === 0, a4.join(' | '));
  const same = [1, 2].map((id) => diffPaths(canon(q(directCorrect, id)), canon(q(direct4, id))));
  check('…and hw2-p7 / hw3-p6 grade exactly as the unboxed machines',
    same.every((d) => d.length === 0) && q(direct4, 1).passed === q(direct4, 1).total && q(direct4, 2).passed === q(direct4, 2).total,
    same.flat().join(' | '));

  // The same boxes saved before 038 (no binding), re-bound by the load rule
  // (from their library entry, as restoreQuestionCircuits does).
  const rebound: Answers = acrossAnswers.map((a) => {
    if (a.questionId !== 1 && a.questionId !== 2) return a;
    const box = a.circuit.components.find((c) => c.type === 'BOXED')!;
    const entry = {
      id: box.boxedCircuitId!, name: box.label,
      inputPortIds: box.ports.filter((p) => p.side === 'left').map((p) => p.bind!),
      outputPortIds: box.ports.filter((p) => p.side === 'right').map((p) => p.bind!),
      internalComponents: box.internalCircuit!.components, internalWires: box.internalCircuit!.wires,
    };
    const legacy = unbind(a.circuit);
    return { ...a, circuit: { ...legacy, components: rebindLegacyBoxes(legacy.components, [entry]) } };
  });
  const dr = diffPaths(canon(directCorrect), canon(directGrade(rebound)));
  check('a pre-038 save of those boxes, re-bound on load, grades ≡ the unboxed answers',
    dr.length === 0, dr.join(' | '));
}

server.close();
db.close();

console.log(failures === 0 ? '\nparityCheck: all checks passed' : `\nparityCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
