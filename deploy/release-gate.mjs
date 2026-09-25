#!/usr/bin/env node
// deploy/release-gate.mjs — may an UNATTENDED release go out now? (task 042)
//
// The one decision in front of `deploy/release.sh --unattended` (and `--check`):
//
//   current  nothing new since the last release, or nothing that ships
//            (QUIET_PATHS: the queue, docs) — nothing to do
//   hold     do not release until Gabriel does, by hand: the new commits touch
//            something on HOLD_PATHS, the daily backups (task 041) are not
//            running, or CI failed on the commit to ship
//   wait     not now, the next run may: outside the release hours, inside a
//            deadline freeze, CI still running (or not yet run) on the commit,
//            or the box / the pilot API / CI cannot be asked (never release
//            blind)
//   release  go
//
// Every rule that fires is reported with its reason; the strictest decides
// (hold > wait > release). The rules are data below, each with a comment —
// Gabriel tunes them (tasks/done/…-042 §Resolved decisions). The decision
// itself is `decide(facts)`, pure; `gatherFacts()` is the I/O (git, an ssh
// probe of the box, the pilot API as an instructor via deploy/pilot-api.mjs,
// GitHub's CI runs via `gh`).
// A hand run of release.sh never asks this gate: Gabriel's "release" is the
// override.
//
//   node deploy/release-gate.mjs [--json] [--env <file>] [--note-state <file>]
//
// Prints the verdict and reasons (to stderr with --json, which puts the result
// on stdout). Exit status: 0 release · 3 hold · 4 wait · 5 current · 1 error.
// Pinned by server/tools/releaseGateCheck.ts.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_ENV, PilotError, REPO, call, readEnv, withSession } from './pilot-api.mjs';

// ── the rules (data) ────────────────────────────────────────────

/** A change under any of these waits for Gabriel's own release. Matched as a
 *  prefix of the changed path (a trailing / = a whole directory). */
export const HOLD_PATHS = [
  ['app/src/engine/', 'grading: the simulators and the grader'],
  ['app/src/devData/homeworks/', 'homework content and answer keys'],
  ['app/src/devData/homeworkSync.ts', 'how homework content reaches the database'],
  ['server/src/homeworks.ts', 'how homework content reaches the database'],
  ['server/src/sanitize.ts', 'what students may see (answer keys stripped)'],
  ['server/src/auth.ts', 'sign-in'],
  ['server/src/password.ts', 'passwords'],
  ['app/src/auth/', 'sign-in'],
  ['server/src/db.ts', 'the database schema and its migrations'],
  ['deploy/', 'the release and backup machinery itself'],
];

/** Paths that never reach the pilot. A range touching nothing else is
 *  "current": the robot pushes queue commits every hour (task 029), and none
 *  of them is worth a release (a box restart, a Pages upload). */
export const QUIET_PATHS = [
  ['tasks/', 'the task queue'],
  ['docs/', 'design docs'],
  ['CLAUDE.md', 'the session index'],
  ['.claude/', 'session commands and workflows'],
];

/** Unattended releases only in these hours (Pacific): a broken release at
 *  night would sit unnoticed while students work. [start, end) in hours. */
export const RELEASE_HOURS = { start: 7, end: 22, timeZone: 'America/Los_Angeles' };

/** No unattended release this long before a published assignment is due. */
export const FREEZE_HOURS = 24;

/** The newest daily backup must be younger than this (a day plus slack). */
export const BACKUP_MAX_AGE_HOURS = 30;

// ── the decision (pure) ─────────────────────────────────────────

const RANK = { release: 0, wait: 1, hold: 2 };

function pacific(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: RELEASE_HOURS.timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour), label: `${parts.hour.padStart(2, '0')}:${parts.minute} Pacific` };
}

function whenLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: RELEASE_HOURS.timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Which HOLD_PATHS entries these changed files touch: `[{ path, why }]`,
 *  one per changed file that matches. */
const under = (prefix, file) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);

/** True when every changed path is on QUIET_PATHS: nothing that ships. */
export function quietOnly(changedFiles) {
  return changedFiles.length > 0 && changedFiles.every((file) => QUIET_PATHS.some(([prefix]) => under(prefix, file)));
}

