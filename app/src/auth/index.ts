// Public entry point for the auth layer. Consumers import from './auth' (or
// '../auth') and never from the underlying implementation file, so swapping the
// stub for real auth stays a single-file change.
export { AuthProvider, useAuth, getCurrentUserEmail } from './stubAuth';
export { AuthGate } from './AuthGate';
export type { AuthUser, AuthContextValue } from './types';
