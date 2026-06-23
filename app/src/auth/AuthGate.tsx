import type { ReactNode } from 'react';
import { useAuth } from './stubAuth';

/**
 * Gates the app behind authentication. Renders children only when a user is
 * logged in.
 *
 * Under the current stub a user is always present, so the app renders
 * immediately. When real auth lands, the `!user` branch becomes the
 * Login / SetPassword flow — consumers wrapping with <AuthGate> stay the same.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-gate-loading" style={{ padding: 24 }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    // TODO(auth): render the Login / SetPassword screen here once real auth lands.
    // Unreachable under the stub.
    return null;
  }

  return <>{children}</>;
}
