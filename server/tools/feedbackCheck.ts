// The feedback pipeline's contract (task 018), end to end (`npm run check`).
//
//   [migration]  the boot that adds `feedback.author_role` backfills it once
//                from the roster; an author since removed stays unknown; the
//                triage column starts empty
//   [filing]     a report carries the role its author filed in (the session's
//                word, never the client's)
//   [list]       ?status=, ?triaged= and ?triage=<outcome> narrow the queue;
//                bad values are 400s
//   [triage]     PUT /api/feedback/:id/triage — instructor-only; filed needs
//                task ids, dismissed a note, only filed names tasks; review
//                (task 029) is a mark like personal; set and clear; a filed
//                mark whose tasks are not live leaves the report open;
//                unknown id → 404
//   [script]     tasks/tools/feedback.mjs against a real password-mode server:
//                pull writes each open, unprocessed report outside the repo
//                (role, no email, screenshot bytes intact), a re-pull is a
//                no-op, mark sets the server's mark and drops the working
//                copy, a report processed elsewhere is dropped on the next
//                pull, no session is left behind, a review mark keeps the
//                copy and leaves it out of the pull's list, `list --review`
//                prints id/role/category/date and never the report's words
//                (task 029), and the refusals (an --out
//                inside the repo, no credentials file, bad usage, a wrong
//                password); a dismissed mark says the report is now resolved;
//                clear says whether the report is open again (task 086)
//   [resolver]   (task 086) the pure planner: dismissed resolves; filed only
//                once every task is done and live (merged → its target, down
//                the chain, cycle-safe); personal, review, unmarked, already
//                resolved and stamped (reopened) reports never; no done set →
//                filed stays open, dismissed still resolves; the first reopen
//                of a pipeline resolve is noted (reopenedMark), after which
//                it no longer stands (autoResolveStands)
//   [done tasks] a tasks/done/ file: the id from its name, status and
//                merged_into from its frontmatter; other names skipped; a
//                missing folder is null, never a throw; where the folder is
//   [labels]     the Feedback tab's words for a report the pipeline resolved
//                (app/src/instructor/feedbackViews.ts), never once the
//                instructor has reopened it and resolved it again by hand
//   [auto-resolve] end to end on a file database over a temp tasks/done/:
//                marks resolve as they land, or at the next boot once their
//                tasks are live (a task done after boot waits for the
//                restart); a forged stamp is ignored; a reopen survives a
//                restart and a re-mark, and is noted on the stamp; a hand
//                resolve after it is not credited; clear drops the stamp and
//                reopens only a pipeline resolve that still stands
//
// Every server here reads a temp repo's tasks/done/ (`repoDir`), never the
// real checkout's: a task landing there must not change a verdict.
//
// Exits non-zero on any failed assertion.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { hashPassword } from '../src/password';
import type { ServerConfig } from '../src/config';
import {
  doneDirFor,
  isTaskLive,
  parseDoneTaskFile,
  planAutoResolves,
  readDoneTasks,
  reopenedMark,
  type DoneTask,
} from '../src/feedbackResolution';
import { REPO_ROOT } from '../src/robotStatus';
import { autoResolveLabel, taskNumber } from '../../app/src/instructor/feedbackViews';
import { autoResolveStands, type FeedbackStatus, type FeedbackTriage, type PlatformFeedback } from '../../app/src/types';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function section(name: string) {
  console.log(`\n${name}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'tasks', 'tools', 'feedback.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'mm-feedback-'));
const dbPath = join(tmp, 'mm.sqlite');

const STUDENT = 'stu@ucla.edu';
const INSTRUCTOR = 'prof@ucla.edu';
const LEFT = 'gone@ucla.edu';
// A 1×1 PNG: the screenshot the pull must write back byte for byte.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ── [migration] ──────────────────────────────────────────────────
section('[migration]');
{
  // A database as it stood before task 018: users + feedback, no role column.
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (
      email TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      role  TEXT NOT NULL CHECK (role IN ('student', 'instructor'))
    );
    CREATE TABLE feedback (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      category    TEXT NOT NULL CHECK (category IN ('platform design', 'homework content')),
      message     TEXT NOT NULL,
      screenshots TEXT NOT NULL DEFAULT '[]',
      context     TEXT,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at  TEXT NOT NULL
    );
  `);
  old.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)').run(STUDENT, 'Stu', 'student');
  old.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)').run(INSTRUCTOR, 'Prof', 'instructor');
  const insert = old.prepare(
    `INSERT INTO feedback (id, email, category, message, created_at) VALUES (?, ?, 'platform design', ?, ?)`,
  );
  insert.run('fb-old-stu', STUDENT, 'old student report', '2026-09-01T00:00:00.000Z');
  insert.run('fb-old-prof', INSTRUCTOR, 'old instructor report', '2026-09-02T00:00:00.000Z');
  insert.run('fb-old-gone', LEFT, 'report by someone since removed', '2026-09-03T00:00:00.000Z');
  old.close();
}
{
  const migrated = new Db(dbPath);
  const byId = new Map(migrated.listFeedback().map((f) => [f.id, f]));
  check('backfill: a student author is a student', byId.get('fb-old-stu')?.authorRole === 'student');
  check('backfill: an instructor author is an instructor', byId.get('fb-old-prof')?.authorRole === 'instructor');
  check('backfill: an author no longer on the roster stays unknown', byId.get('fb-old-gone')?.authorRole === undefined);
  check('no report starts triaged', [...byId.values()].every((f) => f.triage === undefined));
  migrated.close();
}
{
  // A later boot never re-guesses: someone who reappears on the roster does
  // not retroactively own the role of a report filed while they were gone.
  const raw = new DatabaseSync(dbPath);
  raw.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)').run(LEFT, 'Back', 'instructor');
  raw.close();
  const again = new Db(dbPath);
  check(
    'the backfill runs once, on the boot that adds the column',
    again.listFeedback().find((f) => f.id === 'fb-old-gone')?.authorRole === undefined,
  );
  again.close();
}

