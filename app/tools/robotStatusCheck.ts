// Headless checks for the robot's state on the Dashboard (task 083;
// src/storage/robotStatus.ts — the ONE pure builder behind GET
// /api/robot/status — and the RobotStatusStore seam).
//
//   cd app && npx tsx tools/robotStatusCheck.ts
//
// Synthetic facts through the REAL release gate (deploy/release-gate.mjs
// `decide`, fed by `gateFactsFor`), so the words pinned here are the gate's
// own. Pins: [hold] held paths → "held: " + the gate's briefs, the landed
// task as a row; [quiet] queue and docs only → "Up to date", no rows; [wait]
// outside release hours → the gate's wait brief; [release] a clear line;
// [box] what runs unknown → the gate's own wait; [pending] git failing to
// compare what runs with main → release: unknown, with the real why (not the
// gate's "not in this clone's history"); [backup] backups this server cannot
// read → a wait naming them, never "clear to release"; [quiet-task] a
// docs-only task in a range that ships is no row; [blocked] deferred omitted,
// the student-fix tag, a long or preambled first question cut to one line,
// and every real tasks/blocked/ file on one line; [activity] queue events,
// the robot tag, non-events, newest first, capped; [review] id + category
// only, open review marks only; [unknown] a missing mirror degrades the
// mirror's sections and nothing else; [strip] the one line over the tabs, its
// singulars, and when it is absent; [ago] the relative times; [local] local
// mode answers "not available" with zero fetches (law 5); [pure] the builder
// imports nothing with I/O.

import { readdirSync, readFileSync } from 'node:fs';
import { decide } from '../../deploy/release-gate.mjs';
import type { PlatformFeedback } from '../src/types';
import {
  agoLabel,
  blockedQuestions,
  classifyQueueSubject,
  gateFactsFor,
  QUESTION_LIMIT,
  queueActivity,
  releaseLine,
  robotStatusView,
  robotStripLine,
  type CommitLine,
  type GateLike,
  type RobotFacts,
  type RobotStatus,
} from '../src/storage/robotStatus';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const section = (name: string) => console.log(`\n${name}`);

// 10:00 and 23:00 Pacific (PDT, UTC−7) on 2026-09-28.
const TEN_AM = new Date('2026-09-28T17:00:00Z');
const ELEVEN_PM = new Date('2026-09-29T06:00:00Z');
const LIVE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

const land = (id: string, title: string, at: number, sha = HEAD): CommitLine => ({ sha, at, subject: `tasks: land ${id} — ${title}` });

/** Facts where nothing but the range matters: backups fresh, CI green. */
function factsWith(
  over: Partial<RobotFacts> & { changedFiles?: string[] | null; commits?: CommitLine[]; quietLands?: string[]; now?: Date } = {},
): RobotFacts {
  const now = over.now ?? TEN_AM;
  const { changedFiles = [], commits = [], quietLands = [], now: _now, ...rest } = over;
  void _now;
  return {
    fetchedAt: now.toISOString(),
    live: { ok: true, value: { sha: LIVE, subject: 'what runs', releasedAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(), releasedAtSource: 'reflog', lastLandSubject: 'tasks: land 2026-09-27-080 — The last one' } },
    mirror: { ok: true, value: { head: HEAD, stale: null } },
    pending: { ok: true, value: { changedFiles, commits, quietLands } },
    blocked: { ok: true, value: [] },
    recent: { ok: true, value: [] },
    backup: { timerActive: true, newestAt: new Date(now.getTime() - 3_600_000).toISOString() },
    backupProblem: null,
    ci: { status: 'completed', conclusion: 'success' },
    ciProblem: null,
    ...rest,
  };
}

function viewOf(facts: RobotFacts, now: Date, feedback: PlatformFeedback[] = []): { status: RobotStatus; gate: GateLike | null } {
  const gateFacts = gateFactsFor(facts, [], now);
  const gate = gateFacts ? decide(gateFacts) : null;
  return { status: robotStatusView(facts, gate, feedback), gate };
}

type Available = Extract<RobotStatus, { available: true }>;
const avail = (s: RobotStatus): Available => {
  if (!s.available) throw new Error('expected an available status');
  return s;
};

