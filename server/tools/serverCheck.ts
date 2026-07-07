// End-to-end smoke test for the API server (`npm run check`).
//
// Boots the real app on an ephemeral port against an in-memory SQLite DB, seeds
// the toy roster + the five-mode sample assignment, then drives the full
// student → instructor flow over HTTP with fetch:
//
//   login (student + instructor, bad email rejected)
//   assignment list / detail (student copy has no test_cases; instructor's does)
//   workbook save + reload round-trip
//   submit correct + incorrect sample circuits → server-side grades
//   student sees scores but no per-case detail; instructor sees everything
//   authorization: student PUT assignment → 403, no token → 401
//
// Exits non-zero on the first failed assertion.

import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
  SAMPLE_ASSIGNMENT_ID,
} from '../../app/src/devData/sampleData';
import type { AssignmentData, SubmissionRecord } from '../../app/src/types';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const config: ServerConfig = {
  port: 0,
  dbPath: ':memory:',
  corsOrigins: ['http://localhost:5173'],
  authMode: 'dev',
  sessionTtlSeconds: 3600,
};

const db = new Db(config.dbPath);
for (const a of TOY_ACCOUNTS) {
  db.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
}
db.saveAssignment(buildSampleAssignment());

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

// ── health + auth ────────────────────────────────────────────────
const health = await api<{ ok: boolean }>('GET', '/health');
check('health', health.status === 200 && health.json.ok === true);

const student = TOY_ACCOUNTS.find((a) => a.role === 'student')!;
const instructor = TOY_ACCOUNTS.find((a) => a.role === 'instructor')!;

const badLogin = await api('POST', '/auth/login', { body: { email: 'nobody@nowhere.edu' } });
check('unknown email rejected', badLogin.status === 401);

const sLogin = await api<{ token: string; user: { role: string } }>('POST', '/auth/login', {
  body: { email: student.email },
});
check('student login', sLogin.status === 200 && sLogin.json.user.role === 'student');
const sTok = sLogin.json.token;

const iLogin = await api<{ token: string; user: { role: string } }>('POST', '/auth/login', {
  body: { email: instructor.email },
});
check('instructor login', iLogin.status === 200 && iLogin.json.user.role === 'instructor');
const iTok = iLogin.json.token;

const me = await api<{ user: { email: string } }>('GET', '/auth/me', { token: sTok });
check('me', me.status === 200 && me.json.user.email === student.email.toLowerCase());

const noTok = await api('GET', '/assignments');
check('no token → 401', noTok.status === 401);

// ── assignments ──────────────────────────────────────────────────
const list = await api<{ assignments: { id: string }[] }>('GET', '/assignments', { token: sTok });
check(
  'assignment list',
  list.status === 200 && list.json.assignments.some((a) => a.id === SAMPLE_ASSIGNMENT_ID),
);

const sAsg = await api<{ assignment: AssignmentData }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}`,
  { token: sTok },
);
check(
  'student copy hides test_cases',
  sAsg.status === 200 &&
    sAsg.json.assignment.questions.every((q) => (q.test_cases ?? []).length === 0),
);
check(
  'student copy keeps turbot arenas',
  sAsg.json.assignment.questions.some((q) => (q.turbot_cases ?? []).length > 0),
);

const iAsg = await api<{ assignment: AssignmentData }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}`,
  { token: iTok },
);
check(
  'instructor copy has test_cases',
  iAsg.status === 200 && iAsg.json.assignment.questions.some((q) => (q.test_cases ?? []).length > 0),
);

const forbidden = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, {
  token: sTok,
  body: iAsg.json.assignment,
});
check('student cannot save assignments', forbidden.status === 403);

const resave = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, {
  token: iTok,
  body: iAsg.json.assignment,
});
check('instructor can save assignments', resave.status === 200);