// ── the server ───────────────────────────────────────────────────
// Its tasks/done/ is an empty temp one: no filed mark here is live.
mkdirSync(join(tmp, 'repo', 'tasks', 'done'), { recursive: true });
const config: ServerConfig = {
  port: 0,
  dbPath,
  corsOrigins: [],
  authMode: 'password',
  sessionTtlSeconds: 3600,
  repoDir: join(tmp, 'repo'),
};
const db = new Db(dbPath);
db.setPasswordHash(STUDENT, hashPassword('studentpass'));
db.setPasswordHash(INSTRUCTOR, hashPassword('instructorpass'));
const server = createApp(config, db).listen(0);
await new Promise<void>((done) => server.on('listening', done));
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

async function api<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; at?: string } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${opts.at ?? origin}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}
async function login(email: string, password: string): Promise<string> {
  return (await api<{ token: string }>('POST', '/auth/login', { body: { email, password } })).json.token;
}
async function list(query = ''): Promise<PlatformFeedback[]> {
  return (await api<{ feedback: PlatformFeedback[] }>('GET', `/feedback${query}`, { token: iTok })).json.feedback;
}
async function file(token: string, message: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await api<{ feedback: PlatformFeedback }>('POST', '/feedback', {
    token,
    body: { category: 'homework content', message, ...extra },
  });
  return r.json.feedback.id;
}

const sTok = await login(STUDENT, 'studentpass');
const iTok = await login(INSTRUCTOR, 'instructorpass');

// ── [filing] ─────────────────────────────────────────────────────
section('[filing]');
const stuReport = await file(sTok, 'The Rotate button turns the gate the wrong way.', {
  screenshots: [{ dataUrl: `data:image/png;base64,${PNG_B64}`, filename: 'shot.png' }],
  context: { assignmentId: 'hw3', questionId: 2 },
});
const profReport = await file(iTok, 'HW4 P2 statement has a typo.');
{
  const all = await list();
  check('a student-filed report carries role student', all.find((f) => f.id === stuReport)?.authorRole === 'student');
  check(
    'an instructor-filed report carries role instructor',
    all.find((f) => f.id === profReport)?.authorRole === 'instructor',
  );
  const spoof = await file(sTok, 'I claim to be an instructor', { authorRole: 'instructor' });
  check(
    "the role is the session's word, not the client's",
    (await list()).find((f) => f.id === spoof)?.authorRole === 'student',
  );
  await api('PUT', `/feedback/${spoof}/status`, { token: iTok, body: { status: 'resolved' } });
}

// ── [list] ───────────────────────────────────────────────────────
section('[list]');
{
  const open = await list('?status=open');
  check('?status=open lists only open reports', open.length > 0 && open.every((f) => f.status === 'open'));
  const resolved = await list('?status=resolved');
  check('?status=resolved lists only resolved ones', resolved.length === 1 && resolved[0].status === 'resolved');
  check('?triaged=false lists only unprocessed ones', (await list('?triaged=false')).every((f) => !f.triage));
  const badStatus = await api('GET', '/feedback?status=closed', { token: iTok });
  const badTriaged = await api('GET', '/feedback?triaged=maybe', { token: iTok });
  const badTriage = await api('GET', '/feedback?triage=maybe', { token: iTok });
  check('a bad filter value is a 400', badStatus.status === 400 && badTriaged.status === 400 && badTriage.status === 400);
  check('a student still cannot list the queue', (await api('GET', '/feedback', { token: sTok })).status === 403);
}

// ── [triage] ─────────────────────────────────────────────────────
section('[triage]');
{
  const put = (body: unknown, token = iTok, id = profReport) =>
    api<{ triage: FeedbackTriage | null; error?: string }>('PUT', `/feedback/${id}/triage`, { token, body });
  check('no token → 401', (await put({ outcome: 'personal' }, '')).status === 401);
  check('a student cannot mark → 403', (await put({ outcome: 'personal' }, sTok)).status === 403);
  check('an unknown outcome → 400', (await put({ outcome: 'resolved' })).status === 400);
  check('filed without tasks → 400', (await put({ outcome: 'filed' })).status === 400);
  check('filed with a malformed task id → 400', (await put({ outcome: 'filed', tasks: ['40'] })).status === 400);
  check('personal naming tasks → 400', (await put({ outcome: 'personal', tasks: ['2026-09-24-040'] })).status === 400);
  check('dismissed without a note → 400', (await put({ outcome: 'dismissed', note: '  ' })).status === 400);
  check('an over-long note → 400', (await put({ outcome: 'personal', note: 'x'.repeat(301) })).status === 400);
  check('an unknown report → 404', (await put({ outcome: 'personal' }, iTok, 'fb-nope')).status === 404);

  const filed = await put({ outcome: 'filed', tasks: ['2026-09-24-040', '2026-09-24-040', '2026-09-24-041'] });
  check(
    'filed: the mark is stored with its tasks (deduplicated) and a time',
    filed.status === 200 &&
      filed.json.triage?.outcome === 'filed' &&
      JSON.stringify(filed.json.triage.tasks) === '["2026-09-24-040","2026-09-24-041"]' &&
      typeof filed.json.triage.at === 'string',
  );
  const after = (await list()).find((f) => f.id === profReport);
  check('the list carries the mark', after?.triage?.outcome === 'filed');
  check(
    'a filed mark whose tasks are not live leaves it open',
    after?.status === 'open' && !after.triage?.autoResolved && (filed.json as { resolved?: unknown }).resolved === false,
  );
  check('?triaged=true lists it; ?triaged=false does not', (await list('?triaged=true')).some((f) => f.id === profReport) &&
    !(await list('?triaged=false')).some((f) => f.id === profReport));
  const review = await put({ outcome: 'review' });
  check('review: a mark with no tasks and no note needed', review.status === 200 && review.json.triage?.outcome === 'review');
  check('review naming tasks → 400', (await put({ outcome: 'review', tasks: ['2026-09-24-040'] })).status === 400);
  check(
    '?triage=review lists only review marks',
    (await list('?triage=review')).map((f) => f.id).join() === profReport && (await list('?triage=filed')).length === 0,
  );
  const cleared = await put({ clear: true });
  check(
    'clear removes the mark',
    cleared.status === 200 && cleared.json.triage === null && !(await list()).find((f) => f.id === profReport)?.triage,
  );
}

