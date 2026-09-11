// Stable auth interface. Consumers depend only on these types; the underlying
// implementation (toy accounts locally, email+password against the roster
// remotely, UCLA SSO later) can change without touching them.

import type { Role } from './accounts';

export interface AuthUser {
  email: string;
  name: string;
  /** Drives view selection + gating. Local: the chosen toy account. Remote: the server session's role (an SSO claim later). */
  role: Role;
  /** Campus ID, when the roster carried one. Remote mode only. */
  studentId?: string;
}

/**
 * What the sign-in system offers, as reported by the server at runtime
 * (GET /api/auth/config). Local mode reports a fixed mockup shape. The login
 * screen renders from this, so swapping the server's AuthProvider — to UCLA
 * SSO, or back to passwordless dev login — changes the UI with no rebuild.
 */
export interface AuthCapabilities {
  mode: 'mockup' | 'password' | 'dev' | 'sso';
  usesPassword: boolean;
  allowsRegistration: boolean;
  allowsAccessRequests: boolean;
  passwordMinLength: number;
  ssoLoginUrl?: string;
}

/** What a failed sign-in / registration attempt should tell the person. */
export interface AuthAttemptResult {
  ok: boolean;
  /** Ready-to-display message; null on success. */
  error: string | null;
}

export interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: AuthUser | null;
  /** True while the initial session is being resolved. */
  loading: boolean;
  /**
   * What this server's sign-in system supports. Null while it is still being
   * fetched (remote mode, first paint).
   */
  capabilities: AuthCapabilities | null;
  /**
   * Sign in. Local mode: `id` is a toy account id and `password` is ignored.
   * Remote mode: `id` is the account email, with the password unless the
   * server reports `usesPassword: false`.
   */
  login(id: string, password?: string): Promise<AuthAttemptResult>;
  /**
   * Create an account for someone already on the roster, and sign them in.
   * Refused (with a reason) off-roster, when an account already exists, when
   * the password is too short, or when the student ID does not match.
   */
  register(input: {
    email: string;
    password: string;
    studentId?: string;
  }): Promise<AuthAttemptResult>;
  /** File a "my email isn't on the roster" request for instructor review. */
  requestAccess(input: {
    email: string;
    name: string;
    studentId?: string;
    message?: string;
  }): Promise<AuthAttemptResult>;
  /** Change the signed-in user's own password. */
  changePassword(currentPassword: string, newPassword: string): Promise<AuthAttemptResult>;
  /** Clear the session, returning to the login screen. */
  logout(): void;
}
