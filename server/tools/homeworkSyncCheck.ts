// homeworkSyncCheck — pins the repo → server homework sync (task
// 2026-09-21-007; src/homeworks.ts + app/src/devData/homeworkSync.ts). Part of
// `npm run check`. Runs against in-memory databases and the real HW JSON; the
// API pins boot the real app on an ephemeral port, like serverCheck.
//
//   cd server && npx tsx tools/homeworkSyncCheck.ts

import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { gitLineage, readRepoHomeworks, syncHomeworks, type RepoHomework } from '../src/homeworks';
import { homeworkContentHash, planHomeworkSync } from '../../app/src/devData/homeworkSync';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import type { AssignmentData } from '../../app/src/types';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const repo = readRepoHomeworks();
const byId = new Map(repo.map((h) => [h.assignment.id, h]));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** No git history at all: only what the test says is known. */
const noLineage = () => new Map<string, string>();

function freshDb(): Db {
  const db = new Db(':memory:');
  for (const a of TOY_ACCOUNTS) db.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
  return db;
}

/** Count saveAssignment calls, to prove what a sync did NOT write. */
function countSaves(db: Db): () => number {
  let n = 0;
  const save = db.saveAssignment.bind(db);
  db.saveAssignment = (a: AssignmentData) => { n++; save(a); };
  return () => n;
}

check(`the repo has HW1–HW7 (${repo.map((h) => h.assignment.id).join(', ')})`,
  repo.map((h) => h.assignment.id).join(',') === 'hw1,hw2,hw3,hw4,hw5,hw6,hw7');

// ── the planner, in isolation ─────────────────────────────────────
console.log('\n[planner]');
{
  const a = clone(byId.get('hw1')!.assignment);
  const reversed = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reversed)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reversed(x)]))
        : v;
  check('the content hash ignores key order, at every level',
    homeworkContentHash(a) === homeworkContentHash(reversed(a) as AssignmentData));
  check('the content hash ignores order and dueDate',
    homeworkContentHash(a) === homeworkContentHash({ ...a, order: 3, dueDate: '2026-10-01T07:00:00.000Z' }));
  const edited = clone(a); edited.questions[0].statement += ' (edited)';
  check('the content hash sees a statement edit', homeworkContentHash(a) !== homeworkContentHash(edited));
  let threw = false;
  try { planHomeworkSync([a], () => undefined, () => undefined, new Set(['hw99'])); } catch { threw = true; }
  check('forcing an id the repo does not have is an error', threw);
}

// ── a fresh database ──────────────────────────────────────────────
console.log('\n[fresh database]');
const db = freshDb();
{
  const steps = syncHomeworks(db, { lineage: noLineage });
  check('a fresh database gets all seven, inserted', steps.length === 7 && steps.every((s) => s.action === 'insert'));
  check('inserted homeworks are unpublished', repo.every((h) => !db.getVisible(h.assignment.id)));
  check('inserted homeworks are the repo content, byte for byte',
    repo.every((h) => JSON.stringify(db.getAssignment(h.assignment.id)) === JSON.stringify(h.assignment)));
  check('the sync records what it wrote', repo.every((h) => db.syncedHashes(h.assignment.id).has(homeworkContentHash(h.assignment))));

  const saves = countSaves(db);
  const again = syncHomeworks(db, { lineage: noLineage });
  check('a second sync finds everything current and writes nothing',
    again.every((s) => s.action === 'unchanged') && saves() === 0);
}

// ── over the API: unpublished, then sanitized ─────────────────────
console.log('\n[API]');
{
  const config: ServerConfig = { port: 0, dbPath: ':memory:', corsOrigins: [], authMode: 'dev', sessionTtlSeconds: 3600 };
  const server = createApp(config, db).listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
  const api = async <T>(method: string, p: string, token?: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as T };
  };
  const login = async (email: string) =>
    (await api<{ token: string }>('POST', '/auth/login', undefined, { email })).json.token;
  const student = await login(TOY_ACCOUNTS.find((a) => a.role === 'student')!.email);
  const instructor = await login(TOY_ACCOUNTS.find((a) => a.role === 'instructor')!.email);

  const sList = await api<{ assignments: { id: string }[] }>('GET', '/assignments', student);
  check('a student lists none of them before publishing', sList.status === 200 && sList.json.assignments.length === 0);
  const iList = await api<{ assignments: { id: string }[] }>('GET', '/assignments', instructor);
  check('an instructor lists all seven', iList.status === 200 && iList.json.assignments.length === 7);
  await api('PUT', '/assignments/hw1/visibility', instructor, { visible: true });
  const sHw1 = await api<{ assignment: AssignmentData }>('GET', '/assignments/hw1', student);
  const q11 = sHw1.json.assignment?.questions.find((q) => q.id === 11);
  check('a published homework reaches the student with its document and without its answer keys',
    sHw1.status === 200 &&
      (sHw1.json.assignment.sections?.length ?? 0) > 0 &&
      sHw1.json.assignment.questions.every((q) => (q.test_cases ?? []).length === 0) &&
      (q11?.fill_in?.labels.length ?? 0) > 0 && (q11?.fill_in_answers ?? []).length === 0);
  server.close();
}

