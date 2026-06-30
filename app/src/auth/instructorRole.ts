// Instructor role seam.
//
// Role is a property of the logged-in account (see ./accounts), not a separate
// toggle: an instructor account *is* an instructor. `isInstructor()` reads the
// persisted session's role. Later the SSO token carries the role claim and this
// reads that instead — consumers (InstructorGate, the nav links) stay unchanged.

import { readPersistedAccount } from './accounts';

export interface InstructorRole {
  isInstructor(): boolean;
}

class AccountInstructorRole implements InstructorRole {
  isInstructor(): boolean {
    return readPersistedAccount()?.role === 'instructor';
  }
}

export const instructorRole: InstructorRole = new AccountInstructorRole();
