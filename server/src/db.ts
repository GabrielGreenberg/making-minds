// SQLite persistence for the API server, via the Node built-in `node:sqlite`
// (no native npm deps — nothing to compile on the Lightsail box; requires
// Node >= 22.5). One synchronous connection per process is plenty for a
// course-sized load (~80 students), and SQLite gives us durable, transactional
// storage on a single box with trivial backup (copy one file).
//
// JSON-heavy tables mirror the client seams one-to-one:
//   users        — the roster (dev auth logs in by known email; SSO will upsert)
//   sessions     — bearer tokens
//   assignments  — full AssignmentData JSON (INCLUDING test_cases — server-only;
//                  the API strips answers before sending to students)
//   workbooks    — per-(user, assignment) saved canvas state (WorkbookStore seam)
//   submissions  — immutable graded attempts (SubmissionStore seam)

import { DatabaseSync } from 'node:sqlite';
import type {
  AssignmentData,
  AssignmentState,
  SubmissionData,
  SubmissionRecord,
  SubmissionResult,
} from '../../app/src/types';
import type { Role } from '../../app/src/auth/accounts';

export interface UserRow {
  email: string;
  name: string;
  role: Role;
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
    `);
    // Column added after the initial schema; ALTER is a no-op error on re-run.
    try {
      this.db.exec('ALTER TABLE assignments ADD COLUMN grades_released INTEGER NOT NULL DEFAULT 0;');
    } catch {
      // already present
    }
  }

  close(): void {
    this.db.close();
  }

  // ── users ──────────────────────────────────────────────────────

  upsertUser(user: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO users (email, name, role) VALUES (?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role`,
      )
      .run(user.email, user.name, user.role);
  }

  getUser(email: string): UserRow | null {
    const row = this.db.prepare('SELECT email, name, role FROM users WHERE email = ?').get(email);
    return (row as unknown as UserRow) ?? null;
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
        `SELECT u.email, u.name, u.role, s.expires_at FROM sessions s
         JOIN users u ON u.email = s.email WHERE s.token = ?`,
      )
      .get(token) as unknown as (UserRow & { expires_at: string }) | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.deleteSession(token);
      return null;
    }
    return { email: row.email, name: row.name, role: row.role };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
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

  clearSubmissions(assignmentId: string): void {
    this.db.prepare('DELETE FROM submissions WHERE assignment_id = ?').run(assignmentId);
  }
}