// ── [script] ─────────────────────────────────────────────────────
section('[script]');

// Settle the pre-018 rows so the pull sees only this section's reports.
for (const id of ['fb-old-stu', 'fb-old-prof', 'fb-old-gone']) {
  await api('PUT', `/feedback/${id}/status`, { token: iTok, body: { status: 'resolved' } });
}
// One more that the pipeline already processed: never pulled.
const alreadyProcessed = await file(sTok, 'Please add dark mode.');
await api('PUT', `/feedback/${alreadyProcessed}/triage`, { token: iTok, body: { outcome: 'dismissed', note: 'feature request, parked' } });

const envFile = join(tmp, 'feedback.env');
writeFileSync(
  envFile,
  `# test credentials\nMM_API_BASE=${origin}/\nMM_FEEDBACK_EMAIL=${INSTRUCTOR}\nMM_FEEDBACK_PASSWORD="instructorpass"\n`,
);
const out = join(tmp, 'private', 'feedback');

function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Asynchronous on purpose: the server answering the script runs in THIS process.
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, stdout, stderr });
    });
  });
}
const sessionCount = () => {
  const raw = new DatabaseSync(dbPath, { readOnly: true });
  const n = (raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  raw.close();
  return n;
};
const mdPath = (id: string) => join(out, `feedback-${id}.md`);
const sessionsBefore = sessionCount();

{
  const first = await run('pull', '--env', envFile, '--out', out);
  check('pull exits 0', first.code === 0, first.stderr);
  check('pull reports 2 pending, 2 new', first.stdout.includes('2 pending reports') && first.stdout.includes('(2 new;'), first.stdout);
  check('each open, unprocessed report is written', existsSync(mdPath(stuReport)) && existsSync(mdPath(profReport)));
  check(
    'resolved and already-processed reports are not',
    !existsSync(mdPath(alreadyProcessed)) && !existsSync(mdPath('fb-old-stu')),
  );
  const md = readFileSync(mdPath(stuReport), 'utf8');
  check(
    'the file carries report id, role, category, context, screenshot name and message',
    md.includes(`report: ${stuReport}\n`) &&
      md.includes('author-role: student\n') &&
      md.includes('category: homework content\n') &&
      md.includes('context: hw3, question 2\n') &&
      md.includes(`screenshots: feedback-${stuReport}-1.png\n`) &&
      md.includes('The Rotate button turns the gate the wrong way.'),
    md,
  );
  check("the working copy never carries the author's email", !md.includes(STUDENT) && !first.stdout.includes(STUDENT));
  check(
    'an instructor report says so',
    readFileSync(mdPath(profReport), 'utf8').includes('author-role: instructor\n'),
  );
  const shot = join(out, `feedback-${stuReport}-1.png`);
  check(
    'the screenshot is decoded byte for byte',
    existsSync(shot) && Buffer.compare(readFileSync(shot), Buffer.from(PNG_B64, 'base64')) === 0,
  );
  check('pull signs out again (no session left behind)', sessionCount() === sessionsBefore);

  const mtime = statSync(mdPath(stuReport)).mtimeMs;
  const second = await run('pull', '--env', envFile, '--out', out);
  check(
    'a re-pull is a no-op',
    second.code === 0 && second.stdout.includes('(0 new; 0 processed elsewhere dropped)') &&
      statSync(mdPath(stuReport)).mtimeMs === mtime,
    second.stdout + second.stderr,
  );
}

{
  const marked = await run('mark', stuReport, 'filed', '2026-09-24-040', '--env', envFile, '--out', out);
  check('mark filed exits 0', marked.code === 0, marked.stderr);
  const onServer = (await list()).find((f) => f.id === stuReport);
  check(
    'mark sets the server mark',
    onServer?.triage?.outcome === 'filed' && onServer.triage.tasks?.[0] === '2026-09-24-040' && onServer.status === 'open',
  );
  check(
    'mark drops the working copy, screenshots included',
    !existsSync(mdPath(stuReport)) && !existsSync(join(out, `feedback-${stuReport}-1.png`)),
  );

  // Processed from another machine (straight through the API): the next
  // pull drops the stale copy and fetches nothing new.
  await api('PUT', `/feedback/${profReport}/triage`, { token: iTok, body: { outcome: 'personal' } });
  const third = await run('pull', '--env', envFile, '--out', out);
  check(
    'a report processed elsewhere is dropped on the next pull',
    third.code === 0 && !existsSync(mdPath(profReport)) && third.stdout.includes('(0 new; 1 processed elsewhere dropped)'),
    third.stdout + third.stderr,
  );
  check('a marked report is never pulled again', !existsSync(mdPath(stuReport)));

  const cleared = await run('mark', profReport, 'clear', '--env', envFile, '--out', out);
  const fourth = await run('pull', '--env', envFile, '--out', out);
  check(
    'clearing a mark brings the report back on the next pull',
    cleared.code === 0 && fourth.code === 0 && existsSync(mdPath(profReport)),
    cleared.stderr + fourth.stderr,
  );
  const personal = await run('mark', profReport, 'personal', 'asked for an extension', '--env', envFile, '--out', out);
  check(
    'mark personal (with a note) exits 0 and records it',
    personal.code === 0 && (await list()).find((f) => f.id === profReport)?.triage?.note === 'asked for an extension',
    personal.stderr,
  );
  check('marks sign out again too', sessionCount() === sessionsBefore);
}

// ── [script] review (task 029): Gabriel's call, not the pipeline's input ──
{
  const DARK = 'Could the editor have a dark mode?';
  const request = await file(sTok, DARK, { category: 'platform design' });
  const pulled = await run('pull', '--env', envFile, '--out', out);
  check('a new report is pulled as pending', pulled.code === 0 && existsSync(mdPath(request)), pulled.stdout + pulled.stderr);
  const marked = await run('mark', request, 'review', '--env', envFile, '--out', out);
  check(
    'mark review exits 0, sets the mark, and keeps the working copy',
    marked.code === 0 && (await list()).find((f) => f.id === request)?.triage?.outcome === 'review' && existsSync(mdPath(request)),
    marked.stdout + marked.stderr,
  );
  const again = await run('pull', '--env', envFile, '--out', out);
  check(
    'the next pull keeps its copy but lists it only as a count, never as pending',
    again.code === 0 &&
      again.stdout.includes('0 pending reports') &&
      again.stdout.includes('(1 more marked review') &&
      !again.stdout.includes(`feedback-${request}.md`) &&
      existsSync(mdPath(request)),
    again.stdout + again.stderr,
  );
  rmSync(mdPath(request));
  const listed = await run('list', '--review', '--env', envFile, '--out', out);
  check(
    'list --review prints id, role, category and date, and rewrites the copy',
    listed.code === 0 &&
      listed.stdout.includes('1 report marked review') &&
      new RegExp(`feedback-${request}\\.md · student · platform design · filed \\d{4}-\\d{2}-\\d{2}`).test(listed.stdout) &&
      existsSync(mdPath(request)),
    listed.stdout + listed.stderr,
  );
  check(
    "list --review never prints the report's words or its author",
    !listed.stdout.includes('dark mode') && !listed.stdout.includes(STUDENT),
  );
  const decided = await run('mark', request, 'dismissed', 'not now (Gabriel)', '--env', envFile, '--out', out);
  const after = await run('list', '--review', '--env', envFile, '--out', out);
  check(
    "Gabriel's call re-marks it; the copy goes and the review list empties",
    decided.code === 0 && !existsSync(mdPath(request)) && after.code === 0 && after.stdout.includes('0 reports marked review'),
    decided.stderr + after.stdout + after.stderr,
  );
  check(
    'a dismissed mark resolves the report, and mark says so (task 086)',
    decided.stdout.includes('marked dismissed; resolved;') &&
      (await list()).find((f) => f.id === request)?.status === 'resolved',
    decided.stdout,
  );
  // A mistaken dismissal is undone by clear: the report is open again, for
  // the next pull (task 086).
  const undo = await run('mark', request, 'clear', '--env', envFile, '--out', out);
  const undone = (await list()).find((f) => f.id === request);
  check(
    "clearing the mark that resolved it reopens the report, and mark says so",
    undo.code === 0 &&
      undo.stdout.includes("mark cleared and the pipeline's resolve undone (reopened) — the next pull fetches it again") &&
      undone?.status === 'open' &&
      !undone.triage,
    undo.stdout + undo.stderr,
  );
  // Re-dismissed, reopened and resolved in the tab: that resolve is the
  // instructor's, so clear leaves it and says pull won't fetch it.
  await run('mark', request, 'dismissed', 'not now (Gabriel)', '--env', envFile, '--out', out);
  await api('PUT', `/feedback/${request}/status`, { token: iTok, body: { status: 'open' } });
  await api('PUT', `/feedback/${request}/status`, { token: iTok, body: { status: 'resolved' } });
  const kept = await run('mark', request, 'clear', '--env', envFile, '--out', out);
  check(
    'clearing the mark of a report resolved in the tab leaves it resolved, and mark says pull skips it',
    kept.code === 0 &&
      kept.stdout.includes('mark cleared — it stays resolved') &&
      (await list()).find((f) => f.id === request)?.status === 'resolved',
    kept.stdout + kept.stderr,
  );
  const badList = await run('list', '--env', envFile, '--out', out);
  check('list without --review is a usage error (exit 2)', badList.code === 2);
  check('the review commands sign out again too', sessionCount() === sessionsBefore);
}

{
  const inRepo = await run('pull', '--env', envFile, '--out', join(REPO, 'tasks', 'inbox'));
  check('an --out inside the repo is refused', inRepo.code === 1 && inRepo.stderr.includes('inside the repo'), inRepo.stderr);
  const noEnv = await run('pull', '--env', join(tmp, 'missing.env'), '--out', out);
  check('a missing credentials file explains the setup', noEnv.code === 1 && noEnv.stderr.includes('MM_FEEDBACK_PASSWORD'));
  const noNote = await run('mark', profReport, 'dismissed', '--env', envFile, '--out', out);
  check('dismissed without a note is a usage error (exit 2)', noNote.code === 2);
  const unknown = await run('mark', 'fb-nope', 'personal', '--env', envFile, '--out', out);
  check('marking an unknown report fails (exit 1)', unknown.code === 1 && unknown.stderr.includes('unknown feedback id'), unknown.stderr);
  const badCommand = await run('push');
  check('an unknown command is a usage error (exit 2)', badCommand.code === 2);

  // Last: a failed sign-in counts toward the login throttle.
  const wrongEnv = join(tmp, 'wrong.env');
  writeFileSync(wrongEnv, `MM_API_BASE=${origin}\nMM_FEEDBACK_EMAIL=${INSTRUCTOR}\nMM_FEEDBACK_PASSWORD=nope\n`);
  const wrong = await run('pull', '--env', wrongEnv, '--out', out);
  check('a wrong password is refused (exit 1)', wrong.code === 1 && wrong.stderr.includes('Sign-in refused'), wrong.stderr);
  const asStudent = join(tmp, 'student.env');
  writeFileSync(asStudent, `MM_API_BASE=${origin}\nMM_FEEDBACK_EMAIL=${STUDENT}\nMM_FEEDBACK_PASSWORD=studentpass\n`);
  const stu = await run('pull', '--env', asStudent, '--out', out);
  check('a student account is refused (exit 1)', stu.code === 1 && stu.stderr.includes('not an instructor'), stu.stderr);
}

server.close();
db.close();

// ── [resolver] (task 086) ────────────────────────────────────────
section('[resolver]');
{
  const NOW = '2026-09-29T12:00:00.000Z';
  const AT = '2026-09-28T09:00:00.000Z';
  const DONE = '2026-01-01-001';
  const ABSENT = '2026-01-01-002';
  const done = new Map<string, DoneTask>([
    [DONE, { status: 'done' }],
    ['2026-01-01-010', { status: 'merged', mergedInto: DONE }], // merged → done
    ['2026-01-01-011', { status: 'merged', mergedInto: ABSENT }], // merged → not in done/
    ['2026-01-01-012', { status: 'merged', mergedInto: '2026-01-01-013' }], // merged → an odd status
    ['2026-01-01-013', { status: 'ready' }],
    ['2026-01-01-014', { status: 'merged', mergedInto: '2026-01-01-010' }], // a chain down to done
    ['2026-01-01-015', { status: 'merged', mergedInto: '2026-01-01-016' }], // a cycle
    ['2026-01-01-016', { status: 'merged', mergedInto: '2026-01-01-015' }],
    ['2026-01-01-017', { status: 'merged' }], // merged into nothing
  ]);
  const report = (triage?: FeedbackTriage, status: FeedbackStatus = 'open') => ({ id: 'fb-r', status, triage });
  const filed = (...tasks: string[]): FeedbackTriage => ({ outcome: 'filed', tasks, at: AT });
  const plan = (r: ReturnType<typeof report>, d: ReadonlyMap<string, DoneTask> | null = done) => planAutoResolves([r], d, NOW);

  const one = plan(report(filed(DONE)));
  check(
    'filed [A], A done → resolved, the mark kept and stamped {filed, [A]}',
    one.length === 1 &&
      one[0].id === 'fb-r' &&
      JSON.stringify(one[0].triage) ===
        JSON.stringify({ outcome: 'filed', tasks: [DONE], at: AT, autoResolved: { at: NOW, reason: 'filed', tasks: [DONE] } }),
    JSON.stringify(one),
  );
  check('filed [A, B], only A done → open', plan(report(filed(DONE, ABSENT))).length === 0);
  const dismissed = plan(report({ outcome: 'dismissed', note: 'already fixed (085)', at: AT }));
  check(
    'dismissed → resolved, stamped {dismissed}, no tasks',
    dismissed.length === 1 &&
      JSON.stringify(dismissed[0].triage.autoResolved) === JSON.stringify({ at: NOW, reason: 'dismissed' }) &&
      dismissed[0].triage.note === 'already fixed (085)',
  );
  check('personal → open', plan(report({ outcome: 'personal', at: AT })).length === 0);
  check('review → open', plan(report({ outcome: 'review', at: AT })).length === 0);
  check('unmarked → open', plan(report()).length === 0);
  check('an already-resolved report is left alone', plan(report(filed(DONE), 'resolved')).length === 0);
  check(
    'a stamped report reopened by the instructor stays open',
    plan(report({ ...filed(DONE), autoResolved: { at: AT, reason: 'filed', tasks: [DONE] } })).length === 0 &&
      plan(report({ outcome: 'dismissed', note: 'x', at: AT, autoResolved: { at: AT, reason: 'dismissed' } })).length === 0,
  );
  check(
    '…and one reopened, resolved by hand, then reopened again (reopenedAt) too',
    plan(report({ ...filed(DONE), autoResolved: { at: AT, reason: 'filed', tasks: [DONE], reopenedAt: AT } })).length === 0,
  );
  const stamped: FeedbackTriage = { ...filed(DONE), autoResolved: { at: AT, reason: 'filed', tasks: [DONE] } };
  const firstReopen = reopenedMark(report(stamped, 'resolved'), 'open', NOW);
  check(
    "reopening the pipeline's resolve notes it on the stamp, the mark otherwise kept",
    JSON.stringify(firstReopen) ===
      JSON.stringify({ ...filed(DONE), autoResolved: { at: AT, reason: 'filed', tasks: [DONE], reopenedAt: NOW } }),
    JSON.stringify(firstReopen),
  );
  check(
    'only that first reopen: not a resolve, not open → open, not an unstamped report, not a second reopen',
    reopenedMark(report(stamped, 'open'), 'resolved', NOW) === null &&
      reopenedMark(report(stamped, 'open'), 'open', NOW) === null &&
      reopenedMark(report(filed(DONE), 'resolved'), 'open', NOW) === null &&
      reopenedMark(report(undefined, 'resolved'), 'open', NOW) === null &&
      reopenedMark(report(firstReopen!, 'resolved'), 'open', '2026-10-01T00:00:00.000Z') === null,
  );
  check(
    "the pipeline's resolve stands only while resolved, stamped and never reopened",
    autoResolveStands({ status: 'resolved', triage: stamped }) &&
      !autoResolveStands({ status: 'open', triage: stamped }) &&
      !autoResolveStands({ status: 'resolved', triage: firstReopen! }) &&
      !autoResolveStands({ status: 'resolved', triage: filed(DONE) }) &&
      !autoResolveStands({ status: 'resolved' }),
  );
  check('filed into a task merged into a done one → resolved', plan(report(filed('2026-01-01-010'))).length === 1);
  check('merged into a task not in done/ → open', plan(report(filed('2026-01-01-011'))).length === 0);
  check('merged into a task that is not done → open', plan(report(filed('2026-01-01-012'))).length === 0);
  check('a chain merged → merged → done → resolved', plan(report(filed('2026-01-01-014'))).length === 1);
  check('a merge cycle → open (and it terminates)', plan(report(filed('2026-01-01-015'))).length === 0);
  check('merged into nothing → open', !isTaskLive('2026-01-01-017', done));
  check('isTaskLive: done yes, absent no', isTaskLive(DONE, done) && !isTaskLive(ABSENT, done));
  check(
    'no done set: filed stays open, dismissed still resolves',
    plan(report(filed(DONE)), null).length === 0 &&
      plan(report({ outcome: 'dismissed', note: 'x', at: AT }), null).length === 1,
  );
  check(
    'a whole queue: only the closable ones, in order',
    planAutoResolves(
      [
        { id: 'a', status: 'open', triage: filed(DONE) },
        { id: 'b', status: 'open', triage: { outcome: 'personal', at: AT } },
        { id: 'c', status: 'open', triage: { outcome: 'dismissed', note: 'x', at: AT } },
        { id: 'd', status: 'open', triage: filed(ABSENT) },
      ],
      done,
      NOW,
    )
      .map((p) => p.id)
      .join() === 'a,c',
  );
}

// ── [done tasks] ─────────────────────────────────────────────────
section('[done tasks]');
{
  const fm = (lines: string) => `---\n${lines}\n---\n\n## Description\nstatus: done\n`;
  const merged = parseDoneTaskFile(
    '2026-09-21-017-activate-worker.md',
    fm('id: 2026-09-21-017\ntitle: x\nstatus: merged\nafter:\nbranch:\nmerged_into: 2026-09-22-029'),
  );
  check(
    'status and merged_into come from the frontmatter',
    merged?.id === '2026-09-21-017' && merged.task.status === 'merged' && merged.task.mergedInto === '2026-09-22-029',
    JSON.stringify(merged),
  );
  const renamed = parseDoneTaskFile('2026-01-01-001-alpha.md', fm('id: 2099-12-31-999\nstatus: done\nmerged_into:'));
  check(
    "the id comes from the file name, not the frontmatter's id line",
    renamed?.id === '2026-01-01-001' && renamed.task.status === 'done' && renamed.task.mergedInto === undefined,
  );
  check(
    'a status line below the frontmatter is not read',
    parseDoneTaskFile('2026-01-01-002-b.md', fm('id: 2026-01-01-002\ntitle: x'))?.task.status === '',
  );
  check(
    'no frontmatter → no status (never live)',
    parseDoneTaskFile('2026-01-01-003-c.md', 'status: done\n')?.task.status === '',
  );
  check(
    'a merged_into that is no task id is dropped',
    parseDoneTaskFile('2026-01-01-004-d.md', fm('status: merged\nmerged_into: soon'))?.task.mergedInto === undefined,
  );
  check(
    'names that are not a task file are skipped',
    parseDoneTaskFile('README.md', fm('status: done')) === null &&
      parseDoneTaskFile('2026-01-01-005.md', fm('status: done')) === null &&
      parseDoneTaskFile('2026-01-01-005-e.txt', fm('status: done')) === null,
  );

  const dir = join(tmp, 'done-read');
  mkdirSync(dir);
  writeFileSync(join(dir, '2026-01-01-001-alpha.md'), fm('status: done\nmerged_into:'));
  writeFileSync(join(dir, '2026-01-01-002-beta.md'), fm('status: merged\nmerged_into: 2026-01-01-001'));
  writeFileSync(join(dir, 'README.md'), 'not a task\n');
  const read = readDoneTasks(dir);
  check(
    'readDoneTasks reads every task file and skips the rest',
    read?.size === 2 && read.get('2026-01-01-001')?.status === 'done' && read.get('2026-01-01-002')?.mergedInto === '2026-01-01-001',
    JSON.stringify([...(read ?? new Map())]),
  );
  let threw = false;
  let missing: unknown = 'unset';
  try {
    missing = readDoneTasks(join(tmp, 'no-such-dir'));
  } catch {
    threw = true;
  }
  check('a missing folder is null, never a throw', !threw && missing === null && readDoneTasks(null) === null);
  check(
    'where it reads: the configured clone, none in memory, else this repo',
    doneDirFor(':memory:') === null &&
      doneDirFor(':memory:', join(tmp, 'r')) === join(tmp, 'r', 'tasks', 'done') &&
      doneDirFor(join(tmp, 'x.sqlite')) === join(REPO_ROOT, 'tasks', 'done'),
  );
}

// ── [labels] ─────────────────────────────────────────────────────
section('[labels]');
{
  const AT = '2026-09-29T12:00:00.000Z';
  const filed = (tasks: string[]): FeedbackTriage => ({ outcome: 'filed', tasks, at: AT, autoResolved: { at: AT, reason: 'filed', tasks } });
  const dismissed: FeedbackTriage = { outcome: 'dismissed', note: 'x', at: AT, autoResolved: { at: AT, reason: 'dismissed' } };
  const labels = [
    autoResolveLabel({ status: 'resolved', triage: filed(['2026-09-28-085']) }),
    autoResolveLabel({ status: 'resolved', triage: filed(['2026-09-28-085', '2026-09-29-086']) }),
    autoResolveLabel({ status: 'resolved', triage: dismissed }),
    autoResolveLabel({ status: 'open', triage: filed(['2026-09-28-085']) }),
    autoResolveLabel({ status: 'open', triage: dismissed }),
  ];
  check(
    'the exact words: fixed by one task, by two, dismissed, and reopened after each',
    JSON.stringify(labels) ===
      JSON.stringify([
        'Resolved: fixed by 085',
        'Resolved: fixed by 085, 086',
        'Resolved: dismissed by the pipeline',
        'Reopened after the pipeline resolved it (fixed by 085)',
        'Reopened after the pipeline resolved it (dismissed)',
      ]),
    JSON.stringify(labels),
  );
  const reopened = (t: FeedbackTriage): FeedbackTriage => ({ ...t, autoResolved: { ...t.autoResolved!, reopenedAt: AT } });
  check(
    'reopened (noted on the stamp): the reopen while open, nothing once resolved again by hand',
    autoResolveLabel({ status: 'open', triage: reopened(filed(['2026-09-28-085'])) }) ===
      'Reopened after the pipeline resolved it (fixed by 085)' &&
      autoResolveLabel({ status: 'open', triage: reopened(dismissed) }) === 'Reopened after the pipeline resolved it (dismissed)' &&
      autoResolveLabel({ status: 'resolved', triage: reopened(filed(['2026-09-28-085'])) }) === null &&
      autoResolveLabel({ status: 'resolved', triage: reopened(dismissed) }) === null,
  );
  check(
    '…and re-marked into another task: the old stamp never reads as the new mark resolved',
    autoResolveLabel({
      status: 'resolved',
      triage: { outcome: 'filed', tasks: ['2026-10-01-090'], at: AT, autoResolved: reopened(filed(['2026-09-28-085'])).autoResolved },
    }) === null,
  );
  check(
    'no stamp, no label (a hand resolve, a local report, an unmarked one)',
    autoResolveLabel({ status: 'resolved', triage: { outcome: 'filed', tasks: ['2026-09-28-085'], at: AT } }) === null &&
      autoResolveLabel({ status: 'resolved' }) === null,
  );
  check('taskNumber keeps the number', taskNumber('2026-09-28-085') === '085');
}

// ── [auto-resolve] end to end ────────────────────────────────────
section('[auto-resolve]');
{
  // Its own file database and its own tasks/done/, with synthetic ids.
  const root = join(tmp, 'auto');
  const doneDir = join(root, 'repo', 'tasks', 'done');
  mkdirSync(doneDir, { recursive: true });
  const A = '2026-01-01-001';
  const B = '2026-01-01-002';
  const MERGED = '2026-01-01-003';
  const OPEN = '2026-01-01-004';
  const task = (id: string, status: string, mergedInto = '') =>
    writeFileSync(
      join(doneDir, `${id}-a-fixture.md`),
      `---\nid: ${id}\ntitle: A fixture task\nstatus: ${status}\nmerged_into: ${mergedInto}\n---\n\n## Description\nx\n`,
    );
  task(A, 'done');
  task(MERGED, 'merged', OPEN);
  writeFileSync(join(doneDir, 'README.md'), 'not a task\n');

  const autoConfig: ServerConfig = { ...config, dbPath: join(root, 'mm.sqlite'), repoDir: join(root, 'repo') };
  const seed = new Db(autoConfig.dbPath);
  seed.upsertUser({ email: INSTRUCTOR, name: 'Prof', role: 'instructor' });
  seed.setPasswordHash(INSTRUCTOR, hashPassword('instructorpass'));
  const report = (message: string) =>
    seed.addFeedback({ email: INSTRUCTOR, authorRole: 'instructor', category: 'platform design', message, screenshots: [] }).id;
  const partial = report('filed into a done task and one not yet done');
  const whole = report('filed into a done task');
  const dismissedId = report('noise');
  const personal = report('about me');
  const review = report('a big idea');
  const merged = report('filed into a task merged into an open one');
  const forged = report('a mark that claims its own stamp');
  seed.close();

  // A boot of the server over that database: the sweep runs in createApp.
  const boot = async () => {
    const bootDb = new Db(autoConfig.dbPath);
    const srv = createApp(autoConfig, bootDb).listen(0);
    await new Promise<void>((done) => srv.on('listening', done));
    const addr = srv.address();
    const at = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const token = (await api<{ token: string }>('POST', '/auth/login', { at, body: { email: INSTRUCTOR, password: 'instructorpass' } }))
      .json.token;
    return {
      mark: (id: string, body: unknown) =>
        api<{ triage: FeedbackTriage | null; resolved?: boolean; reopened?: boolean; status?: FeedbackStatus }>(
          'PUT',
          `/feedback/${id}/triage`,
          { at, token, body },
        ),
      setStatus: (id: string, status: FeedbackStatus) => api('PUT', `/feedback/${id}/status`, { at, token, body: { status } }),
      get: async (id: string) =>
        (await api<{ feedback: PlatformFeedback[] }>('GET', '/feedback', { at, token })).json.feedback.find((f) => f.id === id),
      stop: () => {
        srv.close();
        bootDb.close();
      },
    };
  };

  const first = await boot();
  const partialMark = await first.mark(partial, { outcome: 'filed', tasks: [A, B] });
  check(
    'filed into [done, not done] → open, unstamped',
    partialMark.json.resolved === false && (await first.get(partial))?.status === 'open' && !partialMark.json.triage?.autoResolved,
  );
  const wholeMark = await first.mark(whole, { outcome: 'filed', tasks: [A] });
  const wholeNow = await first.get(whole);
  check(
    'filed into a task already live → resolved as the mark lands, with reason and tasks',
    wholeMark.json.resolved === true &&
      wholeNow?.status === 'resolved' &&
      wholeNow.triage?.autoResolved?.reason === 'filed' &&
      JSON.stringify(wholeNow.triage.autoResolved.tasks) === JSON.stringify([A]) &&
      JSON.stringify(wholeMark.json.triage?.autoResolved) === JSON.stringify(wholeNow.triage.autoResolved),
    JSON.stringify(wholeNow?.triage),
  );
  const dismissedMark = await first.mark(dismissedId, { outcome: 'dismissed', note: 'not a report' });
  const dismissedNow = await first.get(dismissedId);
  check(
    'dismissed → resolved at once',
    dismissedMark.json.resolved === true &&
      dismissedNow?.status === 'resolved' &&
      dismissedNow.triage?.autoResolved?.reason === 'dismissed' &&
      typeof dismissedNow.triage.autoResolved.at === 'string',
  );
  await first.mark(personal, { outcome: 'personal' });
  await first.mark(review, { outcome: 'review' });
  check(
    'personal and review stay open',
    (await first.get(personal))?.status === 'open' && (await first.get(review))?.status === 'open',
  );
  await first.mark(merged, { outcome: 'filed', tasks: [MERGED] });
  check('filed into a task merged into one not done → open', (await first.get(merged))?.status === 'open');
  const forgedMark = await first.mark(forged, {
    outcome: 'filed',
    tasks: [B],
    autoResolved: { at: '2026-01-01T00:00:00.000Z', reason: 'filed', tasks: [B] },
  });
  check(
    "a body's own autoResolved is ignored",
    forgedMark.status === 200 && !forgedMark.json.triage?.autoResolved && !(await first.get(forged))?.triage?.autoResolved,
  );

  // B lands on main while this server runs: not live until the next boot.
  task(B, 'done');
  const again = await first.mark(partial, { outcome: 'filed', tasks: [A, B] });
  check(
    'a task done after boot is not live yet: the re-mark stays open',
    again.json.resolved === false && (await first.get(partial))?.status === 'open',
  );
  first.stop();

  const second = await boot();
  const partialLive = await second.get(partial);
  check(
    'after the restart the report is resolved, reason filed, both tasks',
    partialLive?.status === 'resolved' &&
      partialLive.triage?.autoResolved?.reason === 'filed' &&
      JSON.stringify(partialLive.triage.autoResolved.tasks) === JSON.stringify([A, B]),
    JSON.stringify(partialLive),
  );
  check('…so is the one whose forged stamp was dropped', (await second.get(forged))?.status === 'resolved');
  check(
    '…and personal, review and the merged one still wait',
    (await second.get(personal))?.status === 'open' &&
      (await second.get(review))?.status === 'open' &&
      (await second.get(merged))?.status === 'open',
  );
  check('the Feedback tab says what closed it', autoResolveLabel(partialLive!) === 'Resolved: fixed by 001, 002');
  await second.setStatus(partial, 'open');
  second.stop();

  const third = await boot();
  const reopened = await third.get(partial);
  check(
    'reopened after an automatic resolve, it stays open across a restart',
    reopened?.status === 'open' && reopened.triage?.autoResolved?.reason === 'filed',
  );
  check(
    'the reopen is noted on the stamp (the status route)',
    typeof reopened?.triage?.autoResolved?.reopenedAt === 'string' &&
      reopened.triage.autoResolved.at === partialLive?.triage?.autoResolved?.at,
    JSON.stringify(reopened?.triage),
  );
  check(
    'the Feedback tab says so',
    autoResolveLabel(reopened!) === 'Reopened after the pipeline resolved it (fixed by 001, 002)',
  );
  const remark = await third.mark(partial, { outcome: 'filed', tasks: [A, B], note: 'still open, per Gabriel' });
  check(
    'a re-mark keeps the stamp, so it stays open',
    remark.json.resolved === false &&
      remark.json.triage?.autoResolved?.reason === 'filed' &&
      remark.json.triage.note === 'still open, per Gabriel' &&
      (await third.get(partial))?.status === 'open',
  );
  await third.setStatus(partial, 'resolved');
  const byHand = await third.get(partial);
  check(
    'resolved again by hand: the stamp keeps its first reopen, and the tab no longer credits the pipeline',
    byHand?.status === 'resolved' &&
      byHand.triage?.autoResolved?.reopenedAt === reopened?.triage?.autoResolved?.reopenedAt &&
      autoResolveLabel(byHand!) === null,
  );
  const cleared = await third.mark(partial, { clear: true });
  check(
    'clear drops the mark, stamp and all, and leaves a hand resolve alone (and says so)',
    cleared.json.triage === null &&
      cleared.json.resolved === false &&
      cleared.json.reopened === false &&
      cleared.json.status === 'resolved' &&
      (await third.get(partial))?.triage === undefined &&
      (await third.get(partial))?.status === 'resolved',
    JSON.stringify(cleared.json),
  );
  const undone = await third.mark(dismissedId, { clear: true });
  const undoneNow = await third.get(dismissedId);
  check(
    "clear undoes a pipeline resolve that still stands: the report reopens, unmarked, and it says so",
    undone.json.triage === null &&
      undone.json.reopened === true &&
      undone.json.status === 'open' &&
      undoneNow?.status === 'open' &&
      undoneNow.triage === undefined,
    JSON.stringify(undone.json),
  );
  const openClear = await third.mark(personal, { clear: true });
  check(
    'clear on an open report reopens nothing and says it is open',
    openClear.json.reopened === false && openClear.json.status === 'open' && (await third.get(personal))?.status === 'open',
    JSON.stringify(openClear.json),
  );
  const fresh = await third.mark(dismissedId, { outcome: 'dismissed', note: 'not a report, again' });
  check(
    'once cleared, the report is new to the pipeline: a fresh dismissal resolves it again',
    fresh.json.resolved === true && (await third.get(dismissedId))?.status === 'resolved',
  );
  third.stop();
}

rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nfeedbackCheck: all passed' : `\nfeedbackCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