// ── a pristine older copy refreshes; the deployment's own state survives ──
console.log('\n[refresh]');
{
  const d = freshDb();
  syncHomeworks(d, { lineage: noLineage });
  // An older transcription, as the pilot held: no sections, a missing limit.
  const older = clone(byId.get('hw2')!.assignment);
  delete older.sections;
  delete older.sourcePdf;
  older.questions[5].statement = 'Design a combinatorial circuit that computes 2(x+1).';
  delete older.questions[5].component_limits;
  d.saveAssignment({ ...older, order: 5, dueDate: '2026-10-10T06:59:00.000Z' });
  d.setVisible('hw2', true);
  d.setGradesReleased('hw2', true);
  d.addSubmission('hw2', 'john.doe@example.com',
    { assignmentTitle: older.title, submittedAt: new Date().toISOString(), answers: [] },
    { student: 'john.doe@example.com', questions: [], passed: 0, total: 0 });
  const olderHash = homeworkContentHash(older);
  const lineage = (file: string) =>
    file === byId.get('hw2')!.file ? new Map([[olderHash, 'abc1234 2026-07-12']]) : new Map<string, string>();

  const dry = syncHomeworks(d, { lineage, dryRun: true });
  check('a dry run plans the refresh but writes nothing',
    dry.find((s) => s.id === 'hw2')?.action === 'refresh' && !d.getAssignment('hw2')?.sections);

  const steps = syncHomeworks(d, { lineage });
  const hw2 = steps.find((s) => s.id === 'hw2')!;
  const stored = d.getAssignment('hw2')!;
  check('a copy equal to a committed version is refreshed, and says which', hw2.action === 'refresh' && hw2.matched === 'abc1234 2026-07-12');
  check('the refreshed copy is the repo content', homeworkContentHash(stored) === homeworkContentHash(byId.get('hw2')!.assignment));
  check('the refresh keeps the deployment\'s order and due date', stored.order === 5 && stored.dueDate === '2026-10-10T06:59:00.000Z');
  check('the refresh keeps the publish and release flags', d.getVisible('hw2') && d.getGradesReleased('hw2'));
  check('the refresh keeps the submissions', d.listSubmissions('hw2').length === 1);
  check('the other six are untouched', steps.filter((s) => s.id !== 'hw2').every((s) => s.action === 'unchanged'));

  // A version the sync itself wrote counts as pristine even with no git history.
  const synced = clone(byId.get('hw6')!.assignment);
  synced.questions[0].statement = 'An earlier wording the sync once wrote.';
  d.saveAssignment(synced);
  d.recordSync('hw6', homeworkContentHash(synced));
  const s6 = syncHomeworks(d, { lineage: noLineage }).find((s) => s.id === 'hw6')!;
  check('a version recorded by an earlier sync refreshes without git history', s6.action === 'refresh' && s6.matched === 'last synced');
}

// ── an instructor's edit is left alone unless forced ──────────────
console.log('\n[edited]');
{
  const d = freshDb();
  syncHomeworks(d, { lineage: noLineage });
  const mine = clone(byId.get('hw3')!.assignment);
  mine.questions[0].statement = 'My own wording for this term.';
  d.saveAssignment(mine);
  const saves = countSaves(d);
  const step = syncHomeworks(d, { lineage: noLineage }).find((s) => s.id === 'hw3')!;
  check('an edited copy is reported and left alone',
    step.action === 'edited' && d.getAssignment('hw3')!.questions[0].statement === 'My own wording for this term.' && saves() === 0);
  check('an edited copy is not recorded as synced', !d.syncedHashes('hw3').has(homeworkContentHash(mine)));
  const forced = syncHomeworks(d, { lineage: noLineage, force: ['hw3'] }).find((s) => s.id === 'hw3')!;
  check('--force replaces it', forced.action === 'refresh' && forced.matched === 'forced' &&
    homeworkContentHash(d.getAssignment('hw3')!) === homeworkContentHash(byId.get('hw3')!.assignment));
}

console.log('\n[due date]');
{
  const d = freshDb();
  syncHomeworks(d, { lineage: noLineage });
  check('an inserted copy carries the repo due date', d.getAssignment('hw1')!.dueDate === byId.get('hw1')!.assignment.dueDate);
  const { dueDate: _dropped, ...undated } = d.getAssignment('hw1')!;
  d.saveAssignment({ ...undated, order: 2 });
  d.saveAssignment({ ...d.getAssignment('hw2')!, dueDate: '2026-10-20T06:59:00.000Z' });
  const steps = syncHomeworks(d, { lineage: noLineage });
  const s1 = steps.find((s) => s.id === 'hw1')!;
  check('an undated current copy gets the repo due date, keeping its order',
    s1.action === 'refresh' && s1.matched === 'due date' &&
      d.getAssignment('hw1')!.dueDate === byId.get('hw1')!.assignment.dueDate && d.getAssignment('hw1')!.order === 2);
  check('a due date set on the deployment is kept',
    steps.find((s) => s.id === 'hw2')!.action === 'unchanged' && d.getAssignment('hw2')!.dueDate === '2026-10-20T06:59:00.000Z');
}

// ── git lineage ───────────────────────────────────────────────────
console.log('\n[git lineage]');
{
  const hw1: RepoHomework = byId.get('hw1')!;
  const lineage = gitLineage(hw1.file);
  check(`the working tree is always known (${lineage.size} version${lineage.size === 1 ? '' : 's'} found)`,
    lineage.has(homeworkContentHash(hw1.assignment)));
  check('a missing file or directory degrades to nothing, never throws', gitLineage('/nonexistent/hw1.json').size === 0);
  console.log(`  note  ${lineage.size > 1 ? 'history available — committed versions count as pristine' : 'shallow clone — only the working tree and content_sync are known'}`);
}

console.log(`\nhomeworkSyncCheck: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
if (failures > 0) process.exit(1);
