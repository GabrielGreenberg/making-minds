// Instructor role seam.
//
// Role is a property of the logged-in identity, not a separate toggle: an
// instructor account *is* an instructor. Local mode reads the persisted toy
// session's role; remote mode reads the server session's role (cached by the
// AuthProvider after login/me() — the server's word, an SSO role claim
// later). Consumers (InstructorGate, the nav links) are unchanged either way.

import { readPersistedAccount } from './accounts';
import { getSessionUser } from './session';
import { backendMode } from '../storage/backend';

export interface InstructorRole {
  isInstructor(): boolean;
}

class SessionInstructorRole implements InstructorRole {
  isInstructor(): boolean {
    if (backendMode === 'remote') return getSessionUser()?.role === 'instructor';
    return readPersistedAccount()?.role === 'instructor';
  }
}

export const instructorRole: InstructorRole = new SessionInstructorRole();