// ── workbook round-trip ──────────────────────────────────────────
const wbState = {
  currentQuestionIndex: 2,
  questionCircuits: { 1: { components: [], wires: [], textElements: [], comments: [], boxes: [] } },
};
const wbPut = await api('PUT', `/workbooks/${SAMPLE_ASSIGNMENT_ID}`, { token: sTok, body: wbState });
const wbGet = await api<{ state: typeof wbState | null }>(
  'GET',
  `/workbooks/${SAMPLE_ASSIGNMENT_ID}`,
  { token: sTok },
);
check(
  'workbook save/load round-trip',
  wbPut.status === 200 && wbGet.json.state?.currentQuestionIndex === 2,
);
const wbOther = await api<{ state: unknown }>('GET', `/workbooks/${SAMPLE_ASSIGNMENT_ID}`, {
  token: iTok,
});
check('workbook is per-user', wbOther.json.state === null);

// ── submit + grade ───────────────────────────────────────────────
const correct = buildCorrectSubmission(student.email);
const submitOk = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok, body: { answers: correct.answers } },
);
check(
  'submit succeeds with NO grade shown (grades not released)',
  submitOk.status === 201 && submitOk.json.record?.result === undefined,
);
check(
  'server stamps identity',
  submitOk.json.record.submission.student === student.email.toLowerCase(),
);

const wrong = buildIncorrectSubmission(student.email);
const submitBad = await api<{ record: SubmissionRecord }>(
  'POST',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok, body: { answers: wrong.answers } },
);
check(
  'second submit also withholds the grade',
  submitBad.status === 201 && submitBad.json.record?.result === undefined,
);
check('attempt increments', submitBad.json.record.attempt === 2);

// ── gradebook views + grade release ──────────────────────────────
const ownHidden = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
check(
  'student sees own attempts but no grades before release',
  ownHidden.json.records.length === 2 && ownHidden.json.records.every((r) => r.result === undefined),
);

const all = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: iTok },
);
const iFirst = all.json.records.find((r) => r.attempt === 1)?.result;
const iSecond = all.json.records.find((r) => r.attempt === 2)?.result;
check(
  'instructor sees grades immediately (correct all-pass, incorrect fails)',
  !!iFirst &&
    iFirst.passed === iFirst.total &&
    iFirst.total > 0 &&
    !!iSecond &&
    iSecond.passed < iSecond.total,
  JSON.stringify({ first: [iFirst?.passed, iFirst?.total], second: [iSecond?.passed, iSecond?.total] }),
);
check(
  'instructor sees per-case detail',
  all.json.records.some((r) =>
    r.result?.questions.some((q) => q.cases.length > 0 || (q.turbotCases ?? []).length > 0),
  ),
);

const releaseForbidden = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/grades-release`, {
  token: sTok,
  body: { released: true },
});
check('student cannot release grades', releaseForbidden.status === 403);

const release = await api<{ gradesReleased: boolean }>(
  'PUT',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/grades-release`,
  { token: iTok, body: { released: true } },
);
check('instructor releases grades', release.status === 200 && release.json.gradesReleased === true);

const listReleased = await api<{ assignments: { id: string; gradesReleased: boolean }[] }>(
  'GET',
  '/assignments',
  { token: sTok },
);
check(
  'assignment list reports gradesReleased',
  listReleased.json.assignments.find((a) => a.id === SAMPLE_ASSIGNMENT_ID)?.gradesReleased === true,
);

const ownReleased = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
const sFirst = ownReleased.json.records.find((r) => r.attempt === 1)?.result;
check(
  'after release, student sees scores',
  !!sFirst && sFirst.passed === sFirst.total && sFirst.total > 0,
);
check(
  'after release, still no per-case detail for students',
  ownReleased.json.records.every((r) =>
    (r.result?.questions ?? []).every((q) => q.cases.length === 0 && (q.turbotCases ?? []).length === 0),
  ),
);

await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/grades-release`, {
  token: iTok,
  body: { released: false },
});
const ownRehidden = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
check(
  'unrelease hides grades again',
  ownRehidden.json.records.every((r) => r.result === undefined),
);

// ── logout ───────────────────────────────────────────────────────
await api('POST', '/auth/logout', { token: sTok });
const afterLogout = await api('GET', '/auth/me', { token: sTok });
check('logout invalidates session', afterLogout.status === 401);

server.close();
db.close();

console.log(failures === 0 ? '\nserverCheck: all checks passed' : `\nserverCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
