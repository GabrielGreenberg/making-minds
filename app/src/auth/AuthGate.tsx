import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './authProvider';
import { LoginScreen } from './LoginScreen';
import { HealthGate } from './HealthGate';
import { initRouting, routeAccess, setRoutingPrincipal } from '../routing';
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
 * initial URL as it is — the bare site is Home, so anyone not signed in who
 * opens it gets the sign-in screen, which offers the sandbox as its second
 * choice (one front door, routing.ts). A route that needs
 * sign-in is held — never applied to the store unauthenticated. Every
 * principal change (`setRoutingPrincipal`) re-applies the URL onto the store
 * the auth provider has just reset for the new person: a deep link like
 * #/a/hw1 opened logged-out lands on hw1 right after the sign-in screen, and
 * #/sandbox shows the arriving person's own sandbox.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const route = useRoute();

  // Declared first so it runs first: routing must know who is signed in
  // before it applies the initial URL.
  useEffect(() => {
    setRoutingPrincipal(user?.email ?? null);
  }, [user]);

  useEffect(() => {
    initRouting();
  }, []);

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
