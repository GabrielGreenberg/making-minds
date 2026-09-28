// The robot's state for the instructor Dashboard (task 083): the ONE pure
// builder behind GET /api/robot/status. The server gathers the facts
// (server/src/robotStatus.ts: its own clone — what the pilot runs — a
// fetch-only mirror of GitHub main, the daily backups, CI) and asks the
// release gate itself (deploy/release-gate.mjs `decide`, fed by
// `gateFactsFor` below; `completeGate` adds the one wait only this server
// can owe — backups it could not read); this module turns facts and verdict
// into what the Robot tab and the strip over the Dashboard's tabs show:
//
//   live      the sha and subject the pilot runs, since when, its newest landed task
//   release   the gate's verdict in its own words, and the landed tasks the pilot lacks
//   answers   tasks/blocked/ on GitHub main (not `status: deferred`), each with
//             its first `## Questions` item on one line; the student-fix tag
//   review    open feedback reports marked `review` — id and category ONLY
//   activity  the last queue events on main (land / park / claim / file, robot/ merges)
//
// Each section degrades on its own to `{ ok: false, unknown }`: a git or
// network failure is an answer ("unknown: <why>"), never an error.
//
// No I/O, no React, no DOM, no import.meta.env: the server imports it (the
// gradingSummary.ts precedent), and app/tools/robotStatusCheck.ts pins it
// headless against the real gate. Law 9: a feedback report reaches the wire
// as its id and category — never its text, its author or its screenshots.

// ── the gate, structurally ──────────────────────────────────────

export type GateVerdict = 'release' | 'hold' | 'wait' | 'current';

/** The part of the gate's GateResult (deploy/release-gate.d.mts) this module
 *  reads — structural, so the app program never imports deploy/. */
export interface GateLike {
  verdict: GateVerdict;
  reasons: { verdict: GateVerdict; rule: string; detail: string; brief: string }[];
}

/** The gate's Facts (deploy/release-gate.d.mts), structurally: what
 *  `gateFactsFor` hands the server to pass to `decide`. */
export interface GateFactsLike {
  head: string;
  lastReleased: string | null;
  changedFiles: string[] | null;
  landed: LandedTask[];
  now: Date;
  assignments: { id: string; title: string; visible: boolean; dueDate?: string }[] | null;
  apiProblem: string | null;
  boxProblem: string | null;
  backup: { timerActive: boolean; newestAt: Date | null } | null;
  ci: { status: string; conclusion: string } | null;
  ciProblem: string | null;
}

// ── the facts (the server's I/O hands these in) ─────────────────

export type Known<T> = { ok: true; value: T } | { ok: false; unknown: string };

/** One commit: `git log --format=%H%x1f%ct%x1f%s` — sha, committer time
 *  (unix seconds), subject. */
export interface CommitLine {
  sha: string;
  at: number;
  subject: string;
}

export interface RobotFacts {
  /** When these facts were gathered (ISO) — the page's "as of". */
  fetchedAt: string;
  /** The server's own clone: what the pilot runs. `releasedAt` is when its
   *  HEAD last moved (the reflog), else when the server process started. */
  live: Known<{
    sha: string;
    subject: string;
    releasedAt: string;
    releasedAtSource: 'reflog' | 'process-start';
    /** The newest `tasks: land` subject in its history, if any. */
    lastLandSubject: string | null;
  }>;
  /** The mirror's copy of GitHub main. `stale`: this fetch failed, so main is
   *  the mirror's last good copy. */
  mirror: Known<{ head: string; stale: string | null }>;
  /** live..main: the paths it changes (null = live is not in main's history)
   *  and its commits, newest first. `quietLands`: the shas of its `tasks:
   *  land` commits whose task changed nothing that ships (the gate's
   *  QUIET_PATHS — queue, docs), as the server judged from the merge that
   *  landed each; a land it could not judge is not listed, so it counts. */
  pending: Known<{ changedFiles: string[] | null; commits: CommitLine[]; quietLands: string[] }>;
  /** tasks/blocked/*.md on main, as text. */
  blocked: Known<{ path: string; text: string }[]>;
  /** main's newest commits, newest first. */
  recent: Known<CommitLine[]>;
  /** The daily backups (task 041), as the gate reads them; null = unknown
   *  (`backupProblem` says why). */
  backup: { timerActive: boolean; newestAt: string | null } | null;
  backupProblem: string | null;
  /** main's CI run (status 'none' = not run yet); null = could not ask. */
  ci: { status: string; conclusion: string } | null;
  ciProblem: string | null;
}

