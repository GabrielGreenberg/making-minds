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
//     through the gradebook's /submissions/all (403 for a student), while the
//     plain /submissions is the caller's own for every role (task 037)
//   authorization: student PUT assignment → 403, no token → 401
//   provenance (task 034): the workbook fetch's mint key (per person, per
//     assignment, stable across restarts with no MM_MINT_SECRET), the
//     deduplicated save history, a transplant attributed to its owner, sandbox
//     ids unbound, integrity never on a student's copy, legacy content read as
//     legacy
//
// Exits non-zero on the first failed assertion.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
  ccCorrect,
  SAMPLE_ASSIGNMENT_ID,
} from '../../app/src/devData/sampleData';
import type { AssignmentData, CircuitData, SubmissionRecord } from '../../app/src/types';
import { deriveMintKey, DEV_MINT_SECRET, mintWithKey, prepareKey } from '../../app/src/provenance/ids';

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
// Seeded assignments are unpublished, like every other one — a student sees an
// empty catalog until the instructor releases something. The student-facing
// checks below need it published, and the visibility section further down
// exercises hiding it again.
const beforePublish = await api<{ assignments: { id: string }[] }>('GET', '/assignments', {
  token: sTok,
});
check(
  'a student sees no assignments until one is published',
  beforePublish.status === 200 && beforePublish.json.assignments.length === 0,
);
const publish = await api<{ visible: boolean }>(
  'PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/visibility`,
  { token: iTok, body: { visible: true } },
);
check('instructor publishes the seeded assignment', publish.status === 200 && publish.json.visible);

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

// The problem-set document (task 020): preamble, sections, sourcePdf and a
// question's callouts/figures are display data that must round-trip through
// the server and reach the student copy intact — only the three answer-key
// fields are stripped.
const firstQ = iAsg.json.assignment.questions[0];
const documented: AssignmentData = {
  ...iAsg.json.assignment,
  preamble: '**Note:** key words are in bold.',
  sourcePdf: 'problem-sets/sample.pdf',
  sections: [
    {
      heading: 'I. Everything',
      intro: 'Design the following:',
      questionIds: iAsg.json.assignment.questions.map((q) => q.id),
      callouts: [{ kind: 'hint', body: 'think in tables', placement: 'after' }],
      figures: [{ src: 'data:image/svg+xml;base64,PHN2Zy8+', alt: 'a figure', placement: 'aside' }],
    },
  ],
  questions: iAsg.json.assignment.questions.map((q) =>
    q.id === firstQ.id ? { ...q, callouts: [{ kind: 'caution', body: 'no OR gates', placement: 'aside' }] } : q,
  ),
};
const saveDoc = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: iTok, body: documented });
const sDoc = await api<{ assignment: AssignmentData }>('GET', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: sTok });
check(
  'the document fields (preamble, sections, sourcePdf, callouts, figures) reach the student copy intact',
  saveDoc.status === 200 &&
    sDoc.status === 200 &&
    sDoc.json.assignment.preamble === documented.preamble &&
    sDoc.json.assignment.sourcePdf === documented.sourcePdf &&
    JSON.stringify(sDoc.json.assignment.sections) === JSON.stringify(documented.sections) &&
    JSON.stringify(sDoc.json.assignment.questions.find((q) => q.id === firstQ.id)?.callouts) ===
      JSON.stringify([{ kind: 'caution', body: 'no OR gates', placement: 'aside' }]) &&
    sDoc.json.assignment.questions.every((q) => (q.test_cases ?? []).length === 0),
);
// Put the sample back as it was for the pins that follow.
await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: iTok, body: iAsg.json.assignment });