// ── [hold] ───────────────────────────────────────────────────────
section('[hold]');
{
  const facts = factsWith({
    changedFiles: ['server/src/db.ts', 'server/src/sanitize.ts'],
    commits: [land('2026-09-28-099', 'A test task', sec(TEN_AM) - 60), { sha: 'c'.repeat(40), at: sec(TEN_AM) - 120, subject: '099: the change' }],
  });
  const { status, gate } = viewOf(facts, TEN_AM);
  const s = avail(status);
  check('the gate holds', gate?.verdict === 'hold', JSON.stringify(gate));
  check('the line starts "held: " and names both held paths in the gate\'s briefs',
    s.release.ok && s.release.line.startsWith('held: ') &&
      s.release.line.includes('the database schema and its migrations') &&
      s.release.line.includes('what students may see (answer keys stripped)'),
    s.release.ok ? s.release.line : '');
  check('the landed task is a row, with its time',
    s.release.ok && s.release.rows.length === 1 && s.release.rows[0].id === '2026-09-28-099' &&
      s.release.rows[0].title === 'A test task' && s.release.rows[0].landedAt === new Date((sec(TEN_AM) - 60) * 1000).toISOString());
  check('the gate\'s reasons ride along, details and all', s.release.ok && s.release.reasons.some((r) => r.verdict === 'hold' && r.detail.includes('server/src/db.ts')));
  check('live: sha, short sha, since when, its newest landed task',
    s.live.ok && s.live.sha === LIVE && s.live.shortSha === 'aaaaaaa' && s.live.releasedAtSource === 'reflog' &&
      s.live.lastLanded?.id === '2026-09-27-080' && s.live.lastLanded.title === 'The last one');
  check('releaseLine is the view\'s line', !!gate && s.release.ok && releaseLine(gate) === s.release.line);
  const twice = decide(gateFactsFor(factsWith({ changedFiles: ['server/src/db.ts', 'server/src/db.ts'] }), [], TEN_AM)!);
  check('one brief per reason, however many paths share it', releaseLine(twice) === 'held: the database schema and its migrations', releaseLine(twice));
}

// ── [quiet] ──────────────────────────────────────────────────────
section('[quiet]');
{
  const facts = factsWith({ changedFiles: ['tasks/x.md', 'docs/y.md'], commits: [land('2026-09-28-099', 'A queue-only task', sec(TEN_AM) - 60)] });
  const s = avail(viewOf(facts, TEN_AM).status);
  check('queue and docs only → "Up to date"', s.release.ok && s.release.verdict === 'current' && s.release.line === 'Up to date');
  check('…and nothing waits: zero rows, though a task landed', s.release.ok && s.release.rows.length === 0);
  const same = avail(viewOf(factsWith({ mirror: { ok: true, value: { head: LIVE, stale: null } } }), TEN_AM).status);
  check('main at what runs → "Up to date", no rows', same.release.ok && same.release.line === 'Up to date' && same.release.rows.length === 0);
}