/** A feedback report, as much of one as the review list reads (a whole
 *  PlatformFeedback fits). */
export interface FeedbackLike {
  id: string;
  category: string;
  status: string;
  triage?: { outcome: string } | null;
}

// ── the wire ────────────────────────────────────────────────────

export type Section<T> = ({ ok: true } & T) | { ok: false; unknown: string };

export interface LandedTask {
  id: string;
  title: string;
}

export interface PendingTask extends LandedTask {
  landedAt: string;
}

export interface BlockedQuestion {
  id: string;
  title: string;
  /** The first `## Questions` item, one line, ≤ QUESTION_LIMIT characters. */
  question: string;
  /** The robot catch's student-report question (ROBOT-CATCH.md). */
  studentFix: boolean;
}

/** A report marked `review`: never more than these two fields (law 9). */
export interface ReviewItem {
  id: string;
  category: string;
}

export type QueueEventKind = 'land' | 'park' | 'claim' | 'file' | 'merge';

export interface QueueEvent {
  at: string;
  kind: QueueEventKind;
  text: string;
  robot: boolean;
}

export interface RobotLive {
  sha: string;
  shortSha: string;
  subject: string;
  releasedAt: string;
  releasedAtSource: 'reflog' | 'process-start';
  lastLanded: LandedTask | null;
}

export interface RobotRelease {
  /** GitHub main's sha. */
  head: string;
  verdict: GateVerdict;
  /** The verdict in one line, in the gate's own words (`releaseLine`). */
  line: string;
  reasons: { verdict: GateVerdict; brief: string; detail: string }[];
  /** The landed tasks on main the pilot does not run yet, oldest first — none
   *  when the verdict is `current` (a range of queue and docs commits ships
   *  nothing, so nothing waits), and never a task that changed only queue or
   *  docs (`pending.quietLands`) though the range around it ships. */
  rows: PendingTask[];
}

export type RobotStatus =
  | { available: false; reason: string }
  | {
      available: true;
      asOf: string;
      /** Why main may be behind GitHub's (the fetch failed), else null. */
      stale: string | null;
      live: Section<RobotLive>;
      release: Section<RobotRelease>;
      answers: Section<{ tasks: BlockedQuestion[] }>;
      review: Section<{ items: ReviewItem[] }>;
      activity: Section<{ events: QueueEvent[] }>;
    };

// ── parsing ─────────────────────────────────────────────────────

/** A landed task's subject — the gate's own pattern (deploy/release-gate.mjs
 *  gatherFacts, :325), copied rather than imported so the app program never
 *  reaches into deploy/. Note the em dash. */
export const LAND_SUBJECT = /^tasks: land (\S+) — (.+)$/;

export function parseLand(subject: string): LandedTask | null {
  const m = LAND_SUBJECT.exec(subject);
  return m ? { id: m[1], title: m[2] } : null;
}

/** The landed tasks among these commits (newest first, as git logs them),
 *  oldest first — the order of the gate's summary. */
export function landedIn(commits: readonly CommitLine[]): PendingTask[] {
  const out: PendingTask[] = [];
  for (const c of commits) {
    const task = parseLand(c.subject);
    if (task) out.push({ ...task, landedAt: new Date(c.at * 1000).toISOString() });
  }
  return out.reverse();
}