// ── workbook round-trip ──────────────────────────────────────────
const wbState = {
  currentQuestionIndex: 2,
  questionCircuits: { 1: { components: [], wires: [], boxes: [] } },
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

// Task 037: the plain route is the caller's OWN attempts for every role —
// an instructor's Student view must never show a student's attempt as theirs.
const instructorOwn = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: iTok },
);
check(
  "instructor GET /submissions is the instructor's own attempts only (none yet)",
  instructorOwn.status === 200 &&
    instructorOwn.json.records.every((r) => r.submission.student === instructor.email.toLowerCase()) &&
    instructorOwn.json.records.length === 0,
);
const allForbidden = await api(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions/all`,
  { token: sTok },
);
check('student GET /submissions/all → 403', allForbidden.status === 403);

const all = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions/all`,
  { token: iTok },
);
check(
  "instructor GET /submissions/all is everyone's: the student's two attempts",
  all.status === 200 &&
    all.json.records.length === 2 &&
    all.json.records.every((r) => r.submission.student === student.email.toLowerCase()),
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
// notes/todos.md item 4: students DO now see safe per-case detail (which
// input, pass/fail) once released — the answer key (expected/got) is what
// must stay hidden. parityCheck.ts pins this widening in full detail; this
// is the same-shaped assertion serverCheck already made for the OLD (fully
// blanked) policy, updated to the new one.
check(
  'after release, per-case detail shows which input failed but never the answer',
  ownReleased.json.records.every((r) =>
    (r.result?.questions ?? []).every((q) => q.cases.every((c) => c.expected.length === 0 && c.got.length === 0)),
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

// ── student visibility ───────────────────────────────────────────
// A hidden assignment must be invisible, not merely flagged: absent from the
// student's list and a 404 on fetch, so a deep link cannot confirm it exists.
{
  const listedBefore = await api<{ assignments: { id: string; visible: boolean }[] }>(
    'GET', '/assignments', { token: sTok },
  );
  check(
    'the published assignment is listed as visible',
    listedBefore.json.assignments.some((a) => a.id === SAMPLE_ASSIGNMENT_ID && a.visible),
  );

  const hideForbidden = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/visibility`, {
    token: sTok,
    body: { visible: false },
  });
  check('student cannot change visibility', hideForbidden.status === 403);

  const badBody = await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/visibility`, {
    token: iTok,
    body: { visible: 'no' },
  });
  check('visibility rejects a non-boolean body (400)', badBody.status === 400);

  const hide = await api<{ visible: boolean }>(
    'PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/visibility`,
    { token: iTok, body: { visible: false } },
  );
  check('instructor hides the assignment', hide.status === 200 && hide.json.visible === false);

  const listedHidden = await api<{ assignments: { id: string }[] }>(
    'GET', '/assignments', { token: sTok },
  );
  check(
    'a hidden assignment is absent from the student list',
    !listedHidden.json.assignments.some((a) => a.id === SAMPLE_ASSIGNMENT_ID),
  );
  const fetchHidden = await api('GET', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: sTok });
  check('a hidden assignment 404s for a student (not 403)', fetchHidden.status === 404);

  const iSees = await api<{ assignments: { id: string; visible: boolean }[] }>(
    'GET', '/assignments', { token: iTok },
  );
  check(
    'the instructor still sees it, marked hidden',
    iSees.json.assignments.some((a) => a.id === SAMPLE_ASSIGNMENT_ID && a.visible === false),
  );
  const iFetch = await api('GET', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: iTok });
  check('the instructor can still fetch it', iFetch.status === 200);

  await api('PUT', `/assignments/${SAMPLE_ASSIGNMENT_ID}/visibility`, {
    token: iTok,
    body: { visible: true },
  });
  const fetchShown = await api('GET', `/assignments/${SAMPLE_ASSIGNMENT_ID}`, { token: sTok });
  check('publishing again restores the student view', fetchShown.status === 200);

  const unknown = await api('PUT', '/assignments/no-such-assignment/visibility', {
    token: iTok,
    body: { visible: false },
  });
  check('visibility on an unknown assignment is 404', unknown.status === 404);
}

// ── manual review (instructor-only; grades still unreleased here) ─
const openQ = iAsg.json.assignment.questions.find((q) => q.buildMode === 'open')!;
const reviewPath = `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions/1/review`;
const reviewBody = {
  student: student.email,
  questionId: openQ.id,
  pass: true,
  note: 'clear justification',
};

const reviewForbidden = await api('POST', reviewPath, { token: sTok, body: reviewBody });
check('student cannot review submissions (403)', reviewForbidden.status === 403);

