// Instructor-authored assignment seam.
//
// Bundled assignments (assignments/index.ts) are read-only and fixed at build
// time. Instructor-created assignments need to be editable at runtime, so they
// live behind this mutable store. The UI talks to the `AssignmentStore`
// interface, never to localStorage directly, so a server CRUD API drops in later
// at the same seam. Mirrors the WorkbookStore / SubmissionStore pattern.

import type { AssignmentData } from '../types';
import type { AssignmentSummary } from '../assignments';

export interface AssignmentStore {
  list(): AssignmentSummary[];
  get(id: string): AssignmentData | undefined;
  save(assignment: AssignmentData): void; // create or update
  remove(id: string): void;
}

// Distinct from `mm:asg:<id>` (student work) and `mm:sub:<id>` (submissions).
const KEY_PREFIX = 'mm:inst-asg:';

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

  list(): AssignmentSummary[] {
    return this.ids()
      .map((id) => this.get(id))
      .filter((a): a is AssignmentData => a != null)
      .map((a) => ({ id: a.id, title: a.title, questionCount: a.questions.length }));
  }

  get(id: string): AssignmentData | undefined {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (!raw) return undefined;
      return JSON.parse(raw) as AssignmentData;
    } catch {
      return undefined;
    }
  }

  save(assignment: AssignmentData): void {
    try {
      localStorage.setItem(KEY_PREFIX + assignment.id, JSON.stringify(assignment));
    } catch {
      // localStorage full or unavailable — silent fail (matches autosave).
    }
  }

  remove(id: string): void {
    try {
      localStorage.removeItem(KEY_PREFIX + id);
    } catch {
      // ignore
    }
  }
}

export const localAssignmentStore: AssignmentStore = new LocalAssignmentStore();
