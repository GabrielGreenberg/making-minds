// Human grades on the real server (task 063; design memo
// docs/buildout/designs/grading-interface.md §4.2, §7, §9).
//
//   cd server && npx tsx tools/gradingCheck.ts
//
// Covers: the grade routes (PUT/DELETE .../grades/:sid/:qid) — opaque student
// keys, the version check (409 carrying the current grade), 0 / ½ / 1 only,
// an override of an autograde needs a note; every change logged, the log
// append-only; students can neither write nor (before release) read grades,
// and after release see them without grader or version; a resubmission with a
// different answer turns a grade into "changed since graded"; the one-time
// migration of legacy ✓/✗ reviews (latest attempt only, idempotent across
// restarts); results stamped with the assignment's content hash; an
// assignment with submissions can't be deleted. And the grading summaries
// (task 064): the roster join (a row for a student who never submitted, a
// removed or instructor submitter flagged under an opaque key), latest attempt
// only, stale results by content hash, no circuits / answers / emails in a
// summary, one attempt in full on demand, students refused; the local
// GradingStore ≡ the server on the same fixture; the 80 × 23 payload's size.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import { buildSampleAssignment, buildCorrectSubmission, buildIncorrectSubmission, SAMPLE_ASSIGNMENT_ID } from '../../app/src/devData/sampleData';
import { gradeSubmission } from '../../app/src/engine/grader';
import { scoreRecord } from '../../app/src/engine/score';
import { homeworkContentHash } from '../../app/src/devData/homeworkSync';
import type { AssignmentData, HumanGrade, SubmissionData, SubmissionRecord } from '../../app/src/types';
import type {
  AssignmentGradingSummary,
  AttemptDetail,
  CourseGrading,
  GradingRow,
  StudentGrading,
} from '../../app/src/storage/gradingSummary';
import { assignmentSummary } from '../src/gradingSummary';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const config: ServerConfig = { port: 0, dbPath: ':memory:', corsOrigins: [], authMode: 'dev', sessionTtlSeconds: 3600 };
const db = new Db(config.dbPath);
for (const a of TOY_ACCOUNTS) db.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
const asg = buildSampleAssignment();
db.saveAssignment(asg);
const server = createApp(config, db).listen(0);
await new Promise<void>((r) => server.on('listening', r));
const address = server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
async function api<T>(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}
const login = async (email: string) =>
  (await api<{ token: string }>('POST', '/auth/login', { body: { email } })).json.token;
const student = TOY_ACCOUNTS.find((a) => a.role === 'student')!;
const instructor = TOY_ACCOUNTS.find((a) => a.role === 'instructor')!;
const sTok = await login(student.email);
const iTok = await login(instructor.email);
const email = student.email.toLowerCase();

const OPEN = asg.questions.find((q) => q.buildMode === 'open')!.id;
const MACHINE = asg.questions.find((q) => q.buildMode !== 'open')!.id;
const url = `/assignments/${SAMPLE_ASSIGNMENT_ID}`;
const correct = buildCorrectSubmission(student.email);

// ── submit: stamped with the content hash ───────────────────────────────
console.log('[submit]');
const sub1 = await api<{ record: SubmissionRecord }>('POST', `${url}/submissions`, { token: sTok, body: { answers: correct.answers } });
const all1 = await api<{ records: SubmissionRecord[] }>('GET', `${url}/submissions/all`, { token: iTok });
check('a result is stamped with the content hash of the assignment it graded against',
  sub1.status === 201 && all1.json.records[0]?.assignmentHash === homeworkContentHash(asg));
const sKey = all1.json.records[0]?.studentKey ?? '';
check("the gradebook's records name the student by an opaque key", sKey === db.publicIdOf(email) && !sKey.includes('@'));

// ── the grade routes ────────────────────────────────────────────────────
console.log('[grade routes]');
const path = (qid: number, key = sKey) => `${url}/grades/${key}/${qid}`;
type GradeRes = { grade?: HumanGrade | null; error?: string; current?: HumanGrade | null };
check('students cannot write grades (403)',
  (await api('PUT', path(OPEN), { token: sTok, body: { points: 1, version: null } })).status === 403 &&
  (await api('DELETE', path(OPEN), { token: sTok, body: { version: 1 } })).status === 403);
