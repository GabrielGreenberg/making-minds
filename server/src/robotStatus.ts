// The robot's state, gathered (task 083): the facts behind GET
// /api/robot/status — the server's I/O half; the pure builder that turns
// them into the Dashboard's four sections is app/src/storage/robotStatus.ts,
// and the verdict is the release gate's own `decide` (app.ts asks it).
//
//   live      the server's own clone (on the box /srv/making-minds/repo, which
//             only a release moves): HEAD, its subject, when HEAD last moved
//             (the reflog; else this process's start) and its newest landed
//             task. Read-only commands only — rev-parse, log, reflog, config —
//             never status or diff against the worktree: an index.lock would
//             race release.sh's pull there.
//   mirror    a fetch-only bare mirror of GitHub main (beside the database,
//             inside the unit's ReadWritePaths — no deploy/ change), fetched
//             from the clone's own `remote.origin.url`; never a fetch in the
//             release clone itself, and every mirror command by --git-dir,
//             so git never climbs to a repository above it. A failed fetch
//             over an older copy is "stale"; no copy at all is unknown.
//   pending   live..main in the mirror: changed paths and commits, and which
//             landed tasks shipped nothing (their merge's own diff, quietOnly)
//   blocked   tasks/blocked/*.md at main
//   recent    main's newest commits (the queue activity)
//   backup    the newest daily-*.sqlite and `systemctl is-active` of its timer
//             (unknown, with why, when either cannot be read)
//   ci        main's run of deploy.yml, from GitHub's public API — asked only
//             when main is ahead of live and the origin is on GitHub
//
// Safety: every child process is an async execFile with FIXED arguments (the
// only inputs are shas git itself printed, checked against /^[0-9a-f]{40}$/,
// and paths from its own ls-tree), a timeout, a buffer cap, and no prompt.
// No request input ever reaches one: the route's only parameter is
// `?refresh=1`. Async, never execFileSync — a fetch must not freeze every
// other request. Each step fails on its own into "unknown: <why>".
//
// Cache: one per app instance (createApp builds it; serverCheck builds
// several apps): the facts at most every 10 minutes, one gathering in flight
// at a time, `refresh` to look again now.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseLand, type CommitLine, type Known, type RobotFacts } from '../../app/src/storage/robotStatus';
// The gate's own QUIET_PATHS test (pure; importing the gate runs nothing).
import { quietOnly } from '../../deploy/release-gate.mjs';

const execFileAsync = promisify(execFile);

/** The repo this code runs from — on the box, the release clone. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ROBOT_CACHE_MS = 10 * 60 * 1000;
const LOCAL_TIMEOUT_MS = 5_000;
const FIRST_FETCH_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const CI_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_BLOCKED_FILES = 50;
const RECENT_COMMITS = 300;
const SHA = /^[0-9a-f]{40}$/;
const LOG_FORMAT = '--format=%H%x1f%ct%x1f%s';
const PROCESS_STARTED = new Date(Date.now() - process.uptime() * 1000);

/** The clone to read: the configured one, else the repo this code runs from. */
export function repoDirFor(configured?: string): string {
  return configured || REPO_ROOT;
}

/** The mirror: the configured folder, else `repo-mirror.git` beside the
 *  database (the box: /srv/making-minds/data/repo-mirror.git); an in-memory
 *  database (the harnesses) has none, so it never touches the network. */
export function mirrorDirFor(dbPath: string, configured?: string): string | null {
  if (configured) return resolve(configured);
  if (dbPath === ':memory:') return null;
  return join(dirname(resolve(dbPath)), 'repo-mirror.git');
}

/** The daily backups: the configured folder, else `backups/daily` beside the
 *  database's directory (the box: /srv/making-minds/backups/daily — the
 *  shape of snapshot.ts snapshotDirFor); none for an in-memory database. */
export function backupDirFor(dbPath: string, configured?: string): string | null {
  if (configured) return configured;
  if (dbPath === ':memory:') return null;
  return join(dirname(dirname(resolve(dbPath))), 'backups', 'daily');
}

