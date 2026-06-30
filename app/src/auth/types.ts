// Stable auth interface. Consumers depend only on these types; the underlying
// implementation (currently a mockup, later Supabase) can change without touching them.

import type { Role } from './accounts';

export interface AuthUser {
  email: string;
  name: string;
  /** Drives view selection + gating. From the chosen account today; an SSO role claim later. */
  role: Role;
}

export interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: AuthUser | null;
  /** True while the initial session is being resolved. */
  loading: boolean;
  /** Log in as the given toy account id. */
  login(accountId: string): void;
  /** Clear the session, returning to the login screen. */
  logout(): void;
}
