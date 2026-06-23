// Stable auth interface. Consumers depend only on these types; the underlying
// implementation (currently a stub, later Supabase) can change without touching them.

export interface AuthUser {
  email: string;
  name: string;
}

export interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: AuthUser | null;
  /** True while the initial session is being resolved. */
  loading: boolean;
}
