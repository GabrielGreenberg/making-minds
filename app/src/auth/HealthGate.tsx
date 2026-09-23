import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { backendMode } from '../storage/backend';
import { health } from '../api/client';
import { PageShell, hashLink } from '../components/PageShell';

/**
 * Remote mode's server-health state, and the gate built on it.
 *
 * <ServerHealthProvider> wraps the whole app (main.tsx) and probes
 * GET /api/health once at boot. It never blocks rendering on its own: a
 * visitor's sandbox needs no server, so it works while the course server is
 * down. What needs the server — session restore and the sign-in screen —
 * waits on `status === 'ok'` (the RemoteAuthProvider reads it before calling
 * me() or /api/auth/config, so a boot-time outage can't be misread as a dead
 * session), and <HealthGate> shows the retry screen in front of the signed-in
 * routes and the sign-in screen until the probe answers. Never a white screen,
 * never a silent fall-back to local storage: a hidden local fork of student
 * work would be worse than a visible outage
 * (docs/buildout/designs/remote-stores.md §5).
 *
 * Local mode: status is 'ok' from the first render — no probe, no network.
 */

export type ServerStatus = 'checking' | 'ok' | 'down';

interface ServerHealth {
  status: ServerStatus;
  /** Probe again now (the Retry button). */
  probe(): void;
}

const LOCAL_HEALTH: ServerHealth = { status: 'ok', probe: () => {} };

const ServerHealthContext = createContext<ServerHealth>(LOCAL_HEALTH);

export function useServerHealth(): ServerHealth {
  return useContext(ServerHealthContext);
}

export function ServerHealthProvider({ children }: { children: ReactNode }) {
  if (backendMode !== 'remote') return <>{children}</>;
  return <RemoteServerHealthProvider>{children}</RemoteServerHealthProvider>;
}

const RETRY_INTERVAL_MS = 5000;

function RemoteServerHealthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>('checking');

  const probe = useCallback(async () => {
    setStatus((s) => (s === 'ok' ? s : 'checking'));
    const ok = await health();
    // Once up, stay up: mid-session failures surface through the autosave
    // error chip and submit retry alerts, not by unmounting the app.
    setStatus((s) => (s === 'ok' ? s : ok ? 'ok' : 'down'));
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // While down, quietly re-probe so the app recovers on its own when the
  // server comes back — the Retry button is for the impatient.
  useEffect(() => {
    if (status !== 'down') return;
    const timer = setInterval(() => void probe(), RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, probe]);

  return (
    <ServerHealthContext.Provider value={{ status, probe: () => void probe() }}>
      {children}
    </ServerHealthContext.Provider>
  );
}

/**
 * Holds its children (a signed-in route, or the sign-in screen) until the
 * server has answered the health probe, showing the connecting / retry screen
 * meanwhile. Uses the bare PageShell: nothing here depends on a session.
 */
export function HealthGate({ children }: { children: ReactNode }) {
  const { status, probe } = useServerHealth();
  if (status === 'ok') return <>{children}</>;

  return (
    <PageShell variant="card">
      <div className="mm-card mm-card--narrow">
        {status === 'checking' ? (
          <>
            <h1>Connecting…</h1>
            <p className="mm-lede">Reaching the course server.</p>
          </>
        ) : (
          <>
            <h1>The course server can't be reached</h1>
            <p className="mm-lede">
              Your work is safe — nothing is lost — but signing in and saving need the server.
              Retrying automatically every few seconds. The sandbox works without it.
            </p>
            <div className="login-actions">
              <button className="mm-btn mm-btn--primary" onClick={probe}>
                Retry now
              </button>
              <a className="mm-btn" {...hashLink({ kind: 'sandbox' })}>
                Open the sandbox
              </a>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
