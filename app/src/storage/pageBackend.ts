// The page's course backend (task 087) — the slot through which the editor
// store and routing reach the course: the seams, the assignment registry, who
// is signed in and whether they teach.
//
// The editor store once imported those modules itself (storage/backend,
// assignments, auth/session, auth/instructorRole), so every page that showed
// the editor carried the whole course client: the remote stores, the API
// client, the toy accounts. A page now INSTALLS its backend before it renders:
// the app's entry imports storage/appBackend.ts, which fills this slot from
// storage/backend.ts (still the ONE local-vs-remote decision) and the auth
// seam; the embeddable sandbox (src/embed/) installs none, so none of that
// reaches its bundle (tools/embedCheck.ts [module graph]).
//
// Types only, plus the slot: nothing here imports a store, so importing it
// costs nothing. An assignment action on a page without a backend is a bug,
// and `pageBackend()` says so; the paths the sandbox shares with an
// assignment (the autosave, the unload flush) ask `pageBackendOrNull()`.

import type { AssignmentData } from '../types';
import type { WorkbookStore } from './workbookStore';
import type { SubmissionStore } from './submissionStore';
import type { AssignmentStore } from './AssignmentStore';
import type { GradingStore } from './gradingStore';

export interface PageBackend {
  /** storage/backend.ts's decision: local (browser storage) or remote (the server). */
  mode: 'local' | 'remote';
  workbookStore: WorkbookStore;
  submissionStore: SubmissionStore;
  assignmentStore: AssignmentStore;
  gradingStore: GradingStore;
  /** The assignment registry (assignments/index.ts). */
  getAssignment(id: string): Promise<AssignmentData | undefined>;
  listAssignments(): Promise<{ id: string }[]>;
  /** The signed-in person's email as the session reports it (null: nobody). */
  sessionEmail(): string | null;
  /** The instructor role seam (auth/instructorRole.ts). */
  isInstructor(): boolean;
}

let installed: PageBackend | null = null;

/** Install the page's backend — once: a second, different one is a bug. */
export function installPageBackend(backend: PageBackend): void {
  if (installed && installed !== backend) throw new Error('a course backend is already installed on this page');
  installed = backend;
}

/** The installed backend; throws on a page that installed none (the embed). */
export function pageBackend(): PageBackend {
  if (!installed) throw new Error('no course backend on this page');
  return installed;
}

/** The installed backend, or null on a page without one. */
export function pageBackendOrNull(): PageBackend | null {
  return installed;
}
