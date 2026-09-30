// The app's course backend (task 087): imported for its effect by the app's
// entry (main.tsx) before anything renders, and by every harness tool that
// drives the editor store. It installs storage/pageBackend.ts's slot from the
// seams storage/backend.ts exports (the ONE local-vs-remote decision), the
// assignment registry and the auth seam — the edges the store once held
// itself. The embeddable sandbox never imports this module.

import { installPageBackend, type PageBackend } from './pageBackend';
import { backendMode, workbookStore, submissionStore, assignmentStore, gradingStore } from './backend';
import { getAssignment, listAssignments } from '../assignments';
import { getSessionUser } from '../auth/session';
import { instructorRole } from '../auth/instructorRole';

export const appBackend: PageBackend = {
  mode: backendMode,
  workbookStore,
  submissionStore,
  assignmentStore,
  gradingStore,
  getAssignment,
  listAssignments,
  sessionEmail: () => getSessionUser()?.email ?? null,
  isInstructor: () => instructorRole.isInstructor(),
};

installPageBackend(appBackend);
