// The unattended-release gate (task 042): deploy/release-gate.mjs (`npm run check`).
//
//   [verdicts]   decide()'s table — a hold-list path → hold (prefix-exact),
//                the release hours in Pacific time across daylight saving,
//                the deadline freeze (published only, before the due time
//                only), the box or the API unreachable → wait (never hold,
//                never release), stale or missing backups → hold, nothing new
//                → current, the strictest verdict wins, and the note says only
//                what a hold is waiting on
//   [note key]   a hold is keyed by its commit and rules, not the time of day
//   [facts]      gatherFacts() over a real git history (changed paths, landed
//                tasks from `tasks: land` subjects) with the box injected;
//                listPilotAssignments() against a real password-mode server
//                (published + due date — the fields the freeze reads)
//   [release.sh] --unattended asks the gate and obeys its exit codes; the
//                smoke test runs after every release
//
// Exits non-zero on any failed assertion.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { hashPassword } from '../src/password';
import type { ServerConfig } from '../src/config';
import type { AssignmentData } from '../../app/src/types';
import {
  BACKUP_MAX_AGE_HOURS,
  FREEZE_HOURS,
  decide,
  gatherFacts,
  heldPaths,
  listPilotAssignments,
  noteKey,
  type Facts,
} from '../../deploy/release-gate.mjs';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function section(name: string) {
  console.log(`\n${name}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOUR = 3_600_000;
// 2026-10-01 is daylight time (UTC−7): 17:00Z = 10:00 Pacific.
const TEN_AM_PDT = new Date('2026-10-01T17:00:00Z');

function facts(over: Partial<Facts> = {}): Facts {
  const now = over.now ?? TEN_AM_PDT;
  return {
    head: 'b'.repeat(40),
    lastReleased: 'a'.repeat(40),
    changedFiles: ['app/src/components/HomeScreen.tsx'],
    landed: [{ id: '2026-09-25-040', title: 'Land first-time visitors on the sign-in screen' }],
    now,
    assignments: [],
    apiProblem: null,
    boxProblem: null,
    backup: { timerActive: true, newestAt: new Date(now.getTime() - 2 * HOUR) },
    ...over,
  };
}
const verdict = (over: Partial<Facts> = {}) => decide(facts(over)).verdict;

// ── [verdicts] ───────────────────────────────────────────────────
section('[verdicts]');
{
  const ok = decide(facts());
  check('an ordinary change at 10:00 Pacific → release', ok.verdict === 'release', JSON.stringify(ok.reasons));
  check('a release carries no hold note; its summary names the landed tasks', ok.note === '' && ok.summary.includes('2026-09-25-040'));

  const held = decide(facts({ changedFiles: ['app/src/engine/grader.ts', 'app/src/components/X.tsx'] }));
  check('a change under app/src/engine/ → hold', held.verdict === 'hold');
  check('the reason names the path and why', held.reasons.some((r) => r.detail.includes('app/src/engine/grader.ts') && r.detail.includes('grading')));
  check(
    'the note says what it waits on and what is pending, briefly',
    held.note.startsWith('Held bbbbbbb') && held.note.includes('grading') && held.note.includes('2026-09-25-040') && !held.note.includes('grader.ts'),
    held.note,
  );
  for (const path of ['app/src/devData/homeworks/hw3.json', 'server/src/sanitize.ts', 'server/src/auth.ts', 'server/src/password.ts',
    'server/src/db.ts', 'app/src/auth/LoginScreen.tsx', 'deploy/release.sh', 'server/src/homeworks.ts', 'app/src/devData/homeworkSync.ts']) {
    check(`${path} is on the hold list`, heldPaths([path]).length === 1);
  }
  for (const path of ['app/src/engineering.ts', 'server/src/db.tsx', 'server/src/app.ts', 'deployment.md', 'app/src/authority/x.ts']) {
    check(`${path} is not (prefixes are exact)`, heldPaths([path]).length === 0);
  }

  const at = (iso: string) => verdict({ now: new Date(iso), backup: { timerActive: true, newestAt: new Date(new Date(iso).getTime() - HOUR) } });
  check('06:59 Pacific (daylight) → wait', at('2026-10-01T13:59:00Z') === 'wait');
  check('07:00 Pacific (daylight) → release', at('2026-10-01T14:00:00Z') === 'release');
  check('21:59 Pacific (daylight) → release', at('2026-10-02T04:59:00Z') === 'release');
  check('22:00 Pacific (daylight) → wait', at('2026-10-02T05:00:00Z') === 'wait');
  check('07:00 Pacific (standard time, UTC−8) → release', at('2026-12-01T15:00:00Z') === 'release');
  check('06:59 Pacific (standard time) → wait', at('2026-12-01T14:59:00Z') === 'wait');

  const due = (hours: number, visible = true) => ({ id: 'hw3', title: 'HW3', visible, dueDate: new Date(TEN_AM_PDT.getTime() + hours * HOUR).toISOString() });
  check(`a published assignment due in ${FREEZE_HOURS - 1} h → wait`, verdict({ assignments: [due(FREEZE_HOURS - 1)] }) === 'wait');
  check(`… due in ${FREEZE_HOURS + 1} h → release`, verdict({ assignments: [due(FREEZE_HOURS + 1)] }) === 'release');
  check('… already past due → release', verdict({ assignments: [due(-1)] }) === 'release');
  check('an unpublished assignment due in 5 h → release', verdict({ assignments: [due(5, false)] }) === 'release');
  check('an assignment with no due date → release', verdict({ assignments: [{ id: 'x', title: 'X', visible: true }] }) === 'release');
  check(
    'the freeze reason names the assignment',
    decide(facts({ assignments: [due(5)] })).reasons.some((r) => r.rule === 'deadlines' && r.detail.includes('HW3')),
  );

  check('the API unreachable → wait (never release blind)', verdict({ assignments: null, apiProblem: 'Cannot reach' }) === 'wait');
  check(
    'the box unreachable → wait, not hold',
    verdict({ lastReleased: null, changedFiles: null, backup: null, boxProblem: 'no key' }) === 'wait',
  );
  check('the released commit missing from this clone → wait', verdict({ changedFiles: null }) === 'wait');
  const current = decide(facts({ lastReleased: 'b'.repeat(40) }));
  check('nothing new since the last release → current', current.verdict === 'current' && current.note === '');

  check('the backup timer inactive → hold', verdict({ backup: { timerActive: false, newestAt: TEN_AM_PDT } }) === 'hold');
  check('no daily backup yet → hold', verdict({ backup: { timerActive: true, newestAt: null } }) === 'hold');
  check(
    `the newest backup ${BACKUP_MAX_AGE_HOURS + 1} h old → hold`,
    verdict({ backup: { timerActive: true, newestAt: new Date(TEN_AM_PDT.getTime() - (BACKUP_MAX_AGE_HOURS + 1) * HOUR) } }) === 'hold',
  );
  check(
    `… ${BACKUP_MAX_AGE_HOURS - 1} h old → release`,
    verdict({ backup: { timerActive: true, newestAt: new Date(TEN_AM_PDT.getTime() - (BACKUP_MAX_AGE_HOURS - 1) * HOUR) } }) === 'release',
  );

  const both = decide(facts({ changedFiles: ['server/src/db.ts'], now: new Date('2026-10-02T06:00:00Z') }));
  check('a hold at 23:00 → hold (the strictest wins)', both.verdict === 'hold' && both.reasons.some((r) => r.verdict === 'wait'));
  check("a hold's note mentions only what holds it, not the hour", both.note.includes('database') && !both.note.includes('Pacific'));
  check('a wait sends no note', decide(facts({ now: new Date('2026-10-02T06:00:00Z') })).note === '');
}

// ── [note key] ───────────────────────────────────────────────────
section('[note key]');
{
  const head = 'b'.repeat(40);
  const nine = decide(facts({ changedFiles: ['server/src/db.ts'], now: new Date('2026-10-01T16:00:00Z') }));
  const noon = decide(facts({ changedFiles: ['server/src/db.ts'], now: new Date('2026-10-01T19:00:00Z') }));
  check('the same hold an hour later has the same key (not re-sent)', noteKey(nine, head) === noteKey(noon, head));
  check('a new commit gets a new key', noteKey(nine, head) !== noteKey(nine, 'c'.repeat(40)));
  const more = decide(facts({ changedFiles: ['server/src/db.ts', 'app/src/engine/grader.ts'] }));
  check('a new reason to hold gets a new key', noteKey(nine, head) !== noteKey(more, head));
}

// ── [facts] ──────────────────────────────────────────────────────
section('[facts]');
const tmp = mkdtempSync(join(tmpdir(), 'mm-gate-'));
{
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'app', 'src', 'engine'), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const released = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'app', 'src', 'engine', 'grader.ts'), 'y\n');
  git('add', '.');
  git('commit', '-q', '-m', '099: change the grader');
  git('commit', '-q', '--allow-empty', '-m', 'tasks: land 2026-09-25-099 — A test task');
  const head = git('rev-parse', 'HEAD');

  const f = await gatherFacts({
    root: repo,
    now: TEN_AM_PDT,
    probeBox: () => ({ head: released, timerActive: true, newestAt: TEN_AM_PDT }),
    listAssignments: async () => [{ id: 'hw1', title: 'HW1', visible: true }],
  });
  check('head and last-released come from git and the box', f.head === head && f.lastReleased === released);
  check('the changed paths span last-released..head', JSON.stringify(f.changedFiles) === '["app/src/engine/grader.ts"]', JSON.stringify(f.changedFiles));
  check('landed tasks come from `tasks: land` subjects', JSON.stringify(f.landed) === '[{"id":"2026-09-25-099","title":"A test task"}]', JSON.stringify(f.landed));
  check('… and that history holds', decide(f).verdict === 'hold');

  const down = await gatherFacts({
    root: repo,
    now: TEN_AM_PDT,
    probeBox: () => {
      throw new Error('ssh: connect to host timed out');
    },
    listAssignments: async () => {
      throw new Error('Cannot reach the server');
    },
  });
  check(
    'a box that does not answer is a boxProblem; an API that does not, an apiProblem',
    down.boxProblem?.includes('timed out') === true && down.apiProblem?.includes('Cannot reach') === true && down.lastReleased === null,
  );
  check('… and together they wait', decide(down).verdict === 'wait');
}
{
  const dbPath = join(tmp, 'pilot.sqlite');
  const db = new Db(dbPath);
  db.upsertUser({ email: 'prof@ucla.edu', name: 'Prof', role: 'instructor' });
  db.setPasswordHash('prof@ucla.edu', hashPassword('instructorpass'));
  const assignment = (id: string, dueDate?: string): AssignmentData =>
    ({ id, title: id.toUpperCase(), questions: [], ...(dueDate ? { dueDate } : {}) }) as unknown as AssignmentData;
  db.saveAssignment(assignment('hw1', '2026-10-02T06:59:00.000Z'));
  db.saveAssignment(assignment('hw2', '2026-10-09T06:59:00.000Z'));
  db.saveAssignment(assignment('hw3'));
  db.setVisible('hw1', true);
  db.setVisible('hw3', true);
  const config: ServerConfig = { port: 0, dbPath, corsOrigins: [], authMode: 'password', sessionTtlSeconds: 3600 };
  const server = createApp(config, db).listen(0);
  await new Promise<void>((done) => server.on('listening', done));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const envPath = join(tmp, 'feedback.env');
  writeFileSync(envPath, `MM_API_BASE=${origin}\nMM_FEEDBACK_EMAIL=prof@ucla.edu\nMM_FEEDBACK_PASSWORD=instructorpass\n`);

  const list = await listPilotAssignments(envPath);
  const byId = new Map(list.map((a) => [a.id, a]));
  check('the pilot lists every assignment to the instructor', list.length === 3);
  check('published + due date come through (the freeze reads these)', byId.get('hw1')?.visible === true && byId.get('hw1')?.dueDate === '2026-10-02T06:59:00.000Z');
  check('an unpublished one says so', byId.get('hw2')?.visible === false);
  check('no due date stays absent', byId.get('hw3')?.dueDate === undefined);
  check(
    'end to end: HW1 due 23:59 Pacific tonight freezes a 10:00 release',
    decide(facts({ assignments: list })).verdict === 'wait',
  );
  server.close();
  db.close();
}
rmSync(tmp, { recursive: true, force: true });

// ── [release.sh] ─────────────────────────────────────────────────
section('[release.sh]');
{
  const sh = readFileSync(join(REPO, 'deploy', 'release.sh'), 'utf8');
  check('--unattended asks the gate, remembering its last note', sh.includes('deploy/release-gate.mjs" --json --note-state'));
  check('… releases on 0, stops on hold (3) / wait (4), treats current (5) as done', /0\) ;;/.test(sh) && /5\) echo "nothing new to release"; exit 0 ;;/.test(sh) && /3\|4\) exit "\$gate_code" ;;/.test(sh));
  check('… and refuses other options beside it', sh.includes('--unattended releases everything or nothing'));
  check('--check prints the verdict and releases nothing', sh.includes('[ "$CHECK" = 1 ] && exec node "$ROOT/deploy/release-gate.mjs"'));
  check('a smoke test follows every full release', sh.includes('say "Smoke test"') && sh.includes('/api/auth/config'));
  check('an unattended release ends with one note line', sh.includes('echo "note: Released $short'));
}

console.log(failures === 0 ? '\nreleaseGateCheck: all passed' : `\nreleaseGateCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
