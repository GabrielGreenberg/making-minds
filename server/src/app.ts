// The Express app — every endpoint the productized platform needs, mirroring
// the client's seams one-to-one:
//
//   GET    /api/auth/config                    unauthenticated: what the login screen offers
//   POST   /api/auth/login                     email (+ password) → bearer token
//   POST   /api/auth/register                  roster member creates their account (student ID + email)
//   POST   /api/auth/password                  change own password
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   POST   /api/auth/access-requests           unauthenticated: "my email isn't on the roster"
//   GET    /api/roster                         instructor: roster + account state
//   POST   /api/roster/import                  instructor: {csv, defaultRole?} → upsert
//   POST   /api/roster                         instructor: add one person
//   DELETE /api/roster/:email                  instructor: remove from the roster
//   DELETE /api/roster/:email/aliases/:alias    instructor: drop one extra sign-in address
//   POST   /api/roster/:email/reset-password   instructor: clear the credential + sessions
//   GET    /api/access-requests                instructor: pending/all requests (+ the account each names)
//   POST   /api/access-requests/:id/approve    instructor: add to roster (or as an alias), mark approved
//   POST   /api/access-requests/:id/reject     instructor
//   GET    /api/assignments                    summaries (any logged-in user)
//   GET    /api/assignments/:id                student: answers stripped; instructor: full
//   PUT    /api/assignments/:id                instructor: create/update
//   DELETE /api/assignments/:id                instructor
//   PUT    /api/assignments/:id/visibility     instructor: {visible: boolean} —
//                                              hidden assignments are invisible
//                                              to students (list + fetch)
//   PUT    /api/assignments/:id/grades-release instructor: {released: boolean} —
//                                              students see no grades at all until released
//   POST   /api/assignments/:id/regrade        instructor: {dryRun: boolean, expectHash?} —
//                                              re-grade every stale latest attempt against the
//                                              current version (task 069): the dry run's diff,
//                                              or commit (snapshot, rewrite, log; 409 on a
//                                              changed version). Human grades never touched
//   GET    /api/workbooks/:assignmentId        the caller's saved canvas state + their
//                                              mint key for it (task 034)
//   PUT    /api/workbooks/:assignmentId        autosave target (also appends to the
//                                              coarse per-save history)
//   POST   /api/assignments/:id/submissions    submit → server autogrades → record
//                                              (+ the integrity check, instructor-only)
//   GET    /api/assignments/:id/submissions    the caller's own attempts, any role
//                                              (task 037) — student: no grades until
//                                              released, then scores only; never
//                                              integrity; instructor: their own, full
//   GET    /api/assignments/:id/submissions/all
//                                              instructor: every student's attempts,
//                                              full detail (the gradebook feed)
//   GET    /api/assignments/:id/summary       instructor: the shared grading summary (task
//                                              064) — a row per roster student ∪ flagged
//                                              other submitters: latest-attempt meta,
//                                              points per problem, grade; progress. No circuits
//   GET    /api/assignments/:id/submissions/:sid/:attempt
//                                              instructor: one attempt in full (circuits,
//                                              expected/got, integrity, grades, the log)
//   GET    /api/grading                        instructor: every assignment's progress +
//                                              course-wide counts, the flagged students
//                                              and the flag thresholds (task 070)
//   PUT    /api/grading/settings               instructor: {thresholds} → normalized, stored
//                                              in course_settings.flagThresholds
//   GET    /api/grading/export.csv             instructor: the grades CSV (task 071) — a row
//                                              per roster student, the counted published
//                                              sets and the average; ?assignment=<id> →
//                                              that one column. Logged as an `export` event
//   GET    /api/students/:sid                  instructor: the student page — every
//                                              assignment's row, flags, the counted
//                                              average, private notes, the grade log
//   POST   /api/students/:sid/notes            instructor: {body} → one private note,
//                                              append-only (no update or delete route)
//   PUT    /api/assignments/:id/grades/:sid/:qid
//   DELETE /api/assignments/:id/grades/:sid/:qid
//                                              instructor: write / clear one human grade
//                                              (task 063; :sid = the opaque key)
//   GET    /api/assignments/:id/questions/:qid/responses
//                                              instructor: the hand-grading queue's feed
//                                              (task 066) — one problem across every
//                                              submitter's latest attempt: the answer
//                                              (text / blanks; a machine by reference),
//                                              grade, answer fingerprint, live claim
//   POST   /api/grading/claims                 instructor: a soft claim on one response —
//                                              {assignmentId, studentKey, questionId,
//                                              release?}; in memory, 5-minute TTL; advisory
//   POST   /api/assignments/:id/submissions/:attempt/review
//                                              instructor: manual verdict on a pending
//                                              open question — {student, questionId,
//                                              pass, note?} → updated record
//   POST   /api/feedback                       any signed-in user: file a platform/homework
//                                              report, screenshots as base64 data URLs
//   GET    /api/feedback                       instructor: the queue, newest first;
//                                              ?status=open|resolved, ?triaged=true|false,
//                                              ?triage=<outcome>
//   PUT    /api/feedback/:id/status            instructor: {status: 'open'|'resolved'}
//   PUT    /api/feedback/:id/triage            instructor: what the task pipeline made of
//                                              it — {outcome: filed|personal|dismissed|review,
//                                              tasks?, note?} | {clear: true}; dismissed, or
//                                              filed into tasks already live, also resolves
//                                              it, and clear undoes that (task 086)
//                                              → {ok, triage, resolved, reopened, status}
//   GET    /api/instructor-notes               instructor: the one shared markdown note
//   PUT    /api/instructor-notes               instructor: {content: string} → saves it
//   GET    /api/robot/status                   instructor: the robot's state (task 083) — what
//                                              the pilot runs, the release gate's verdict on
//                                              GitHub main, blocked questions, review marks
//                                              (id + category), queue activity; cached 10
//                                              minutes, ?refresh=1 looks again; never a 500
//   GET    /api/health                         unauthenticated liveness probe
//
// Grading happens HERE, with the same pure engine the browser uses
// (app/src/engine/grader.ts) — the server holds the test cases, the client
// never sees them. So does the provenance check (app/src/provenance/, task
// 034): the server holds the mint secret, hands each student their own key,
// and on submit tests every id and editing record against every known key. Exported as a factory (no listen()) so the smoke test can
// boot it on an ephemeral port against a temp database.

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AssignmentData, AssignmentState, ExportEvent, FeedbackTriage, FeedbackTriageOutcome, SubmissionData, SubmissionRecord } from '../../app/src/types';
import { autoResolveStands, COURSE_LOG_ID } from '../../app/src/types';
import { gradeSubmission } from '../../app/src/engine/grader';
import { checkStudentNote, planExtensionWrite, planGradeWrite, planWaiverWrite, type GradeWrite } from '../../app/src/storage/gradeWrites';
import { normalizeThresholds } from '../../app/src/storage/gradingFlags';
import { homeworkContentHash } from '../../app/src/devData/homeworkSync';
import { deriveMintKey } from '../../app/src/provenance/ids';
import { assessIntegrity, saveSummary } from '../../app/src/provenance/integrity';
import type { ServerConfig } from './config';
import { Db } from './db';
import {
  createAuthProvider,
  issueSession,
  bearerToken,
  requireAuth,
  requireInstructor,
  LoginThrottle,
  type AuthProvider,
} from './auth';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { isEmail, normalizeEmail, normalizeUid } from './roster';
import { matchAccount, placeRosterEntry } from './identity';
import { importRosterCsv } from './rosterImport';
import { stripAnswers, studentRecord } from './sanitize';
import {
  addStudentNote,
  assignmentSummary,
  attemptDetail,
  courseGrading,
  gradesExport,
  questionResponses,
  studentEmailOf,
  regradeInputs,
  studentGrading,
} from './gradingSummary';
import { regradeEvents } from '../../app/src/storage/regrade';
import { snapshotDirFor, takeRegradeSnapshot } from './snapshot';
import { ClaimBook } from '../../app/src/storage/gradingClaims';
import { checkGroup } from '../../app/src/submissionGroup';
import { studentCopy } from '../../app/src/lateContext';
import { gateFactsFor, robotStatusUnknown, robotStatusView, type GateFactsLike } from '../../app/src/storage/robotStatus';
import { backupDirFor, createRobotStatusSource, mirrorDirFor, repoDirFor } from './robotStatus';
import { autoResolveFeedback, doneDirFor, readDoneTasks, reopenedMark, TASK_ID, type AutoResolve } from './feedbackResolution';
// The release gate's decision itself (pure; importing it runs nothing), so
// the Dashboard's reason can never drift from what the robot's gate says.
import { decide } from '../../deploy/release-gate.mjs';