/** A task file's front matter as flat `key: value` strings. */
export function parseFrontMatter(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const out: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export const QUESTION_LIMIT = 160;
export const EVENT_LIMIT = 160;
export const STUDENT_FIX_QUESTION = 'Work this student-reported fix?';

/** Whitespace collapsed to single spaces, cut to `limit` characters (the
 *  ellipsis included), at a word break when one is near. */
export function cutLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Markdown's marks off: links to their text, code spans and emphasis bare. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\*/g, '');
}

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+/;

/** The first item of a task file's `## Questions` list, on one line: its
 *  continuation lines joined, markdown stripped, cut to `limit`. A preamble
 *  paragraph before the list is skipped; a section with no list gives its
 *  first paragraph; no section gives ''. */
export function firstQuestion(text: string, limit = QUESTION_LIMIT): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Questions\b/i.test(l));
  if (start < 0) return '';
  const item: string[] = [];
  const preamble: string[] = [];
  let preambleDone = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const marker = LIST_ITEM.exec(line);
    if (item.length === 0) {
      if (marker) item.push(line.slice(marker[0].length));
      else if (line.trim() === '') preambleDone ||= preamble.length > 0;
      else if (!preambleDone) preamble.push(line.trim());
      continue;
    }
    if (marker || line.trim() === '') break;
    item.push(line.trim());
  }
  return cutLine(plainText((item.length > 0 ? item : preamble).join(' ')), limit);
}

const TASK_ID = /^(\d{4}-\d{2}-\d{2}-\d{3})/;

/** The blocked tasks that wait for an answer: every file but `status:
 *  deferred` (and anything that is not a task file), by id. */