// ── child processes ─────────────────────────────────────────────

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  // A parent's repository must never redirect these commands.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']) {
    delete env[key];
  }
  return env;
}

async function run(args: string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { encoding: 'utf8', timeout, maxBuffer: MAX_BUFFER, env: childEnv() });
  return stdout;
}

/** A read in the server's own clone: `-C`, so git finds the repository its
 *  folder belongs to (the repo root, on the box and in dev alike). */
const git = (dir: string, args: string[], timeout = LOCAL_TIMEOUT_MS) => run(['-C', dir, ...args], timeout);

/** A command in the mirror: `--git-dir`, never `-C` — git must not go looking
 *  in the folders above for a repository. The dev mirror sits inside the live
 *  checkout (server/repo-mirror.git), so a malformed one would otherwise hand
 *  the forced fetch below to the checkout itself and move its main. With
 *  --git-dir, a folder that is no repository is an error: "unknown". */
const mirrorGit = (mirrorDir: string, args: string[], timeout = LOCAL_TIMEOUT_MS) =>
  run([`--git-dir=${mirrorDir}`, ...args], timeout);

/** Credentials never reach a page: `//user:token@host` → `//host`. */
const redact = (text: string) => text.replace(/\/\/[^/@\s]+@/g, '//');

/** A failure in one line: a timeout, git's own first stderr line, or the message. */
function why(e: unknown): string {
  const err = (e ?? {}) as { killed?: boolean; signal?: unknown; stderr?: unknown; message?: unknown };
  if (err.killed || err.signal === 'SIGTERM') return 'timed out';
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
  const text = stderr || (typeof err.message === 'string' ? err.message : String(e));
  return redact(text.split('\n')[0]).slice(0, 200);
}

async function step<T>(what: string, f: () => Promise<T>): Promise<Known<T>> {
  try {
    return { ok: true, value: await f() };
  } catch (e) {
    return { ok: false, unknown: `${what}: ${why(e)}` };
  }
}

const unknown = (why: string) => ({ ok: false as const, unknown: why });

function commitLines(out: string): CommitLine[] {
  const lines: CommitLine[] = [];
  for (const line of out.split('\n')) {
    const [sha, at, ...subject] = line.split('\x1f');
    if (SHA.test(sha ?? '') && /^\d+$/.test(at ?? '')) lines.push({ sha, at: Number(at), subject: subject.join('\x1f') });
  }
  return lines;
}

// ── URLs ────────────────────────────────────────────────────────

const GITHUB = /^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** The origin as the mirror may fetch it, with no credential: a GitHub ssh
 *  address becomes its https one (the repo is public); https, file:// and
 *  absolute local paths stay; anything else (and anything that could read as
 *  an option) is refused. */
