import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, AuthContextValue } from './types';
import { SESSION_KEY, findAccount, readPersistedAccount } from './accounts';
import { setSessionUser, getSessionUser } from './session';
import { backendMode } from '../storage/backend';
import { migrateLocalData } from '../storage/migrateLocal';
import * as api from '../api/client';

// The auth layer, both modes behind one set of exports (AuthProvider /
// useAuth / getCurrentUserEmail), selected once by `backendMode`:
//
//   local  — the original mockup: pick a toy account (see ./accounts), no
//            password, choice persisted in localStorage. Byte-identical to
//            the pre-S3 stub; exists to demo the two perspectives and drive
//            the headless harness.
//   remote — the server session: login(email) → POST /auth/login → bearer
//            token (stored by api/client.ts under mm:auth:token) + user; on
//            mount, an existing token is resolved via me() (`loading` is true
//            until it settles, and AuthGate holds rendering, so nothing
//            behind the gate ever runs unauthenticated); any 401 from any
//            call clears the token and drops to the login screen via the
//            client's onUnauthorized hook. Identity and role are the
//            SERVER's word — the roster today, the UCLA SSO claim later
//            (that swap happens in server/src/auth.ts; this file is done).

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  login: async () => false,
  logout: () => {},
});

function accountToUser(account: ReturnType<typeof readPersistedAccount>): AuthUser | null {
  if (!account) return null;
  return { email: account.email, name: account.name, role: account.role };
}

function LocalAuthProvider({ children }: { children: ReactNode }) {
  // Seed from the persisted session so a reload stays logged in.
  const [user, setUser] = useState<AuthUser | null>(() => accountToUser(readPersistedAccount()));

  const login = useCallback(async (accountId: string) => {
    const account = findAccount(accountId);
    if (!account) return false;
    try {
      localStorage.setItem(SESSION_KEY, account.id);
    } catch {
      // localStorage unavailable — the session just won't persist across reloads.
    }
    setUser(accountToUser(account));
    return true;
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

/**
 * First-remote-login migration: fill-empty upload of any prototype
 * localStorage data (see storage/migrateLocal.ts). Awaited BEFORE the user is
 * set, so nothing behind AuthGate can read a server workbook that migration
 * is about to fill. Failure is non-fatal (login proceeds; the guard stays
 * unset so the next login retries).
 */
async function runMigration(u: { email: string; role: 'student' | 'instructor' }): Promise<void> {
  try {
    await migrateLocalData(u);
  } catch (e) {
    console.warn('local-data migration failed (will retry next login):', e);
  }
}

function RemoteAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  // Only an existing token needs resolving; with none we go straight to login.
  const [loading, setLoading] = useState<boolean>(() => api.getToken() != null);

  // Keep the React state and the non-hook session cache in lockstep.
  const setUser = useCallback((u: AuthUser | null) => {
    setSessionUser(u);
    setUserState(u);
  }, []);

  useEffect(() => {
    // Any 401 anywhere (expired session, revoked roster row) ends the session
    // cleanly: token gone, back to the login screen.
    api.setOnUnauthorized(() => {
      api.setToken(null);
      setUser(null);
    });
    const token = api.getToken();
    if (!token) return;
    let cancelled = false;
    api.me().then(
      async (u) => {
        if (cancelled) return;
        await runMigration(u);
        if (!cancelled) {
          setUser(u);
          setLoading(false);
        }
      },
      (e: unknown) => {
        // A 401 (dead/foreign token) has already been cleared by the hook
        // above; any OTHER failure (transient network blip past the health
        // gate) keeps the token so a reload can restore the session — either
        // way, resolve this boot to logged-out.
        if (!cancelled) {
          if (e instanceof api.ApiError && e.status === 401) api.setToken(null);
          setUser(null);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  const login = useCallback(
    async (email: string) => {
      try {
        const u = await api.login(email);
        await runMigration(u);
        setUser(u);
        return true;
      } catch {
        // Unknown account (401) or network failure — the login screen reports it.
        return false;
      }
    },
    [setUser],
  );

  const logout = useCallback(() => {
    // Drop the session locally first (the UI must log out even offline);
    // server-side session deletion is best-effort. api.logout() clears the
    // token in its finally block either way.
    setUser(null);
    void api.logout().catch(() => {});
  }, [setUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const AuthProvider = backendMode === 'remote' ? RemoteAuthProvider : LocalAuthProvider;

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Non-hook accessor for imperative call sites (e.g. submission tagging).
 * Local mode reads the persisted toy session directly; remote mode reads the
 * provider's session cache (populated before AuthGate renders anything).
 * Throws when logged out — every caller runs behind <AuthGate>, so a user is
 * always present.
 */
export function getCurrentUserEmail(): string {
  if (backendMode === 'remote') {
    const user = getSessionUser();
    if (!user) throw new Error('getCurrentUserEmail called with no logged-in user');
    return user.email;
  }
  const account = readPersistedAccount();
  if (!account) throw new Error('getCurrentUserEmail called with no logged-in user');
  return account.email;
}