check('an unknown student key or question → 404',
  (await api('PUT', path(OPEN, 'no-such-key'), { token: iTok, body: { points: 1, version: null } })).status === 404 &&
  (await api('PUT', path(9999), { token: iTok, body: { points: 1, version: null } })).status === 404);
check('an email in the path is not a key (404) — students are never named by email',
  (await api('PUT', path(OPEN, encodeURIComponent(email)), { token: iTok, body: { points: 1, version: null } })).status === 404);
const bad = await api<GradeRes>('PUT', path(OPEN), { token: iTok, body: { points: 0.7, version: null } });
check('points outside 0 / ½ / 1 → 400 with the reason', bad.status === 400 && /0, ½ or 1/.test(bad.json.error ?? ''));
check('a missing version → 400', (await api('PUT', path(OPEN), { token: iTok, body: { points: 1 } })).status === 400);
const g1 = await api<GradeRes>('PUT', path(OPEN), { token: iTok, body: { points: 0.5, note: 'half there', version: null } });
check('a hand grade → version 1, stamped with the grader and the attempt',
  g1.status === 200 && g1.json.grade?.version === 1 && g1.json.grade.points === 0.5 &&
  g1.json.grade.grader === instructor.email.toLowerCase() && g1.json.grade.attempt === 1);
const stale = await api<GradeRes>('PUT', path(OPEN), { token: iTok, body: { points: 1, version: null } });
check('a write that read an older version → 409 carrying the current grade',
  stale.status === 409 && stale.json.current?.version === 1 && stale.json.current.points === 0.5);
const g2 = await api<GradeRes>('PUT', path(OPEN), { token: iTok, body: { points: 1, note: 'on a second look, yes', version: 1 } });
check('naming the current version replaces it → version 2', g2.status === 200 && g2.json.grade?.version === 2);
const noNote = await api<GradeRes>('PUT', path(MACHINE), { token: iTok, body: { points: 0.5, version: null } });
check('overriding an autograded problem with no note → 400', noNote.status === 400 && /note/.test(noNote.json.error ?? ''));
const override = await api<GradeRes>('PUT', path(MACHINE), { token: iTok, body: { points: 0.5, note: 'right idea, one wire off', version: null } });
check('…with a note → 200', override.status === 200 && override.json.grade?.version === 1);
const staleClear = await api('DELETE', path(MACHINE), { token: iTok, body: { version: 7 } });
check('a clear naming a stale version → 409', staleClear.status === 409);
const cleared = await api<GradeRes>('DELETE', path(MACHINE), { token: iTok, body: { version: 1 } });
check('a clear naming the version → the autograde again', cleared.status === 200 && cleared.json.grade === null &&
  db.getGrade(SAMPLE_ASSIGNMENT_ID, email, MACHINE) === null);

// ── the log ─────────────────────────────────────────────────────────────
console.log('[log]');
const events = db.listGradeEvents(SAMPLE_ASSIGNMENT_ID);
check('every change is logged, in order: grade, grade, override, clear',
  events.map((e) => e.kind).join() === 'grade,grade,override,clear' &&
  events.every((e) => e.actor === instructor.email.toLowerCase() && e.student === email));
check('…each with what it was before and after', events[1].before?.version === 1 && events[1].after?.version === 2 &&
  events[3].after === null && events[3].before?.points === 0.5);
check('refused and conflicting writes are not logged', events.length === 4);
const dbSource = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
check('the log is append-only: db.ts never updates or deletes a grade_events row',
  !/UPDATE\s+grade_events/i.test(dbSource) && !/DELETE\s+FROM\s+grade_events/i.test(dbSource));

// ── what a student sees ─────────────────────────────────────────────────
console.log('[student view]');
const before = await api<{ records: SubmissionRecord[] }>('GET', `${url}/submissions`, { token: sTok });
check('before release: no result and no grades', before.json.records.every((r) => r.result === undefined && r.grades === undefined));
await api('PUT', `${url}/grades-release`, { token: iTok, body: { released: true } });
const after = await api<{ records: SubmissionRecord[] }>('GET', `${url}/submissions`, { token: sTok });
const mine = after.json.records[0]?.grades?.[0];
check('after release: the grade — points, note, what it judged — never grader, attempt or version',
  mine?.points === 1 && mine.note === 'on a second look, yes' && typeof mine.answerKey === 'string' &&
  mine.grader === undefined && mine.attempt === undefined && mine.version === undefined);
