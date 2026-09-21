import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { backendMode } from '../storage/backend';
import { health } from '../api/client';
import { PageShell } from '../components/PageShell';

/**
 * Remote mode's boot gate: nothing renders — not even the login screen —
 * until GET /api/health answers. A down server gets a friendly retry screen
 * (manual Retry button + an automatic re-probe every few seconds), never a
 * white screen and never a silent fall-back to local storage: a hidden local
 * fork of student work would be worse than a visible outage
 * (docs/buildout/designs/remote-stores.md §5).
 *
 * Sits OUTSIDE <AuthProvider> (see main.tsx): the provider's `me()` session
 * restore and the login form only ever run against a server known to be up,
 * so a boot-time outage can't be misread as a dead session. That is also why
 * the screen uses the bare PageShell (no session controls).
 *
 * Local mode renders children directly — no probe, no network, byte-identical.
 */
export function HealthGate({ children }: { children: ReactNode }) {
  if (backendMode !== 'remote') return <>{children}</>;
  return <RemoteHealthGate>{children}</RemoteHealthGate>;
}

const RETRY_INTERVAL_MS = 5000;

function RemoteHealthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking');

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
              Retrying automatically every few seconds.
            </p>
            <button className="mm-btn mm-btn--primary" onClick={() => void probe()}>
              Retry now
            </button>
          </>
        )}
      </div>
    </PageShell>
  );
}
