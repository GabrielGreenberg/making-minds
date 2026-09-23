import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './authProvider';
import { LoginScreen } from './LoginScreen';
import { HealthGate } from './HealthGate';
import { initRouting, routeAccess, setRoutingSignedIn } from '../routing';
import { useRoute } from '../useRoute';

/**
 * The per-route access gate. Access is a property of the route
 * (routing.ts `routeAccess`), so the gate asks what the CURRENT route needs:
 *
 *   public     — rendered for anyone: a signed-in user or a visitor. No
 *                server needed (a visitor's sandbox works while the course
 *                server is down).
 *   signed-in  — (and `instructor`, whose role check is <InstructorGate>'s)
 *                held behind the server-health screen in remote mode, then
 *                "Loading…" while a session restores, then the sign-in screen
 *                if nobody is signed in, then the app.
 *
 * Routing starts HERE, at boot, for everyone: `initRouting` applies the
 * landing rule (a browser with no trace of a previous sign-in, opening `#/`,
 * lands in the sandbox as a visitor) and the initial URL. A route that needs
 * sign-in is held — never applied to the store unauthenticated — and applied
 * the moment someone signs in (`setRoutingSignedIn`), so a deep link like
 * #/a/hw1 opened logged-out lands on hw1 right after the sign-in screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, hasSignInTrace } = useAuth();
  const route = useRoute();

  // Declared first so it runs first: routing must know who is signed in
  // before it applies the initial URL.
  useEffect(() => {
    setRoutingSignedIn(user != null);
  }, [user]);

  useEffect(() => {
    initRouting({ hasSignInTrace: hasSignInTrace() });
  }, [hasSignInTrace]);

  if (routeAccess(route) === 'public') return <>{children}</>;

  return (
    <HealthGate>
      {loading ? (
        <div className="auth-gate-loading" style={{ padding: 24 }}>
          Loading…
        </div>
      ) : user ? (
        children
      ) : (
        <LoginScreen />
      )}
    </HealthGate>
  );
}