check("…and no legacy review field anywhere in the student's result",
  after.json.records.every((r) => r.result?.questions.every((q) => q.manual === undefined)));
check('…and it counts in their score', scoreRecord(asg.questions, after.json.records[0], 0)
  .problems.find((p) => p.questionId === OPEN)?.source === 'human');
check('students still cannot read the gradebook feed (403)',
  (await api('GET', `${url}/submissions/all`, { token: sTok })).status === 403);

// ── a resubmission with a different answer ──────────────────────────────
console.log('[resubmission]');
const changed = correct.answers.map((a) => (a.questionId === OPEN ? { ...a, responseText: 'A different answer.' } : a));
await api('POST', `${url}/submissions`, { token: sTok, body: { answers: changed } });
const all2 = await api<{ records: SubmissionRecord[] }>('GET', `${url}/submissions/all`, { token: iTok });
const latest2 = all2.json.records.find((r) => r.attempt === 2)!;
const p2 = scoreRecord(asg.questions, latest2, 0).problems.find((p) => p.questionId === OPEN)!;
check('a grade on the old answer becomes "changed since graded", offered as a suggestion',
  p2.source === 'changed' && p2.suggestion?.points === 1);
await api('POST', `${url}/submissions`, { token: sTok, body: { answers: correct.answers } });
const all3 = await api<{ records: SubmissionRecord[] }>('GET', `${url}/submissions/all`, { token: iTok });
check('…and holds again when the answer is back to the one it judged',
  scoreRecord(asg.questions, all3.json.records.find((r) => r.attempt === 3)!, 0)
    .problems.find((p) => p.questionId === OPEN)?.source === 'human');

// ── deleting an assignment ──────────────────────────────────────────────
console.log('[delete]');
const del = await api<{ error?: string }>('DELETE', url, { token: iTok });
check('an assignment with submissions cannot be deleted (409)', del.status === 409 && /hide it/.test(del.json.error ?? '') &&
  db.getAssignment(SAMPLE_ASSIGNMENT_ID) !== null);

server.close();
db.close();

// ── the one-time migration of legacy reviews ────────────────────────────
console.log('[migration]');
{
  const dir = mkdtempSync(join(tmpdir(), 'mm-grades-'));
  const file = join(dir, 'g.sqlite');
  const d1 = new Db(file);
  d1.upsertUser({ email, name: student.name, role: 'student' });
  d1.saveAssignment(asg);
  const review = (pass: boolean, at: string) => {
    const result = gradeSubmission(asg, correct);
    return { ...result, questions: result.questions.map((q) => (q.questionId === OPEN ? { ...q, manual: { pass, note: pass ? 'ok' : 'no', reviewedAt: at } } : q)) };
  };
  d1.addSubmission(SAMPLE_ASSIGNMENT_ID, email, correct, review(false, '2026-09-01T00:00:00Z'));
  d1.addSubmission(SAMPLE_ASSIGNMENT_ID, email, correct, review(true, '2026-09-02T00:00:00Z'));
  // Reviews stored the old way, inside results — then the migration ran on
  // this DB's first boot, BEFORE they existed. Force a second first boot:
  d1.close();
  const raw = new (await import('node:sqlite')).DatabaseSync(file);
  raw.exec("DELETE FROM server_meta WHERE key = 'grades_migrated'");
  raw.close();
  const d2 = new Db(file);
  const g = d2.getGrade(SAMPLE_ASSIGNMENT_ID, email, OPEN);
  check("legacy reviews migrate from the LATEST attempt only: ✓ = 1, its note, attempt 2, version 1, grader null",
    g?.points === 1 && g.note === 'ok' && g.attempt === 2 && g.version === 1 && g.grader === null && g.gradedAt === '2026-09-02T00:00:00Z');
  check('…each logged as "migrate" by "migration"', d2.listGradeEvents(SAMPLE_ASSIGNMENT_ID).map((e) => `${e.kind}:${e.actor}`).join() === 'migrate:migration');
  d2.close();
  const d3 = new Db(file);
  check('a restart does not migrate again', d3.listGradeEvents(SAMPLE_ASSIGNMENT_ID).length === 1);
  d3.close();
  rmSync(dir, { recursive: true, force: true });
}

