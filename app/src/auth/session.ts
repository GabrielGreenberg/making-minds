// Module-level cache of the authenticated user, for NON-HOOK call sites.
//
// Remote mode has no synchronous session record to read (the token in
// localStorage is opaque — identity and role are the server's word, resolved
// by `me()`), so the AuthProvider caches the resolved user here for the
// imperative accessors: `getCurrentUserEmail` (the submit buttons) and
// `instructorRole.isInstructor()`. Local mode keeps reading the persisted toy
// account directly and never touches this cache.
//
// A tiny leaf module (types only) so instructorRole.ts can read it without
// importing the React provider.

import type { AuthUser } from './types';

let currentUser: AuthUser | null = null;

export function setSessionUser(user: AuthUser | null): void {
  currentUser = user;
}

export function getSessionUser(): AuthUser | null {
  return currentUser;
}
