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
import { gradeSubmission } from '../../app/src/engine/grader';
import { buildSampleAssignment } from '../../app/src/devData/sampleData';
import { comp, transition, circuit } from '../../app/tools/builder';
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

const ASSIGNMENT_ID = 'parity-hw';
const assignment: AssignmentData = {
  id: ASSIGNMENT_ID,
  title: 'Grading-parity pin assignment',
  questions: [
    ...fixtures.map((fx, i) => ({ ...fx.question, id: i + 1, label: FIXTURE_IDS[i] })),
    { ...openQuestion, id: 7, label: 'open' },
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
];

const brokenAnswers: Answers = [
  ...fixtures.map((fx, i) => ({
    // hw6-p2 (index 4) ships no broken variant (interface tier) — substitute
    // the wanderer so the turbot question fails with rich per-case detail.
    questionId: i + 1,
    circuit: fx.broken ?? wandererBrain,
  })),
  { questionId: 7, circuit: emptyCircuit, responseText: '' },
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
    if (forbidden.has(k) && Array.isArray(v) && v.length > 0) out.push(`${path}.${k}`);
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
  'self-test: findLeaks detects a planted leak',
  findLeaks({ q: [{ test_cases: [1] }] }, new Set(['test_cases'])).length === 1 &&
    findLeaks({ q: [{ test_cases: [] }] }, new Set(['test_cases'])).length === 0,
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

// Create the assignment via the API (instructor), as real authoring would.
const put = await api('PUT', `/assignments/${ASSIGNMENT_ID}`, { token: iTok, body: assignment });
check('assignment created via API', put.status === 200);

// ── Sanitization pin #1: the student's assignment copy ──────────────────────
// serverCheck pins empty test_cases + retained turbot arenas on the sample
// assignment; here the deep scan additionally rejects perception_cases (the
// perception answer bank) anywhere in the student copy. turbot_cases stay by
// design (the arena is the question statement, not the answer).
const sAsg = await api<{ assignment: AssignmentData }>('GET', `/assignments/${ASSIGNMENT_ID}`, {
  token: sTok,
});
const asgLeaks = findLeaks(sAsg.json.assignment, new Set(['test_cases', 'perception_cases', 'expected']));
check('student assignment copy leaks no answer banks (incl. perception)', asgLeaks.length === 0, asgLeaks.join(', '));
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
const all = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${ASSIGNMENT_ID}/submissions`,
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
// The perception-aware extension of serverCheck's cases/turbotCases pin: no
// per-case detail of ANY shape — value cases, turbot cases, perception frames
// with expected bits — may reach a student, released or not.
const recordLeaks = postRelease.json.records.flatMap((r) =>
  findLeaks(r.result, new Set(['cases', 'turbotCases', 'perceptionCases', 'expected', 'frames', 'got'])),
);
check('post-release student records leak no per-case detail (incl. perception)', recordLeaks.length === 0, recordLeaks.join(', '));

server.close();
db.close();

console.log(failures === 0 ? '\nparityCheck: all checks passed' : `\nparityCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