const reviewOk = await api<{ record: SubmissionRecord }>('POST', reviewPath, {
  token: iTok,
  body: reviewBody,
});
const reviewedQ = reviewOk.json.record?.result?.questions.find((q) => q.questionId === openQ.id);
check(
  'instructor review → 201 with the verdict on the returned record',
  reviewOk.status === 201 && reviewedQ?.manual?.pass === true && reviewedQ.manual.note === 'clear justification',
);

const reviewMalformed = await api('POST', reviewPath, {
  token: iTok,
  body: { student: student.email, questionId: openQ.id }, // no pass verdict
});
check('malformed review body → 400', reviewMalformed.status === 400);

const reviewNotPending = await api('POST', reviewPath, {
  token: iTok,
  body: { ...reviewBody, questionId: iAsg.json.assignment.questions[0].id }, // autograded, not pending
});
check('review of a non-pending question → 404', reviewNotPending.status === 404);

const allReviewed = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions/all`,
  { token: iTok },
);
const storedVerdict = allReviewed.json.records
  .find((r) => r.attempt === 1)
  ?.result?.questions.find((q) => q.questionId === openQ.id)?.manual;
check(
  'verdict persisted on the stored record (instructor GET)',
  storedVerdict?.pass === true && !Number.isNaN(Date.parse(storedVerdict?.reviewedAt ?? '')),
);

const ownAfterReview = await api<{ records: SubmissionRecord[] }>(
  'GET',
  `/assignments/${SAMPLE_ASSIGNMENT_ID}/submissions`,
  { token: sTok },
);
check(
  'review leaks nothing to the student pre-release (results still withheld)',
  ownAfterReview.json.records.every((r) => r.result === undefined),
);

const reReview = await api<{ record: SubmissionRecord }>('POST', reviewPath, {
  token: iTok,
  body: { student: student.email, questionId: openQ.id, pass: false, note: 'on reflection, no' },
});
const reReviewedQ = reReview.json.record?.result?.questions.find((q) => q.questionId === openQ.id);
check(
  're-review overwrites the previous verdict',
  reReview.status === 201 && reReviewedQ?.manual?.pass === false && reReviewedQ.manual.note === 'on reflection, no',
);

// ── feedback ─────────────────────────────────────────────────────
const noFeedbackTok = await api('POST', '/feedback', {
  body: { category: 'platform design', message: 'hi' },
});
check('filing feedback needs auth', noFeedbackTok.status === 401);

const badCategory = await api('POST', '/feedback', {
  token: sTok,
  body: { category: 'not a real category', message: 'hi' },
});
check('unknown category rejected', badCategory.status === 400);

const emptyMessage = await api('POST', '/feedback', {
  token: sTok,
  body: { category: 'platform design', message: '   ' },
});
check('empty message rejected', emptyMessage.status === 400);

const tooManyScreenshots = await api('POST', '/feedback', {
  token: sTok,
  body: {
    category: 'platform design',
    message: 'three is too many',
    screenshots: [
      { dataUrl: 'data:image/png;base64,AAAA' },
      { dataUrl: 'data:image/png;base64,AAAA' },
      { dataUrl: 'data:image/png;base64,AAAA' },
    ],
  },
});
check('more than 2 screenshots rejected', tooManyScreenshots.status === 400);

const badScreenshot = await api('POST', '/feedback', {
  token: sTok,
  body: {
    category: 'platform design',
    message: 'not really an image',
    screenshots: [{ dataUrl: 'not-a-data-url' }],
  },
});
check('a non-image data URL is rejected', badScreenshot.status === 400);

const filed = await api<{ feedback: { id: string; student: string; status: string } }>(
  'POST',
  '/feedback',
  {
    token: sTok,
    body: {
      category: 'homework content',
      message: 'HW3 P7 statement has a typo',
      screenshots: [{ dataUrl: 'data:image/png;base64,AAAA', filename: 'shot.png' }],
      context: { assignmentId: SAMPLE_ASSIGNMENT_ID, questionId: 3 },
    },
  },
);
check(
  'a well-formed report is filed, stamped with the caller\'s email',
  filed.status === 201 && filed.json.feedback.student === student.email.toLowerCase() && filed.json.feedback.status === 'open',
);
const feedbackId = filed.json.feedback.id;

const studentListsFeedback = await api('GET', '/feedback', { token: sTok });
check('a student cannot see the queue', studentListsFeedback.status === 403);

const instructorListsFeedback = await api<{ feedback: { id: string; category: string }[] }>(
  'GET',
  '/feedback',
  { token: iTok },
);
check(
  'the instructor sees the filed report',
  instructorListsFeedback.status === 200 &&
    instructorListsFeedback.json.feedback.some((f) => f.id === feedbackId && f.category === 'homework content'),
);

const studentResolves = await api('PUT', `/feedback/${feedbackId}/status`, {
  token: sTok,
  body: { status: 'resolved' },
});
check('a student cannot resolve a report', studentResolves.status === 403);

const badStatus = await api('PUT', `/feedback/${feedbackId}/status`, {
  token: iTok,
  body: { status: 'archived' },
});
check('an unknown status value is rejected', badStatus.status === 400);

const resolve = await api('PUT', `/feedback/${feedbackId}/status`, {
  token: iTok,
  body: { status: 'resolved' },
});
check('the instructor marks it resolved', resolve.status === 200);

const afterResolve = await api<{ feedback: { id: string; status: string }[] }>('GET', '/feedback', {
  token: iTok,
});
check(
  'the resolved status persists',
  afterResolve.json.feedback.find((f) => f.id === feedbackId)?.status === 'resolved',
);

const unknownFeedback = await api('PUT', '/feedback/nope/status', {
  token: iTok,
  body: { status: 'open' },
});
check('resolving an unknown id 404s', unknownFeedback.status === 404);

// ── instructor notes ─────────────────────────────────────────────
const noNote = await api<{ note: unknown }>('GET', '/instructor-notes', { token: iTok });
check('no note saved yet reads null', noNote.status === 200 && noNote.json.note === null);

const studentReadsNotes = await api('GET', '/instructor-notes', { token: sTok });
check('a student cannot read the notes', studentReadsNotes.status === 403);

const studentWritesNotes = await api('PUT', '/instructor-notes', {
  token: sTok,
  body: { content: 'sneaking in' },
});
check('a student cannot save the notes', studentWritesNotes.status === 403);

const badNoteBody = await api('PUT', '/instructor-notes', { token: iTok, body: {} });
check('a missing content field is rejected', badNoteBody.status === 400);

const savedNote = await api<{ note: { content: string; updatedBy: string; updatedAt: string } }>(
  'PUT',
  '/instructor-notes',
  { token: iTok, body: { content: '# Coordination\n\n- watch HW4 P2 for confusion' } },
);
check(
  'saving stamps the caller\'s name and a timestamp',
  savedNote.status === 200 &&
    savedNote.json.note.updatedBy === instructor.name &&
    savedNote.json.note.content.startsWith('# Coordination'),
);

const reread = await api<{ note: { content: string } | null }>('GET', '/instructor-notes', {
  token: iTok,
});
check('the saved content persists across a fresh GET',
  reread.json.note?.content === savedNote.json.note.content);

const overwritten = await api<{ note: { content: string } }>('PUT', '/instructor-notes', {
  token: iTok,
  body: { content: 'replaced' },
});
check('saving again overwrites the single row (not a second one)',
  overwritten.status === 200 && overwritten.json.note.content === 'replaced');

// ── provenance (task 034) ────────────────────────────────────────
{
  const PROV_ID = 'prov-check';
  const aEmail = student.email.toLowerCase();
  await api('PUT', `/assignments/${PROV_ID}`, {
    token: iTok,
    body: { ...iAsg.json.assignment, id: PROV_ID, title: 'Provenance check' },
  });
  await api('PUT', `/assignments/${PROV_ID}/visibility`, { token: iTok, body: { visible: true } });
  const keyOf = async (tok: string, id = PROV_ID) =>
    (await api<{ mintKey?: string }>('GET', `/workbooks/${id}`, { token: tok })).json.mintKey ?? '';
  const aKey = await keyOf(sTok);
  check("GET /workbooks/:id returns the caller's mint key", /^[0-9a-f]{64}$/.test(aKey));
  check('…deterministic per (person, assignment)', aKey === (await keyOf(sTok)));
  check('…different for another person and for another assignment',
    aKey !== (await keyOf(iTok)) && aKey !== (await keyOf(sTok, SAMPLE_ASSIGNMENT_ID)));
  check("…and never the client's dev key", aKey !== deriveMintKey(DEV_MINT_SECRET, aEmail, PROV_ID));

  /** A circuit's ids replaced by `mint`'s, wires re-pointed. */
  const withIds = (c: CircuitData, mint: () => string): CircuitData => {
    const map = new Map(c.components.map((x) => [x.id, mint()]));
    return {
      components: c.components.map((x) => ({ ...x, id: map.get(x.id)! })),
      wires: c.wires.map((w) => ({
        ...w,
        id: mint(),
        sourceComponentId: map.get(w.sourceComponentId)!,
        targetComponentId: map.get(w.targetComponentId)!,
      })),
    };
  };
  const q1 = iAsg.json.assignment.questions[0].id; // CC
  const pA = prepareKey(aKey)!;
  const circuitA = withIds(ccCorrect(), () => mintWithKey(pA));
  const stateOf = (c: CircuitData) => ({
    currentQuestionIndex: 0,
    questionCircuits: { [q1]: { components: c.components, wires: c.wires, boxes: [] } },
  });
  await api('PUT', `/workbooks/${PROV_ID}`, { token: sTok, body: stateOf({ components: [], wires: [] }) });
  await api('PUT', `/workbooks/${PROV_ID}`, { token: sTok, body: stateOf(circuitA) });
  await api('PUT', `/workbooks/${PROV_ID}`, { token: sTok, body: stateOf(circuitA) });
  const saves = db.listWorkbookSaves(aEmail, PROV_ID);
  check('PUT appends to the save history, one row per CHANGED summary',
    saves.length === 2 && saves[1].summary[String(q1)]?.c === circuitA.components.length);
  check('…sizes only, never the work itself', !JSON.stringify(saves).includes(circuitA.components[0].id));

  const answersA = [{ questionId: q1, circuit: circuitA }];
  const postA = await api<{ record: SubmissionRecord }>('POST', `/assignments/${PROV_ID}/submissions`, {
    token: sTok,
    body: { answers: answersA },
  });
  check('the student POST response carries no integrity key', postA.status === 201 && !('integrity' in postA.json.record));

  // Student B takes A's workbook off the server and submits it as their own.
  const bEmail = 'b.student@example.com';
  db.upsertUser({ email: bEmail, name: 'B Student', role: 'student' });
  const bLogin = await api<{ token: string }>('POST', '/auth/login', { body: { email: bEmail } });
  const bTok = bLogin.json.token;
  await api('PUT', `/workbooks/${PROV_ID}`, { token: bTok, body: db.getWorkbook(aEmail, PROV_ID) });
  await api('POST', `/assignments/${PROV_ID}/submissions`, { token: bTok, body: { answers: answersA } });
  // …and then a sandbox circuit.
  const sandboxCircuit = withIds(ccCorrect(), () => mintWithKey(null));
  await api('POST', `/assignments/${PROV_ID}/submissions`, {
    token: bTok,
    body: { answers: [{ questionId: q1, circuit: sandboxCircuit }] },
  });

  const iRecs = (await api<{ records: SubmissionRecord[] }>('GET', `/assignments/${PROV_ID}/submissions/all`, { token: iTok })).json.records;
  const q1Of = (r: SubmissionRecord | undefined) => r?.integrity?.questions.find((x) => x.questionId === q1);
  const aRec = iRecs.find((r) => r.submission.student === aEmail);
  const bRecs = iRecs.filter((r) => r.submission.student === bEmail);
  const aQ = q1Of(aRec);
  check("A's own submission: every id bound to A",
    aQ != null && aQ.ids.total === 7 && aQ.ids.self === 7 && !aQ.flags.some((f) => f.code.startsWith('ids-')));
  const bQ = q1Of(bRecs.find((r) => r.attempt === 1));
  check("the transplant: B's submission names A as the ids' owner",
    bQ != null && bQ.ids.self === 0 && bQ.ids.others.length === 1 && bQ.ids.others[0].email === aEmail &&
    bQ.ids.others[0].count === 7 &&
    bQ.flags.some((f) => f.code === 'ids-other' && f.detail.includes(aEmail)));
  const sbQ = q1Of(bRecs.find((r) => r.attempt === 2));
  check('sandbox-minted ids read as unbound',
    sbQ != null && sbQ.ids.unbound === 7 && sbQ.flags.some((f) => f.code === 'ids-unbound'));
  check('the grade is untouched by it (the transplant still grades correct)',
    bRecs.find((r) => r.attempt === 1)?.result?.questions.find((x) => x.questionId === q1)?.passed ===
      aRec?.result?.questions.find((x) => x.questionId === q1)?.passed);

  const noIntegrity = async (label: string) => {
    const own = await api<{ records: SubmissionRecord[] }>('GET', `/assignments/${PROV_ID}/submissions`, { token: bTok });
    check(label, own.json.records.length === 2 && own.json.records.every((r) => !('integrity' in r)));
  };
  await noIntegrity('the student GET carries no integrity, pre-release');
  await api('PUT', `/assignments/${PROV_ID}/grades-release`, { token: iTok, body: { released: true } });
  await noIntegrity('…nor post-release');
  const postReleased = await api<{ record: SubmissionRecord }>('POST', `/assignments/${PROV_ID}/submissions`, {
    token: bTok,
    body: { answers: answersA },
  });
  check('…and neither does a post-release POST response',
    postReleased.status === 201 && !('integrity' in postReleased.json.record) && postReleased.json.record.result != null);

  // The generated secret is kept: a restart on the same file keeps every key.
  const dir = mkdtempSync(join(tmpdir(), 'mm-provenance-'));
  try {
    const file = join(dir, 'mm.sqlite');
    const bootKey = async (): Promise<string> => {
      const d = new Db(file);
      d.upsertUser({ email: aEmail, name: 'A', role: 'student' });
      const srv = createApp({ ...config, dbPath: file }, d).listen(0);
      await new Promise<void>((resolve) => srv.on('listening', resolve));
      const addr = srv.address();
      const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
      const login = await fetch(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: aEmail }),
      }).then((r) => r.json() as Promise<{ token: string }>);
      const wb = await fetch(`${url}/workbooks/${PROV_ID}`, {
        headers: { Authorization: `Bearer ${login.token}` },
      }).then((r) => r.json() as Promise<{ mintKey?: string }>);
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      d.close();
      return wb.mintKey ?? '';
    };
    const k1 = await bootKey();
    const k2 = await bootKey();
    check('with no MM_MINT_SECRET the generated secret persists: same key after a restart',
      /^[0-9a-f]{64}$/.test(k1) && k1 === k2);

    // Legacy: a database from before the watermark, with a saved workbook.
    const legacyFile = join(dir, 'legacy.sqlite');
    const raw = new DatabaseSync(legacyFile);
    raw.exec(`
      CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE workbooks (email TEXT NOT NULL, assignment_id TEXT NOT NULL, state TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (email, assignment_id));
    `);
    const legacyCircuit = withIds(ccCorrect(), () => crypto.randomUUID());
    // Its box library too: the assignment-wide one and an older per-question
    // one. An instance placed from it later keeps these internal ids.
    const libCircuit = withIds({ components: ccCorrect().components.slice(0, 2), wires: [] }, () => crypto.randomUUID());
    const oldLibCircuit = withIds({ components: ccCorrect().components.slice(0, 1), wires: [] }, () => crypto.randomUUID());
    const boxDef = (id: string, c: CircuitData) =>
      ({ id, name: id, inputPortIds: [], outputPortIds: [], internalComponents: c.components, internalWires: c.wires });
    const legacyState = stateOf(legacyCircuit);
    Object.assign(legacyState.questionCircuits[q1], { confirmedBoxes: [boxDef('old-box', oldLibCircuit)] });
    raw.prepare('INSERT INTO workbooks VALUES (?, ?, ?, ?)')
      .run(aEmail, PROV_ID, JSON.stringify({ ...legacyState, boxLibrary: [boxDef('lib-box', libCircuit)] }),
        new Date().toISOString());
    raw.close();
    const ldb = new Db(legacyFile);
    const legacy = ldb.legacyFor(aEmail, PROV_ID);
    check('opening a pre-watermark database snapshots its workbooks as legacy',
      legacy != null && legacy.ids.length === 7 + 2 + 1 && legacy.summary[String(q1)]?.c === 4);
    check("…the box library's internals included (boxLibrary and the older per-question confirmedBoxes)",
      [...libCircuit.components, ...oldLibCircuit.components].every((c) => legacy?.ids.includes(c.id)));
    ldb.saveWorkbook(aEmail, 'later', stateOf(legacyCircuit));
    ldb.close();
    const ldb2 = new Db(legacyFile);
    check('…once: a workbook saved after it is never legacy', ldb2.legacyFor(aEmail, 'later') === null);
    ldb2.upsertUser({ email: aEmail, name: 'A', role: 'student' });
    ldb2.saveAssignment({ ...iAsg.json.assignment, id: PROV_ID });
    const lsrv = createApp({ ...config, dbPath: legacyFile }, ldb2).listen(0);
    await new Promise<void>((resolve) => lsrv.on('listening', resolve));
    const laddr = lsrv.address();
    const lurl = `http://127.0.0.1:${typeof laddr === 'object' && laddr ? laddr.port : 0}/api`;
    const llogin = await fetch(`${lurl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: aEmail }),
    }).then((r) => r.json() as Promise<{ token: string }>);
    await fetch(`${lurl}/assignments/${PROV_ID}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llogin.token}` },
      body: JSON.stringify({ answers: [{ questionId: q1, circuit: legacyCircuit }] }),
    });
    // A library box placed AFTER the watermark: the instance id is minted
    // under A's key, its internals are the library's legacy ids.
    const lwb = await fetch(`${lurl}/workbooks/${PROV_ID}`, { headers: { Authorization: `Bearer ${llogin.token}` } })
      .then((r) => r.json() as Promise<{ mintKey: string }>);
    const instance = {
      id: mintWithKey(prepareKey(lwb.mintKey)), type: 'BOXED' as const, x: 0, y: 0, label: 'lib-box', ports: [],
      boxedCircuitId: 'lib-box', internalCircuit: libCircuit,
    };
    await fetch(`${lurl}/assignments/${PROV_ID}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llogin.token}` },
      body: JSON.stringify({
        answers: [{ questionId: q1, circuit: { components: [...legacyCircuit.components, instance], wires: legacyCircuit.wires } }],
      }),
    });
    await new Promise<void>((resolve) => lsrv.close(() => resolve()));
    const lrecs = ldb2.listSubmissions(PROV_ID);
    const lq = lrecs.find((r) => r.attempt === 1)?.integrity?.questions.find((x) => x.questionId === q1);
    check("…and a submission of that workbook's ids reads them as legacy, unflagged as ids",
      lq != null && lq.ids.legacy === 7 && lq.ids.unbound === 0 && !lq.flags.some((f) => f.code.startsWith('ids-')));
    const lbq = lrecs.find((r) => r.attempt === 2)?.integrity?.questions.find((x) => x.questionId === q1);
    check("…and a library box placed after it: the instance is the student's, its internals legacy — never unbound",
      lbq != null && lbq.ids.self === 1 && lbq.ids.legacy === 7 + 2 && lbq.ids.unbound === 0 &&
        !lbq.flags.some((f) => f.code.startsWith('ids-')),
      JSON.stringify(lbq?.ids));
    ldb2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── logout ───────────────────────────────────────────────────────
await api('POST', '/auth/logout', { token: sTok });
const afterLogout = await api('GET', '/auth/me', { token: sTok });
check('logout invalidates session', afterLogout.status === 401);

server.close();
db.close();

console.log(failures === 0 ? '\nserverCheck: all checks passed' : `\nserverCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