export function fetchableUrl(url: string): string | null {
  if (!url || url.startsWith('-')) return null;
  const gh = GITHUB.exec(url);
  if (gh && !url.startsWith('https://')) return `https://github.com/${gh[1]}/${gh[2]}.git`;
  if (/^(?:https|file):\/\//.test(url) || url.startsWith('/')) return url;
  return null;
}

/** owner/repo when the origin is on GitHub. */
export function githubRepo(url: string): { owner: string; repo: string } | null {
  const m = GITHUB.exec(url);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ── the facts ───────────────────────────────────────────────────

async function readLive(repoDir: string): Promise<RobotFacts['live']> {
  let sha: string;
  try {
    sha = (await git(repoDir, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch (e) {
    return unknown(`cannot read the server's own clone: ${why(e)}`);
  }
  if (!SHA.test(sha)) return unknown(`unexpected answer from the server's clone: ${sha.slice(0, 60)}`);
  let subject = '';
  try {
    subject = (await git(repoDir, ['log', '-1', '--format=%s', sha])).trim();
  } catch {
    // the sha alone still says what runs
  }
  // When HEAD last moved (a release's pull): the reflog's newest entry,
  // printed as HEAD@{<unix seconds>} under --date=unix.
  let releasedAt = PROCESS_STARTED.toISOString();
  let releasedAtSource: 'reflog' | 'process-start' = 'process-start';
  try {
    const m = /\{(\d+)\}/.exec(await git(repoDir, ['log', '-g', '-1', '--date=unix', '--format=%gd', 'HEAD']));
    if (m) {
      releasedAt = new Date(Number(m[1]) * 1000).toISOString();
      releasedAtSource = 'reflog';
    }
  } catch {
    // no reflog: the process start stands in
  }
  let lastLandSubject: string | null = null;
  try {
    lastLandSubject = (await git(repoDir, ['log', '-1', '--format=%s', '-E', '--grep=^tasks: land ', sha])).trim() || null;
  } catch {
    // no landed task to name
  }
  return { ok: true, value: { sha, subject, releasedAt, releasedAtSource, lastLandSubject } };
}

/** Bring the mirror's main up to GitHub's (creating the mirror the first
 *  time). Returns main's sha, and the origin URL for the CI question. */
async function syncMirror(
  repoDir: string,
  mirrorDir: string | null,
): Promise<{ mirror: RobotFacts['mirror']; origin: string | null }> {
  if (!mirrorDir) {
    return { mirror: unknown('no mirror of GitHub main, since an in-memory database has no data folder to keep one in (set MM_REPO_MIRROR)'), origin: null };
  }
  let origin: string;
  try {
    origin = (await git(repoDir, ['config', '--get', 'remote.origin.url'])).trim();
  } catch (e) {
    // `config --get` exits 1, silently, for a key that is not set.
    const silent = (e as { code?: unknown; stderr?: unknown }).code === 1 && !String((e as { stderr?: unknown }).stderr ?? '').trim();
    return { mirror: unknown(`cannot read the server clone's origin: ${silent ? 'none is set' : why(e)}`), origin: null };
  }
  const url = fetchableUrl(origin);
  if (!url) return { mirror: unknown(`the server clone's origin is not a URL the mirror can fetch: ${redact(origin)}`), origin: null };

  const mainSha = async () => {
    try {
      const out = (await mirrorGit(mirrorDir, ['rev-parse', '--verify', '-q', 'refs/heads/main'])).trim();
      return SHA.test(out) ? out : null;
    } catch {
      return null;
    }
  };
  if (!existsSync(join(mirrorDir, 'HEAD'))) {
    try {
      await execFileAsync('git', ['init', '--bare', '-q', mirrorDir], { encoding: 'utf8', timeout: LOCAL_TIMEOUT_MS, env: childEnv() });
    } catch (e) {
      return { mirror: unknown(`cannot create the mirror of GitHub main: ${why(e)}`), origin };
    }
  }
  const before = await mainSha();
  let stale: string | null = null;
  try {
    await mirrorGit(mirrorDir, ['fetch', '-q', '--no-tags', url, '+refs/heads/main:refs/heads/main'], before ? FETCH_TIMEOUT_MS : FIRST_FETCH_TIMEOUT_MS);
  } catch (e) {
    stale = `the fetch from GitHub failed (${why(e)})`;
  }
  const head = await mainSha();
  if (!head) return { mirror: unknown(stale ? `no copy of GitHub main yet: ${stale}` : 'the mirror has no main branch'), origin };
  return { mirror: { ok: true, value: { head, stale } }, origin };
}

async function readPending(mirrorDir: string, live: string, head: string) {
  if (live === head) return { changedFiles: [], commits: [], quietLands: [] };
  try {
    await mirrorGit(mirrorDir, ['cat-file', '-e', `${live}^{commit}`]);
  } catch {
    // What the pilot runs is not in main's history: the gate says so.
    return { changedFiles: null, commits: [], quietLands: [] };
  }
  const changedFiles = (await mirrorGit(mirrorDir, ['diff', '--name-only', `${live}..${head}`])).split('\n').filter(Boolean);
  const commits = commitLines(await mirrorGit(mirrorDir, ['log', LOG_FORMAT, `${live}..${head}`]));
  return { changedFiles, commits, quietLands: await quietLandsIn(mirrorDir, live, head, commits) };
}

/** The `tasks: land` commits in live..head whose task changed nothing that
 *  ships (the gate's `quietOnly`: queue, docs, session config) — a docs-only
 *  task in a range that also ships code does not wait for a release. A task
 *  lands as the second parent of its merge into main (/work and the robot
 *  both land that way); its changes are that branch's own, `git diff
 *  <main>...<land>` (from their merge base). A land merged any other way —
 *  or any git failure here — is not judged, so it still counts. */
async function quietLandsIn(mirrorDir: string, live: string, head: string, commits: CommitLine[]): Promise<string[]> {
  const lands = new Set(commits.filter((c) => parseLand(c.subject)).map((c) => c.sha));
  if (lands.size === 0) return [];
  const quiet: string[] = [];
  try {
    const merges = await mirrorGit(mirrorDir, ['log', '--merges', '--format=%P', `${live}..${head}`]);
    for (const line of merges.split('\n')) {
      const [main, land] = line.trim().split(' ');
      if (!SHA.test(main ?? '') || !SHA.test(land ?? '') || !lands.has(land)) continue;
      lands.delete(land);
      try {
        const files = (await mirrorGit(mirrorDir, ['diff', '--name-only', `${main}...${land}`])).split('\n').filter(Boolean);
        if (quietOnly(files)) quiet.push(land);
      } catch {
        // not judged: it counts
      }
    }
  } catch {
    // not judged: they count
  }
  return quiet;
}

async function readBlocked(mirrorDir: string, head: string) {
  const paths = (await mirrorGit(mirrorDir, ['ls-tree', '--name-only', head, 'tasks/blocked/']))
    .split('\n')
    .filter((p) => /^tasks\/blocked\/[\w.-]+\.md$/.test(p))
    .slice(0, MAX_BLOCKED_FILES);
  const files: { path: string; text: string }[] = [];
  for (const path of paths) files.push({ path, text: await mirrorGit(mirrorDir, ['show', `${head}:${path}`]) });
  return files;
}

/** The daily backups as the gate's ssh probe reads them: the timer's state
 *  and the newest copy's time. Unknown (null, and why) when systemctl cannot
 *  answer (not installed, not allowed) or the folder cannot be read — the
 *  view then waits on them (robotStatus.ts `completeGate`). */
async function readBackup(backupDir: string | null): Promise<Pick<RobotFacts, 'backup' | 'backupProblem'>> {
  const none = (backupProblem: string) => ({ backup: null, backupProblem });
  if (!backupDir) return none('no backups folder, since an in-memory database has none (set MM_BACKUP_DIR)');
  let timerActive: boolean;
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', 'makingminds-backup.timer'], {
      encoding: 'utf8',
      timeout: LOCAL_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: childEnv(),
    });
    timerActive = stdout.trim() === 'active';
  } catch (e) {
    // Inactive exits non-zero (3) with its state on stdout; no answer at all
    // (ENOENT, EACCES, no systemd) is unknown.
    const out = (e as { stdout?: unknown }).stdout;
    if (typeof out !== 'string' || out.trim() === '') return none(`systemctl gave no answer about makingminds-backup.timer (${why(e)})`);
    timerActive = false;
  }
  let newestAt: string | null = null;
  try {
    let newest = -Infinity;
    for (const f of readdirSync(backupDir)) {
      if (/^daily-.*\.sqlite$/.test(f)) newest = Math.max(newest, statSync(join(backupDir, f)).mtimeMs);
    }
    if (Number.isFinite(newest)) newestAt = new Date(newest).toISOString();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return none(`cannot read the backups folder: ${why(e)}`);
  }
  return { backup: { timerActive, newestAt }, backupProblem: null };
}

/** main's run of deploy.yml, from GitHub's public API (unauthenticated: 60
 *  asks an hour, so only when there is something to ship, and cached). */
async function readCi(origin: string, head: string): Promise<Pick<RobotFacts, 'ci' | 'ciProblem'>> {
  const gh = githubRepo(origin);
  if (!gh) return { ci: null, ciProblem: 'the origin is not on GitHub' };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/workflows/deploy.yml/runs?branch=main&head_sha=${head}`,
      {
        headers: { 'User-Agent': 'making-minds-robot-status', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(CI_TIMEOUT_MS),
      },
    );
    if (!res.ok) return { ci: null, ciProblem: `GitHub answered ${res.status}` };
    const json = (await res.json()) as { workflow_runs?: { head_sha?: unknown; status?: unknown; conclusion?: unknown }[] };
    const run = json.workflow_runs?.find((r) => r.head_sha === head);
    return {
      ci: run
        ? { status: String(run.status ?? ''), conclusion: typeof run.conclusion === 'string' ? run.conclusion : '' }
        : { status: 'none', conclusion: '' },
      ciProblem: null,
    };
  } catch (e) {
    return { ci: null, ciProblem: `cannot reach GitHub: ${why(e)}` };
  }
}

export interface RobotSourceOptions {
  repoDir: string;
  mirrorDir: string | null;
  backupDir: string | null;
}

/** Every fact, each step on its own: nothing here throws. */
export async function gatherRobotFacts(opts: RobotSourceOptions): Promise<RobotFacts> {
  const fetchedAt = new Date().toISOString();
  const live = await readLive(opts.repoDir);
  const { mirror, origin } = await syncMirror(opts.repoDir, opts.mirrorDir);
  if (!mirror.ok) {
    return {
      fetchedAt,
      live,
      mirror,
      pending: unknown(mirror.unknown),
      blocked: unknown(mirror.unknown),
      recent: unknown(mirror.unknown),
      backup: null,
      backupProblem: mirror.unknown,
      ci: null,
      ciProblem: mirror.unknown,
    };
  }
  const dir = opts.mirrorDir!;
  const head = mirror.value.head;
  const pending = live.ok
    ? await step('cannot compare what runs with GitHub main', () => readPending(dir, live.value.sha, head))
    : unknown(`what the pilot runs is unknown (${live.unknown})`);
  const blocked = await step('cannot read tasks/blocked/ on GitHub main', () => readBlocked(dir, head));
  const recent = await step("cannot read GitHub main's history", async () =>
    commitLines(await mirrorGit(dir, ['log', '-n', String(RECENT_COMMITS), LOG_FORMAT, head])),
  );
  // The backups and CI only matter to a release: when main is ahead of live.
  const ahead = live.ok && live.value.sha !== head;
  const notAsked = live.ok ? 'not asked (nothing new to ship)' : 'not asked (what the pilot runs is unknown)';
  const backup = ahead ? await readBackup(opts.backupDir) : { backup: null, backupProblem: notAsked };
  const ci = ahead && origin ? await readCi(origin, head) : { ci: null, ciProblem: notAsked };
  return { fetchedAt, live, mirror, pending, blocked, recent, ...backup, ...ci };
}

export interface RobotStatusSource {
  /** The facts: cached (≤ ROBOT_CACHE_MS old) unless `refresh`; one
   *  gathering in flight at a time, shared by every caller. */
  get(refresh: boolean): Promise<RobotFacts>;
}

export function createRobotStatusSource(opts: RobotSourceOptions): RobotStatusSource {
  let cache: { facts: RobotFacts; at: number } | null = null;
  let inFlight: Promise<RobotFacts> | null = null;
  return {
    get(refresh) {
      if (inFlight) return inFlight;
      if (!refresh && cache && Date.now() - cache.at < ROBOT_CACHE_MS) return Promise.resolve(cache.facts);
      inFlight = gatherRobotFacts(opts)
        .then((facts) => {
          cache = { facts, at: Date.now() };
          return facts;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