// ── [wait] / [release] / [box] ───────────────────────────────────
section('[wait]');
{
  const facts = factsWith({ now: ELEVEN_PM, changedFiles: ['app/src/components/HomeScreen.tsx'], commits: [land('2026-09-28-098', 'A home fix', sec(ELEVEN_PM) - 60)] });
  const { status, gate } = viewOf(facts, ELEVEN_PM);
  const s = avail(status);
  const waits = gate?.reasons.filter((r) => r.verdict === 'wait') ?? [];
  check('outside release hours the gate waits', gate?.verdict === 'wait' && waits.some((r) => r.rule === 'hours'), JSON.stringify(gate));
  check('the line carries the gate\'s wait brief',
    s.release.ok && s.release.line.startsWith('waiting: ') && waits.every((r) => s.release.ok && s.release.line.includes(r.brief)),
    s.release.ok ? s.release.line : '');
  check('…and the waiting task is a row', s.release.ok && s.release.rows.length === 1 && s.release.rows[0].id === '2026-09-28-098');
}
section('[release]');
{
  const s = avail(viewOf(factsWith({ changedFiles: ['app/src/components/HomeScreen.tsx'], commits: [land('2026-09-28-098', 'A home fix', sec(TEN_AM) - 60)] }), TEN_AM).status);
  check('nothing held, in hours, CI green → clear to release', s.release.ok && s.release.verdict === 'release' && /clear to release/i.test(s.release.line));
}
section('[box]');
{
  const facts = factsWith({ live: { ok: false, unknown: 'fatal: not a git repository' } });
  const { status, gate } = viewOf(facts, TEN_AM);
  const s = avail(status);
  check('what runs unknown → the gate\'s own "cannot tell what the box runs" wait, naming why',
    gate?.verdict === 'wait' && s.release.ok && s.release.line.includes('cannot tell what the box runs: fatal: not a git repository'),
    s.release.ok ? s.release.line : '');
  check('…and live says unknown with the why', !s.live.ok && s.live.unknown === 'fatal: not a git repository');
  const noBackup = avail(viewOf(factsWith({ live: { ok: false, unknown: 'x' }, backup: null, backupProblem: 'not asked (what the pilot runs is unknown)' }), TEN_AM).status);
  check('…where the backups go unasked, as on the robot, with no extra reason',
    noBackup.release.ok && noBackup.release.verdict === 'wait' && !noBackup.release.reasons.some((r) => /backups/.test(r.detail)),
    JSON.stringify(noBackup.release));
}

// ── [pending] ────────────────────────────────────────────────────
section('[pending]');
{
  const why = 'cannot compare what runs with GitHub main: timed out';
  const facts = factsWith({ pending: { ok: false, unknown: why } });
  check('what runs known, the comparison failed → nothing for the gate to decide', gateFactsFor(facts, [], TEN_AM) === null);
  const s = avail(robotStatusView(facts, null, []));
  check('release is unknown with the real why', !s.release.ok && s.release.unknown === why, JSON.stringify(s.release));
  check('…never the gate\'s "not in this clone\'s history"', !JSON.stringify(s).includes("not in this clone's history"));
  check('…and live, answers and activity still answer', s.live.ok && s.answers.ok && s.activity.ok);
}

// ── [backup] ─────────────────────────────────────────────────────
section('[backup]');
{
  const problem = 'systemctl gave no answer about makingminds-backup.timer (spawn systemctl ENOENT)';
  const shipping = { changedFiles: ['app/src/components/HomeScreen.tsx'], commits: [land('2026-09-28-098', 'A home fix', sec(TEN_AM) - 60)] };
  const facts = factsWith({ ...shipping, backup: null, backupProblem: problem });
  const { status, gate } = viewOf(facts, TEN_AM);
  const s = avail(status);
  check('the gate alone would clear it (it reads a null backup as nothing to add)', gate?.verdict === 'release', JSON.stringify(gate));
  check('unread backups in hours, CI green, nothing held → a wait, not "clear to release"',
    s.release.ok && s.release.verdict === 'wait' && !/clear to release/i.test(s.release.line), s.release.ok ? s.release.line : '');
  check('…whose line and reasons say the backups are unknown, and why',
    s.release.ok && s.release.line === `waiting: the daily backups are unknown: ${problem}` &&
      s.release.reasons.some((r) => r.verdict === 'wait' && r.detail.includes('backups are unknown') && r.detail.includes(problem)),
    s.release.ok ? s.release.line : '');
  const held = avail(viewOf(factsWith({ ...shipping, changedFiles: ['server/src/db.ts'], backup: null, backupProblem: problem }), TEN_AM).status);
  check('a hold stays a hold, the unread backups listed beside it',
    held.release.ok && held.release.verdict === 'hold' && held.release.line === 'held: the database schema and its migrations' &&
      held.release.reasons.some((r) => r.verdict === 'wait' && r.detail.includes('backups are unknown')));
  const quiet = avail(viewOf(factsWith({ changedFiles: ['docs/x.md'], backup: null, backupProblem: 'not asked (nothing new to ship)' }), TEN_AM).status);
  check('nothing that ships → "Up to date", backups not asked',
    quiet.release.ok && quiet.release.verdict === 'current' && quiet.release.line === 'Up to date' && !quiet.release.reasons.some((r) => /backups/.test(r.detail)));
  const known = avail(viewOf(factsWith(shipping), TEN_AM).status);
  check('backups known and fresh → the gate\'s answer untouched', known.release.ok && known.release.verdict === 'release' && !known.release.reasons.some((r) => /backups/.test(r.detail)));
}

