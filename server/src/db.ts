// SQLite persistence for the API server, via the Node built-in `node:sqlite`
// (no native npm deps — nothing to compile on the Lightsail box; requires
// Node >= 22.5). One synchronous connection per process is plenty for a
// course-sized load (~80 students), and SQLite gives us durable, transactional
// storage on a single box with trivial backup (copy one file).
//
// JSON-heavy tables mirror the client seams one-to-one:
//   users        — the roster + local credentials (see src/auth.ts; SSO will upsert)
//   sessions     — bearer tokens
//   access_requests — people who want an account under an email the roster
//                  does not have; an instructor approves or rejects each one
//   assignments  — full AssignmentData JSON (INCLUDING test_cases — server-only;
//                  the API strips answers before sending to students)
//   workbooks    — per-(user, assignment) saved canvas state (WorkbookStore seam)
//   submissions  — immutable graded attempts (SubmissionStore seam)
//   feedback     — student reports on the platform/homeworks, an instructor's
//                  queue (FeedbackStore seam); screenshots ride as base64 in
//                  the JSON `screenshots` column, capped client- and
//                  server-side — see app.ts's POST /api/feedback
//   instructor_notes — ONE shared markdown note (NotesStore seam); a single
//                  row, id pinned to 1 by a CHECK constraint

import { DatabaseSync } from 'node:sqlite';
import type {
  AssignmentData,
  AssignmentState,
  FeedbackCategory,
  FeedbackScreenshot,
  FeedbackStatus,
  InstructorNote,
  PlatformFeedback,
  SubmissionData,
  SubmissionRecord,
  SubmissionResult,
} from '../../app/src/types';
import type { Role } from '../../app/src/auth/accounts';

export interface UserRow {
  email: string;
  name: string;
  role: Role;
  /** Campus ID from the roster CSV; '' when the import had no ID column. */
  studentId?: string;
  /** Discussion section from the class list; absent/null leaves a stored one. */
  section?: string | null;
  /** "Last, First" sort key from the class list; null sorts by name. */
  sortName?: string | null;
  /** True once the person has created an account (set a password). */
  registered?: boolean;
}

/** A roster row plus its account state — the instructor's roster view.
 *  Instructor-only: `section` never reaches a student (getUser omits it). */
export interface RosterRow extends UserRow {
  studentId: string;
  section: string | null;
  registered: boolean;
  registeredAt: string | null;
}

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

