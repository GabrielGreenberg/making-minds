// The Express app — every endpoint the productized platform needs, mirroring
// the client's seams one-to-one:
//
//   POST   /api/auth/login                     dev login (roster email) → bearer token
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   GET    /api/assignments                    summaries (any logged-in user)
//   GET    /api/assignments/:id                student: answers stripped; instructor: full
//   PUT    /api/assignments/:id                instructor: create/update
//   DELETE /api/assignments/:id                instructor
//   GET    /api/workbooks/:assignmentId        the caller's saved canvas state
//   PUT    /api/workbooks/:assignmentId        autosave target
//   POST   /api/assignments/:id/submissions    submit → server autogrades → record
//   GET    /api/assignments/:id/submissions    student: own attempts (scores only);
//                                              instructor: all attempts, full detail
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
import type { ServerConfig } from './config';
import { Db } from './db';
import {
  DevAuthProvider,
  issueSession,
  bearerToken,
  requireAuth,
  requireInstructor,
  type AuthProvider,
} from './auth';
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

  const authProvider: AuthProvider = new DevAuthProvider(db);
  // MM_AUTH_MODE=sso: swap in the SSO provider here once UCLA SSO exists.
  if (config.authMode === 'sso') {
    throw new Error('MM_AUTH_MODE=sso is not implemented yet (waiting on UCLA SSO details)');
  }

  const auth = requireAuth(db);

  // ── health ─────────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ── auth ───────────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    const user = await authProvider.authenticate(req.body ?? {});
    if (!user) {
      res.status(401).json({ error: 'unknown account' });
      return;
    }
    const token = issueSession(db, user, config.sessionTtlSeconds);
    res.json({ token, user });
  });

  app.post('/api/auth/logout', auth, (req, res) => {
    const token = bearerToken(req);
    if (token) db.deleteSession(token);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', auth, (req, res) => {
    res.json({ user: req.user });
  });

  // ── assignments ────────────────────────────────────────────────
  app.get('/api/assignments', auth, (_req, res) => {
    const summaries = db
      .listAssignments()
      .map((a) => ({ id: a.id, title: a.title, questionCount: a.questions.length }));
    res.json({ assignments: summaries });
  });

  app.get('/api/assignments/:id', auth, (req, res) => {
    const assignment = db.getAssignment(String(req.params.id));
    if (!assignment) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      assignment: req.user!.role === 'instructor' ? assignment : stripAnswers(assignment),
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
    // Students get their scores, never the per-case answer detail.
    res.status(201).json({
      record: req.user!.role === 'instructor' ? record : studentRecord(record),
    });
  });

  app.get('/api/assignments/:id/submissions', auth, (req, res) => {
    if (req.user!.role === 'instructor') {
      res.json({ records: db.listSubmissions(String(req.params.id)) });
      return;
    }
    const own = db.listSubmissions(String(req.params.id), req.user!.email);
    res.json({ records: own.map(studentRecord) });
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