// ── [quiet-task] ─────────────────────────────────────────────────
section('[quiet-task]');
{
  const shipsSha = 'd'.repeat(40);
  const docsSha = 'e'.repeat(40);
  const range = {
    changedFiles: ['server/src/db.ts', 'CLAUDE.md'],
    commits: [land('2026-09-28-072', 'CLAUDE.md headroom', sec(TEN_AM) - 60, docsSha), land('2026-09-28-090', 'A schema change', sec(TEN_AM) - 120, shipsSha)],
  };
  const s = avail(viewOf(factsWith({ ...range, quietLands: [docsSha] }), TEN_AM).status);
  check('the range ships (held for the schema)', s.release.ok && s.release.verdict === 'hold');
  check('…but the docs-only task is no row: only the one that ships waits',
    s.release.ok && s.release.rows.map((r) => r.id).join(',') === '2026-09-28-090', s.release.ok ? JSON.stringify(s.release.rows) : '');
  check('…and the strip counts one task', robotStripLine(s) === 'Robot: 1 task held for your release', String(robotStripLine(s)));
  const unjudged = avail(viewOf(factsWith(range), TEN_AM).status);
  check('a land the server could not judge still counts', unjudged.release.ok && unjudged.release.rows.length === 2);
}

// ── [blocked] ────────────────────────────────────────────────────
section('[blocked]');
{
  const long =
    'Which protocol does UCLA IT offer this app: Shibboleth/SAML, or OIDC (CAS)? Is there a\n' +
    '   registered service provider / client id yet, and who is the contact? And a good deal more\n' +
    '   text that runs well past one line of the page.';
  const files = [
    { path: 'tasks/blocked/2026-09-21-006-sso.md', text: `---\nid: 2026-09-21-006\ntitle: SSO\nstatus: deferred\n---\n\n## Questions\n1. ${long}\n` },
    {
      path: 'tasks/blocked/2026-09-28-090-fix.md',
      text: '---\nid: 2026-09-28-090\ntitle: A student-reported fix\nstatus: blocked\n---\n\n## Description\n1. Not the question.\n\n## Questions\n1. Work this student-reported fix? (yes / no)\n2. Something else?\n',
    },
    { path: 'tasks/blocked/2026-09-21-009-long.md', text: `---\nid: 2026-09-21-009\ntitle: A long question\nstatus: blocked\n---\n\n## Questions\n1. ${long}\n2. Second?\n` },
    {
      path: 'tasks/blocked/2026-09-21-014-memo.md',
      text:
        '---\nid: 2026-09-21-014\ntitle: A design memo\nstatus: blocked\n---\n\n## Questions\n' +
        'Parked by the robot (2026-09-27): a design task — the memo is written\non a branch and awaits your review.\n' +
        '1. Approve the memo\'s **recommendation** — the `LLM` only *suggests*?\n   Recommend: yes.\n2. Land it?\n\n## Progress log\n',
    },
    { path: 'tasks/blocked/README.md', text: '# not a task\n' },
  ];
  const tasks = blockedQuestions(files);
  check('a deferred task, and a file that is no task, are omitted', tasks.length === 3 && !tasks.some((t) => t.id === '2026-09-21-006'), JSON.stringify(tasks.map((t) => t.id)));
  check('ordered by id', tasks.map((t) => t.id).join(',') === '2026-09-21-009,2026-09-21-014,2026-09-28-090');
  const fix = tasks.find((t) => t.id === '2026-09-28-090');
  check('"Work this student-reported fix?" first → the student-fix tag; the Description\'s list is not the question',
    fix?.studentFix === true && fix.question === 'Work this student-reported fix? (yes / no)', JSON.stringify(fix));
  const cut = tasks.find((t) => t.id === '2026-09-21-009');
  check('a first question over several lines → one line, cut with an ellipsis',
    !!cut && !cut.question.includes('\n') && cut.question.length <= QUESTION_LIMIT && cut.question.endsWith('…') &&
      cut.question.startsWith('Which protocol does UCLA IT offer this app') && cut.question.includes('registered service provider') && !cut.studentFix,
    JSON.stringify(cut));
  const memo = tasks.find((t) => t.id === '2026-09-21-014');
  check('a preamble paragraph before "1." is skipped; continuation joined; markdown bare',
    memo?.question === 'Approve the memo\'s recommendation — the LLM only suggests? Recommend: yes.', JSON.stringify(memo));
  check('titles from the front matter', memo?.title === 'A design memo');

  // Every blocked task the queue holds today reads on one line.
  const dir = new URL('../../tasks/blocked/', import.meta.url);
  let real: { path: string; text: string }[] = [];
  try {
    real = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ path: `tasks/blocked/${f}`, text: readFileSync(new URL(f, dir), 'utf8') }));
  } catch {
    // no blocked/ folder: nothing to sweep
  }
  const realTasks = blockedQuestions(real);
  check(`every real blocked task's first question is one line ≤ ${QUESTION_LIMIT} (${realTasks.length} of ${real.length} files)`,
    realTasks.every((t) => !/\n/.test(t.question) && t.question.length <= QUESTION_LIMIT && t.question.length > 0),
    JSON.stringify(realTasks.filter((t) => t.question.length === 0 || t.question.length > QUESTION_LIMIT).map((t) => t.id)));
}

