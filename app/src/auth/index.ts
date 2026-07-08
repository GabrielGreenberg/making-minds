// Public entry point for the auth layer. Consumers import from './auth' (or
// '../auth') and never from the underlying implementation file, so swapping
// implementations (toy accounts locally, the server session remotely, UCLA
// SSO later) stays invisible to them.
export { AuthProvider, useAuth, getCurrentUserEmail } from './authProvider';
export { AuthGate } from './AuthGate';
export type { AuthUser, AuthContextValue } from './types';