export function blockedQuestions(files: readonly { path: string; text: string }[]): BlockedQuestion[] {
  const out: BlockedQuestion[] = [];
  for (const f of files) {
    const front = parseFrontMatter(f.text);
    if (front.status === 'deferred') continue;
    const name = f.path.split('/').pop() ?? f.path;
    const id = front.id || TASK_ID.exec(name)?.[1];
    if (!id) continue;
    const question = firstQuestion(f.text);
    out.push({ id, title: front.title || name.replace(/\.md$/, ''), question, studentFix: question.startsWith(STUDENT_FIX_QUESTION) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const QUEUE_SUBJECT = /^tasks: (land|park|claim|file)\b(?: and \w+)?\s*/;
const ROBOT_MERGE = /^Merge (robot\/[^\s:]+)/;
const ROBOT_SUFFIX = /\((?:robot|robot catch)\)/;

/** A commit subject as a queue event, or null: `tasks: land|park|claim|file …`
 *  ("file and claim" is a file) and merges of `robot/…` branches. A merge of
 *  main INTO a robot branch, and the queue's other subjects (renumber, inbox),
 *  are not events. `robot`: the robot's own (a `(robot)` / `(robot catch)`
 *  suffix, or its branch). */
export function classifyQueueSubject(subject: string): { kind: QueueEventKind; text: string; robot: boolean } | null {
  if (ROBOT_MERGE.test(subject)) {
    return { kind: 'merge', text: cutLine(subject.slice('Merge '.length), EVENT_LIMIT), robot: true };
  }
  const q = QUEUE_SUBJECT.exec(subject);
  if (!q) return null;
  const text = subject.slice(q[0].length).replace(ROBOT_SUFFIX, ' ');
  return { kind: q[1] as QueueEventKind, text: cutLine(text, EVENT_LIMIT), robot: ROBOT_SUFFIX.test(subject) };
}

export const ACTIVITY_LIMIT = 15;

/** The newest queue events among these commits, newest first. */
export function queueActivity(commits: readonly CommitLine[], limit = ACTIVITY_LIMIT): QueueEvent[] {
  const events: { at: number; event: QueueEvent }[] = [];
  for (const c of commits) {
    const e = classifyQueueSubject(c.subject);
    if (e) events.push({ at: c.at, event: { at: new Date(c.at * 1000).toISOString(), ...e } });
  }
  return events
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((e) => e.event);
}

/** Open reports marked `review` (what `feedback.mjs list --review` lists),
 *  as their id and category — nothing else leaves the server (law 9). */
export function reviewItems(feedback: readonly FeedbackLike[]): ReviewItem[] {
  return feedback
    .filter((f) => f.status === 'open' && f.triage?.outcome === 'review')
    .map((f) => ({ id: f.id, category: f.category }));
}

// ── the verdict ─────────────────────────────────────────────────

/** What the gate needs, from the facts — or null when there is nothing it
 *  could decide about: GitHub main is unknown, or what the pilot runs is
 *  known but git could not compare it with main (the gate would read the
 *  failure as "not in this clone's history" and lose the real why; the view
 *  shows that why instead). The server passes it to `decide`. */
export function gateFactsFor(
  facts: RobotFacts,
  assignments: GateFactsLike['assignments'],
  now: Date,
): GateFactsLike | null {
  if (!facts.mirror.ok) return null;
  if (facts.live.ok && !facts.pending.ok) return null;
  const pending = facts.pending.ok ? facts.pending.value : null;
  return {
    head: facts.mirror.value.head,
    lastReleased: facts.live.ok ? facts.live.value.sha : null,
    boxProblem: facts.live.ok ? null : facts.live.unknown,
    changedFiles: pending ? pending.changedFiles : null,
    landed: pending ? landedIn(pending.commits).map(({ id, title }) => ({ id, title })) : [],
    now,
    assignments,
    apiProblem: assignments ? null : 'the database could not list the assignments',
    backup: facts.backup
      ? { timerActive: facts.backup.timerActive, newestAt: facts.backup.newestAt ? new Date(facts.backup.newestAt) : null }
      : null,
    ci: facts.ci,
    ciProblem: facts.ciProblem,
  };
}

/** The gate's verdict in one line, in its own words: a hold names what
 *  holds it (the `brief`s — "held: the database schema and its migrations");
 *  a wait, what it waits for. */
export function releaseLine(gate: GateLike): string {
  const briefs = (verdict: GateVerdict) =>
    [...new Set(gate.reasons.filter((r) => r.verdict === verdict).map((r) => r.brief))].join('; ');
  switch (gate.verdict) {
    case 'hold':
      return `held: ${briefs('hold')}`;
    case 'wait':
      return `waiting: ${briefs('wait')}`;
    case 'current':
      return 'Up to date';
    case 'release':
      return 'Clear to release: the robot ships it on its next run';
  }
}

/** The gate's verdict, completed for the one fact only this server can lack.
 *  The gate reads `backup: null` as "nothing to add", which it can afford on
 *  the robot: there a null backup always comes with the box's own wait (its
 *  ssh probe failed). Here the box answered — what runs is known — while the
 *  backups could not be read (systemctl gave no answer, the folder is
 *  unreadable), so the gate alone would say "clear to release" where the
 *  robot's gate may hold. A range that ships therefore also waits on the
 *  unread backups — the gate's own "never release blind" — and says so;
 *  `current` (the gate asks no backup then) and a known backup are the
 *  gate's answer untouched. */
export function completeGate(gate: GateLike, facts: RobotFacts): GateLike {
  if (gate.verdict === 'current' || !facts.live.ok || facts.backup) return gate;
  const detail = `the daily backups are unknown: ${facts.backupProblem ?? 'no answer'}`;
  return {
    // hold > wait > release, as the gate ranks them
    verdict: gate.verdict === 'release' ? 'wait' : gate.verdict,
    reasons: [...gate.reasons, { verdict: 'wait', rule: 'backup', detail, brief: detail }],
  };
}

const unknown = (why: string) => ({ ok: false as const, unknown: why });

/** The whole answer from the facts, the gate's verdict (null: not asked or
 *  no answer; completed by `completeGate`) and the feedback queue (null:
 *  unreadable). */
export function robotStatusView(
  facts: RobotFacts,
  decided: GateLike | null,
  feedback: readonly FeedbackLike[] | null,
): RobotStatus {
  const gate = decided ? completeGate(decided, facts) : null;
  const live: Section<RobotLive> = facts.live.ok
    ? {
        ok: true,
        sha: facts.live.value.sha,
        shortSha: facts.live.value.sha.slice(0, 7),
        subject: facts.live.value.subject,
        releasedAt: facts.live.value.releasedAt,
        releasedAtSource: facts.live.value.releasedAtSource,
        lastLanded: facts.live.value.lastLandSubject ? parseLand(facts.live.value.lastLandSubject) : null,
      }
    : unknown(facts.live.unknown);

  let release: Section<RobotRelease>;
  if (!facts.mirror.ok) release = unknown(facts.mirror.unknown);
  else if (facts.live.ok && !facts.pending.ok) release = unknown(facts.pending.unknown);
  else if (!gate) release = unknown('the release gate gave no verdict');
  else {
    let rows: PendingTask[] = [];
    if (gate.verdict !== 'current' && facts.pending.ok) {
      const quiet = new Set(facts.pending.value.quietLands);
      rows = landedIn(facts.pending.value.commits.filter((c) => !quiet.has(c.sha)));
    }
    release = {
      ok: true,
      head: facts.mirror.value.head,
      verdict: gate.verdict,
      line: releaseLine(gate),
      reasons: gate.reasons.map((r) => ({ verdict: r.verdict, brief: r.brief, detail: r.detail })),
      rows,
    };
  }

  return {
    available: true,
    asOf: facts.fetchedAt,
    stale: facts.mirror.ok ? facts.mirror.value.stale : null,
    live,
    release,
    answers: facts.blocked.ok ? { ok: true, tasks: blockedQuestions(facts.blocked.value) } : unknown(facts.blocked.unknown),
    review: feedback ? { ok: true, items: reviewItems(feedback) } : unknown('the feedback queue could not be read'),
    activity: facts.recent.ok ? { ok: true, events: queueActivity(facts.recent.value) } : unknown(facts.recent.unknown),
  };
}

/** Every section unknown, for the same reason (the server's last resort). */
export function robotStatusUnknown(why: string, now: Date): RobotStatus {
  return {
    available: true,
    asOf: now.toISOString(),
    stale: null,
    live: unknown(why),
    release: unknown(why),
    answers: unknown(why),
    review: unknown(why),
    activity: unknown(why),
  };
}

// ── the strip and the times ─────────────────────────────────────

/** The one line over the Dashboard's tabs when something waits for Gabriel —
 *  "Robot: 7 tasks held for your release · 2 questions wait · 1 report to
 *  review" — or null when nothing does. Only a hold counts for the release (a
 *  wait or a clear release is the robot's to finish, not his); an unknown
 *  section counts nothing. */
export function robotStripLine(status: RobotStatus): string | null {
  if (!status.available) return null;
  const parts: string[] = [];
  if (status.release.ok && status.release.verdict === 'hold') {
    const n = status.release.rows.length;
    parts.push(n > 0 ? `${n} ${n === 1 ? 'task' : 'tasks'} held for your release` : 'changes held for your release');
  }
  if (status.answers.ok && status.answers.tasks.length > 0) {
    const k = status.answers.tasks.length;
    parts.push(`${k} ${k === 1 ? 'question waits' : 'questions wait'}`);
  }
  if (status.review.ok && status.review.items.length > 0) {
    const r = status.review.items.length;
    parts.push(`${r} ${r === 1 ? 'report' : 'reports'} to review`);
  }
  return parts.length > 0 ? `Robot: ${parts.join(' · ')}` : null;
}

/** "just now", "12 min ago", "3 h ago", "4 days ago". */
export function agoLabel(then: string | Date, now: Date): string {
  const ms = now.getTime() - new Date(then).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
