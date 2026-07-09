// Stable auth interface. Consumers depend only on these types; the underlying
// implementation (toy accounts locally, the server session remotely, UCLA SSO
// later) can change without touching them.

import type { Role } from './accounts';

export interface AuthUser {
  email: string;
  name: string;
  /** Drives view selection + gating. Local: the chosen toy account. Remote: the server session's role (an SSO claim later). */
  role: Role;
}

export interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: AuthUser | null;
  /** True while the initial session is being resolved. */
  loading: boolean;
  /**
   * Log in. Local mode: `id` is a toy account id. Remote mode: `id` is a
   * roster email (dev login; SSO later). Resolves false when the account is
   * unknown or the server is unreachable — the login screen reports it.
   */
  login(id: string): Promise<boolean>;
  /** Clear the session, returning to the login screen. */
  logout(): void;
}