// ── the grading summaries (task 064) ───────────────────────────────────
{
  const db2 = new Db(':memory:');
  for (const a of TOY_ACCOUNTS) db2.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
  // Synthetic only (PROFILE §8.9): a student who submits, then leaves the roster.
  const LEAVER = 's01@example.com';
  db2.upsertUser({ email: LEAVER, name: 'Student 01', role: 'student' });
  const asg2: AssignmentData = { ...buildSampleAssignment(), dueDate: '2026-01-01T00:00:00.000Z' };
  db2.saveAssignment(asg2);
  const server2 = createApp(config, db2).listen(0);
  await new Promise<void>((r) => server2.on('listening', r));
  const addr2 = server2.address();
  const base2 = `http://127.0.0.1:${typeof addr2 === 'object' && addr2 ? addr2.port : 0}/api`;
  const call = async <T>(method: string, p: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await fetch(base2 + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json = {} as T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      // not JSON
    }
    return { status: res.status, json, text };
  };
  const signIn = async (e: string) => (await call<{ token: string }>('POST', '/auth/login', { body: { email: e } })).json.token;
  const john = TOY_ACCOUNTS.find((a) => a.role === 'student')!;
  const jane = TOY_ACCOUNTS.filter((a) => a.role === 'student')[1];
  const johnEmail = john.email.toLowerCase();
  const jTok = await signIn(john.email);
  const i2Tok = await signIn(instructor.email);
  const leaverTok = await signIn(LEAVER);
  const u2 = `/assignments/${asg2.id}`;
  const submit = (tok: string, answers: SubmissionData['answers']) => call('POST', `${u2}/submissions`, { token: tok, body: { answers } });
  await submit(jTok, buildCorrectSubmission(john.email).answers);
  const wrong = buildIncorrectSubmission(john.email).answers;
  await submit(jTok, wrong);
  await submit(leaverTok, buildCorrectSubmission(LEAVER).answers);
  db2.removeUser(LEAVER);
  await submit(i2Tok, buildCorrectSubmission(instructor.email).answers);

  console.log('[summary]');
  const getSummary = async () => (await call<AssignmentGradingSummary>('GET', `${u2}/summary`, { token: i2Tok })).json;
  const s1 = await getSummary();
  const names = s1.rows.map((r) => r.student.name);
  const johnRow = s1.rows.find((r) => r.student.name === john.name)!;
  const janeRow = s1.rows.find((r) => r.student.name === jane.name)!;
  const leaverRow = s1.rows.find((r) => r.student.offRoster === 'removed');
  const adaRow = s1.rows.find((r) => r.student.offRoster === 'instructor');
  check('one row per roster student, by name, then the other submitters',
    names.join('|') === [jane.name, john.name, instructor.name, 'Removed from the roster'].join('|'), names.join('|'));
  check('a roster student who never submitted has a row: no attempt, Missing past the due date',
    janeRow.latest === null && janeRow.problems.length === 0 && janeRow.grade.missing && janeRow.grade.final === 0 &&
      s1.progress.missing === 1);
  const johnLatest = db2.listSubmissions(asg2.id, johnEmail)[1];
  const expected = scoreRecord(asg2.questions, johnLatest, Date.now(), { at: asg2.dueDate! })
    .problems.map((p) => ({ points: p.points, source: p.source }));
  check('latest attempt only: the row is attempt 2, scored from attempt 2',
    johnRow.latest?.attempt === 2 && JSON.stringify(johnRow.problems) === JSON.stringify(expected) &&
      johnRow.problems.some((p) => p.points !== 1));
  check('a submission past the due date is late (units and deduction wait for the calendar, task 068)',
    johnRow.latest?.late.late === true && johnRow.latest.late.units === null && johnRow.latest.late.deduction === null &&
      s1.progress.late === 1);
  check('a submitter removed from the roster is flagged, under an opaque derived key',
    !!leaverRow && leaverRow.latest?.attempt === 1 && !leaverRow.student.key.includes('@') && leaverRow.student.key.startsWith('x') &&
      leaverRow.student.key !== db2.publicIdOf(LEAVER));
  check("an instructor's own attempt is flagged, never counted", adaRow?.student.key === db2.publicIdOf(instructor.email.toLowerCase()));
  check('progress: 2 on the roster, 1 submitted, 2 off-roster submissions apart',
    s1.progress.roster === 2 && s1.progress.submitted === 1 && s1.progress.offRosterSubmitted === 2 && s1.progress.released === false,
    JSON.stringify(s1.progress));
  check('the problems line up with questionIds', s1.questionIds.length === asg2.questions.length &&
    johnRow.problems.length === asg2.questions.length);

  console.log('[stale]');
  const janeSub: SubmissionData = { ...buildCorrectSubmission(jane.email.toLowerCase()), submittedAt: '2025-12-31T00:00:00.000Z' };
  db2.addSubmission(asg2.id, jane.email.toLowerCase(), janeSub, gradeSubmission(asg2, janeSub), undefined, 'an-older-version');
  const s2 = await getSummary();
  const janeRow2 = s2.rows.find((r) => r.student.name === jane.name)!;
  check('a result graded against an older version is stale; the current one is not',
    janeRow2.latest?.stale === true && s2.rows.find((r) => r.student.name === john.name)?.latest?.stale === false &&
      s2.progress.autograded.stale === 1 && s2.progress.autograded.current === 1, JSON.stringify(s2.progress.autograded));
  check('…an on-time submission is not late, and nobody is missing now',
    janeRow2.latest?.late.late === false && s2.progress.late === 1 && s2.progress.missing === 0 && s2.progress.submitted === 2);

  console.log('[no circuits]');
  const noLeak = (label: string, text: string) =>
    check(`${label}: no circuits, cases, answers, integrity, notes or emails`,
      !/circuit|components|expected|"got"|integrity|responseText|fillAnswers|answerKey|"note"|@/.test(text), text.slice(0, 200));
  noLeak('/summary', (await call('GET', `${u2}/summary`, { token: i2Tok })).text);
  noLeak('/grading', (await call('GET', '/grading', { token: i2Tok })).text);
  noLeak('/students/:sid', (await call('GET', `/students/${johnRow.student.key}`, { token: i2Tok })).text);

  console.log('[403]');
  const routes = ['/grading', `${u2}/summary`, `/students/${johnRow.student.key}`, `${u2}/submissions/${johnRow.student.key}/1`];
  const statuses = await Promise.all(routes.map(async (r) => [(await call('GET', r, { token: jTok })).status, (await call('GET', r)).status]));
  check('students get 403 on all four; no session 401', statuses.every(([st, anon]) => st === 403 && anon === 401), JSON.stringify(statuses));
  check('an unknown assignment → 404', (await call('GET', '/assignments/nope/summary', { token: i2Tok })).status === 404);

  console.log('[grades flow]');
  const openIdx = s2.questionIds.indexOf(OPEN);
  const johnKey = johnRow.student.key;
  await call('PUT', `${u2}/grades/${johnKey}/${OPEN}`, { token: i2Tok, body: { points: 1, version: null } });
  const s3 = await getSummary();
  const johnRow3 = s3.rows.find((r) => r.student.key === johnKey)!;
  check('a hand grade shows as source "human", and counts toward hand-graded x',
    johnRow3.problems[openIdx].source === 'human' && johnRow3.problems[openIdx].points === 1 &&
      s3.progress.handGraded.x === s2.progress.handGraded.x + 1 && s3.progress.handGraded.y === s2.progress.handGraded.y,
    JSON.stringify([s2.progress.handGraded, s3.progress.handGraded]));
  await submit(jTok, wrong.map((a) => (a.questionId === OPEN ? { ...a, responseText: 'Something else entirely.' } : a)));
  const s4 = await getSummary();
  const johnRow4 = s4.rows.find((r) => r.student.key === johnKey)!;
  check('a resubmission with a different answer: "changed", the grade provisional, back out of x',
    johnRow4.latest?.attempt === 3 && johnRow4.problems[openIdx].source === 'changed' && johnRow4.problems[openIdx].points === null &&
      johnRow4.grade.provisional && s4.progress.handGraded.x === s2.progress.handGraded.x);

  console.log('[course]');
  const course = (await call<CourseGrading>('GET', '/grading', { token: i2Tok })).json;
  check('/grading: every assignment with the same progress as its summary',
    course.assignments.length === 1 && course.assignments[0].id === asg2.id &&
      JSON.stringify(course.assignments[0].progress) === JSON.stringify(s4.progress));
  check('…and course-wide counts',
    course.counts.roster === 2 && course.counts.submittedAny === 2 && course.counts.staleResults === 1 &&
      course.counts.accounts === 0 &&
      course.counts.pendingHandGrading === s4.progress.handGraded.y - s4.progress.handGraded.x,
    JSON.stringify(course.counts));

  console.log('[student]');
  const one = await call<StudentGrading>('GET', `/students/${johnKey}`, { token: i2Tok });
  check('/students/:sid: that student across assignments — the same row as the summary',
    one.status === 200 && one.json.student.key === johnKey && one.json.assignments.length === 1 &&
      JSON.stringify(one.json.assignments[0].row) === JSON.stringify(johnRow4));
  const gone = await call<StudentGrading>('GET', `/students/${leaverRow!.student.key}`, { token: i2Tok });
  check('…a removed submitter by their derived key', gone.status === 200 && gone.json.student.offRoster === 'removed' &&
    gone.json.assignments[0].row.latest?.attempt === 1);
  check('…an unknown key, or an email, → 404',
    (await call('GET', '/students/no-such-key', { token: i2Tok })).status === 404 &&
      (await call('GET', `/students/${encodeURIComponent(johnEmail)}`, { token: i2Tok })).status === 404);

  console.log('[attempt]');
  const det = await call<AttemptDetail>('GET', `${u2}/submissions/${johnKey}/2`, { token: i2Tok });
  const machine = det.json.record?.result?.questions.find((q) => q.questionId === MACHINE);
  check('one attempt in full: circuits, expected/got, integrity',
    det.status === 200 && det.json.record.attempt === 2 &&
      det.json.record.submission.answers.some((a) => a.circuit.components.length > 0) &&
      !!machine && machine.cases.some((c) => c.expected.length > 0) && det.json.record.integrity !== undefined);
  check("…the grades in full (grader, version) and that student's log",
    det.json.record.grades?.[0]?.grader === instructor.email.toLowerCase() && det.json.record.grades[0].version === 1 &&
      det.json.events.length === 1 && det.json.events.every((e) => e.student === johnEmail) &&
      det.json.score.problems.length === asg2.questions.length);
  check('…an unknown attempt, student or assignment → 404',
    (await call('GET', `${u2}/submissions/${johnKey}/99`, { token: i2Tok })).status === 404 &&
      (await call('GET', `${u2}/submissions/nobody/1`, { token: i2Tok })).status === 404 &&
      (await call('GET', `/assignments/nope/submissions/${johnKey}/1`, { token: i2Tok })).status === 404);
  check('…a removed submitter\'s attempt by the derived key',
    (await call('GET', `${u2}/submissions/${leaverRow!.student.key}/1`, { token: i2Tok })).status === 200);
  {
    // The grade writes take every key a summary hands out (one resolver,
    // gradingSummary.ts studentEmailOf) — a removed submitter's derived key too.
    const leaverKey = leaverRow!.student.key;
    const put = await call('PUT', `${u2}/grades/${leaverKey}/${OPEN}`, { token: i2Tok, body: { points: 1, version: null } });
    const del = await call('DELETE', `${u2}/grades/${leaverKey}/${OPEN}`, { token: i2Tok, body: { version: 1 } });
    check("…and a removed submitter's derived key is gradable (PUT, then DELETE, a grade)",
      put.status === 200 && del.status === 200, JSON.stringify([put.status, put.text, del.status, del.text]));
  }

  console.log('[local ≡ remote]');
  {
    // The local GradingStore over the same records: localStorage shimmed
    // BEFORE the app's storage modules load (the harness resolves to local).
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: (i: number) => [...mem.keys()][i] ?? null,
        get length() {
          return mem.size;
        },
      },
    });
    const backendUrl = new URL('../../app/src/storage/backend.ts', import.meta.url).href;
    const local = (await import(backendUrl)) as {
      backendMode: string;
      assignmentStore: { save(a: AssignmentData): Promise<void> };
      gradingStore: { summary(id: string): Promise<AssignmentGradingSummary | null> };
    };
    check('the harness resolves to the local backend', local.backendMode === 'local');
    await local.assignmentStore.save(asg2);
    // Toy accounts only: locally nobody is "removed" (no accounts to remove).
    const toy = new Set(TOY_ACCOUNTS.map((a) => a.email.toLowerCase()));
    mem.set(`mm:sub:${asg2.id}`, JSON.stringify(db2.listSubmissions(asg2.id).filter((r) => toy.has(r.submission.student ?? ''))));
    mem.set(`mm:grades:${asg2.id}`, JSON.stringify(Object.fromEntries(db2.listGrades(asg2.id))));
    const localSummary = (await local.gradingStore.summary(asg2.id))!;
    const remoteSummary = await getSummary();
    // Keys differ by design (public_id vs email), and the toy roster has no
    // UID, section or credential: compare by name.
    const norm = (s: AssignmentGradingSummary) => ({
      ...s,
      rows: s.rows
        .filter((r) => r.student.offRoster !== 'removed')
        .map((r: GradingRow) => ({ ...r, student: { name: r.student.name, sortName: r.student.sortName, offRoster: r.student.offRoster } })),
      progress: { ...s.progress, offRosterSubmitted: 0 },
    });
    const a = JSON.stringify(norm(localSummary));
    const b = JSON.stringify(norm(remoteSummary));
    check('LocalGradingStore.summary ≡ the server\'s /summary on the same records', a === b, `\n local  ${a.slice(0, 400)}\n remote ${b.slice(0, 400)}`);
  }
  server2.close();
  db2.close();
}

