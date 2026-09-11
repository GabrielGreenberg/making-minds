// The Express app — every endpoint the productized platform needs, mirroring
// the client's seams one-to-one:
//
//   GET    /api/auth/config                    unauthenticated: what the login screen offers
//   POST   /api/auth/login                     email (+ password) → bearer token
//   POST   /api/auth/register                  roster member creates their account
//   POST   /api/auth/password                  change own password
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   POST   /api/auth/access-requests           unauthenticated: "my email isn't on the roster"
//   GET    /api/roster                         instructor: roster + account state
//   POST   /api/roster/import                  instructor: {csv, defaultRole?} → upsert
//   POST   /api/roster                         instructor: add one person
//   DELETE /api/roster/:email                  instructor: remove from the roster
//   POST   /api/roster/:email/reset-password   instructor: clear the credential + sessions
//   GET    /api/access-requests                instructor: pending/all requests
//   POST   /api/access-requests/:id/approve    instructor: add to roster, mark approved
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
//   GET    /api/workbooks/:assignmentId        the caller's saved canvas state
//   PUT    /api/workbooks/:assignmentId        autosave target
//   POST   /api/assignments/:id/submissions    submit → server autogrades → record
//   GET    /api/assignments/:id/submissions    student: own attempts (no grades until
//                                              released, then scores only);
//                                              instructor: all attempts, full detail
//   POST   /api/assignments/:id/submissions/:attempt/review
//                                              instructor: manual verdict on a pending
//                                              open question — {student, questionId,
//                                              pass, note?} → updated record
//   GET    /api/health                         unauthenticated liveness probe
//
// Grading happens HERE, with the same pure engine the browser uses
// (app/src/engine/grader.ts) — the server holds the test cases, the client
// never sees them. Exported as a factory (no listen()) so the smoke test can
// boot it on an ephemeral port against a temp database.

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AssignmentData, AssignmentState, SubmissionData } from '../../app/src/types';
import { gradeSubmission } from '../../app/src/engine/grader';
import { applyManualReview } from '../../app/src/storage/manualReview';
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
import { isEmail, normalizeEmail, parseRoster } from './roster';
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

  const auth = requireAuth(db);
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
    const wait = throttle.retryAfter(email, ip);
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
      throttle.recordFailure(email, ip);
      // One message for every failure: an unknown email, an email with no
      // account yet, and a wrong password are indistinguishable to the caller,
      // so the endpoint can't be used to enumerate the roster.
      res.status(401).json({ error: 'incorrect email or password' });
      return;
    }
    throttle.recordSuccess(email, ip);
    const token = issueSession(db, user, config.sessionTtlSeconds);
    res.json({ token, user });
  });

  // Create an account for someone the roster already contains. On success the
  // caller is signed straight in — one step, not register-then-log-in.
  app.post('/api/auth/register', async (req, res) => {
    // Throttled like sign-in: when the roster carries student IDs, registration
    // takes one, and an unthrottled endpoint would let someone guess a
    // classmate's ID and claim their seat.
    const ip = clientIp(req);
    const email = normalizeEmail((req.body ?? {}).email);
    const wait = throttle.retryAfter(email, ip);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: 'too many attempts — wait a few minutes and try again', retryAfter: wait });
      return;
    }
    const result = await authProvider.register(req.body ?? {});
    if (!result.ok) {
      if (result.reason === 'id-mismatch' || result.reason === 'not-on-roster') {
        throttle.recordFailure(email, ip);
      }
      // 403 you may not have an account here · 409 the account's state says no
      // · 400 the request itself is bad.
      const status =
        result.reason === 'not-on-roster'
          ? 403
          : result.reason === 'already-registered' || result.reason === 'id-mismatch'
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
    const known = db.getUser(email) != null;
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

  /** Upsert roster entries; returns what changed so the UI can report it. */
  function applyRoster(
    entries: { email: string; name: string; studentId: string; role: 'student' | 'instructor' }[],
  ) {
    let added = 0;
    let updated = 0;
    for (const entry of entries) {
      if (db.getUser(entry.email)) updated++;
      else added++;
      db.upsertUser(entry);
    }
    return { added, updated };
  }

  app.post('/api/roster/import', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.csv !== 'string' || body.csv.trim() === '') {
      res.status(400).json({ error: 'body must be {csv: string}' });
      return;
    }
    const defaultRole = body.defaultRole === 'instructor' ? 'instructor' : 'student';
    const parsed = parseRoster(body.csv, defaultRole);
    // Re-importing never removes anyone and never touches a password: a
    // mid-quarter roster refresh must not delete a student's work or sign them
    // out. Removal is the explicit DELETE below.
    const { added, updated } = applyRoster(parsed.entries);
    res.json({
      added,
      updated,
      total: parsed.entries.length,
      issues: parsed.issues,
      columns: parsed.columns,
    });
  });

  app.post('/api/roster', auth, requireInstructor, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    if (!email || !isEmail(email)) {
      res.status(400).json({ error: 'enter a valid email address' });
      return;
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : email.split('@')[0];
    const role = body.role === 'instructor' ? 'instructor' : 'student';
    const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
    const existed = db.getUser(email) != null;
    db.upsertUser({ email, name, role, studentId });
    res.json({ ok: true, added: existed ? 0 : 1, updated: existed ? 1 : 0 });
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

  // Forgotten password, with no mail server in the loop: the instructor clears
  // the credential and the student creates their account again, same email.
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
    res.json({ requests: db.listAccessRequests(filter) });
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
    // same way everyone else does.
    db.upsertUser({
      email: request.email,
      name: request.name,
      role,
      studentId: request.studentId,
    });
    db.resolveAccessRequest(id, 'approved', req.user!.email);
    res.json({ ok: true, email: request.email });
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
    const state = db.getWorkbook(req.user!.email, String(req.params.assignmentId));
    res.json({ state });
  });

  app.put('/api/workbooks/:assignmentId', auth, (req, res) => {
    const state = req.body as AssignmentState;
    if (!state || typeof state.currentQuestionIndex !== 'number' || !state.questionCircuits) {
      res.status(400).json({ error: 'malformed workbook state' });
      return;
    }
    db.saveWorkbook(req.user!.email, String(req.params.assignmentId), state);
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
    const record = db.addSubmission(assignment.id, req.user!.email, submission, result);
    // The grade is computed and stored NOW, but students don't see it until
    // the instructor releases grades — and even then, scores only.
    res.status(201).json({
      record:
        req.user!.role === 'instructor'
          ? record
          : studentRecord(record, db.getGradesReleased(assignment.id)),
    });
  });

  app.get('/api/assignments/:id/submissions', auth, (req, res) => {
    if (req.user!.role === 'instructor') {
      res.json({ records: db.listSubmissions(String(req.params.id)) });
      return;
    }
    const released = db.getGradesReleased(String(req.params.id));
    const own = db.listSubmissions(String(req.params.id), req.user!.email);
    res.json({ records: own.map((r) => studentRecord(r, released)) });
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