export function heldPaths(changedFiles) {
  const out = [];
  for (const file of changedFiles) {
    const hit = HOLD_PATHS.find(([prefix]) => under(prefix, file));
    if (hit) out.push({ path: file, why: hit[1] });
  }
  return out;
}

/**
 * facts: {
 *   head, lastReleased        — commit shas (lastReleased null = the box couldn't say)
 *   changedFiles              — paths changed lastReleased..head (null = unknown)
 *   landed                    — [{ id, title }] tasks landed in that range
 *   now                       — Date
 *   assignments               — [{ id, title, visible, dueDate? }] (null = API problem)
 *   apiProblem, boxProblem    — why a source couldn't be asked, or null
 *   backup                    — { timerActive, newestAt: Date|null } (null = unknown)
 *   ci                        — HEAD's CI run on main: { status, conclusion }; status
 *                               'none' = no run for it yet (null = gh couldn't say)
 *   ciProblem                 — why CI couldn't be asked, or null
 * }
 * → { verdict, reasons: [{ verdict, rule, detail }], summary, note }
 */
export function decide(facts) {
  const reasons = [];
  // `brief` is what the one-line note says; `detail` is the full reason.
  const add = (verdict, rule, detail, brief = detail) => reasons.push({ verdict, rule, detail, brief });
  const short = (sha) => (sha ? sha.slice(0, 7) : '?');
  const summary = facts.landed?.length
    ? facts.landed.map((t) => `${t.id} ${t.title}`).join('; ')
    : `${facts.changedFiles?.length ?? '?'} changed files, no landed task`;

  if (facts.boxProblem || !facts.lastReleased) {
    add('wait', 'box', `cannot tell what the box runs: ${facts.boxProblem ?? 'no answer'}`);
  } else if (facts.lastReleased === facts.head) {
    return {
      verdict: 'current',
      reasons: [{ verdict: 'current', rule: 'current', detail: `the box already runs ${short(facts.head)}`, brief: 'up to date' }],
      summary: '',
      note: '',
    };
  } else if (!facts.changedFiles) {
    add('wait', 'diff', `the released commit ${short(facts.lastReleased)} is not in this clone's history`);
  } else if (quietOnly(facts.changedFiles)) {
    return {
      verdict: 'current',
      reasons: [{
        verdict: 'current',
        rule: 'quiet',
        detail: `only the task queue, docs or session config changed since ${short(facts.lastReleased)}`,
        brief: 'nothing that ships',
      }],
      summary: '',
      note: '',
    };
  } else {
    const byWhy = new Map();
    for (const { path, why } of heldPaths(facts.changedFiles)) {
      byWhy.set(why, [...(byWhy.get(why) ?? []), path]);
    }
    for (const [why, paths] of byWhy) {
      add('hold', 'hold-list', `${why}: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` (+${paths.length - 3})` : ''}`, why);
    }
  }

  // (No answer from the box at all is already a wait, above; these are the
  // box's own answers about the daily backups of task 041.)
  if (!facts.backup) {
    // nothing to add
  } else if (!facts.backup.timerActive) {
    add('hold', 'backup', 'the daily backup timer is not active on the box');
  } else if (!facts.backup.newestAt) {
    add('hold', 'backup', 'the daily backup has not produced a copy yet');
  } else {
    const ageH = (facts.now - facts.backup.newestAt) / 3_600_000;
    if (ageH > BACKUP_MAX_AGE_HOURS) {
      add('hold', 'backup', `the newest daily backup is ${Math.floor(ageH)} h old (limit ${BACKUP_MAX_AGE_HOURS} h)`);
    }
  }

  // A commit ships only once CI has passed on it (task 029): the robot pushes
  // and releases in one run, and a red run must never go out an hour later.
  const at = short(facts.head);
  if (!facts.ci) {
    add('wait', 'ci', `cannot read CI for ${at}: ${facts.ciProblem ?? 'no answer'}`);
  } else if (facts.ci.status === 'none') {
    add('wait', 'ci', `CI has not run on ${at} yet`);
  } else if (facts.ci.status !== 'completed') {
    add('wait', 'ci', `CI is still running on ${at} (${facts.ci.status})`);
  } else if (facts.ci.conclusion === 'cancelled' || facts.ci.conclusion === 'skipped') {
    // deploy.yml cancels a run a newer push supersedes: unproven, not failed.
    add('wait', 'ci', `CI was ${facts.ci.conclusion} on ${at} (superseded?) — not proven`);
  } else if (facts.ci.conclusion !== 'success') {
    add('hold', 'ci', `CI ${facts.ci.conclusion || 'did not pass'} on ${at}`, 'a CI run that did not pass');
  }

  const { hour, label } = pacific(facts.now);
  if (hour < RELEASE_HOURS.start || hour >= RELEASE_HOURS.end) {
    add('wait', 'hours', `${label}; unattended releases ${RELEASE_HOURS.start}:00–${RELEASE_HOURS.end}:00`);
  }

  if (!facts.assignments) {
    add('wait', 'deadlines', `cannot read due dates: ${facts.apiProblem ?? 'no answer'}`);
  } else {
    for (const a of facts.assignments) {
      if (!a.visible || !a.dueDate) continue;
      const due = new Date(a.dueDate);
      const hoursLeft = (due - facts.now) / 3_600_000;
      if (hoursLeft > 0 && hoursLeft <= FREEZE_HOURS) {
        add('wait', 'deadlines', `${a.title} is due ${whenLabel(due)} (in ${Math.ceil(hoursLeft)} h; freeze ${FREEZE_HOURS} h)`);
      }
    }
  }

  const verdict = reasons.reduce((v, r) => (RANK[r.verdict] > RANK[v] ? r.verdict : v), 'release');
  const note =
    verdict === 'hold'
      ? `Held ${short(facts.head)}, not released — it touches ${reasons
          .filter((r) => r.verdict === 'hold')
          .map((r) => r.brief)
          .join('; ')}. Pending: ${summary}. Release by hand when ready.`
      : '';
  return { verdict, reasons, summary, note };
}

