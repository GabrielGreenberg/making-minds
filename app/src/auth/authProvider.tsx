import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser, AuthContextValue, AuthCapabilities, AuthAttemptResult } from './types';
import { SESSION_KEY, findAccount, readPersistedAccount } from './accounts';
import { setSessionUser, getSessionUser } from './session';
import { backendMode } from '../storage/backend';
import { migrateLocalData } from '../storage/migrateLocal';
import { useServerHealth } from './HealthGate';
import { useStore } from '../store';
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
// (routing.ts `routeAccess`).
//
// Identity and role are never the client's decision in remote mode — they are
// whatever the server's AuthProvider returns (server/src/auth.ts), which is
// the seam UCLA SSO swaps.
//
// Every principal change — boot, sign-in, sign-out, a restored session, a
// 401 — is reported to the editor store (reportPrincipal → the store's
// resetForPrincipal, reset law 2), which wipes the previous person's work
// from memory and loads the arriving person's sandbox. A remote boot with a
// stored token reports the person that token was issued to (the principal
// hint below), never the visitor, so their sandbox edits made before me()
// settles — or all through a server outage — are their own.

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

/**
 * Hand the editor store to a new principal (null = the visitor). Called
 * SYNCHRONOUSLY before the React user state changes — never from an effect:
 * the children's effects that react to the new user (App's submission
 * hydration, AuthGate's routing) run before a parent's effect would, and the
 * reset would wipe what they just loaded. A repeat for the same principal is
 * a no-op (StrictMode's double initializer, the 401 hook firing again).
 */
function reportPrincipal(email: string | null): void {
  useStore.getState().resetForPrincipal(email);
}

// Remote mode: the email the stored session token was issued to, so a boot
// with a token can hand the store to that person at once instead of to the
// visitor while me() resolves. me() then confirms it (a no-op report) or
// corrects it (a reset). Written on every sign-in, removed wherever the token
// is; ignored without a token.
const PRINCIPAL_HINT_KEY = 'mm:auth:principal';

function readPrincipalHint(): string | null {
  if (api.getToken() == null) return null;
  try {
    return localStorage.getItem(PRINCIPAL_HINT_KEY);
  } catch {
    return null;
  }
}

function writePrincipalHint(email: string | null): void {
  try {
    if (email) localStorage.setItem(PRINCIPAL_HINT_KEY, email);
    else localStorage.removeItem(PRINCIPAL_HINT_KEY);
  } catch {
    // localStorage unavailable — the next boot just starts as the visitor.
  }
}

function LocalAuthProvider({ children }: { children: ReactNode }) {
  // Seed from the persisted session so a reload stays logged in.
  const [user, setUserState] = useState<AuthUser | null>(() => {
    const u = accountToUser(readPersistedAccount());
    reportPrincipal(u?.email ?? null);
    return u;
  });

  const changeUser = useCallback((u: AuthUser | null) => {
    reportPrincipal(u?.email ?? null);
    setUserState(u);
  }, []);

  const login = useCallback(async (accountId: string): Promise<AuthAttemptResult> => {
    const account = findAccount(accountId);
    if (!account) return { ok: false, error: 'Unknown account.' };
    try {
      localStorage.setItem(SESSION_KEY, account.id);
    } catch {
      // localStorage unavailable — the session just won't persist across reloads.
    }
    changeUser(accountToUser(account));
    return { ok: true, error: null };
  }, [changeUser]);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    changeUser(null);
  }, [changeUser]);

  const unsupported = useCallback(async () => UNSUPPORTED, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: false,
        isVisitor: user == null,
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

function RemoteAuthProvider({ children }: { children: ReactNode }) {
  // Session restore and the capabilities fetch wait for the health probe: a
  // visitor's sandbox renders without the server, but nothing here may read
  // an outage as a dead session (or as a password-only server).
  const serverUp = useServerHealth().status === 'ok';
  // Boot with a stored token hands the store to the token's owner (the
  // hint) while me() resolves; with none, to the visitor. AuthGate holds every
  // signed-in route until it settles, so only the public sandbox can render
  // meanwhile — and it must be that person's own, offline too.
  const [user, setUserState] = useState<AuthUser | null>(() => {
    reportPrincipal(readPrincipalHint());
    return null;
  });
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);
  // Only an existing token needs resolving; with none we go straight to login.
  const [loading, setLoading] = useState<boolean>(() => api.getToken() != null);

  // Keep the React state and the non-hook session cache in lockstep. The
  // store hears first, while the session cache still names the LEAVING user
  // (its flush journals their unsaved work under their email).
  const setUser = useCallback((u: AuthUser | null) => {
    reportPrincipal(u?.email ?? null);
    setSessionUser(u);
    setUserState(u);
    if (u) writePrincipalHint(u.email);
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
      writePrincipalHint(null);
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
          if (e instanceof api.ApiError && e.status === 401) {
            api.setToken(null);
            writePrincipalHint(null);
          }
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
          // The server refuses an off-roster ID or email with 403 (and only that).
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
    writePrincipalHint(null);
    setUser(null);
    void api.logout().catch(() => {});
  }, [setUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isVisitor: user == null && !loading,
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