// ── [activity] ───────────────────────────────────────────────────
section('[activity]');
{
  const c = (at: number, subject: string): CommitLine => ({ sha: at.toString(16).padStart(40, '0'), at, subject });
  const commits = [
    c(95, 'tasks: land 082 — HW1 wording'),
    c(100, 'tasks: claim 083 (robot)'),
    c(99, 'Merge robot/077-figure-crop-slivers: problem-set figures lose their slivers'),
    c(98, 'Merge origin/main into robot/069-regrade-dry-run'),
    c(97, 'tasks: renumber the robot status panel 082 → 083 (robot catch)'),
    c(96, 'tasks: file 082 — Show the robot\'s state (robot catch)'),
    c(94, 'tasks: file and claim 082 — HW1 wording to match the reader'),
    c(93, 'tasks: park 014 (robot)'),
    c(92, '082: HW1 reads as the revised reader does'),
    c(91, 'Merge task/082-hw1-match-reader: HW1 reads as the reader does'),
    c(90, 'tasks: inbox — a robot status panel (Gabriel)'),
    c(89, 'Merge remote-tracking branch \'origin/main\' into robot/076-x'),
  ];
  const events = queueActivity(commits);
  check('land / park / claim / file and robot/ merges are events, newest first',
    events.map((e) => e.kind).join(',') === 'claim,merge,file,land,file,park', events.map((e) => e.kind).join(','));
  check('(robot), (robot catch) and robot/ merges carry the robot tag; a plain land does not',
    events.map((e) => (e.robot ? 'r' : '-')).join('') === 'rrr--r', events.map((e) => (e.robot ? 'r' : '-')).join(''));
  check('merges into a robot branch, renumbers, inbox notes, code commits and task/ merges are not events',
    ['Merge origin/main into robot/069-regrade-dry-run', 'tasks: renumber the robot status panel 082 → 083 (robot catch)', 'tasks: inbox — a note (Gabriel)', '082: a code commit', 'Merge task/082-x: y']
      .every((subject) => classifyQueueSubject(subject) === null));
  check('the text drops the verb and the robot suffix',
    classifyQueueSubject('tasks: land 082 — HW1 wording')?.text === '082 — HW1 wording' &&
      classifyQueueSubject('tasks: claim 083 (robot)')?.text === '083' &&
      classifyQueueSubject('tasks: file and claim 082 — HW1')?.text === '082 — HW1' &&
      classifyQueueSubject('Merge robot/077-x: slivers')?.text === 'robot/077-x: slivers');
  check('each event\'s time is its commit\'s', events[0].at === new Date(100_000).toISOString());
  const many = Array.from({ length: 40 }, (_, i) => c(1000 + ((i * 7) % 40), `tasks: claim ${100 + i} (robot)`));
  const capped = queueActivity(many);
  check('capped at 15, newest first', capped.length === 15 && capped.every((e, i) => i === 0 || e.at <= capped[i - 1].at) && capped[0].at === new Date(1039_000).toISOString());
}

