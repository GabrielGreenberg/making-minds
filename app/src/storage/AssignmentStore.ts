// Instructor-authored assignment seam.
//
// Bundled assignments (assignments/index.ts) are read-only and fixed at build
// time. Instructor-created assignments need to be editable at runtime, so they
// live behind this mutable store. The UI talks to the `AssignmentStore`
// interface, never to localStorage directly, so a server CRUD API drops in later
// at the same seam. Mirrors the WorkbookStore / SubmissionStore pattern.
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

import type { AssignmentData } from '../types';
import type { AssignmentSummary } from '../assignments';

export interface AssignmentStore {
  list(): Promise<AssignmentSummary[]>;
  get(id: string): Promise<{ assignment: AssignmentData; gradesReleased: boolean } | null>;
  save(assignment: AssignmentData): Promise<void>; // create or update
  remove(id: string): Promise<void>;
  /**
   * The release flag for one assignment id. Answered for ANY id — including
   * bundled assignments that live outside this store — because release is
   * policy keyed on the id, not a property of a stored row. (Remote mode reads
   * it off the fetched assignment; there, every assignment is a server row.)
   */
  getGradesReleased(id: string): Promise<boolean>;
  /** Instructor only: release (or hide again) grades for an assignment. */
  setGradesReleased(id: string, released: boolean): Promise<void>;
}

// Distinct from `mm:asg:<id>` (student work) and `mm:sub:<id>` (submissions).
const KEY_PREFIX = 'mm:inst-asg:';
// Same key the pre-seam storage/gradeRelease.ts module used, so existing
// local release flags keep working byte-for-byte.
const RELEASE_PREFIX = 'mm:release:';

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

  async list(): Promise<AssignmentSummary[]> {
    return this.ids()
      .map((id) => this.read(id))
      .filter((a): a is AssignmentData => a != null)
      .map((a) => ({
        id: a.id,
        title: a.title,
        questionCount: a.questions.length,
        gradesReleased: this.readReleased(a.id),
      }));
  }

  async get(id: string): Promise<{ assignment: AssignmentData; gradesReleased: boolean } | null> {
    const assignment = this.read(id);
    return assignment ? { assignment, gradesReleased: this.readReleased(id) } : null;
  }

  async save(assignment: AssignmentData): Promise<void> {
    try {
      localStorage.setItem(KEY_PREFIX + assignment.id, JSON.stringify(assignment));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
  }

  async remove(id: string): Promise<void> {
    try {
      localStorage.removeItem(KEY_PREFIX + id);
      // Release is policy about THIS assignment; a future assignment reusing
      // the id must not inherit a stale released flag.
      localStorage.removeItem(RELEASE_PREFIX + id);
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
}

export const localAssignmentStore: AssignmentStore = new LocalAssignmentStore();
