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
//   POST   /api/assignments/:id/submissions/:attempt/review
//                                              instructor: manual verdict on a pending
//                                              open question — {student, questionId,
//                                              pass, note?} → updated record
//   POST   /api/feedback                       any signed-in user: file a platform/homework
//                                              report, screenshots as base64 data URLs
//   GET    /api/feedback                       instructor: the queue, newest first;
//                                              ?status=open|resolved, ?triaged=true|false
//   PUT    /api/feedback/:id/status            instructor: {status: 'open'|'resolved'}
//   PUT    /api/feedback/:id/triage            instructor: what the task pipeline made of
//                                              it — {outcome, tasks?, note?} | {clear: true}
//   GET    /api/instructor-notes               instructor: the one shared markdown note
//   PUT    /api/instructor-notes               instructor: {content: string} → saves it
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
import type { AssignmentData, AssignmentState, FeedbackTriage, SubmissionData } from '../../app/src/types';
import { gradeSubmission } from '../../app/src/engine/grader';
import { applyManualReview } from '../../app/src/storage/manualReview';
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
      .map((a) => ({
        id: a.id,
        title: a.title,
        questionCount: a.questions.length,
        gradesReleased: released.get(a.id) ?? false,
        visible: visible.get(a.id) ?? false,
        dueDate: a.dueDate,
        order: a.order,
      }));
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
      assignment: isInstructor ? assignment : stripAnswers(assignment),
      gradesReleased: db.getGradesReleased(assignment.id),
      visible: db.getVisible(assignment.id),
    });
  });

  app.put('/api/assignments/:id', auth, requireInstructor, (req, res) => {
    const assignment = req.body as AssignmentData;
    if (
      !assignment ||
      assignment.id !== String(req.params.id) ||
      typeof assignment.title !== 'string' ||
      !Array.isArray(assignment.questions)
    ) {
      res.status(400).json({ error: 'malformed assignment (id must match URL)' });
      return;
    }
    db.saveAssignment(assignment);
    res.json({ ok: true });
  });

  app.delete('/api/assignments/:id', auth, requireInstructor, (req, res) => {
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
    // Identity and timestamp are the server's word, not the client's.
    const submission: SubmissionData = {
      assignmentTitle: assignment.title,
      student: req.user!.email,
      submittedAt: new Date().toISOString(),
      answers: body.answers,
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
    const record = db.addSubmission(assignment.id, email, submission, result, integrity);
    // The grade is computed and stored NOW, but students don't see it until
    // the instructor releases grades — and even then, scores only.
    res.status(201).json({
      record:
        req.user!.role === 'instructor'
          ? record
          : studentRecord(record, db.getGradesReleased(assignment.id), assignment),
    });
  });

  // The caller's OWN attempts, for every role (task 037): an instructor's
  // Student view is a student-side read, so it sees only the instructor's
  // own attempts. Everyone's is the gradebook's route below.
  app.get('/api/assignments/:id/submissions', auth, (req, res) => {
    const own = db.listSubmissions(String(req.params.id), req.user!.email);
    if (req.user!.role === 'instructor') {
      res.json({ records: own });
      return;
    }
    const released = db.getGradesReleased(String(req.params.id));
    // The full assignment fills older results' case separations (sanitize.ts).
    const assignment = db.getAssignment(String(req.params.id)) ?? undefined;
    res.json({ records: own.map((r) => studentRecord(r, released, assignment)) });
  });

  app.get('/api/assignments/:id/submissions/all', auth, requireInstructor, (req, res) => {
    res.json({ records: db.listSubmissions(String(req.params.id)) });
  });

  // ── manual review (instructor) ─────────────────────────────────
  // Record (or overwrite) the instructor's verdict on a pending open question
  // of one stored attempt, via the SAME pure `applyManualReview` the local
  // SubmissionStore uses (app/src/storage/manualReview.ts) — the server is the
  // other implementation of one contract, not a mirror. `student` rides in the
  // body because attempt numbers count per (assignment, student). The server
  // stamps `reviewedAt` (its word, like submission timestamps); the verdict
  // lands on the stored record's `result` and reaches students only through
  // the release gate + `studentRecord` sanitization like any other grade.
  app.post('/api/assignments/:id/submissions/:attempt/review', auth, requireInstructor, (req, res) => {
    const assignmentId = String(req.params.id);
    if (!db.getAssignment(assignmentId)) {
      res.status(404).json({ error: 'unknown assignment' });
      return;
    }
    const attempt = Number(req.params.attempt);
    const body = (req.body ?? {}) as {
      student?: unknown;
      questionId?: unknown;
      pass?: unknown;
      note?: unknown;
    };
    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      typeof body.student !== 'string' ||
      body.student.length === 0 ||
      typeof body.questionId !== 'number' ||
      typeof body.pass !== 'boolean' ||
      (body.note !== undefined && typeof body.note !== 'string')
    ) {
      res.status(400).json({ error: 'body must be {student, questionId, pass, note?}' });
      return;
    }
    const email = body.student.toLowerCase();
    const records = db.listSubmissions(assignmentId, email);
    const updated = applyManualReview(records, attempt, body.questionId, {
      pass: body.pass,
      note: body.note?.trim() || undefined,
      reviewedAt: new Date().toISOString(),
    });
    if (!updated) {
      res.status(404).json({ error: 'no pending open question for that attempt' });
      return;
    }
    const record = updated.find((r) => r.attempt === attempt)!;
    db.updateSubmissionResult(assignmentId, email, attempt, record.result!);
    res.status(201).json({ record });
  });

  // ── feedback (notes/todos.md item 9) ────────────────────────────
  // Anyone signed in can file a report; only an instructor can see or work
  // the queue. Screenshots ride as base64 data URLs inside the JSON body —
  // no upload endpoint, no multer, no filesystem — capped here so the shared
  // express.json({limit:'10mb'}) body-size cap isn't the only backstop.
  const MAX_FEEDBACK_SCREENSHOTS = 2;
  const MAX_SCREENSHOT_DATA_URL_LENGTH = 4_500_000; // ~3.3MB decoded
  const MAX_FEEDBACK_MESSAGE_LENGTH = 5000;

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

  app.get('/api/feedback', auth, requireInstructor, (req, res) => {
    const { status, triaged } = req.query;
    if (status !== undefined && status !== 'open' && status !== 'resolved') {
      res.status(400).json({ error: 'status must be "open" or "resolved"' });
      return;
    }
    if (triaged !== undefined && triaged !== 'true' && triaged !== 'false') {
      res.status(400).json({ error: 'triaged must be "true" or "false"' });
      return;
    }
    res.json({
      feedback: db.listFeedback({
        status,
        triaged: triaged === undefined ? undefined : triaged === 'true',
      }),
    });
  });

  app.put('/api/feedback/:id/status', auth, requireInstructor, (req, res) => {
    const status = (req.body ?? {}).status;
    if (status !== 'open' && status !== 'resolved') {
      res.status(400).json({ error: 'status must be "open" or "resolved"' });
      return;
    }
    if (!db.setFeedbackStatus(String(req.params.id), status)) {
      res.status(404).json({ error: 'unknown feedback id' });
      return;
    }
    res.json({ ok: true });
  });

  // The task pipeline's mark (task 018), set by `tasks/tools/feedback.mjs
  // mark` from the instructor's machine once the catcher has processed a
  // report. It never touches `status`: resolving stays the instructor's act.
  const TASK_ID = /^\d{4}-\d{2}-\d{2}-\d{3}$/;
  const MAX_TRIAGE_TASKS = 10;
  const MAX_TRIAGE_NOTE_LENGTH = 300;

  app.put('/api/feedback/:id/triage', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as { outcome?: unknown; tasks?: unknown; note?: unknown; clear?: unknown };
    let triage: FeedbackTriage | null;
    if (body.clear === true) {
      triage = null;
    } else {
      const { outcome, tasks, note } = body;
      if (outcome !== 'filed' && outcome !== 'personal' && outcome !== 'dismissed') {
        res.status(400).json({ error: 'outcome must be "filed", "personal" or "dismissed" (or send {clear: true})' });
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
      triage = {
        outcome,
        ...(outcome === 'filed' ? { tasks: [...new Set(tasks as string[])] } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
        at: new Date().toISOString(),
      };
    }
    if (!db.setFeedbackTriage(String(req.params.id), triage)) {
      res.status(404).json({ error: 'unknown feedback id' });
      return;
    }
    res.json({ ok: true, triage });
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
