import type { ReactNode } from 'react';
import { useAuth } from './stubAuth';
import { LoginScreen } from './LoginScreen';

/**
 * Gates the app behind authentication. Renders the login screen until a user is
 * logged in, then the app. Consumers wrapping with <AuthGate> stay the same when
 * real auth replaces the mockup — only what `useAuth` resolves to changes.
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
    return <LoginScreen />;
  }

  return <>{children}</>;
}
