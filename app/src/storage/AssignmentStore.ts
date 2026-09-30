// Assignment seam.
//
// Every assignment is instructor-authored and editable at runtime, so all of
// them live behind this mutable store — the registry (assignments/index.ts) is
// a thin layer over it. The UI talks to the `AssignmentStore` interface, never
// to localStorage directly, so a server CRUD API drops in at the same seam.
// Mirrors the WorkbookStore / SubmissionStore pattern.
// Promise-returning (a remote backend is intrinsically async); the local
// implementation resolves immediately.
//
// GRADE RELEASE lives on this seam. Students must not see their grades — not
// even on submit — until the instructor releases them per assignment. The flag
// is grading POLICY, so it rides beside the assignment rather than inside
// AssignmentData (which ships to the client): server-side it is the
// `grades_released` column on the assignment row (server/src/db.ts), on the
// wire it is `gradesReleased` on summaries and fetched assignments
// (api/client.ts), and locally it is a private `mm:release:<id>` localStorage
// key of this store — one read path, one write path, server-authoritative in
// remote mode. NOTE (prototype honesty): with everything client-side, the
// local gate is a UI courtesy, not a security boundary — real enforcement is
// server-side, where results are stripped from student responses until release
// (server/src/sanitize.ts).
//
// STUDENT VISIBILITY lives on this seam too, the same way and for the same
// reason: whether an assignment is published is policy, not content. Server-
// side it is the `student_visible` column (hidden assignments are absent from
// a student's list and 404 on fetch); locally it is a private
// `mm:published:<id>` key. An assignment is HIDDEN until the instructor
// publishes it — absent means hidden, on both backends, for every assignment
// including the seeded ones. Students see an empty catalog until
// something is released, which is the point.
//
// A STUDENT'S EXTENSION (task 068) is served the same way on both backends:
// a student's copy carries their effective due date as `dueDate` (marked
// `dueExtended`), so Home, the overview and the freeze follow it with no
// client logic (lateContext.ts studentCopy). Never an instructor's copy —
// the editor saves that one back.

import type { AssignmentData } from '../types';
import type { AssignmentSummary } from '../assignments';
import { readPersistedAccount } from '../auth/accounts';
import { studentCopy } from '../lateContext';
import { readExtensions } from './lateLocal';

export const ASSIGNMENT_HAS_SUBMISSIONS = 'students have submitted this assignment. Hide it instead of deleting it';

export interface AssignmentStore {
  list(): Promise<AssignmentSummary[]>;
  get(id: string): Promise<{ assignment: AssignmentData; gradesReleased: boolean } | null>;
  save(assignment: AssignmentData): Promise<void>; // create or update
  /** Rejects (ASSIGNMENT_HAS_SUBMISSIONS) once any student has submitted it —
   *  hide it instead; its attempts and grades must not be orphaned. */
  remove(id: string): Promise<void>;
  /**
   * The release flag for one assignment id. Answered for ANY id, known or not,
   * because release is policy keyed on the id, not a property of a stored row
   * (an unknown id is simply unreleased). Remote mode reads it off the fetched
   * assignment.
   */
  getGradesReleased(id: string): Promise<boolean>;
  /** Instructor only: release (or hide again) grades for an assignment. */
  setGradesReleased(id: string, released: boolean): Promise<void>;
  /**
   * Whether students can see this assignment. Answered for ANY id, like
   * release. Absent = HIDDEN, so publishing is always an explicit act.
   */
  getVisible(id: string): Promise<boolean>;
  /** Instructor only: publish an assignment to students, or hide it again. */
  setVisible(id: string, visible: boolean): Promise<void>;
}

// Distinct from `mm:asg:<id>` (student work) and `mm:sub:<id>` (submissions).
// Exported for the fill-empty migration (migrateLocal.ts), which scans
// localStorage for locally authored assignments on first remote login.
export const INSTRUCTOR_ASG_KEY_PREFIX = 'mm:inst-asg:';
const KEY_PREFIX = INSTRUCTOR_ASG_KEY_PREFIX;
// Same key the pre-seam storage/gradeRelease.ts module used, so existing
// local release flags keep working byte-for-byte.
const RELEASE_PREFIX = 'mm:release:';
// Presence means PUBLISHED — absent is hidden, so nothing reaches students
// until the instructor releases it.
const PUBLISHED_PREFIX = 'mm:published:';