/** A "my email is not on the roster" request, awaiting an instructor. */
export interface AccessRequestRow {
  id: number;
  email: string;
  name: string;
  studentId: string;
  message: string;
  status: AccessRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export class Db {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name  TEXT NOT NULL,
        role  TEXT NOT NULL CHECK (role IN ('student', 'instructor'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbooks (
        email         TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        state         TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (email, assignment_id)
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id TEXT NOT NULL,
        email         TEXT NOT NULL,
        attempt       INTEGER NOT NULL,
        submitted_at  TEXT NOT NULL,
        submission    TEXT NOT NULL,
        result        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_submissions_asg
        ON submissions (assignment_id, email, attempt);
      CREATE TABLE IF NOT EXISTS access_requests (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT NOT NULL,
        name        TEXT NOT NULL,
        student_id  TEXT NOT NULL DEFAULT '',
        message     TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at  TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_access_requests_email
        ON access_requests (email);
      CREATE TABLE IF NOT EXISTS feedback (
        id          TEXT PRIMARY KEY,
        email       TEXT NOT NULL,
        category    TEXT NOT NULL CHECK (category IN ('platform design', 'homework content')),
        message     TEXT NOT NULL,
        screenshots TEXT NOT NULL DEFAULT '[]',
        context     TEXT,
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_status
        ON feedback (status, created_at);
      -- Every homework content version the repo sync wrote (server/src/homeworks.ts):
      -- a copy still equal to one of them is untouched since, so it may refresh.
      CREATE TABLE IF NOT EXISTS content_sync (
        assignment_id TEXT NOT NULL,
        hash          TEXT NOT NULL,
        synced_at     TEXT NOT NULL,
        PRIMARY KEY (assignment_id, hash)
      );
      CREATE TABLE IF NOT EXISTS instructor_notes (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        content    TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
    `);
    // Columns added after the initial schema; ALTER is a no-op error on re-run.
    for (const sql of [
      'ALTER TABLE assignments ADD COLUMN grades_released INTEGER NOT NULL DEFAULT 0;',
      // Assignments are HIDDEN until the instructor publishes them, so the
      // column defaults to 0 — including for any row that predates it.
      'ALTER TABLE assignments ADD COLUMN student_visible INTEGER NOT NULL DEFAULT 0;',
      // Local accounts: the roster carries the campus ID, and a person who has
      // created an account carries a credential. NULL password_hash = on the
      // roster but no account yet (and, for the dev provider, irrelevant).
      "ALTER TABLE users ADD COLUMN student_id TEXT NOT NULL DEFAULT '';",
      'ALTER TABLE users ADD COLUMN password_hash TEXT;',
      'ALTER TABLE users ADD COLUMN registered_at TEXT;',
      // From the registrar's class list (task 035): the discussion section and
      // a "Last, First" sort key. Nothing else from that file is stored.
      'ALTER TABLE users ADD COLUMN section TEXT;',
      'ALTER TABLE users ADD COLUMN sort_name TEXT;',
    ]) {
      try {
        this.db.exec(sql);
      } catch {
        // already present
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ── users ──────────────────────────────────────────────────────

  /**
   * Create or update a roster row. Deliberately does NOT touch the credential:
   * re-importing the roster mid-quarter must not log everybody out or wipe the
   * passwords they already chose. Name/role/studentId are the roster's word,
   * except that a blank incoming studentId leaves an existing one alone, and so
   * does a missing section (a re-import without a Section column keeps it).
   * The sort key follows the name: a caller that keeps the name and sends no
   * key (the CLI's `add`) keeps the stored one; a new name drops a stale one.
   */
  upsertUser(user: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO users (email, name, role, student_id, section, sort_name) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           role = excluded.role,
           student_id = CASE WHEN excluded.student_id = '' THEN users.student_id
                             ELSE excluded.student_id END,
           section = COALESCE(excluded.section, users.section),
           sort_name = CASE WHEN excluded.name = users.name
                            THEN COALESCE(excluded.sort_name, users.sort_name)
                            ELSE excluded.sort_name END`,
      )
      .run(user.email, user.name, user.role, user.studentId ?? '', user.section ?? null, user.sortName ?? null);
  }

  getUser(email: string): UserRow | null {
    const row = this.db
      .prepare('SELECT email, name, role, student_id, password_hash FROM users WHERE email = ?')
      .get(email) as unknown as
      | { email: string; name: string; role: Role; student_id: string; password_hash: string | null }
      | undefined;
    if (!row) return null;
    return {
      email: row.email,
      name: row.name,
      role: row.role,
      studentId: row.student_id ?? '',
      registered: row.password_hash != null,
    };
  }

  /** The stored credential, or null when the account has no password yet. */
  getPasswordHash(email: string): string | null {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email) as
      | unknown as { password_hash: string | null } | undefined;
    return row?.password_hash ?? null;
  }

  /** Set (or, with null, clear) a credential. Clearing re-opens registration. */
  setPasswordHash(email: string, hash: string | null): void {
    this.db
      .prepare('UPDATE users SET password_hash = ?, registered_at = ? WHERE email = ?')
      .run(hash, hash ? new Date().toISOString() : null, email);
  }

  /** The full roster with account state, for the instructor's roster view:
   *  students first (role DESC), then by surname where the class list gave one. */
  listUsers(): RosterRow[] {
    const rows = this.db
      .prepare(
        `SELECT email, name, role, student_id, section, password_hash, registered_at
         FROM users ORDER BY role DESC, COALESCE(sort_name, name) COLLATE NOCASE`,
      )
      .all() as unknown as {
      email: string;
      name: string;
      role: Role;
      student_id: string;
      section: string | null;
      password_hash: string | null;
      registered_at: string | null;
    }[];
    return rows.map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role,
      studentId: r.student_id ?? '',
      section: r.section ?? null,
      registered: r.password_hash != null,
      registeredAt: r.registered_at ?? null,
    }));
  }

  /** Remove a roster row (cascades to its sessions). Work is left in place. */
  removeUser(email: string): void {
    this.db.prepare('DELETE FROM users WHERE email = ?').run(email);
  }

  // ── sessions ───────────────────────────────────────────────────

  createSession(token: string, email: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)')
      .run(token, email, expiresAt);
  }

