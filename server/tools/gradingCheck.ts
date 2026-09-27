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
// assignment with submissions can't be deleted.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import { buildSampleAssignment, buildCorrectSubmission, SAMPLE_ASSIGNMENT_ID } from '../../app/src/devData/sampleData';
import { gradeSubmission } from '../../app/src/engine/grader';
import { scoreRecord } from '../../app/src/engine/score';
import { homeworkContentHash } from '../../app/src/devData/homeworkSync';
import type { HumanGrade, SubmissionRecord } from '../../app/src/types';

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

console.log(failures === 0 ? '\ngradingCheck: all checks passed' : `\ngradingCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