class LocalAssignmentStore implements AssignmentStore {
  private ids(): string[] {
    const ids: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(KEY_PREFIX)) ids.push(key.slice(KEY_PREFIX.length));
      }
    } catch {
      // localStorage unavailable — behave as empty.
    }
    return ids;
  }

  /** Synchronous read shared by the async interface methods. */
  private read(id: string): AssignmentData | undefined {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (!raw) return undefined;
      return JSON.parse(raw) as AssignmentData;
    } catch {
      return undefined;
    }
  }

  private readReleased(id: string): boolean {
    try {
      return localStorage.getItem(RELEASE_PREFIX + id) === '1';
    } catch {
      return false;
    }
  }

  private readVisible(id: string): boolean {
    try {
      return localStorage.getItem(PUBLISHED_PREFIX + id) === '1';
    } catch {
      return false;
    }
  }

  /** The signed-in toy account's own copy: a student's carries their
   *  extension (the server's GET rule); anyone else's is the stored one. */
  private served<T extends Pick<AssignmentData, 'dueDate'>>(id: string, a: T): T & { dueExtended?: true } {
    const account = readPersistedAccount();
    if (account?.role !== 'student') return a;
    return studentCopy(a, readExtensions(id)[account.email.toLowerCase()]);
  }

  async list(): Promise<AssignmentSummary[]> {
    return this.ids()
      .map((id) => this.read(id))
      .filter((a): a is AssignmentData => a != null)
      .map((a) =>
        this.served(a.id, {
          id: a.id,
          title: a.title,
          questionCount: a.questions.length,
          gradesReleased: this.readReleased(a.id),
          visible: this.readVisible(a.id),
          dueDate: a.dueDate,
          order: a.order,
          ...(a.latePolicy ? { latePolicy: a.latePolicy } : {}),
        }),
      );
  }

  async get(id: string): Promise<{ assignment: AssignmentData; gradesReleased: boolean } | null> {
    const assignment = this.read(id);
    return assignment ? { assignment: this.served(id, assignment), gradesReleased: this.readReleased(id) } : null;
  }

  async save(assignment: AssignmentData): Promise<void> {
    try {
      localStorage.setItem(KEY_PREFIX + assignment.id, JSON.stringify(assignment));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
  }

  async remove(id: string): Promise<void> {
    // The server's rule (task 063): an assignment students have submitted is
    // never removed — its attempts and grades would be orphaned.
    let submitted = false;
    try {
      submitted = JSON.parse(localStorage.getItem('mm:sub:' + id) ?? '[]').length > 0;
    } catch {
      // unreadable — treat as none
    }
    if (submitted) throw new Error(ASSIGNMENT_HAS_SUBMISSIONS);
    try {
      localStorage.removeItem(KEY_PREFIX + id);
      // Release is policy about THIS assignment; a future assignment reusing
      // the id must not inherit a stale released flag.
      localStorage.removeItem(RELEASE_PREFIX + id);
      localStorage.removeItem(PUBLISHED_PREFIX + id);
    } catch {
      // ignore
    }
  }

  async getGradesReleased(id: string): Promise<boolean> {
    return this.readReleased(id);
  }

  async setGradesReleased(id: string, released: boolean): Promise<void> {
    try {
      if (released) localStorage.setItem(RELEASE_PREFIX + id, '1');
      else localStorage.removeItem(RELEASE_PREFIX + id);
    } catch {
      // localStorage unavailable — stays unreleased, the safe default.
    }
  }

  async getVisible(id: string): Promise<boolean> {
    return this.readVisible(id);
  }

  async setVisible(id: string, visible: boolean): Promise<void> {
    try {
      if (visible) localStorage.setItem(PUBLISHED_PREFIX + id, '1');
      else localStorage.removeItem(PUBLISHED_PREFIX + id);
    } catch {
      // localStorage unavailable — stays hidden, the safe default.
    }
  }
}

export const localAssignmentStore: AssignmentStore = new LocalAssignmentStore();