// ── [review] ─────────────────────────────────────────────────────
section('[review]');
{
  const base = { student: 'someone@ucla.edu', authorRole: 'student' as const, message: 'my private words', screenshots: [{ dataUrl: 'data:image/png;base64,AAAA' }], createdAt: '2026-09-28T10:00:00Z', context: { assignmentId: 'hw1' } };
  const at = '2026-09-28T11:00:00Z';
  const feedback: PlatformFeedback[] = [
    { ...base, id: 'f1', category: 'platform design', status: 'open', triage: { outcome: 'review', at } },
    { ...base, id: 'f2', category: 'homework content', status: 'resolved', triage: { outcome: 'review', at } },
    { ...base, id: 'f3', category: 'homework content', status: 'open', triage: { outcome: 'filed', tasks: ['2026-09-28-090'], at } },
    { ...base, id: 'f4', category: 'homework content', status: 'open' },
    { ...base, id: 'f5', category: 'homework content', status: 'open', triage: { outcome: 'review', at } },
  ];
  const s = avail(robotStatusView(factsWith(), null, feedback));
  const items = s.review.ok ? s.review.items : [];
  check('open reports marked review only, in queue order', items.map((i) => i.id).join(',') === 'f1,f5', JSON.stringify(items));
  check('each is exactly {id, category}', items.every((i) => JSON.stringify(Object.keys(i).sort()) === '["category","id"]'));
  const wire = JSON.stringify(s);
  check('no report text, author, screenshot or context reaches the answer',
    !wire.includes('my private words') && !wire.includes('someone@ucla.edu') && !wire.includes('data:image') && !wire.includes('"context"'));
  const unread = avail(robotStatusView(factsWith(), null, null));
  check('an unreadable queue is review: unknown', !unread.review.ok);
}

// ── [unknown] ────────────────────────────────────────────────────
section('[unknown]');
{
  const why = 'no mirror of GitHub main, since an in-memory database has no data folder to keep one in';
  const facts = factsWith({
    mirror: { ok: false, unknown: why },
    pending: { ok: false, unknown: why },
    blocked: { ok: false, unknown: why },
    recent: { ok: false, unknown: why },
    backup: null,
    ci: null,
    ciProblem: why,
  });
  check('no main → nothing for the gate to decide', gateFactsFor(facts, [], TEN_AM) === null);
  const s = avail(robotStatusView(facts, null, []));
  check('release, answers and activity are unknown, carrying the why',
    !s.release.ok && s.release.unknown === why && !s.answers.ok && s.answers.unknown === why && !s.activity.ok && s.activity.unknown === why);
  check('…live and review still answer', s.live.ok && s.review.ok);
  const stale = avail(robotStatusView(factsWith({ mirror: { ok: true, value: { head: HEAD, stale: 'the fetch from GitHub failed (timed out)' } } }), null, []));
  check('a failed fetch over an older copy is a stale note, not an unknown', stale.stale === 'the fetch from GitHub failed (timed out)');
  check('a mirror with no verdict is release: unknown', !stale.release.ok);
}

