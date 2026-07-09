// One-time, fill-empty migration of prototype localStorage data to the server
// (docs/buildout/designs/remote-stores.md §2 "Migration").
//
// On first remote login (per-user guard key `mm:migrated:<email>`), each local
// workbook (`mm:asg:<id>`) whose server side is EMPTY is uploaded, and — for
// instructors — each locally authored assignment (`mm:inst-asg:<id>`) the
// server doesn't know is uploaded likewise. Fill-empty is the whole contract:
// server data is NEVER overwritten, so the migration is safe to re-run (and
// does re-run if a partial failure leaves the guard unset). Local keys are
// never deleted — local mode remains the dev environment. Submissions,
// release flags, and reviews are deliberately NOT migrated (prototype data;
// the cutover lands before the real HW1–HW7 content exists).
//
// Imports the Remote stores directly (not storage/backend.ts): migration is
// only meaningful against a server, and the direct import keeps this module
// drivable headlessly (tools/remoteStoreCheck.ts pins the decision table:
// server-null + local-present → upload; server-present → never touch;
// idempotence via the guard AND via fill-empty itself).
//
// GRADER-FREE ZONE (like remoteStores.ts): remoteStoreCheck grep-gates this.

import { WORKBOOK_KEY_PREFIX, localWorkbookStore } from './workbookStore';
import { INSTRUCTOR_ASG_KEY_PREFIX, localAssignmentStore } from './AssignmentStore';
import { remoteWorkbookStore, remoteAssignmentStore } from './remoteStores';

const MIGRATED_PREFIX = 'mm:migrated:';

function guardKey(email: string): string {
  return MIGRATED_PREFIX + email.toLowerCase();
}

function idsWithPrefix(prefix: string): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) ids.push(key.slice(prefix.length));
    }
  } catch {
    // localStorage unavailable — nothing local to migrate.
  }
  return ids;
}

export interface MigrationSummary {
  /** False when the per-user guard short-circuited (already migrated). */
  ran: boolean;
  workbooksUploaded: number;
  assignmentsUploaded: number;
}

/**
 * Run the fill-empty migration for the just-authenticated user. Idempotent
 * twice over: the guard key skips the whole pass after one success, and even
 * without the guard every upload re-checks that the server side is empty.
 * Throws on a failed round-trip (guard left unset, so the next login retries);
 * the caller treats that as non-fatal — login proceeds either way.
 */
export async function migrateLocalData(user: {
  email: string;
  role: 'student' | 'instructor';
}): Promise<MigrationSummary> {
  try {
    if (localStorage.getItem(guardKey(user.email)) != null) {
      return { ran: false, workbooksUploaded: 0, assignmentsUploaded: 0 };
    }
  } catch {
    return { ran: false, workbooksUploaded: 0, assignmentsUploaded: 0 };
  }

  let workbooksUploaded = 0;
  let assignmentsUploaded = 0;

  // Student workbooks — server workbooks are per-(user, assignment), so
  // "empty" means THIS user has no server copy for that assignment yet.
  for (const id of idsWithPrefix(WORKBOOK_KEY_PREFIX)) {
    const local = await localWorkbookStore.loadAssignmentState(id);
    if (!local) continue;
    const server = await remoteWorkbookStore.loadAssignmentState(id);
    if (server != null) continue; // server-present → never touch
    await remoteWorkbookStore.saveAssignmentState(id, local);
    workbooksUploaded++;
  }

  // Locally authored assignments — instructor-only (the PUT is role-gated
  // server-side; a student's browser may carry these keys from local-mode
  // demos, and they are simply not that student's data to publish).
  if (user.role === 'instructor') {
    for (const id of idsWithPrefix(INSTRUCTOR_ASG_KEY_PREFIX)) {
      const local = await localAssignmentStore.get(id);
      if (!local) continue;
      const server = await remoteAssignmentStore.get(id);
      if (server != null) continue; // server-present → never touch
      await remoteAssignmentStore.save(local.assignment);
      assignmentsUploaded++;
    }
  }

  try {
    localStorage.setItem(guardKey(user.email), new Date().toISOString());
  } catch {
    // Guard couldn't persist: the next login re-runs, and fill-empty makes
    // that a no-op against everything uploaded this time.
  }
  return { ran: true, workbooksUploaded, assignmentsUploaded };
}
