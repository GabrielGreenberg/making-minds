// The feedback pipeline's contract (task 018), end to end (`npm run check`).
//
//   [migration]  the boot that adds `feedback.author_role` backfills it once
//                from the roster; an author since removed stays unknown; the
//                triage column starts empty
//   [filing]     a report carries the role its author filed in (the session's
//                word, never the client's)
//   [list]       ?status= and ?triaged= narrow the queue; bad values are 400s
//   [triage]     PUT /api/feedback/:id/triage — instructor-only; filed needs
//                task ids, dismissed a note, only filed names tasks; set and
//                clear; never touches `status`; unknown id → 404
//   [script]     tasks/tools/feedback.mjs against a real password-mode server:
//                pull writes each open, unprocessed report outside the repo
//                (role, no email, screenshot bytes intact), a re-pull is a
//                no-op, mark sets the server's mark and drops the working
//                copy, a report processed elsewhere is dropped on the next
//                pull, no session is left behind, and the refusals (an --out
//                inside the repo, no credentials file, bad usage, a wrong
//                password)
//
// Exits non-zero on any failed assertion.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { hashPassword } from '../src/password';
import type { ServerConfig } from '../src/config';
import type { FeedbackTriage, PlatformFeedback } from '../../app/src/types';

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
const config: ServerConfig = {
  port: 0,
  dbPath,
  corsOrigins: [],
  authMode: 'password',
  sessionTtlSeconds: 3600,
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
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${origin}/api${path}`, {
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
  check('a bad filter value is a 400', badStatus.status === 400 && badTriaged.status === 400);
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
  check('marking never touches status', after?.status === 'open');
  check('?triaged=true lists it; ?triaged=false does not', (await list('?triaged=true')).some((f) => f.id === profReport) &&
    !(await list('?triaged=false')).some((f) => f.id === profReport));
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
rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nfeedbackCheck: all passed' : `\nfeedbackCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
