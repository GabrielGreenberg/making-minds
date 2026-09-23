import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, AuthContextValue, AuthCapabilities, AuthAttemptResult } from './types';
import { SESSION_KEY, KNOWN_KEY, findAccount, readPersistedAccount, markSignedInBefore, hasAnyKey } from './accounts';
import { setSessionUser, getSessionUser } from './session';
import { backendMode } from '../storage/backend';
import { migrateLocalData } from '../storage/migrateLocal';
import { useServerHealth } from './HealthGate';
import * as api from '../api/client';

// The auth layer, both modes behind one set of exports (AuthProvider /
// useAuth / getCurrentUserEmail), selected once by `backendMode`:
//
//   local  — the original mockup: pick a toy account (see ./accounts), no
//            password, choice persisted in localStorage. Exists to demo the
//            two perspectives and drive the headless harness; account
//            creation, passwords and access requests are all reported
//            unsupported, so the login screen shows only the account buttons.
//   remote — the server's account system: the login screen asks the server
//            what it supports (GET /api/auth/config) and renders accordingly —
//            email + password against the CSV roster today, a single SSO
//            button once UCLA SSO lands, passwordless email in dev mode. Every
//            path ends the same way: a bearer token (stored by api/client.ts
//            under mm:auth:token) + the user the SERVER says you are. Once the
//            server answers the health probe, an existing token is resolved
//            via me() (`loading` is true until it settles, and AuthGate holds
//            the signed-in routes, so nothing behind them ever runs
//            unauthenticated); any 401 from any call clears the token and
//            drops to the login screen via the client's onUnauthorized hook.
//
// Neither mode requires a user: with nobody signed in and nothing resolving,
// the principal is the VISITOR (`isVisitor`), who may use the public routes
// (routing.ts `routeAccess`). Every successful sign-in or restore also sets
// the durable "signed in before" marker (accounts.ts KNOWN_KEY) that the boot
// landing rule reads.
//
// Identity and role are never the client's decision in remote mode — they are
// whatever the server's AuthProvider returns (server/src/auth.ts), which is
// the seam UCLA SSO swaps.

const UNSUPPORTED: AuthAttemptResult = {
  ok: false,
  error: 'Not available with this sign-in method.',
};

const LOCAL_CAPABILITIES: AuthCapabilities = {
  mode: 'mockup',
  usesPassword: false,
  allowsRegistration: false,
  allowsAccessRequests: false,
  passwordMinLength: 8,
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  isVisitor: true,
  hasSignInTrace: () => false,
  capabilities: LOCAL_CAPABILITIES,
  login: async () => UNSUPPORTED,
  register: async () => UNSUPPORTED,
  requestAccess: async () => UNSUPPORTED,
  changePassword: async () => UNSUPPORTED,
  logout: () => {},
});

function accountToUser(account: ReturnType<typeof readPersistedAccount>): AuthUser | null {
  if (!account) return null;
  return { email: account.email, name: account.name, role: account.role };
}

const localHasSignInTrace = () => hasAnyKey([SESSION_KEY, KNOWN_KEY]);