// ── [strip] ──────────────────────────────────────────────────────
section('[strip]');
{
  const gate = (verdict: GateLike['verdict']): GateLike => ({ verdict, reasons: [] });
  const lands = (n: number) => Array.from({ length: n }, (_, i) => land(`2026-09-28-${String(100 + i)}`, `Task ${i}`, 1000 + i));
  const blocked = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `tasks/blocked/2026-09-28-2${String(i).padStart(2, '0')}-x.md`, text: `---\nid: 2026-09-28-2${String(i).padStart(2, '0')}\ntitle: Q\nstatus: blocked\n---\n\n## Questions\n1. Yes?\n` }));
  const review: PlatformFeedback = { id: 'r1', student: 's@x', category: 'platform design', message: 'm', screenshots: [], createdAt: '2026-09-28T10:00:00Z', status: 'open', triage: { outcome: 'review', at: '2026-09-28T11:00:00Z' } };
  const strip = (verdict: GateLike['verdict'], landed: number, parked: number, reviews: number) =>
    robotStripLine(robotStatusView(factsWith({ commits: lands(landed), blocked: { ok: true, value: blocked(parked) } }), gate(verdict), reviews ? [review] : []));
  check('nothing waits → no strip', strip('current', 0, 0, 0) === null);
  check('the shape: "Robot: 7 tasks held for your release · 2 questions wait"', strip('hold', 7, 2, 0) === 'Robot: 7 tasks held for your release · 2 questions wait', String(strip('hold', 7, 2, 0)));
  check('singulars', strip('hold', 1, 1, 1) === 'Robot: 1 task held for your release · 1 question waits · 1 report to review', String(strip('hold', 1, 1, 1)));
  check('a hold naming no task', strip('hold', 0, 0, 0) === 'Robot: changes held for your release');
  check('a wait or a clear release is the robot\'s to finish: no strip', strip('wait', 3, 0, 0) === null && strip('release', 3, 0, 0) === null);
  check('…though a question still shows', strip('wait', 3, 1, 0) === 'Robot: 1 question waits');
  check('local mode → no strip', robotStripLine({ available: false, reason: 'Not available in local mode' }) === null);
  const unknownAll = robotStatusView(
    factsWith({ mirror: { ok: false, unknown: 'x' }, blocked: { ok: false, unknown: 'x' }, recent: { ok: false, unknown: 'x' }, pending: { ok: false, unknown: 'x' } }),
    null,
    [],
  );
  check('unknown sections count nothing → no strip', robotStripLine(unknownAll) === null);
}

// ── [ago] ────────────────────────────────────────────────────────
section('[ago]');
{
  const ago = (ms: number) => agoLabel(new Date(TEN_AM.getTime() - ms), TEN_AM);
  check('under a minute → just now', ago(30_000) === 'just now');
  check('minutes', ago(12 * 60_000) === '12 min ago');
  check('hours', ago(3 * 3_600_000) === '3 h ago' && ago(47 * 3_600_000) === '47 h ago');
  check('days', ago(4 * 86_400_000) === '4 days ago');
  check('an ISO string works too', agoLabel(new Date(TEN_AM.getTime() - 5 * 60_000).toISOString(), TEN_AM) === '5 min ago');
}

// ── [local] ──────────────────────────────────────────────────────
section('[local]');
{
  // Law 5: local mode makes zero /api calls. Any fetch at all is counted.
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('local mode must not fetch');
  }) as typeof fetch;
  const backing = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage ??= {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    get length() { return backing.size; },
    key: (i: number) => [...backing.keys()][i] ?? null,
  };
  try {
    const { localRobotStatusStore } = await import('../src/storage/robotStatusStore');
    const { backendMode, robotStatusStore } = await import('../src/storage/backend');
    const direct = await localRobotStatusStore.get();
    const refreshed = await localRobotStatusStore.get(true);
    const viaBackend = await robotStatusStore.get(true);
    check('the Node harness resolves to local mode', backendMode === 'local');
    check('the local store answers "Not available in local mode"',
      !direct.available && direct.reason === 'Not available in local mode' && !refreshed.available);
    check('backend\'s robotStatusStore is the local one here', !viaBackend.available && viaBackend.reason === 'Not available in local mode');
    check('…with zero fetches', calls === 0, `${calls} fetch call(s)`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── [pure] ───────────────────────────────────────────────────────
section('[pure]');
{
  const source = readFileSync(new URL('../src/storage/robotStatus.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  check('the builder imports nothing (the server imports it: no React, DOM, fetch, env or deploy/)', imports.length === 0, imports.join(', '));
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('…and never fetches or reads import.meta.env, window or document', !/\bfetch\(|import\.meta\.env|\bwindow\.|\bdocument\./.test(code));
  const store = readFileSync(new URL('../src/storage/robotStatusStore.ts', import.meta.url), 'utf8');
  check('the local store has no fetch and no api client', !/\bfetch\(|api\/client/.test(store));
}

console.log(failures === 0 ? '\nrobotStatusCheck: all checks passed' : `\nrobotStatusCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
