#!/usr/bin/env node
// The feedback detector (task 018) — the app's Feedback reports, for the catcher.
//
// Reports live on the server, in its database: the private store of record.
// This script, run on the instructor's machine, reads them through the same
// instructor-only API the dashboard's Feedback tab uses and keeps a working
// copy OUTSIDE the repo for the catcher to distil. The repo is public: a raw
// report (a student's words, screenshots showing their name and their work)
// never enters git; only the catcher's de-identified task does
// (tasks/CATCHER.md §3). The working copy never carries the author's email.
//
//   node tasks/tools/feedback.mjs pull
//       Sign in; fetch every open report the pipeline has not processed; write
//       each as <out>/feedback-<id>.md with its screenshots beside it; drop the
//       cached copies of reports no longer pending; sign out. Idempotent.
//   node tasks/tools/feedback.mjs mark <report-id> filed <task-id> [<task-id>…]
//   node tasks/tools/feedback.mjs mark <report-id> personal ["<note>"]
//   node tasks/tools/feedback.mjs mark <report-id> dismissed "<note>"
//   node tasks/tools/feedback.mjs mark <report-id> clear
//       Record what the pipeline made of a report — the server's triage mark,
//       shown in the Feedback tab — and drop its cached copy. `personal` = about
//       the student, not the platform or a homework: left for the instructor,
//       never filed. Never marks a report resolved; that stays the
//       instructor's act in the app.
//
// Options: --env <file>  credentials (default <repo>/secrets/feedback.env)
//          --out <dir>   the working copy (default ~/making-minds-private/feedback;
//                        refused anywhere inside the repo)
// The env file (gitignored with the rest of secrets/):
//   MM_API_BASE=https://100-22-69-95.sslip.io
//   MM_FEEDBACK_EMAIL=<an instructor account's email>
//   MM_FEEDBACK_PASSWORD=<its password>
// Exit status: 0 done, 1 failed (the message says why), 2 bad usage.
// Pinned by server/tools/feedbackCheck.ts.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
// Signing in to the pilot is shared with deploy/release-gate.mjs (task 042).
import { DEFAULT_ENV, PilotError as Failure, REPO, call, readEnv, withSession } from '../../deploy/pilot-api.mjs';

const DEFAULT_OUT = join(homedir(), 'making-minds-private', 'feedback');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'usage: node tasks/tools/feedback.mjs pull [--env <file>] [--out <dir>]\n' +
      '       node tasks/tools/feedback.mjs mark <report-id> filed <task-id>… | personal ["<note>"] | dismissed "<note>" | clear',
  );
  process.exit(2);
}

// ── arguments ───────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { env: DEFAULT_ENV, out: DEFAULT_OUT };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env' || a === '--out') {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      opts[a.slice(2)] = resolve(argv[++i]);
    } else {
      rest.push(a);
    }
  }
  return { opts, rest };
}

/** The working copy must live outside the repo, which is public. Checked on
 *  real paths (a symlink into the repo is still the repo). */
function assertOutsideRepo(out) {
  let existing = out;
  const tail = [];
  while (!existsSync(existing)) {
    tail.unshift(basename(existing));
    existing = dirname(existing);
  }
  const real = join(realpathSync(existing), ...tail);
  const repo = realpathSync(REPO);
  if (real === repo || real.startsWith(repo + sep)) {
    throw new Failure(
      `Refusing --out ${out}: it is inside the repo (${relative(repo, real) || '.'}), which is public. ` +
        'Raw feedback never goes near git — pick a folder outside it.',
    );
  }
}

// ── the working copy ────────────────────────────────────────────

const SHOT_EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp' };

function cachedIds(out) {
  if (!existsSync(out)) return [];
  return readdirSync(out)
    .map((f) => /^feedback-(.+)\.md$/.exec(f)?.[1])
    .filter(Boolean);
}

/** Remove a report's cached copy: its file and its screenshots. */
function dropCached(out, id) {
  if (!existsSync(out)) return false;
  const shot = new RegExp(`^feedback-${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.(png|jpg|webp)$`);
  let dropped = false;
  for (const f of readdirSync(out)) {
    if (f === `feedback-${id}.md` || shot.test(f)) {
      rmSync(join(out, f));
      dropped = true;
    }
  }
  return dropped;
}

function describeContext(context) {
  if (!context?.assignmentId) return 'none';
  return context.questionId != null ? `${context.assignmentId}, question ${context.questionId}` : context.assignmentId;
}

/** One report as its markdown file + screenshot files. The author's email is
 *  deliberately absent: the report id is the link back to the app. */