function LocalAuthProvider({ children }: { children: ReactNode }) {
  // Seed from the persisted session so a reload stays logged in.
  const [user, setUser] = useState<AuthUser | null>(() => {
    const u = accountToUser(readPersistedAccount());
    if (u) markSignedInBefore();
    return u;
  });

  const login = useCallback(async (accountId: string): Promise<AuthAttemptResult> => {
    const account = findAccount(accountId);
    if (!account) return { ok: false, error: 'Unknown account.' };
    try {
      localStorage.setItem(SESSION_KEY, account.id);
    } catch {
      // localStorage unavailable — the session just won't persist across reloads.
    }
    markSignedInBefore();
    setUser(accountToUser(account));
    return { ok: true, error: null };
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  const unsupported = useCallback(async () => UNSUPPORTED, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: false,
        isVisitor: user == null,
        hasSignInTrace: localHasSignInTrace,
        capabilities: LOCAL_CAPABILITIES,
        login,
        register: unsupported,
        requestAccess: unsupported,
        changePassword: unsupported,
        logout,
      }}
    >
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

/**
 * Turn a failed API call into a message for the person in front of the screen.
 * The server writes these (it knows which rule was broken); anything without
 * one is a network failure.
 */
function describeError(e: unknown, fallback: string): string {
  if (e instanceof api.ApiError && e.message) {
    return e.message.charAt(0).toUpperCase() + e.message.slice(1);
  }
  return fallback;
}

const remoteHasSignInTrace = () => api.getToken() != null || hasAnyKey([KNOWN_KEY]);

function RemoteAuthProvider({ children }: { children: ReactNode }) {
  // Session restore and the capabilities fetch wait for the health probe: a
  // visitor's sandbox renders without the server, but nothing here may read
  // an outage as a dead session (or as a password-only server).
  const serverUp = useServerHealth().status === 'ok';
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  // Only an existing token needs resolving; with none we go straight to login.
  const [loading, setLoading] = useState<boolean>(() => api.getToken() != null);

  // Keep the React state and the non-hook session cache in lockstep.
  const setUser = useCallback((u: AuthUser | null) => {
    setSessionUser(u);
    setUserState(u);
    if (u) markSignedInBefore();
  }, []);

  // Ask the server what its sign-in system offers. The login screen waits for
  // this rather than guessing, so it can never show a password box to an SSO
  // server (or hide one from a password server).
  useEffect(() => {
    if (!serverUp) return;
    let cancelled = false;
    api.authConfig().then(
      (caps) => {
        if (!cancelled) setCapabilities(caps);
      },
      () => {
        // Unreachable/old server: fall back to the plainest thing that works.
        // The health probe has already vouched for the server being up, so
        // this is a genuinely unexpected response, not an outage.
        if (!cancelled) {
          setCapabilities({
            mode: 'password',
            usesPassword: true,
            allowsRegistration: true,
            allowsAccessRequests: true,
            passwordMinLength: 8,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [serverUp]);

  useEffect(() => {
    // Any 401 anywhere (expired session, revoked roster row) ends the session
    // cleanly: token gone, back to the login screen.
    api.setOnUnauthorized(() => {
      api.setToken(null);
      setUser(null);
    });
    if (!serverUp) return;
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
  }, [setUser, serverUp]);

  const login = useCallback(
    async (email: string, password?: string): Promise<AuthAttemptResult> => {
      try {
        const u = await api.login(email, password);
        await runMigration(u);
        setUser(u);
        return { ok: true, error: null };
      } catch (e) {
        return {
          ok: false,
          error: describeError(e, 'Could not reach the server — check your connection.'),
        };
      }
    },
    [setUser],
  );

  const register = useCallback(
    async (input: { email: string; password: string; studentId?: string }) => {
      try {
        const u = await api.register(input);
        await runMigration(u);
        setUser(u);
        return { ok: true, error: null };
      } catch (e) {
        return {
          ok: false,
          error: describeError(e, 'Could not reach the server — check your connection.'),
          // The server refuses an off-roster email with 403 (and only that).
          notOnRoster: e instanceof api.ApiError && e.status === 403,
        };
      }
    },
    [setUser],
  );

  const requestAccess = useCallback(
    async (input: { email: string; name: string; studentId?: string; message?: string }) => {
      try {
        await api.requestAccess(input);
        return { ok: true, error: null };
      } catch (e) {
        return {
          ok: false,
          error: describeError(e, 'Could not reach the server — check your connection.'),
        };
      }
    },
    [],
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await api.changePassword(currentPassword, newPassword);
      return { ok: true, error: null };
    } catch (e) {
      return {
        ok: false,
        error: describeError(e, 'Could not reach the server — check your connection.'),
      };
    }
  }, []);

  const logout = useCallback(() => {
    // Drop the session locally first (the UI must log out even offline);
    // server-side session deletion is best-effort. api.logout() clears the
    // token in its finally block either way.
    setUser(null);
    void api.logout().catch(() => {});
  }, [setUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isVisitor: user == null && !loading,
        hasSignInTrace: remoteHasSignInTrace,
        capabilities,
        login,
        register,
        requestAccess,
        changePassword,
        logout,
      }}
    >
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
 * Throws when logged out — every caller sits on a signed-in route (the
 * visitor's sandbox offers no submit or feedback), so a user is always present.
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