/** What makes a note "the same as last time": the verdict, the commit and the
 *  rules that fired — not the times inside their details. */
export function noteKey(result, head) {
  return [result.verdict, head, ...result.reasons.map((r) => `${r.verdict}:${r.rule}:${r.rule === 'hold-list' ? r.detail : ''}`).sort()].join('|');
}

// ── the facts (I/O) ─────────────────────────────────────────────

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** HEAD's run of the deploy workflow on main, from GitHub via `gh` (signed in
 *  on this machine). No run for HEAD yet → status 'none'. */
export function ghCiRun(root, head) {
  const out = execFileSync(
    'gh',
    ['run', 'list', '--workflow', 'deploy.yml', '--branch', 'main', '--limit', '30', '--json', 'headSha,status,conclusion'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
  );
  const run = JSON.parse(out).find((r) => r.headSha === head);
  return run ? { status: run.status, conclusion: run.conclusion ?? '' } : { status: 'none', conclusion: '' };
}

const BOX_HOST = '100.22.69.95';
const BOX_USER = 'ubuntu';

/** Ask the box (over ssh, the key in <root>/ssh/) which commit it runs and
 *  whether the daily backups are alive. */
export function sshProbeBox(root) {
  const keyDir = join(root, 'ssh');
  const key = existsSync(keyDir) ? readdirSync(keyDir).find((f) => f.endsWith('.pem')) : undefined;
  if (!key) throw new Error(`no key in ${keyDir}`);
  const script = [
    'echo "head=$(sudo -u makingminds -H git -C /srv/making-minds/repo rev-parse HEAD)"',
    'echo "timer=$(systemctl is-active makingminds-backup.timer 2>/dev/null || true)"',
    `echo "newest=$(sudo bash -c 'f=$(ls -t /srv/making-minds/backups/daily/daily-*.sqlite 2>/dev/null | head -1); [ -n "$f" ] && stat -c %Y "$f" || echo none')"`,
  ].join('\n');
  const out = execFileSync(
    'ssh',
    ['-i', join(keyDir, key), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR',
      '-o', 'StrictHostKeyChecking=accept-new', `${BOX_USER}@${BOX_HOST}`, 'bash -s'],
    { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
  );
  const kv = Object.fromEntries(out.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2));
  if (!/^[0-9a-f]{40}$/.test(kv.head ?? '')) throw new Error(`unexpected answer from the box: ${out.trim()}`);
  return {
    head: kv.head,
    timerActive: kv.timer === 'active',
    newestAt: /^\d+$/.test(kv.newest ?? '') ? new Date(Number(kv.newest) * 1000) : null,
  };
}

/** Gather every fact `decide` needs. `probeBox` and `listAssignments` are
 *  injectable (the check replaces the box); the defaults are the real ones. */
export async function gatherFacts({
  root = REPO,
  envPath = DEFAULT_ENV,
  now = new Date(),
  probeBox = sshProbeBox,
  listAssignments = listPilotAssignments,
  probeCi = ghCiRun,
} = {}) {
  const head = git(root, 'rev-parse', 'HEAD');
  let ci = null;
  let ciProblem = null;
  try {
    ci = await probeCi(root, head);
  } catch (e) {
    ciProblem = (e.stderr?.toString().trim() || e.message).split('\n')[0];
  }
  let box = null;
  let boxProblem = null;
  try {
    box = await probeBox(root);
  } catch (e) {
    boxProblem = e.message.split('\n')[0];
  }
  let changedFiles = null;
  let landed = [];
  if (box && box.head !== head) {
    try {
      git(root, 'cat-file', '-e', `${box.head}^{commit}`);
      changedFiles = git(root, 'diff', '--name-only', `${box.head}..${head}`).split('\n').filter(Boolean);
      landed = git(root, 'log', '--format=%s', `${box.head}..${head}`)
        .split('\n')
        .map((s) => /^tasks: land (\S+) — (.+)$/.exec(s))
        .filter(Boolean)
        .map((m) => ({ id: m[1], title: m[2] }))
        .reverse();
    } catch {
      changedFiles = null;
    }
  }
  let assignments = null;
  let apiProblem = null;
  try {
    assignments = await listAssignments(envPath);
  } catch (e) {
    apiProblem = e.message.split('\n')[0];
  }
  return {
    head,
    lastReleased: box?.head ?? null,
    changedFiles,
    landed,
    now,
    assignments,
    apiProblem,
    boxProblem,
    backup: box ? { timerActive: box.timerActive, newestAt: box.newestAt } : null,
    ci,
    ciProblem,
  };
}

/** Every assignment on the pilot as the gate needs it (published? due when?),
 *  read as an instructor, who sees unpublished ones too. */
export async function listPilotAssignments(envPath) {
  const env = readEnv(envPath);
  return withSession(env, async (token) => {
    const r = await call(env.base, 'GET', '/assignments', { token });
    if (r.status !== 200 || !Array.isArray(r.json?.assignments)) {
      throw new PilotError(`could not list assignments (${r.status})`);
    }
    return r.json.assignments.map((a) => ({ id: a.id, title: a.title, visible: !!a.visible, dueDate: a.dueDate }));
  });
}

// ── CLI ─────────────────────────────────────────────────────────

const EXIT = { release: 0, hold: 3, wait: 4, current: 5 };

async function main(argv) {
  const opts = { json: false, env: DEFAULT_ENV, noteState: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--env') opts.env = resolve(argv[++i]);
    else if (argv[i] === '--note-state') opts.noteState = resolve(argv[++i]);
    else {
      console.error(`unknown option: ${argv[i]}`);
      process.exit(2);
    }
  }
  const facts = await gatherFacts({ envPath: opts.env });
  const result = decide(facts);

  // A hold is reported once, not every hour: a note whose key matches the
  // last one sent is suppressed.
  let note = result.note;
  let repeat = false;
  if (note && opts.noteState) {
    const key = noteKey(result, facts.head);
    const last = existsSync(opts.noteState) ? readFileSync(opts.noteState, 'utf8').trim() : '';
    if (key === last) {
      repeat = true;
      note = '';
    } else {
      writeFileSync(opts.noteState, `${key}\n`);
    }
  }

  const out = opts.json ? console.error : console.log;
  out(`release gate: ${result.verdict.toUpperCase()} (${facts.head.slice(0, 7)}; the box runs ${facts.lastReleased?.slice(0, 7) ?? '?'})`);
  for (const r of result.reasons) out(`  ${r.verdict.padEnd(7)} ${r.detail}`);
  if (result.summary) out(`  pending: ${result.summary}`);
  if (note) out(`note: ${note}`);
  if (repeat) out('note: (the same hold as last time — not repeated)');
  if (opts.json) {
    console.log(JSON.stringify({ ...result, note, repeat, head: facts.head, lastReleased: facts.lastReleased }));
  }
  process.exit(EXIT[result.verdict]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof PilotError ? e.message : e);
    process.exit(1);
  });
}