console.log('[size]');
{
  const db3 = new Db(':memory:');
  const hw1 = JSON.parse(readFileSync(new URL('../../app/src/devData/homeworks/hw1.json', import.meta.url), 'utf8')) as AssignmentData;
  db3.saveAssignment(hw1);
  const hash = homeworkContentHash(hw1);
  for (let n = 1; n <= 80; n++) {
    const nn = String(n).padStart(2, '0');
    const e = `s${nn}@example.com`;
    db3.upsertUser({ email: e, name: `Student ${nn}`, role: 'student', studentId: `9000000${nn}` });
    const sub: SubmissionData = {
      assignmentTitle: hw1.title,
      student: e,
      submittedAt: '2026-10-01T12:00:00.000Z',
      answers: hw1.questions.map((q) => ({ questionId: q.id, circuit: { components: [], wires: [] }, responseText: 'An answer.' })),
    };
    db3.addSubmission(hw1.id, e, sub, gradeSubmission(hw1, sub), undefined, hash);
  }
  const t0 = performance.now();
  const summary = assignmentSummary(db3, db3.mintSecret(), hw1.id, Date.now())!;
  const ms = performance.now() - t0;
  const body = JSON.stringify(summary);
  const bytes = Buffer.byteLength(body);
  // What crosses the wire: the pilot's Caddy serves the API with `encode gzip`
  // (deploy/Caddyfile). The memo's "~50 KB at 80 × 23" is held there; the raw
  // body (identity + attempt meta + 23 `{points, source}` a row) is ~86 KB.
  const wire = gzipSync(body).length;
  console.log(`      80 students × ${hw1.questions.length} questions: ${bytes} bytes raw, ${wire} bytes gzipped, ${ms.toFixed(0)} ms`);
  check('the 80 × 23 summary: under 50 KB on the wire (gzip), under 100 KB raw',
    hw1.questions.length === 23 && summary.rows.length === 80 && wire < 50_000 && bytes < 100_000, `${wire} / ${bytes}`);
  db3.close();
}

console.log(failures === 0 ? '\ngradingCheck: all checks passed' : `\ngradingCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