export function createApp(config: ServerConfig, db: Db) {
  const app = express();
  app.disable('x-powered-by');
  // Circuits are chunky JSON (an 8-question submission with big canvases can
  // run to a few MB); 10mb leaves headroom without inviting abuse.
  app.use(express.json({ limit: '10mb' }));

  // ── CORS (frontend on Cloudflare Pages, API on Lightsail) ──────
  if (config.corsOrigins.length > 0) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (origin && config.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        // A cross-origin fetch hides every header outside the CORS safelist;
        // the grades export (task 071) names its file in Content-Disposition.
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // The one auth decision: MM_AUTH_MODE picks the provider, and nothing below
  // knows which one it got (see src/auth.ts).
  const authProvider: AuthProvider = createAuthProvider(config, db);
  const throttle = new LoginThrottle();
  // Access requests are unauthenticated writes: a looser per-IP budget, since
  // a shared campus NAT may legitimately carry several in one session.
  const requestThrottle = new LoginThrottle(20, 60 * 60 * 1000);
  // Refused sign-ups per IP, whatever email or ID each one typed: guessing
  // student IDs under fresh addresses never meets the per-key throttle, so
  // this budget caps it. Generous, because a lecture hall setting up accounts
  // together shares one campus address and mistypes a few.
  const registerBudget = new LoginThrottle(100, 10 * 60 * 1000);

  const auth = requireAuth(db);
  // The watermark's secret: the configured one, else the one this database
  // generated and keeps (db.mintSecret) — never the client's dev secret.
  const mintSecret = config.mintSecret || db.mintSecret();
  const mintKey = (email: string, assignmentId: string) => deriveMintKey(mintSecret, email, assignmentId);
  const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

  // ── health ─────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ── auth ───────────────────────────────────────────────────────

  // Unauthenticated: lets the frontend render the right sign-in UI for
  // whatever this server is running, without being rebuilt when it changes.
  app.get('/api/auth/config', (_req, res) => {
    res.json(authProvider.capabilities());
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = normalizeEmail((req.body ?? {}).email);
    const ip = clientIp(req);
    // Counted per ACCOUNT, so an account's several addresses share one budget.
    const key = db.findUserByEmail(email)?.email ?? email;
    const wait = throttle.retryAfter(key, ip);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({
        error: 'too many sign-in attempts — wait a few minutes and try again',
        retryAfter: wait,
      });
      return;
    }
    const user = await authProvider.authenticate(req.body ?? {});
    if (!user) {
      throttle.recordFailure(key, ip);
      // One message for every failure: an unknown email, an email with no
      // account yet, and a wrong password are indistinguishable to the caller,
      // so the endpoint can't be used to enumerate the roster.
      res.status(401).json({ error: 'incorrect email or password' });
      return;
    }
    throttle.recordSuccess(key, ip);
    const token = issueSession(db, user, config.sessionTtlSeconds);
    res.json({ token, user });
  });

  // Create an account for someone the roster already contains. On success the
  // caller is signed straight in — one step, not register-then-log-in.
  app.post('/api/auth/register', async (req, res) => {
    // Throttled like sign-in, per email AND per student ID: registration takes
    // an ID, and an unthrottled endpoint would let someone guess a classmate's
    // ID and claim their seat — under a fresh address each time, too.
    const ip = clientIp(req);
    const email = normalizeEmail((req.body ?? {}).email);
    const uid = normalizeUid((req.body ?? {}).studentId);
    const keys = uid ? [email, `uid:${uid}`] : [email];
    const wait = Math.max(registerBudget.retryAfter('register', ip), ...keys.map((k) => throttle.retryAfter(k, ip)));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: 'too many attempts — wait a few minutes and try again', retryAfter: wait });
      return;
    }
    const result = await authProvider.register(req.body ?? {});
    if (!result.ok) {
      registerBudget.recordFailure('register', ip);
      if (result.reason !== 'weak-password' && result.reason !== 'email-not-accepted') {
        for (const k of keys) throttle.recordFailure(k, ip);
      }
      // 403 you may not have an account here · 409 the account's state says no
      // · 400 the request itself is bad.
      const status =
        result.reason === 'not-on-roster'
          ? 403
          : result.reason === 'already-registered' || result.reason === 'id-mismatch' || result.reason === 'email-taken'
            ? 409
            : 400;
      res.status(status).json({ error: result.message, reason: result.reason });
      return;
    }
    const token = issueSession(db, result.user, config.sessionTtlSeconds);
    res.json({ token, user: result.user });
  });

  // Change your own password. Requires the current one, so a walked-up-to
  // machine can't be used to lock the owner out. Other sessions are ended.
  app.post('/api/auth/password', auth, (req, res) => {
    if (!authProvider.capabilities().usesPassword) {
      res.status(400).json({ error: 'this server does not manage passwords' });
      return;
    }
    const email = req.user!.email;
    const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
    const stored = db.getPasswordHash(email);
    if (!stored || !verifyPassword(currentPassword, stored)) {
      res.status(403).json({ error: 'current password is incorrect' });
      return;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    const keep = bearerToken(req);
    db.setPasswordHash(email, hashPassword(newPassword as string));
    db.deleteSessionsFor(email);
    // Keep the caller signed in on THIS device by re-issuing their session.
    const token = keep ? issueSession(db, req.user!, config.sessionTtlSeconds) : null;
    res.json({ ok: true, token });
  });

  app.post('/api/auth/logout', auth, (req, res) => {
    const token = bearerToken(req);
    if (token) db.deleteSession(token);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', auth, (req, res) => {
    res.json({ user: req.user });
  });

  // "My email isn't the one on file" — the special-request path. Unauthenticated
  // by necessity (the person has no account), so it stores a claim and nothing
  // more: only an instructor can turn one into a roster row.
  app.post('/api/auth/access-requests', (req, res) => {
    if (!authProvider.capabilities().allowsAccessRequests) {
      res.status(400).json({ error: 'this server does not accept access requests' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!email || !isEmail(email)) {
      res.status(400).json({ error: 'enter a valid email address' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'enter your name' });
      return;
    }
    // Unauthenticated and writable, so it is rate-limited per IP — a pending
    // request per email is already deduped below, but nothing otherwise stops
    // one source filing thousands under invented addresses.
    const ip = clientIp(req);
    if (requestThrottle.retryAfter('access-request', ip) > 0) {
      res.status(429).json({ error: 'too many requests — try again later' });
      return;
    }
    requestThrottle.recordFailure('access-request', ip);
    // Answer identically whether or not we act, so the endpoint reveals
    // nothing about who is on the roster and can't be spammed into duplicates.
    // An address that is only a student's own sign-up alias is not "known":
    // its real owner may be asking, and approval can take it back.
    const owner = db.emailOwner(email);
    const known = owner != null && owner.source !== 'signup';
    if (!known && !db.hasPendingAccessRequest(email)) {
      db.addAccessRequest({
        email,
        name,
        studentId: typeof body.studentId === 'string' ? body.studentId.trim().slice(0, 64) : '',
        message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '',
      });
    }
    res.json({ ok: true });
  });

  // ── roster (instructor) ────────────────────────────────────────

  app.get('/api/roster', auth, requireInstructor, (_req, res) => {
    res.json({ roster: db.listUsers() });
  });

  app.post('/api/roster/import', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.csv !== 'string' || body.csv.trim() === '') {
      res.status(400).json({ error: 'body must be {csv: string}' });
      return;
    }
    const defaultRole = body.defaultRole === 'instructor' ? 'instructor' : 'student';
    // Re-importing never removes anyone and never touches a password: a
    // mid-quarter roster refresh must not delete a student's work or sign them
    // out. Who the class list no longer carries comes back in the report
    // (noLongerListed) for the instructor to review; removal is the explicit
    // DELETE below.
    res.json(importRosterCsv(db, body.csv, defaultRole));
  });

  app.post('/api/roster', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email || !isEmail(email)) {
      res.status(400).json({ error: 'enter a valid email address' });
      return;
    }
    // Through the identity module, like the import: an email the roster
    // already has updates that person (a blank name keeps theirs); an ID it
    // already has under another email only adds that email as an alias.
    const placed = placeRosterEntry(
      db,
      {
        email,
        name: typeof body.name === 'string' ? body.name.trim() : '',
        role: body.role === 'instructor' ? 'instructor' : 'student',
        studentId: typeof body.studentId === 'string' ? body.studentId.trim() : '',
      },
      'instructor',
    );
    if (placed.kind === 'conflict') {
      res.status(409).json({ error: placed.reason });
      return;
    }
    res.json({
      ok: true,
      added: placed.kind === 'added' ? 1 : 0,
      updated: placed.kind === 'updated' ? 1 : 0,
      account: placed.account.email,
      aliasAdded: placed.kind === 'updated' ? placed.aliasAdded : null,
    });
  });

  app.delete('/api/roster/:email', auth, requireInstructor, (req, res) => {
    const email = normalizeEmail(req.params.email);
    if (email === req.user!.email) {
      res.status(400).json({ error: 'you cannot remove your own account' });
      return;
    }
    if (!db.getUser(email)) {
      res.status(404).json({ error: 'unknown account' });
      return;
    }
    // Submissions and workbooks are keyed by email and deliberately survive:
    // a dropped student's graded work must not vanish from the gradebook.
    db.removeUser(email);
    res.json({ ok: true });
  });

  // A wrong extra sign-in address (a typo at sign-up, a stale registrar
  // email, a mistaken approval) is removed one at a time; the account's key
  // is not an alias. When it is the address the account was SET UP through,
  // whoever did that chose the password: it is cleared and every session
  // ends, exactly as a reset, so removing the address actually locks them out.
  app.delete('/api/roster/:email/aliases/:alias', auth, requireInstructor, (req, res) => {
    const email = normalizeEmail(req.params.email);
    const alias = normalizeEmail(req.params.alias);
    if (!db.getUser(email)) {
      res.status(404).json({ error: 'unknown account' });
      return;
    }
    const setUpThrough = db.registeredVia(email) === alias;
    if (!db.removeEmailAlias(email, alias)) {
      res.status(404).json({ error: 'that account has no such sign-in address' });
      return;
    }
    if (setUpThrough) {
      db.setPasswordHash(email, null);
      db.deleteSessionsFor(email);
    }
    res.json({ ok: true, credentialCleared: setUpThrough });
  });

  // Forgotten password, with no mail server in the loop: the instructor clears
  // the credential and the student sets up their account again (student ID +
  // either email).
  app.post('/api/roster/:email/reset-password', auth, requireInstructor, (req, res) => {
    const email = normalizeEmail(req.params.email);
    if (!db.getUser(email)) {
      res.status(404).json({ error: 'unknown account' });
      return;
    }
    db.setPasswordHash(email, null);
    db.deleteSessionsFor(email);
    res.json({ ok: true });
  });

  // ── access requests (instructor) ───────────────────────────────

  app.get('/api/access-requests', auth, requireInstructor, (req, res) => {
    const status = req.query.status;
    const filter =
      status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined;
    // Each request says which roster account its ID or email already names:
    // approving one of those adds the email to that account, not a new row.
    const requests = db.listAccessRequests(filter).map((r) => {
      const { account, conflict } = matchAccount(db, { email: r.email, studentId: r.studentId });
      return {
        ...r,
        match: account && !conflict ? { email: account.email, name: account.name } : null,
        conflict,
      };
    });
    res.json({ requests });
  });

  app.post('/api/access-requests/:id/approve', auth, requireInstructor, (req, res) => {
    const id = Number(req.params.id);
    const request = Number.isInteger(id) ? db.getAccessRequest(id) : null;
    if (!request) {
      res.status(404).json({ error: 'unknown request' });
      return;
    }
    const role = (req.body ?? {}).role === 'instructor' ? 'instructor' : 'student';
    // Approving IS adding them to the roster; they then create an account the
    // same way everyone else does. When the request's ID or email names
    // someone already on it, the email becomes one of that person's sign-in
    // addresses instead, and their roster facts stand.
    const placed = placeRosterEntry(
      db,
      { email: request.email, name: request.name, role, studentId: request.studentId },
      'request',
    );
    if (placed.kind === 'conflict') {
      res.status(409).json({ error: placed.reason });
      return;
    }
    db.resolveAccessRequest(id, 'approved', req.user!.email);
    res.json({
      ok: true,
      email: request.email,
      account: placed.account.email,
      accountName: placed.account.name,
      aliasAdded: placed.kind === 'updated' ? placed.aliasAdded : null,
    });
  });

  app.post('/api/access-requests/:id/reject', auth, requireInstructor, (req, res) => {
    const id = Number(req.params.id);
    const request = Number.isInteger(id) ? db.getAccessRequest(id) : null;
    if (!request) {
      res.status(404).json({ error: 'unknown request' });
      return;
    }
    db.resolveAccessRequest(id, 'rejected', req.user!.email);
    res.json({ ok: true });
  });

  // ── assignments ────────────────────────────────────────────────
  app.get('/api/assignments', auth, (req, res) => {
    const released = db.listGradesReleased();
    const visible = db.listVisible();
    const isInstructor = req.user!.role === 'instructor';
    const summaries = db
      .listAssignments()
      // A hidden assignment is invisible to students, not merely unlisted-
      // with-a-flag: they must not learn it exists before it is published.
      // Unpublished is the default, so an unknown id counts as hidden.
      .filter((a) => isInstructor || (visible.get(a.id) ?? false))
      .map((a) => {
        const row = {
          id: a.id,
          title: a.title,
          questionCount: a.questions.length,
          gradesReleased: released.get(a.id) ?? false,
          visible: visible.get(a.id) ?? false,
          dueDate: a.dueDate,
          order: a.order,
          ...(a.latePolicy ? { latePolicy: a.latePolicy } : {}),
        };
        // A student's row carries THEIR due date (task 068): an extension,
        // marked dueExtended. Never an instructor's.
        return isInstructor ? row : studentCopy(row, db.getExtension(a.id, req.user!.email) ?? undefined);
      });
    res.json({ assignments: summaries });
  });

  app.get('/api/assignments/:id', auth, (req, res) => {
    const assignment = db.getAssignment(String(req.params.id));
    const isInstructor = req.user!.role === 'instructor';
    // A hidden assignment is a 404 for a student, not a 403: a deep link must
    // not confirm that it exists.
    if (!assignment || (!isInstructor && !db.getVisible(assignment.id))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      // A student's copy: no answers, and their effective due date (task 068 —
      // an overlay of a date, no answer data). The instructor's copy is the
      // stored one: the editor saves it back, so it must never carry an
      // overlaid date.
      assignment: isInstructor
        ? assignment
        : studentCopy(stripAnswers(assignment), db.getExtension(assignment.id, req.user!.email) ?? undefined),
      gradesReleased: db.getGradesReleased(assignment.id),
      visible: db.getVisible(assignment.id),
    });
  });

  app.put('/api/assignments/:id', auth, requireInstructor, (req, res) => {
    const body = req.body as AssignmentData | undefined;
    if (
      !body ||
      body.id !== String(req.params.id) ||
      typeof body.title !== 'string' ||
      !Array.isArray(body.questions)
    ) {
      res.status(400).json({ error: 'malformed assignment (id must match URL)' });
      return;
    }
    // The instructor-owned grading fields (task 068) take only their values.
    if (body.latePolicy !== undefined && body.latePolicy !== 'per-meeting' && body.latePolicy !== 'per-day') {
      res.status(400).json({ error: "latePolicy must be 'per-meeting' or 'per-day'" });
      return;
    }
    if (body.countsTowardGrade !== undefined && typeof body.countsTowardGrade !== 'boolean') {
      res.status(400).json({ error: 'countsTowardGrade must be true or false' });
      return;
    }
    // `dueExtended` is served-only (a student's copy); it is never stored.
    const { dueExtended: _served, ...assignment } = body;
    db.saveAssignment(assignment);
    res.json({ ok: true });
  });

  app.delete('/api/assignments/:id', auth, requireInstructor, (req, res) => {
    // An assignment with submissions is never removed (task 063; memo §6.6):
    // its attempts and grades would be orphaned. Hide it instead.
    if (db.hasSubmissions(String(req.params.id))) {
      res.status(409).json({ error: 'students have submitted this assignment — hide it instead of deleting it' });
      return;
    }
    db.removeAssignment(String(req.params.id));
    res.json({ ok: true });
  });

  // ── grade release (instructor) ─────────────────────────────────
  // Students never see grades — not even on submit — until the instructor
  // flips this per-assignment flag. Idempotent; unrelease (released: false)
  // hides grades again.
  app.put('/api/assignments/:id/visibility', auth, requireInstructor, (req, res) => {
    const id = String(req.params.id);
    if (!db.getAssignment(id)) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const visible = (req.body ?? {}).visible;
    if (typeof visible !== 'boolean') {
      res.status(400).json({ error: 'body must be {visible: boolean}' });
      return;
    }
    db.setVisible(id, visible);
    res.json({ ok: true, visible });
  });

  app.put('/api/assignments/:id/grades-release', auth, requireInstructor, (req, res) => {
    const id = String(req.params.id);
    if (!db.getAssignment(id)) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const released = (req.body ?? {}).released;
    if (typeof released !== 'boolean') {
      res.status(400).json({ error: 'body must be {released: boolean}' });
      return;
    }
    db.setGradesReleased(id, released);
    res.json({ ok: true, gradesReleased: released });
  });

  // ── re-grade (instructor; task 069, memo grading-interface.md §5) ──
  // The plan is the ONE pure planner's (app/src/storage/regrade.ts) over each
  // student's latest attempt; the commit recomputes it — a client's plan is
  // never trusted — and, when anything is stale, snapshots the database, then
  // in one transaction rewrites `result` + `assignment_hash` on those latest
  // attempts and logs one `regrade` event per changed (student, problem).
  // The `grades` table is never written. The handler is synchronous
  // (node:sqlite is), so no submission can land between plan and write.
  const snapshotDir = snapshotDirFor(config.dbPath, config.snapshotDir);
  app.post('/api/assignments/:id/regrade', auth, requireInstructor, (req, res) => {
    const id = String(req.params.id);
    const body = (req.body ?? {}) as { dryRun?: unknown; expectHash?: unknown };
    if (typeof body.dryRun !== 'boolean' || (body.expectHash !== undefined && typeof body.expectHash !== 'string')) {
      res.status(400).json({ error: 'body must be {dryRun: boolean, expectHash?: string}' });
      return;
    }
    const now = new Date();
    const inputs = regradeInputs(db, mintSecret, id, now.getTime());
    if (!inputs) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const { plan, writes, emailOf } = inputs;
    if (body.dryRun) {
      res.json({ plan, committed: false });
      return;
    }
    if (body.expectHash !== undefined && body.expectHash !== plan.assignmentHash) {
      res.status(409).json({ error: 'the assignment changed since the dry run', plan });
      return;
    }
    if (writes.length === 0) {
      res.json({ plan, committed: false });
      return;
    }
    let snapshot: string;
    try {
      snapshot = takeRegradeSnapshot(db, snapshotDir, id, now);
    } catch (err) {
      console.error('regrade snapshot failed:', err);
      res.status(500).json({ error: 'snapshot failed; nothing re-graded' });
      return;
    }
    const events = regradeEvents(plan, writes, { actor: req.user!.email, at: now.toISOString(), emailOf });
    db.transaction(() => {
      for (const w of writes) db.updateSubmissionResult(id, emailOf(w.studentKey), w.attempt, w.result, plan.assignmentHash);
      for (const e of events) db.addGradeEvent(id, e);
    });
    res.json({ plan, committed: true, snapshot });
  });

  // ── workbooks (per-student autosave) ───────────────────────────
  app.get('/api/workbooks/:assignmentId', auth, (req, res) => {
    const assignmentId = String(req.params.assignmentId);
    const state = db.getWorkbook(req.user!.email, assignmentId);
    // The caller's own mint key for this assignment: the ids they mint and
    // the editing records they sign from now on bind to them.
    res.json({ state, mintKey: mintKey(req.user!.email, assignmentId) });
  });

  app.put('/api/workbooks/:assignmentId', auth, (req, res) => {
    const state = req.body as AssignmentState;
    if (!state || typeof state.currentQuestionIndex !== 'number' || !state.questionCircuits) {
      res.status(400).json({ error: 'malformed workbook state' });
      return;
    }
    const assignmentId = String(req.params.assignmentId);
    db.saveWorkbook(req.user!.email, assignmentId, state);
    // The coarse history the "arrived in one save" check reads: sizes only.
    db.addWorkbookSave(req.user!.email, assignmentId, saveSummary(state));
    res.json({ ok: true });
  });

  // ── submissions (submit + gradebook) ───────────────────────────
  // The class list as one student may see another (task 062: the submit
  // dialog's group picker): names and opaque keys only — never an email, a
  // UID or a section — the caller left out. Any signed-in person; an
  // instructor gets every student (the gradebook resolves group keys by it).
  app.get('/api/classmates', auth, (req, res) => {
    const self = req.user!.email;
    res.json({
      classmates: db
        .listStudentKeys()
        .filter((c) => c.email !== self)
        .map(({ key, name }) => ({ key, name })),
    });
  });

  app.post('/api/assignments/:id/submissions', auth, (req, res) => {
    const assignment = db.getAssignment(String(req.params.id));
    if (!assignment) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const body = (req.body ?? {}) as Partial<SubmissionData>;
    if (!Array.isArray(body.answers)) {
      res.status(400).json({ error: 'malformed submission (answers required)' });
      return;
    }
    // The group listing (task 062): up to two roster students by their opaque
    // keys, never the submitter — the one rule, submissionGroup.ts. A bad
    // listing refuses the whole submission (400, nothing recorded) with a
    // reason the dialog shows.
    const group = checkGroup(
      body.group,
      new Set(db.listStudentKeys().map((c) => c.key)),
      db.publicIdOf(req.user!.email),
    );
    if (!group.ok) {
      res.status(400).json({ error: group.error });
      return;
    }
    // Identity and timestamp are the server's word, not the client's.
    const submission: SubmissionData = {
      assignmentTitle: assignment.title,
      student: req.user!.email,
      submittedAt: new Date().toISOString(),
      answers: body.answers,
      ...(group.group.length ? { group: group.group } : {}),
    };
    const result = gradeSubmission(assignment, submission);
    // Provenance (task 034): whose ids and editing records these are, tested
    // against the student's own key and everyone else's. Beside the grade,
    // never in it; instructor-only (sanitize.ts).
    const email = req.user!.email;
    const integrity = assessIntegrity({
      questionIds: assignment.questions.map((q) => q.id),
      answers: submission.answers,
      self: { email, key: mintKey(email, assignment.id) },
      others: db.knownEmails().map((e) => ({ email: e, key: mintKey(e, assignment.id) })),
      legacy: db.legacyFor(email, assignment.id),
      history: db.listWorkbookSaves(email, assignment.id).map((h) => h.summary),
    });
    // Stamped with the version it was graded against (task 063): an edit or a
    // homework sync afterwards makes this result stale, and says so.
    const record = db.addSubmission(assignment.id, email, submission, result, integrity, homeworkContentHash(assignment));
    // The grade is computed and stored NOW, but students don't see it until
    // the instructor releases grades — and even then, scores only.
    res.status(201).json({
      record:
        req.user!.role === 'instructor'
          ? record
          : studentRecord(record, db.getGradesReleased(assignment.id), assignment, [], db.getWaiver(assignment.id, email)?.points),
    });
  });

  // The caller's OWN attempts, for every role (task 037): an instructor's
  // Student view is a student-side read, so it sees only the instructor's
  // own attempts. Everyone's is the gradebook's route below.
  app.get('/api/assignments/:id/submissions', auth, (req, res) => {
    const id = String(req.params.id);
    const own = db.listSubmissions(id, req.user!.email);
    const grades = db.listGrades(id).get(req.user!.email) ?? [];
    if (req.user!.role === 'instructor') {
      res.json({ records: own.map((r) => (grades.length ? { ...r, grades } : r)) });
      return;
    }
    const released = db.getGradesReleased(id);
    // The full assignment fills older results' case separations (sanitize.ts).
    const assignment = db.getAssignment(id) ?? undefined;
    const waived = db.getWaiver(id, req.user!.email)?.points;
    res.json({ records: own.map((r) => studentRecord(r, released, assignment, grades, waived)) });
  });

  // Everyone's attempts (the gradebook): each with its student's human grades
  // in full and the opaque key the grade routes name them by (task 063).
  app.get('/api/assignments/:id/submissions/all', auth, requireInstructor, (req, res) => {
    const id = String(req.params.id);
    const grades = db.listGrades(id);
    const keys = new Map<string, string | null>();
    const keyOf = (email: string) => {
      if (!keys.has(email)) keys.set(email, db.publicIdOf(email));
      return keys.get(email) ?? undefined;
    };
    res.json({
      records: db.listSubmissions(id).map((r): SubmissionRecord => {
        const email = (r.submission.student ?? '').toLowerCase();
        const mine = grades.get(email) ?? [];
        const studentKey = keyOf(email);
        return { ...r, ...(studentKey ? { studentKey } : {}), ...(mine.length ? { grades: mine } : {}) };
      }),
    });
  });

  // ── grading summaries (instructor; task 064) ────────────────────
  // What the grading views read instead of every attempt in full: one pure
  // builder (app/src/storage/gradingSummary.ts) over the roster and each
  // student's latest attempt (server/src/gradingSummary.ts gathers them).
  // Students are named by opaque keys, never an email or UID.
  app.get('/api/grading', auth, requireInstructor, (_req, res) => {
    res.json(courseGrading(db, mintSecret, Date.now()));
  });

  // The grades CSV (task 071): a rendering of the same summaries, downloaded;
  // every export is logged under COURSE_LOG_ID (who, which, how many — never
  // whose grades). Nothing writes the file anywhere on the server.
  app.get('/api/grading/export.csv', auth, requireInstructor, (req, res) => {
    const raw = req.query.assignment;
    const assignmentId = typeof raw === 'string' && raw !== '' ? raw : undefined;
    const now = Date.now();
    const out = gradesExport(db, mintSecret, now, assignmentId);
    if (!out) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const event: ExportEvent = {
      at: new Date(now).toISOString(),
      actor: req.user!.email,
      kind: 'export',
      before: null,
      after: { assignmentId: assignmentId ?? null, rows: out.rows, columns: out.columns },
    };
    db.addGradeEvent(COURSE_LOG_ID, event);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(out.csv);
  });

  // The flag thresholds (task 070): normalized — a missing or junk field is
  // its default — so a flag rule never reads a bad value.
  app.put('/api/grading/settings', auth, requireInstructor, (req, res) => {
    const raw = (req.body ?? {}) as { thresholds?: unknown };
    if (!raw.thresholds || typeof raw.thresholds !== 'object' || Array.isArray(raw.thresholds)) {
      res.status(400).json({ error: 'body must be {thresholds: {…}}' });
      return;
    }
    const thresholds = normalizeThresholds(raw.thresholds);
    db.setCourseSetting('flagThresholds', thresholds);
    res.json({ thresholds });
  });

  app.get('/api/assignments/:id/summary', auth, requireInstructor, (req, res) => {
    const summary = assignmentSummary(db, mintSecret, String(req.params.id), Date.now());
    if (!summary) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    res.json(summary);
  });

  app.get('/api/students/:sid', auth, requireInstructor, (req, res) => {
    const student = studentGrading(db, mintSecret, String(req.params.sid), Date.now());
    if (!student) {
      res.status(404).json({ error: 'no such student' });
      return;
    }
    res.json(student);
  });

  // Private notes on a student (task 070; memo §6.5, §9): instructors only,
  // append-only — this is the only write, and no student route reads them.
  // The student is named by their opaque key, never an email.
  app.post('/api/students/:sid/notes', auth, requireInstructor, (req, res) => {
    const checked = checkStudentNote((req.body ?? {}).body);
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }
    const note = addStudentNote(db, mintSecret, String(req.params.sid), checked.body, req.user!.email);
    if (!note) {
      res.status(404).json({ error: 'no such student' });
      return;
    }
    res.json({ note });
  });

  app.get('/api/assignments/:id/submissions/:sid/:attempt', auth, requireInstructor, (req, res) => {
    const detail = attemptDetail(
      db, mintSecret, String(req.params.id), String(req.params.sid), Number(req.params.attempt), Date.now(),
    );
    if (!detail) {
      res.status(404).json({ error: 'no such assignment, student or attempt' });
      return;
    }
    res.json(detail);
  });

  // ── the hand-grading queue (instructor; task 066) ───────────────
  // The feed is the same pure builder the local GradingStore runs
  // (app/src/storage/gradingSummary.ts buildQuestionResponses). Claims are
  // soft and live only in this process (app/src/storage/gradingClaims.ts):
  // keyed by the student's opaque key, held by the grader's email, shown to
  // others by the grader's name. A grade write never checks one — the
  // grade's version does that job (a 409 below).
  const claims = new ClaimBook();
  const questionOf = (assignmentId: string, qid: unknown) => {
    const n = Number(qid);
    const assignment = db.getAssignment(assignmentId);
    return Number.isInteger(n) ? (assignment?.questions.find((q) => q.id === n) ?? null) : null;
  };

  app.get('/api/assignments/:id/questions/:qid/responses', auth, requireInstructor, (req, res) => {
    const id = String(req.params.id);
    const question = questionOf(id, req.params.qid);
    const feed = question ? questionResponses(db, mintSecret, id, question.id, claims, req.user!.email, Date.now()) : null;
    if (!feed) {
      res.status(404).json({ error: 'no such assignment or question' });
      return;
    }
    res.json(feed);
  });

  app.post('/api/grading/claims', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { assignmentId?: unknown; studentKey?: unknown; questionId?: unknown; release?: unknown };
    if (
      typeof body.assignmentId !== 'string' || typeof body.studentKey !== 'string' || typeof body.questionId !== 'number' ||
      (body.release !== undefined && typeof body.release !== 'boolean')
    ) {
      res.status(400).json({ error: 'body must be {assignmentId, studentKey, questionId, release?}' });
      return;
    }
    const question = questionOf(body.assignmentId, body.questionId);
    // Any key a summary or feed hands out (one resolver); the claim is keyed
    // by that opaque key, never the address it names.
    if (!question || !studentEmailOf(db, mintSecret, body.studentKey)) {
      res.status(404).json({ error: 'no such assignment, question or student' });
      return;
    }
    const target = { assignmentId: body.assignmentId, studentKey: body.studentKey, questionId: question.id };
    const now = Date.now();
    if (body.release) {
      claims.release(target, req.user!.email);
      const left = claims.active(target.assignmentId, target.questionId, now).get(target.studentKey);
      res.json({ held: false, by: left?.by ?? null, until: left?.until ?? null });
      return;
    }
    res.json(claims.claim(target, { actor: req.user!.email, name: req.user!.name }, now));
  });

  // ── human grades (instructor; task 063) ─────────────────────────
  // One grade — a hand grade, or an override of the autograde (note
  // required) — on a student's LATEST attempt, planned by the SAME pure
  // planGradeWrite the local GradingStore uses (app/src/storage/gradeWrites.ts):
  // the server is the other implementation of one contract. The student is
  // named by their opaque key (users.public_id, or a removed submitter's
  // derived key — gradingSummary.ts studentEmailOf), never an email. A stale
  // `version` is a 409 carrying the current grade; every write is logged.
  const gradeRoute = (req: Request, res: Response, write: GradeWrite) => {
    const assignmentId = String(req.params.id);
    const assignment = db.getAssignment(assignmentId);
    // Any key a summary row carries, a removed submitter's derived one too.
    const email = studentEmailOf(db, mintSecret, String(req.params.sid));
    const question = assignment?.questions.find((q) => q.id === Number(req.params.qid));
    if (!assignment || !email || !question) {
      res.status(404).json({ error: 'no such assignment, student or question' });
      return;
    }
    const own = db.listSubmissions(assignmentId, email);
    const plan = planGradeWrite({
      question,
      latest: own.length ? own[own.length - 1] : null,
      student: email,
      existing: db.getGrade(assignmentId, email, question.id),
      write,
      actor: req.user!.email,
      now: new Date().toISOString(),
    });
    if (!plan.ok) {
      if (plan.conflict) res.status(409).json({ error: 'someone else changed this grade meanwhile', current: plan.current });
      else res.status(400).json({ error: plan.error });
      return;
    }
    if (plan.grade) db.putGrade(assignmentId, email, plan.grade);
    else db.deleteGrade(assignmentId, email, question.id);
    db.addGradeEvent(assignmentId, plan.event);
    res.json({ grade: plan.grade });
  };
  const versionOf = (v: unknown): number | null | undefined =>
    v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

  app.put('/api/assignments/:id/grades/:sid/:qid', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { points?: unknown; note?: unknown; version?: unknown };
    const version = versionOf(body.version);
    if (version === undefined || (body.note !== undefined && typeof body.note !== 'string')) {
      res.status(400).json({ error: 'body must be {points, note?, version} (version: the one read, or null)' });
      return;
    }
    // planGradeWrite refuses points outside {0, ½, 1} (engine/score.ts gradeWriteProblem).
    gradeRoute(req, res, { points: body.points as 0 | 0.5 | 1, note: body.note as string | undefined, version });
  });

  app.delete('/api/assignments/:id/grades/:sid/:qid', auth, requireInstructor, (req, res) => {
    const version = versionOf((req.body ?? {}).version);
    if (typeof version !== 'number') {
      res.status(400).json({ error: 'body must be {version}' });
      return;
    }
    gradeRoute(req, res, { clear: true, version });
  });

  // ── extensions and late waivers (instructor; task 068) ──────────
  // Per (assignment, student), set or cleared, planned by the SAME pure
  // planners the local GradingStore uses (storage/gradeWrites.ts) and logged
  // in grade_events. The student is named by their opaque key, never an
  // email. An extension has no reason field, by design (memo §9).
  const lateTarget = (req: Request, res: Response): { assignmentId: string; email: string } | null => {
    const assignmentId = String(req.params.id);
    const email = db.getAssignment(assignmentId) ? studentEmailOf(db, mintSecret, String(req.params.sid)) : null;
    if (!email) {
      res.status(404).json({ error: 'no such assignment or student' });
      return null;
    }
    return { assignmentId, email };
  };

  app.put('/api/assignments/:id/students/:sid/extension', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { dueDate?: unknown };
    if (!('dueDate' in body) || (body.dueDate !== null && typeof body.dueDate !== 'string')) {
      res.status(400).json({ error: 'body must be {dueDate: an ISO date and time, or null to clear}' });
      return;
    }
    const target = lateTarget(req, res);
    if (!target) return;
    const plan = planExtensionWrite({
      existing: db.getExtension(target.assignmentId, target.email),
      dueDate: body.dueDate,
      student: target.email,
      actor: req.user!.email,
      now: new Date().toISOString(),
    });
    if (!plan.ok) {
      res.status(400).json({ error: plan.error });
      return;
    }
    db.putExtension(target.assignmentId, target.email, plan.value);
    db.addGradeEvent(target.assignmentId, plan.event);
    res.json({ extension: plan.value });
  });

  app.put('/api/assignments/:id/students/:sid/waiver', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { points?: unknown; note?: unknown; clear?: unknown };
    const clear = body.clear === true;
    if (!clear && body.points === undefined) {
      res.status(400).json({ error: 'body must be {points, note?} or {clear: true}' });
      return;
    }
    const target = lateTarget(req, res);
    if (!target) return;
    const plan = planWaiverWrite({
      existing: db.getWaiver(target.assignmentId, target.email),
      write: clear ? null : { points: body.points, note: body.note },
      student: target.email,
      actor: req.user!.email,
      now: new Date().toISOString(),
    });
    if (!plan.ok) {
      res.status(400).json({ error: plan.error });
      return;
    }
    db.putWaiver(target.assignmentId, target.email, plan.value);
    db.addGradeEvent(target.assignmentId, plan.event);
    res.json({ waiver: plan.value });
  });

  // ── feedback (notes/todos.md item 9) ────────────────────────────
  // Anyone signed in can file a report; only an instructor can see or work
  // the queue. Screenshots ride as base64 data URLs inside the JSON body —
  // no upload endpoint, no multer, no filesystem — capped here so the shared
  // express.json({limit:'10mb'}) body-size cap isn't the only backstop.
  const MAX_FEEDBACK_SCREENSHOTS = 2;
  const MAX_SCREENSHOT_DATA_URL_LENGTH = 4_500_000; // ~3.3MB decoded
  const MAX_FEEDBACK_MESSAGE_LENGTH = 5000;

  // The pipeline's reports close themselves (task 086, src/feedbackResolution.ts).
  // The live tasks are read once, at boot (the tasks/done/ of the code this
  // process runs), then one sweep over every open, marked report. Neither may
  // ever stop the server.
  const liveDone = readDoneTasks(doneDirFor(config.dbPath, config.repoDir));
  try {
    const resolved = autoResolveFeedback(db, liveDone).length;
    if (resolved) console.log(`feedback: auto-resolved ${resolved} report${resolved === 1 ? '' : 's'}`);
  } catch (e) {
    console.error(e);
  }

  app.post('/api/feedback', auth, (req, res) => {
    const body = (req.body ?? {}) as {
      category?: unknown;
      message?: unknown;
      screenshots?: unknown;
      context?: unknown;
    };
    if (body.category !== 'platform design' && body.category !== 'homework content') {
      res.status(400).json({ error: 'category must be "platform design" or "homework content"' });
      return;
    }
    if (typeof body.message !== 'string' || body.message.trim() === '') {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (body.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
      res.status(400).json({ error: `message must be under ${MAX_FEEDBACK_MESSAGE_LENGTH} characters` });
      return;
    }
    const screenshots = body.screenshots;
    if (screenshots !== undefined && !Array.isArray(screenshots)) {
      res.status(400).json({ error: 'screenshots must be an array' });
      return;
    }
    const shots = (screenshots ?? []) as unknown[];
    if (shots.length > MAX_FEEDBACK_SCREENSHOTS) {
      res.status(400).json({ error: `at most ${MAX_FEEDBACK_SCREENSHOTS} screenshots` });
      return;
    }
    for (const shot of shots) {
      if (
        typeof shot !== 'object' ||
        shot === null ||
        typeof (shot as { dataUrl?: unknown }).dataUrl !== 'string' ||
        !/^data:image\/(png|jpe?g|webp);base64,/.test((shot as { dataUrl: string }).dataUrl)
      ) {
        res.status(400).json({ error: 'each screenshot must be a PNG/JPEG/WEBP data URL' });
        return;
      }
      if ((shot as { dataUrl: string }).dataUrl.length > MAX_SCREENSHOT_DATA_URL_LENGTH) {
        res.status(413).json({ error: 'a screenshot is too large' });
        return;
      }
    }
    const context = body.context as { assignmentId?: unknown; questionId?: unknown } | undefined;
    const cleanContext =
      context && (typeof context.assignmentId === 'string' || typeof context.questionId === 'number')
        ? {
            assignmentId: typeof context.assignmentId === 'string' ? context.assignmentId : undefined,
            questionId: typeof context.questionId === 'number' ? context.questionId : undefined,
          }
        : undefined;
    const feedback = db.addFeedback({
      email: req.user!.email,
      authorRole: req.user!.role,
      category: body.category,
      message: body.message.trim(),
      screenshots: shots as { dataUrl: string; filename?: string }[],
      context: cleanContext,
    });
    res.status(201).json({ feedback });
  });

  const TRIAGE_OUTCOMES: readonly FeedbackTriageOutcome[] = ['filed', 'personal', 'dismissed', 'review'];
  const isTriageOutcome = (v: unknown): v is FeedbackTriageOutcome => TRIAGE_OUTCOMES.includes(v as FeedbackTriageOutcome);

  app.get('/api/feedback', auth, requireInstructor, (req, res) => {
    const { status, triaged, triage } = req.query;
    if (status !== undefined && status !== 'open' && status !== 'resolved') {
      res.status(400).json({ error: 'status must be "open" or "resolved"' });
      return;
    }
    if (triaged !== undefined && triaged !== 'true' && triaged !== 'false') {
      res.status(400).json({ error: 'triaged must be "true" or "false"' });
      return;
    }
    if (triage !== undefined && !isTriageOutcome(triage)) {
      res.status(400).json({ error: `triage must be one of ${TRIAGE_OUTCOMES.join(', ')}` });
      return;
    }
    const feedback = db.listFeedback({
      status,
      triaged: triaged === undefined ? undefined : triaged === 'true',
    });
    // ?triage=review is what `feedback.mjs list --review` asks for (task 029).
    res.json({ feedback: triage === undefined ? feedback : feedback.filter((f) => f.triage?.outcome === triage) });
  });

  // One report, mark and status (listFeedback is the db's one reader).
  const findFeedback = (id: string) => db.listFeedback().find((f) => f.id === id);

  app.put('/api/feedback/:id/status', auth, requireInstructor, (req, res) => {
    const status = (req.body ?? {}).status;
    if (status !== 'open' && status !== 'resolved') {
      res.status(400).json({ error: 'status must be "open" or "resolved"' });
      return;
    }
    const id = String(req.params.id);
    const before = findFeedback(id);
    if (!db.setFeedbackStatus(id, status)) {
      res.status(404).json({ error: 'unknown feedback id' });
      return;
    }
    // Reopening a report the pipeline resolved (task 086): the stamp notes it,
    // so the pipeline's resolve stops standing — the tab stops crediting it.
    const reopened = before ? reopenedMark(before, status, new Date().toISOString()) : null;
    if (reopened) db.setFeedbackTriage(id, reopened);
    res.json({ ok: true });
  });

  // The task pipeline's mark (task 018), set by `tasks/tools/feedback.mjs
  // mark` from the instructor's machine once the catcher has processed a
  // report. A mark that closes the report resolves it too (task 086):
  // `dismissed` at once, `filed` when its tasks are already live (else the
  // boot after their release does). Once per report: a re-mark keeps the
  // server's earlier `autoResolved` stamp, so a reopen sticks; the body's own
  // is never read. `{clear: true}` drops the mark, stamp and all, and undoes
  // a resolve of the pipeline's that still stands (it reopens the report, so
  // the next pull fetches it again). The reply's `status` is the report's now.
  const MAX_TRIAGE_TASKS = 10;
  const MAX_TRIAGE_NOTE_LENGTH = 300;

  app.put('/api/feedback/:id/triage', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { outcome?: unknown; tasks?: unknown; note?: unknown; clear?: unknown };
    const id = String(req.params.id);
    const before = findFeedback(id);
    let triage: FeedbackTriage | null;
    if (body.clear === true) {
      triage = null;
    } else {
      const { outcome, tasks, note } = body;
      if (!isTriageOutcome(outcome)) {
        res.status(400).json({ error: 'outcome must be "filed", "personal", "dismissed" or "review" (or send {clear: true})' });
        return;
      }
      if (note !== undefined && (typeof note !== 'string' || note.length > MAX_TRIAGE_NOTE_LENGTH)) {
        res.status(400).json({ error: `note must be a string under ${MAX_TRIAGE_NOTE_LENGTH} characters` });
        return;
      }
      const cleanNote = typeof note === 'string' && note.trim() !== '' ? note.trim() : undefined;
      if (outcome === 'filed') {
        if (
          !Array.isArray(tasks) ||
          tasks.length === 0 ||
          tasks.length > MAX_TRIAGE_TASKS ||
          !tasks.every((t) => typeof t === 'string' && TASK_ID.test(t))
        ) {
          res.status(400).json({ error: 'a filed report names 1–10 task ids like 2026-09-24-040' });
          return;
        }
      } else if (tasks !== undefined) {
        res.status(400).json({ error: 'only a filed report names tasks' });
        return;
      }
      if (outcome === 'dismissed' && !cleanNote) {
        res.status(400).json({ error: 'a dismissed report needs a note saying why' });
        return;
      }
      const prior = before?.triage;
      triage = {
        outcome,
        ...(outcome === 'filed' ? { tasks: [...new Set(tasks as string[])] } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
        at: new Date().toISOString(),
        ...(prior?.autoResolved ? { autoResolved: prior.autoResolved } : {}),
      };
    }
    // Clearing the mark that resolved it undoes the resolve too: reopen first
    // (a crash between leaves it open and stamped, never resolved, unmarked).
    const reopened = triage === null && before !== undefined && autoResolveStands(before);
    if (reopened) db.setFeedbackStatus(id, 'open');
    if (!db.setFeedbackTriage(id, triage)) {
      res.status(404).json({ error: 'unknown feedback id' });
      return;
    }
    let resolved: AutoResolve | undefined;
    try {
      [resolved] = triage ? autoResolveFeedback(db, liveDone, id) : [];
    } catch (e) {
      console.error(e);
    }
    res.json({
      ok: true,
      triage: resolved?.triage ?? triage,
      resolved: resolved !== undefined,
      reopened,
      status: resolved ? 'resolved' : reopened ? 'open' : before?.status,
    });
  });

  // ── instructor notes (notes/todos.md item 12) ───────────────────
  // One shared markdown document; instructor-only, both to read and to save.
  app.get('/api/instructor-notes', auth, requireInstructor, (_req, res) => {
    res.json({ note: db.getInstructorNote() });
  });

  app.put('/api/instructor-notes', auth, requireInstructor, (req, res) => {
    const content = (req.body ?? {}).content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'body must be {content: string}' });
      return;
    }
    const note = db.saveInstructorNote(content, req.user!.name);
    res.json({ note });
  });

  // ── the robot's state (task 083) ────────────────────────────────
  // Instructor-only, like the Feedback tab. The git and CI facts are cached
  // per app (src/robotStatus.ts); the assignments, the feedback queue, the
  // gate's verdict and the view are this request's. The only input is
  // `?refresh=1`, and it reaches no child process. Every failure is a section
  // that says "unknown: <why>" — this route answers 200.
  const robotSource = createRobotStatusSource({
    repoDir: repoDirFor(config.repoDir),
    mirrorDir: mirrorDirFor(config.dbPath, config.repoMirror),
    backupDir: backupDirFor(config.dbPath, config.backupDir),
  });

  app.get('/api/robot/status', auth, requireInstructor, async (req, res) => {
    const now = new Date();
    try {
      const facts = await robotSource.get(req.query.refresh === '1');
      // The assignments as the gate's pilot probe shapes them (release-gate.mjs
      // listPilotAssignments): published? due when?
      let assignments: GateFactsLike['assignments'] = null;
      try {
        const visible = db.listVisible();
        assignments = db.listAssignments().map((a) => ({
          id: a.id,
          title: a.title,
          visible: visible.get(a.id) ?? false,
          ...(a.dueDate ? { dueDate: a.dueDate } : {}),
        }));
      } catch {
        // the gate waits on "cannot read due dates"
      }
      const gateFacts = gateFactsFor(facts, assignments, now);
      let gate = null;
      try {
        gate = gateFacts ? decide(gateFacts) : null;
      } catch (e) {
        console.error(e);
      }
      let feedback = null;
      try {
        feedback = db.listFeedback({ status: 'open' });
      } catch {
        // review: unknown
      }
      res.json(robotStatusView(facts, gate, feedback));
    } catch (e) {
      console.error(e);
      res.json(robotStatusUnknown("the robot's state could not be read", now));
    }
  });

  // ── errors ─────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Body-parser errors (bad JSON, too large) and anything a route threw.
    const status =
      typeof err === 'object' && err && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : 'bad request' });
  });

  return app;
}
