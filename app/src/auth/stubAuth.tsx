import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, AuthContextValue } from './types';

// TODO(auth): replace this stub with a Supabase-backed implementation — see
// .claude/plans/quiet-finding-seal.md. Real auth keeps the same exports
// (AuthProvider / useAuth / getCurrentUserEmail) so consumers stay unchanged;
// only this file (and the AuthGate no-session branch) gain real behavior.

/** The fixed identity we are "logged in" as until real auth lands. */
const STUB_USER: AuthUser = {
  email: 'john.doe@example.com',
  name: 'John Doe',
};

const STUB_VALUE: AuthContextValue = {
  user: STUB_USER,
  loading: false,
};

const AuthContext = createContext<AuthContextValue>(STUB_VALUE);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Stub: the context value never changes. The real provider will hold session
  // state here and update it via Supabase's onAuthStateChange.
  return <AuthContext.Provider value={STUB_VALUE}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Non-hook accessor for imperative call sites (e.g. submission export).
 * Returns the current user's email. Under the stub this is always John Doe;
 * the real version will read the live Supabase session.
 */
export function getCurrentUserEmail(): string {
  return STUB_USER.email;
}
