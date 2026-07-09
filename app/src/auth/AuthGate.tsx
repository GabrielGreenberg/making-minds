import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './authProvider';
import { LoginScreen } from './LoginScreen';
import { initRouting } from '../routing';

/**
 * Gates the app behind authentication. Renders the login screen until a user
 * is logged in, then the app. Consumers wrapping with <AuthGate> stay the same
 * when real auth replaces the dev login — only what `useAuth` resolves to
 * changes.
 *
 * Routing starts HERE, not at module init: `initRouting()` applies the initial
 * URL (a deep link like #/a/hw1 fires `openAssignment`, which reads the
 * storage seams), so it must not run until a user exists — in remote mode an
 * unauthenticated open would just 401. Gating it on `user` also means a deep
 * link saved before login is applied right after it, for free. `initRouting`
 * is idempotent, so login → logout → login doesn't re-arm anything.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user) initRouting();
  }, [user]);

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
