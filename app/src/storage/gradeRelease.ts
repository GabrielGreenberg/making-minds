// Grade-release seam.
//
// Students must not see their grades — not even on submit — until the
// instructor releases them for an assignment. The flag is grading POLICY, so
// it lives outside AssignmentData (which ships to the client) — here as its
// own localStorage key per assignment, and on the server as a column beside
// the assignment row (see server/src/db.ts). The API counterparts are
// `gradesReleased` on fetched assignments and `setGradesReleased` in
// src/api/client.ts.
//
// NOTE (prototype honesty): with everything client-side, this gate is a UI
// courtesy, not a security boundary — like the rest of the local pipeline,
// the real enforcement is server-side, where results are stripped from
// student responses until release.

const KEY_PREFIX = 'mm:release:';

export function isGradesReleased(assignmentId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + assignmentId) === '1';
  } catch {
    return false;
  }
}

export function setGradesReleased(assignmentId: string, released: boolean): void {
  try {
    if (released) localStorage.setItem(KEY_PREFIX + assignmentId, '1');
    else localStorage.removeItem(KEY_PREFIX + assignmentId);
  } catch {
    // localStorage unavailable — stays unreleased, the safe default.
  }
}