  /** Resolve a bearer token to its user; expired sessions are deleted lazily. */
  getSessionUser(token: string): UserRow | null {
    const row = this.db
      .prepare(
        `SELECT u.email, u.name, u.role, u.student_id, u.password_hash, s.expires_at
         FROM sessions s JOIN users u ON u.email = s.email WHERE s.token = ?`,
      )
      .get(token) as unknown as
      | {
          email: string;
          name: string;
          role: Role;
          student_id: string;
          password_hash: string | null;
          expires_at: string;
        }
      | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.deleteSession(token);
      return null;
    }
    return {
      email: row.email,
      name: row.name,
      role: row.role,
      studentId: row.student_id ?? '',
      registered: row.password_hash != null,
    };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /**
   * End every session belonging to one account — used when an instructor
   * resets a password, so a stolen or stale session can't outlive the reset.
   */
  deleteSessionsFor(email: string): void {
    this.db.prepare('DELETE FROM sessions WHERE email = ?').run(email);
  }

  // ── access requests ────────────────────────────────────────────

  /** File a request for an account under an off-roster email. */
  addAccessRequest(input: {
    email: string;
    name: string;
    studentId: string;
    message: string;
  }): AccessRequestRow {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO access_requests (email, name, student_id, message, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(input.email, input.name, input.studentId, input.message, createdAt);
    const row = this.db
      .prepare('SELECT id FROM access_requests WHERE email = ? ORDER BY id DESC LIMIT 1')
      .get(input.email) as unknown as { id: number };
    return {
      id: row.id,
      email: input.email,
      name: input.name,
      studentId: input.studentId,
      message: input.message,
      status: 'pending',
      createdAt,
      resolvedAt: null,
      resolvedBy: null,
    };
  }

  listAccessRequests(status?: AccessRequestStatus): AccessRequestRow[] {
    const sql = `SELECT id, email, name, student_id, message, status, created_at, resolved_at, resolved_by
                 FROM access_requests ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC`;
    const stmt = this.db.prepare(sql);
    const rows = (status ? stmt.all(status) : stmt.all()) as unknown as {
      id: number;
      email: string;
      name: string;
      student_id: string;
      message: string;
      status: AccessRequestStatus;
      created_at: string;
      resolved_at: string | null;
      resolved_by: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      studentId: r.student_id ?? '',
      message: r.message ?? '',
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    }));
  }

  getAccessRequest(id: number): AccessRequestRow | null {
    return this.listAccessRequests().find((r) => r.id === id) ?? null;
  }

  /** True when this email already has an unresolved request on file. */
  hasPendingAccessRequest(email: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM access_requests WHERE email = ? AND status = 'pending'")
      .get(email) as unknown as { hit: number } | undefined;
    return row != null;
  }

  resolveAccessRequest(id: number, status: AccessRequestStatus, resolvedBy: string): void {
    this.db
      .prepare('UPDATE access_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(status, new Date().toISOString(), resolvedBy, id);
  }

  // ── feedback ───────────────────────────────────────────────────

  addFeedback(input: {
    email: string;
    category: FeedbackCategory;
    message: string;
    screenshots: FeedbackScreenshot[];
    context?: { assignmentId?: string; questionId?: number };
  }): PlatformFeedback {
    const id = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO feedback (id, email, category, message, screenshots, context, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        id,
        input.email,
        input.category,
        input.message,
        JSON.stringify(input.screenshots),
        input.context ? JSON.stringify(input.context) : null,
        createdAt,
      );
    return {
      id,
      student: input.email,
      category: input.category,
      message: input.message,
      screenshots: input.screenshots,
      createdAt,
      status: 'open',
      context: input.context,
    };
  }

  listFeedback(): PlatformFeedback[] {
    const rows = this.db
      .prepare(
        'SELECT id, email, category, message, screenshots, context, status, created_at FROM feedback ORDER BY created_at DESC',
      )
      .all() as unknown as {
      id: string;
      email: string;
      category: FeedbackCategory;
      message: string;
      screenshots: string;
      context: string | null;
      status: FeedbackStatus;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      student: r.email,
      category: r.category,
      message: r.message,
      screenshots: JSON.parse(r.screenshots) as FeedbackScreenshot[],
      createdAt: r.created_at,
      status: r.status,
      context: r.context ? (JSON.parse(r.context) as { assignmentId?: string; questionId?: number }) : undefined,
    }));
  }

  setFeedbackStatus(id: string, status: FeedbackStatus): boolean {
    const result = this.db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id);
    return result.changes > 0;
  }

  // ── instructor notes ───────────────────────────────────────────

  getInstructorNote(): InstructorNote | null {
    const row = this.db
      .prepare('SELECT content, updated_at, updated_by FROM instructor_notes WHERE id = 1')
      .get() as unknown as { content: string; updated_at: string; updated_by: string } | undefined;
    return row ? { content: row.content, updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
  }

  saveInstructorNote(content: string, updatedBy: string): InstructorNote {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO instructor_notes (id, content, updated_at, updated_by) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(content, updatedAt, updatedBy);
    return { content, updatedAt, updatedBy };
  }

  // ── assignments ────────────────────────────────────────────────

  listAssignments(): AssignmentData[] {
    const rows = this.db
      .prepare('SELECT data FROM assignments ORDER BY updated_at')
      .all() as unknown as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AssignmentData);
  }

  getAssignment(id: string): AssignmentData | null {
    const row = this.db.prepare('SELECT data FROM assignments WHERE id = ?').get(id) as
      | unknown as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AssignmentData) : null;
  }

  saveAssignment(assignment: AssignmentData): void {
    this.db
      .prepare(
        `INSERT INTO assignments (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(assignment.id, JSON.stringify(assignment), new Date().toISOString());
  }

  /** Content hashes the homework sync has written for this assignment. */
  syncedHashes(id: string): Set<string> {
    const rows = this.db
      .prepare('SELECT hash FROM content_sync WHERE assignment_id = ?')
      .all(id) as { hash: string }[];
    return new Set(rows.map((r) => r.hash));
  }

  recordSync(id: string, hash: string): void {
    this.db
      .prepare(
        `INSERT INTO content_sync (assignment_id, hash, synced_at) VALUES (?, ?, ?)
         ON CONFLICT(assignment_id, hash) DO UPDATE SET synced_at = excluded.synced_at`,
      )
      .run(id, hash, new Date().toISOString());
  }

  removeAssignment(id: string): void {
    this.db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
  }

  // Grade release is a per-assignment flag OUTSIDE the AssignmentData JSON —
  // it's grading policy, not assignment content, and it must never ride along
  // to the client inside the assignment object.
  getGradesReleased(id: string): boolean {
    const row = this.db
      .prepare('SELECT grades_released FROM assignments WHERE id = ?')
      .get(id) as unknown as { grades_released: number } | undefined;
    return row ? row.grades_released !== 0 : false;
  }

  setGradesReleased(id: string, released: boolean): void {
    this.db
      .prepare('UPDATE assignments SET grades_released = ? WHERE id = ?')
      .run(released ? 1 : 0, id);
  }

  /** ids → released flag, for decorating assignment list summaries. */
  listGradesReleased(): Map<string, boolean> {
    const rows = this.db
      .prepare('SELECT id, grades_released FROM assignments')
      .all() as unknown as { id: string; grades_released: number }[];
    return new Map(rows.map((r) => [r.id, r.grades_released !== 0]));
  }

  // Student visibility — the same shape as grade release, and policy for the
  // same reason: whether an assignment is published is not part of its
  // content, and the server, not the client, decides who may see it.
  getVisible(id: string): boolean {
    const row = this.db
      .prepare('SELECT student_visible FROM assignments WHERE id = ?')
      .get(id) as unknown as { student_visible: number } | undefined;
    return row ? row.student_visible !== 0 : false;
  }

  setVisible(id: string, visible: boolean): void {
    this.db
      .prepare('UPDATE assignments SET student_visible = ? WHERE id = ?')
      .run(visible ? 1 : 0, id);
  }

  /** ids → visible flag, for decorating assignment list summaries. Absent
   *  from the map means hidden, matching the column default. */
  listVisible(): Map<string, boolean> {
    const rows = this.db
      .prepare('SELECT id, student_visible FROM assignments')
      .all() as unknown as { id: string; student_visible: number }[];
    return new Map(rows.map((r) => [r.id, r.student_visible !== 0]));
  }

  // ── workbooks ──────────────────────────────────────────────────

  getWorkbook(email: string, assignmentId: string): AssignmentState | null {
    const row = this.db
      .prepare('SELECT state FROM workbooks WHERE email = ? AND assignment_id = ?')
      .get(email, assignmentId) as unknown as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as AssignmentState) : null;
  }

  saveWorkbook(email: string, assignmentId: string, state: AssignmentState): void {
    this.db
      .prepare(
        `INSERT INTO workbooks (email, assignment_id, state, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(email, assignment_id) DO UPDATE
           SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(email, assignmentId, JSON.stringify(state), new Date().toISOString());
  }

  // ── submissions ────────────────────────────────────────────────

  /** Append a graded attempt; the attempt number is per (assignment, student). */
  addSubmission(
    assignmentId: string,
    email: string,
    submission: SubmissionData,
    result: SubmissionResult | undefined,
  ): SubmissionRecord {
    const prev = this.db
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) AS n FROM submissions WHERE assignment_id = ? AND email = ?',
      )
      .get(assignmentId, email) as unknown as { n: number };
    const attempt = prev.n + 1;
    this.db
      .prepare(
        `INSERT INTO submissions (assignment_id, email, attempt, submitted_at, submission, result)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assignmentId,
        email,
        attempt,
        submission.submittedAt,
        JSON.stringify(submission),
        result ? JSON.stringify(result) : null,
      );
    return { assignmentId, attempt, submittedAt: submission.submittedAt, submission, result };
  }

  /** All attempts for one assignment; optionally scoped to one student. */
  listSubmissions(assignmentId: string, email?: string): SubmissionRecord[] {
    const rows = (
      email
        ? this.db
            .prepare(
              `SELECT attempt, submitted_at, submission, result FROM submissions
               WHERE assignment_id = ? AND email = ? ORDER BY email, attempt`,
            )
            .all(assignmentId, email)
        : this.db
            .prepare(
              `SELECT attempt, submitted_at, submission, result FROM submissions
               WHERE assignment_id = ? ORDER BY email, attempt`,
            )
            .all(assignmentId)
    ) as unknown as { attempt: number; submitted_at: string; submission: string; result: string | null }[];
    return rows.map((r) => ({
      assignmentId,
      attempt: r.attempt,
      submittedAt: r.submitted_at,
      submission: JSON.parse(r.submission) as SubmissionData,
      result: r.result ? (JSON.parse(r.result) as SubmissionResult) : undefined,
    }));
  }

  /**
   * Overwrite the stored grade of one attempt — the manual-review write path.
   * The submission snapshot is immutable; `result` is the grade side of the
   * record, which the server owns and may amend (a review annotates the
   * stored SubmissionResult via the pure applyManualReview).
   */
  updateSubmissionResult(
    assignmentId: string,
    email: string,
    attempt: number,
    result: SubmissionResult,
  ): void {
    this.db
      .prepare(
        'UPDATE submissions SET result = ? WHERE assignment_id = ? AND email = ? AND attempt = ?',
      )
      .run(JSON.stringify(result), assignmentId, email, attempt);
  }

  clearSubmissions(assignmentId: string): void {
    this.db.prepare('DELETE FROM submissions WHERE assignment_id = ?').run(assignmentId);
  }
}
