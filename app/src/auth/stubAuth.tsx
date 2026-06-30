import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, AuthContextValue } from './types';
import { SESSION_KEY, findAccount, readPersistedAccount } from './accounts';

// Mockup auth. There is no password and no security — the login screen picks one
// of a fixed set of toy accounts (see ./accounts) and the choice is persisted in
// localStorage so a reload keeps the session. The whole point is to demo the two
// perspectives (student / instructor) and exercise role gating + routing.
//
// TODO(auth): replace with a Supabase-backed implementation. Real auth keeps the
// same exports (AuthProvider / useAuth / getCurrentUserEmail) so consumers stay
// unchanged; the account table + localStorage session go away and `role` comes
// from the SSO token's role claim.

function accountToUser(account: ReturnType<typeof readPersistedAccount>): AuthUser | null {
  if (!account) return null;
  return { email: account.email, name: account.name, role: account.role };
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seed from the persisted session so a reload stays logged in.
  const [user, setUser] = useState<AuthUser | null>(() => accountToUser(readPersistedAccount()));

  const login = useCallback((accountId: string) => {
    const account = findAccount(accountId);
    if (!account) return;
    try {
      localStorage.setItem(SESSION_KEY, account.id);
    } catch {
      // localStorage unavailable — the session just won't persist across reloads.
    }
    setUser(accountToUser(account));
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading: false, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Non-hook accessor for imperative call sites (e.g. submission tagging). Reads the
 * persisted session directly so it works outside React. Throws when logged out —
 * every caller runs behind <AuthGate>, so a user is always present.
 */
export function getCurrentUserEmail(): string {
  const account = readPersistedAccount();
  if (!account) throw new Error('getCurrentUserEmail called with no logged-in user');
  return account.email;
}