function renderReport(f) {
  const shots = (f.screenshots ?? []).flatMap((s, i) => {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.*)$/s.exec(s.dataUrl ?? '');
    return m ? [{ name: `feedback-${f.id}-${i + 1}.${SHOT_EXT[m[1]]}`, bytes: Buffer.from(m[2], 'base64') }] : [];
  });
  const md =
    [
      '---',
      `report: ${f.id}`,
      `author-role: ${f.authorRole ?? 'unknown'}`,
      `category: ${f.category}`,
      `filed: ${f.createdAt}`,
      `context: ${describeContext(f.context)}`,
      `screenshots: ${shots.length ? shots.map((s) => s.name).join(', ') : 'none'}`,
      '---',
      '<!-- Private working copy of an app Feedback report. Never commit it, never quote it:',
      '     distil it per tasks/CATCHER.md §3, then `node tasks/tools/feedback.mjs mark`. -->',
      '',
      f.message,
    ].join('\n') + '\n';
  return { md, shots };
}

/** Write a file only when its content differs, so a re-pull is a no-op. */
function writeIfChanged(path, data) {
  if (existsSync(path) && Buffer.compare(readFileSync(path), Buffer.from(data)) === 0) return false;
  writeFileSync(path, data);
  return true;
}

// ── commands ────────────────────────────────────────────────────

async function pull(opts) {
  assertOutsideRepo(opts.out);
  const env = readEnv(opts.env);
  const reports = await withSession(env, async (token) => {
    const r = await call(env.base, 'GET', '/feedback?status=open&triaged=false', { token });
    if (r.status !== 200 || !Array.isArray(r.json?.feedback)) {
      throw new Failure(`Could not list feedback (${r.status}${r.json?.error ? `: ${r.json.error}` : ''}).`);
    }
    // Filtered again here: a server older than task 018 ignores the query.
    return r.json.feedback.filter((f) => f.status === 'open' && !f.triage);
  });

  mkdirSync(opts.out, { recursive: true });
  const pending = new Set(reports.map((f) => f.id));
  const lines = [];
  let fresh = 0;
  for (const f of reports.slice().reverse()) {
    const { md, shots } = renderReport(f);
    const isNew = !existsSync(join(opts.out, `feedback-${f.id}.md`));
    writeIfChanged(join(opts.out, `feedback-${f.id}.md`), md);
    for (const s of shots) writeIfChanged(join(opts.out, s.name), s.bytes);
    if (isNew) fresh++;
    lines.push(
      `  ${isNew ? 'new ' : '    '} feedback-${f.id}.md · ${f.authorRole ?? 'unknown'} · ${f.category} · ` +
        `${describeContext(f.context)} · ${shots.length} screenshot${shots.length === 1 ? '' : 's'}`,
    );
  }
  let dropped = 0;
  for (const id of cachedIds(opts.out)) {
    if (!pending.has(id) && dropCached(opts.out, id)) dropped++;
  }

  console.log(
    `${reports.length} pending report${reports.length === 1 ? '' : 's'} in ${opts.out} ` +
      `(${fresh} new; ${dropped} processed elsewhere dropped).`,
  );
  for (const l of lines) console.log(l);
}

async function mark(opts, [id, outcome, ...args]) {
  if (!id || !outcome) usage('mark needs a report id and an outcome');
  let body;
  if (outcome === 'filed') {
    if (args.length === 0) usage('filed needs at least one task id');
    body = { outcome, tasks: args };
  } else if (outcome === 'personal' || outcome === 'dismissed') {
    if (args.length > 1) usage(`${outcome} takes one note — quote it`);
    if (outcome === 'dismissed' && !args[0]) usage('dismissed needs a note saying why');
    body = { outcome, ...(args[0] ? { note: args[0] } : {}) };
  } else if (outcome === 'clear') {
    if (args.length) usage('clear takes nothing else');
    body = { clear: true };
  } else {
    usage(`unknown outcome "${outcome}"`);
  }

  const env = readEnv(opts.env);
  await withSession(env, async (token) => {
    const r = await call(env.base, 'PUT', `/feedback/${encodeURIComponent(id)}/triage`, { token, body });
    if (r.status === 404 && !r.json) {
      throw new Failure('The server has no triage endpoint — it predates task 018; release it first.');
    }
    if (r.status !== 200) throw new Failure(`Not marked (${r.status}): ${r.json?.error ?? 'unexpected reply'}.`);
  });
  const dropped = outcome !== 'clear' && dropCached(opts.out, id);
  console.log(
    `${id}: ${outcome === 'clear' ? 'mark cleared — the next pull fetches it again' : `marked ${outcome}`}` +
      `${dropped ? '; working copy dropped' : ''}.`,
  );
}

// ── main ────────────────────────────────────────────────────────

const { opts, rest } = parseArgs(process.argv.slice(2));
const [command, ...args] = rest;
try {
  if (command === 'pull') {
    if (args.length) usage('pull takes no arguments');
    await pull(opts);
  } else if (command === 'mark') {
    await mark(opts, args);
  } else {
    usage(command ? `unknown command "${command}"` : undefined);
  }
} catch (e) {
  if (e instanceof Failure) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
