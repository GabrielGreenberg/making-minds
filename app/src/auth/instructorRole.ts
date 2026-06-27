// Instructor role seam.
//
// Gates the instructor frontend. In the prototype the role is a session flag the
// user sets via the unlock screen; it lives in sessionStorage so it clears when
// the tab closes and never touches the student-side localStorage data. Later the
// SSO token carries a role claim and `isInstructor()` reads it — consumers
// (InstructorGate) stay unchanged.

export interface InstructorRole {
  isInstructor(): boolean;
  enter(): void;
  exit(): void;
}

const KEY = 'mm:instructor';

class SessionInstructorRole implements InstructorRole {
  isInstructor(): boolean {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  enter(): void {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      // sessionStorage unavailable — role simply won't persist.
    }
  }

  exit(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }
}

export const instructorRole: InstructorRole = new SessionInstructorRole();
